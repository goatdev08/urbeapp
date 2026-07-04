// supabase/functions/create-invitation/invitation_creator.ts
// Fábrica del InvitationCreator real. Separado de index.ts para ser testeable.
// Patrón espejo de update-lead-note/note_updater.ts.
//
// Deriva la agencia de la membresía owner activa del caller (única por el
// constraint agency_members_one_active_per_user) — el payload nunca trae
// agency_id. Genera el código con _shared/crypto.ts y persiste SOLO el hash.

import { generate_invitation_code, sha256_hex } from "../_shared/crypto.ts";
import type {
  CreateInvitationParams,
  CreateInvitationResult,
  InvitationCreator,
} from "./types.ts";

/**
 * Construye el InvitationCreator real contra un cliente supabase-js
 * (service_role — la autorización se verifica aquí, no vía RLS).
 * El parámetro `client` es duck-typed para facilitar el testing con fakes.
 */
// deno-lint-ignore no-explicit-any
export function make_invitation_creator(
  client: { from(table: string): any },
): InvitationCreator {
  return {
    async create(params: CreateInvitationParams): Promise<CreateInvitationResult> {
      // 1. Membresía owner activa del caller → deriva agency_id
      const { data: membership, error: membership_error } = await client
        .from("agency_members")
        .select("agency_id")
        .eq("user_id", params.user_id)
        .eq("member_role", "owner")
        .eq("status", "active")
        .maybeSingle();

      if (membership_error) {
        return {
          ok: false,
          error_code: "DB_ERROR",
          message: membership_error.message,
        };
      }
      if (!membership) {
        return { ok: false, error_code: "NOT_AGENCY_OWNER" };
      }

      const agency_id = membership.agency_id as string;

      // 2. La agencia debe estar activa (fail-closed si no aparece)
      const { data: agency, error: agency_error } = await client
        .from("agencies")
        .select("status")
        .eq("id", agency_id)
        .maybeSingle();

      if (agency_error) {
        return { ok: false, error_code: "DB_ERROR", message: agency_error.message };
      }
      if (!agency || agency.status !== "active") {
        return { ok: false, error_code: "AGENCY_INACTIVE" };
      }

      // 3. Generar código plano + hash (el plano NUNCA se persiste)
      const plain_token = generate_invitation_code();
      const token_hash = await sha256_hex(plain_token);

      // 4. INSERT del hash
      const { data: inserted, error: insert_error } = await client
        .from("agency_invitation_tokens")
        .insert({
          agency_id,
          token: token_hash,
          max_uses: params.max_uses,
          expires_at: params.expires_at,
          created_by_user_id: params.user_id,
        })
        .select("id")
        .single();

      if (insert_error || !inserted) {
        return {
          ok: false,
          error_code: "DB_ERROR",
          message: insert_error?.message ?? "INSERT no devolvió filas",
        };
      }

      // 5. El plano sale de aquí UNA sola vez
      return {
        ok: true,
        invitation: {
          token_id: inserted.id as string,
          plain_token,
          agency_id,
          max_uses: params.max_uses,
          expires_at: params.expires_at,
        },
      };
    },
  };
}
