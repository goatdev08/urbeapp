// _shared/agency_role.ts
// Interfaz DI para resolver la MEMBRESÍA VIGENTE de un usuario en una agencia.
// Solo el contrato; el adaptador real vive en _shared/clients.ts
// (make_agency_role_resolver) y los tests inyectan fakes.
//
// Es la réplica en Edge Function de private.agency_role_of(agency_id)
// (20260805000003): devuelve el member_role del usuario en ESA agencia SOLO si
// su membresía está en status='active'. Suspendido, removido, invitado o sin
// fila → null. La EF corre con service_role (bypass de RLS) y sin auth.uid(),
// por eso el user_id viaja como parámetro explícito.
//
// Fail-closed: si la query falla, devuelve null. "No pude comprobar la
// membresía" se trata igual que "no hay membresía" — nunca autoriza por defecto.
//
// #202 — la suspensión congela la capacidad de ACTUAR en nombre de la agencia.
// Este resolver es el ÚNICO punto de estrangulamiento de "membresía vigente"
// en las EFs: quien decide sobre una propiedad con agency_id lo consulta,
// incluido el dueño de la fila (antes cortocircuitaba por `is_owner`).
// La interfaz vivía en edit-property/types.ts (#142); se movió aquí al
// necesitarla también update-property-status, para NO duplicarla.

export interface AgencyRoleResolver {
  /**
   * @returns member_role ('owner'|'admin'|'agent'|'viewer'|…) si la membresía
   *          del usuario en esa agencia está ACTIVA; null en cualquier otro
   *          caso (suspendida, removida, inexistente o error de la query).
   */
  resolve(user_id: string, agency_id: string): Promise<string | null>;
}
