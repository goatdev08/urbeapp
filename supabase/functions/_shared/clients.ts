// _shared/clients.ts
// Adaptadores de producción: construyen las dependencias del handler a partir del
// cliente supabase-js con service_role. Aquí (y SOLO aquí) se importa supabase-js;
// los handlers y sus tests dependen de las interfaces (DI), no de este módulo.
//
// Variables de entorno disponibles automáticamente en Supabase Edge Functions:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { InvitationDb, InvitationTokenRow } from "./invitation.ts";
import type {
  AuthAdminClient,
  CreateUserParams,
  GenerateInviteLinkParams,
  GenerateInviteLinkResponse,
} from "./auth_user.ts";
import type {
  InvitationRedeemer,
  RedeemParams,
  RedeemResult,
} from "./redeem.ts";
import type { AdminVerifier, AdminVerifyResult } from "./admin_auth.ts";
import type {
  AgencyCreateParams,
  AgencyCreateResult,
  AgencyCreator,
} from "./agency.ts";

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
    /** Stub RED 7.5 — GREEN implementará la llamada real a generateLink. */
    async generateInviteLink(
      _params: GenerateInviteLinkParams,
    ): Promise<GenerateInviteLinkResponse> {
      throw new Error(
        "not_implemented: generateInviteLink en clients.ts — implement in GREEN 7.5",
      );
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

/**
 * Adaptador real de AdminVerifier.
 * Verifica el JWT en el header Authorization usando el service_role client:
 *   1. Extrae el JWT del header "Bearer <token>".
 *   2. Llama client.auth.getUser(jwt) para validar el JWT.
 *   3. Consulta public.users WHERE id = user.id → verifica role = 'admin'.
 */
export function make_admin_verifier(client: SupabaseClient): AdminVerifier {
  return {
    async verify_caller(
      authHeader: string | null,
    ): Promise<AdminVerifyResult> {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }

      const jwt = authHeader.replace(/^Bearer\s+/, "");
      const {
        data: { user },
        error: auth_error,
      } = await client.auth.getUser(jwt);
      if (auth_error || !user) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }

      const { data: user_row, error: user_error } = await client
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (user_error || !user_row) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      if (user_row.role !== "admin") {
        return { ok: false, error_code: "FORBIDDEN" };
      }
      return { ok: true, user_id: user.id };
    },
  };
}

// Códigos de negocio que la RPC admin_create_agency_atomic levanta con SQLSTATE P0001.
const AGENCY_ERROR_CODES = ["SLUG_DUPLICATE", "NAME_DUPLICATE", "CREATED_BY_REQUIRED"];

function extract_agency_error_code(message: string): string {
  return AGENCY_ERROR_CODES.find((c) => message.includes(c)) ?? "DB_ERROR";
}

/**
 * Adaptador real de AgencyCreator sobre la RPC admin_create_agency_atomic (migración 0016).
 * Mapea los errores P0001 al error_code de negocio correspondiente.
 */
export function make_agency_creator(client: SupabaseClient): AgencyCreator {
  return {
    async create_atomic(
      params: AgencyCreateParams,
    ): Promise<AgencyCreateResult> {
      const { data, error } = await client.rpc("admin_create_agency_atomic", {
        p_name: params.name,
        p_slug: params.slug,
        p_contact_name: params.contact_name ?? null,
        p_contact_phone: params.contact_phone ?? null,
        p_contact_email: params.contact_email ?? null,
        p_created_by_user_id: params.created_by_user_id,
      });
      if (error) {
        const error_code = extract_agency_error_code(error.message);
        return { ok: false, error_code };
      }
      return { ok: true, agency_id: data as string };
    },
  };
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
