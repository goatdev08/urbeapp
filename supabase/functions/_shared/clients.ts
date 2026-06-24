// _shared/clients.ts
// Adaptadores de producción: construyen las dependencias del handler a partir del
// cliente supabase-js con service_role. Aquí (y SOLO aquí) se importa supabase-js;
// los handlers y sus tests dependen de las interfaces (DI), no de este módulo.
//
// Variables de entorno disponibles automáticamente en Supabase Edge Functions:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { InvitationDb, InvitationTokenRow } from "./invitation.ts";
import type { AuthAdminClient, CreateUserParams } from "./auth_user.ts";
import type {
  InvitationRedeemer,
  RedeemParams,
  RedeemResult,
} from "./redeem.ts";

/** Cliente supabase-js con service_role (bypassa RLS y column-grants). */
export function service_client(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Adaptador real de InvitationDb. Busca el token por su HASH y trae la agencia
 * por inner join. Descarta agencias soft-deleted (deleted_at IS NOT NULL) en JS
 * (follow-up de 5.2): una agencia borrada no debe permitir canjes aunque su
 * status sea 'active'.
 */
export function make_invitation_db(client: SupabaseClient): InvitationDb {
  return {
    async find_by_hash(hash: string): Promise<InvitationTokenRow | null> {
      const { data, error } = await client
        .from("agency_invitation_tokens")
        .select(
          "id, agency_id, token, max_uses, current_uses, expires_at, revoked_at, agencies!inner(name, status, deleted_at)",
        )
        .eq("token", hash)
        .maybeSingle();

      if (error || data === null) return null;

      // El filtro de soft-delete se aplica en JS, no como filtro embebido de
      // PostgREST (`.is("agencies.deleted_at", null)`), porque ese filtro sobre
      // el recurso embebido descarta la fila padre y devuelve null para tokens
      // válidos. agencies!inner ya garantiza que la agencia existe.
      const raw_agency = data.agencies as unknown;
      const agency = (Array.isArray(raw_agency) ? raw_agency[0] : raw_agency) as
        | { name: string; status: string; deleted_at: string | null }
        | undefined;
      if (agency === undefined || agency.deleted_at !== null) return null;

      return {
        id: data.id,
        agency_id: data.agency_id,
        token: data.token,
        max_uses: data.max_uses,
        current_uses: data.current_uses,
        expires_at: data.expires_at,
        revoked_at: data.revoked_at,
        agency_name: agency.name,
        agency_status: agency.status,
      };
    },
  };
}

/** Adaptador real de AuthAdminClient sobre supabase.auth.admin. */
export function make_auth_admin(client: SupabaseClient): AuthAdminClient {
  return {
    async createUser(params: CreateUserParams) {
      const { data, error } = await client.auth.admin.createUser(params);
      return {
        data: data?.user ? { user: { id: data.user.id } } : null,
        error: error ? { message: error.message } : null,
      };
    },
    async deleteUser(uid: string) {
      await client.auth.admin.deleteUser(uid);
    },
  };
}

// Códigos de negocio que la RPC levanta con SQLSTATE P0001 (mensaje = código).
const REDEEM_CODES = [
  "TOKEN_MAX_USES_REACHED",
  "ALREADY_ACTIVE_MEMBER",
  "USER_NOT_FOUND",
  "NO_ACTIVE_TERMS",
  "NO_ACTIVE_PRIVACY",
];

function extract_redeem_code(message: string): string {
  return REDEEM_CODES.find((c) => message.includes(c)) ?? "REDEEM_FAILED";
}

/** Adaptador real de InvitationRedeemer sobre la RPC redeem_invitation_atomic. */
export function make_redeemer(client: SupabaseClient): InvitationRedeemer {
  return {
    async redeem_atomic(params: RedeemParams): Promise<RedeemResult> {
      const { data, error } = await client.rpc("redeem_invitation_atomic", {
        p_token_id: params.token_id,
        p_user_id: params.user_id,
        p_ip: params.ip ?? null,
      });

      if (error) {
        return { ok: false, error_code: extract_redeem_code(error.message) };
      }
      const row = Array.isArray(data) ? data[0] : data;
      return { ok: true, agency_member_id: row.agency_member_id };
    },
  };
}
