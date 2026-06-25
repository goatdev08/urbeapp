// _shared/admin_auth.ts
// Interfaz DI para verificación de caller con rol admin.
// GREEN implementará el adaptador real que consulta public.users con service_role.
//
// Contrato:
//   AdminVerifier.verify_caller(authHeader) → ok: true + user_id | ok: false + error_code
//   - UNAUTHENTICATED: Authorization header ausente o JWT inválido (HTTP 401)
//   - FORBIDDEN: autenticado pero public.users.role != 'admin' (HTTP 403)

export type AdminVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" | "FORBIDDEN" };

/**
 * Contrato del verificador de rol admin. Inyectable vía DI.
 * En producción lo implementa un adaptador que:
 *   1. Extrae JWT del header Authorization.
 *   2. Llama supabase.auth.getUser(jwt) con service_role client.
 *   3. Consulta public.users WHERE id = user.id → verifica role = 'admin'.
 * En tests se inyecta un fake controlado que graba las llamadas.
 */
export interface AdminVerifier {
  verify_caller(authHeader: string | null): Promise<AdminVerifyResult>;
}
