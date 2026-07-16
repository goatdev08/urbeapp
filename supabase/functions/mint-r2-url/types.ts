// supabase/functions/mint-r2-url/types.ts
// Tipos y contratos de DI para la Edge Function mint-r2-url — subtarea 69.2.
// Solo interfaces; sin imports de supabase-js ni aws4fetch (adapters reales en
// _shared/clients.ts o _shared/r2_client.ts, GREEN los conecta en index.ts).
//
// Responsabilidad de la EF:
//   Firma URLs presigned de Cloudflare R2 (S3-compatible) para PUT (subida) y
//   GET (lectura, en LOTE) de tres tipos de asset:
//     - avatar : prefix "avatars/<user_id>/..."  → dueño = el propio usuario.
//     - logo   : prefix "logos/<agency_id>/..."  → dueño = owner activo de esa agencia.
//     - archive: prefix "archive/..."            → cold-store (tarea #68), sin
//                autorización de usuario final en el alcance de put de esta subtarea;
//                el GET de archive sí sigue la regla general (cualquier autenticado).
//
// AUTZ fail-closed (frontera de confianza — invariante 🔒):
//   op=put, kind=avatar → SOLO el dueño del prefix (user_id del JWT == uid del key).
//   op=put, kind=logo   → SOLO el owner activo (member_role='owner') de ESA agencia.
//   op=get              → cualquier usuario autenticado (bucket privado, lectura
//                          server-side vía presigned; sin JWT sigue siendo 401).
//
// TTL (decisión registrada en 69.2): PUT 15 min, GET 1 h. El "expires" en la
// respuesta es la duración del TTL en segundos (no un timestamp absoluto).

export type AssetKind = "avatar" | "logo" | "archive";
export type R2Operation = "put" | "get";

export const PUT_TTL_SECONDS = 15 * 60; // 900
export const GET_TTL_SECONDS = 60 * 60; // 3600

// ── Input crudo del body (antes de validar) ───────────────────────────────────

export interface MintR2UrlRawInput {
  kind: AssetKind;
  op: R2Operation;
  key?: string;
  keys?: string[];
}

// ── Input validado (discriminado por op) ──────────────────────────────────────

export interface MintR2UrlPutInput {
  op: "put";
  kind: AssetKind;
  key?: string; // si está ausente, el handler lo deriva (avatar: del propio user_id)
}

export interface MintR2UrlGetInput {
  op: "get";
  kind: AssetKind;
  keys: string[]; // lote no vacío de keys a firmar para lectura
}

export type MintR2UrlInput = MintR2UrlPutInput | MintR2UrlGetInput;

// ── CallerVerifier — mismo contrato que update-property-status ───────────────
// Verifica que el JWT pertenece a un usuario autenticado y devuelve user_id.
// No verifica rol aquí — la autorización por rol/ownership la hace el handler
// con AgencyOwnershipVerifier (kind=logo) o comparación directa (kind=avatar).

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── AgencyOwnershipVerifier — autoriza op=put kind=logo ───────────────────────
// Devuelve el agency_id del que el usuario es owner ACTIVO
// (agency_members.member_role='owner' AND status='active'), o null si no es
// owner de ninguna agencia. Una sola llamada resuelve "¿es owner?" y "¿de cuál?".

export interface AgencyOwnershipVerifier {
  get_owned_agency_id(user_id: string): Promise<string | null>;
}

// ── R2UrlMinter — adapter PURO de firma (sin lógica de autorización) ─────────
// El handler ya autorizó antes de llamar; este componente solo firma con
// aws4fetch contra el endpoint S3 de R2 (implementado en GREEN).

export interface SignedGetItem {
  key: string;
  url: string;
  expires: number;
}

export interface R2UrlMinter {
  sign_put(key: string, ttl_seconds: number): Promise<string>;
  sign_get_batch(
    keys: string[],
    ttl_seconds: number,
  ): Promise<SignedGetItem[]>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface MintR2UrlDeps {
  callerVerifier: CallerVerifier;
  agencyOwnershipVerifier: AgencyOwnershipVerifier;
  r2UrlMinter: R2UrlMinter;
}

// ── Shape de respuesta ────────────────────────────────────────────────────────

export interface SignedPutResponse {
  url: string;
  key: string;
  expires: number;
}

export interface SignedGetResponse {
  urls: SignedGetItem[];
}
