// supabase/functions/update-property-status/property_status_updater.ts
// Fábrica del PropertyStatusUpdater real. Separado de index.ts para ser testeable.
// La lógica de dominio (valid_transitions, ownership, UPDATE shape) vive aquí
// y es ejercitada por property_status_updater.test.ts con un fake client.

import type { AgencyRoleResolver } from "../_shared/agency_role.ts";
import type {
  PropertyStatusEnum,
  PropertyStatusTarget,
  PropertyStatusUpdater,
  UpdatePropertyStatusParams,
  UpdatePropertyStatusResult,
} from "./types.ts";

// Tabla de transiciones válidas — espejo 1:1 del enum property_status en DB (#128).
// El Record sobre PropertyStatusEnum (17 valores) obliga a decidir CADA fila: agregar
// un valor al enum sin su entrada aquí rompe la compilación, no falla en runtime.
// [] = decisión deliberada de "el dueño no tiene acciones desde este estado", no omisión.
// Exportada para el test de exhaustividad (property_status_updater.test.ts).
export const VALID_TRANSITIONS: Record<PropertyStatusEnum, PropertyStatusTarget[]> = {
  // draft→active vigente; #131 decidirá si muere (bypass de moderación).
  draft: ["active"],
  // Moderación (pending_review/needs_changes/suspended/rejected): los mueve
  // moderate-property; el dueño no opina aquí (guard 73.8: tampoco rented/sold
  // antes de estar activa/aprobada).
  pending_review: [],
  needs_changes: [],
  suspended: [],
  rejected: [],
  // Pipeline de media/pago: los mueve el wizard/webhook/flujo de pago.
  uploading_media: [],
  media_failed: [],
  pending_payment: [],
  // Ciclo operativo del dueño.
  active: ["paused", "closed", "rented", "sold"],
  paused: ["active", "closed", "rented", "sold"],
  // approved (73.1/PRD §15.4): aprobada pero aún no activa; puede cerrarse directo.
  approved: ["rented", "sold"],
  // expired: la renovación regresa a pending_review vía flujo de pago (PRD §17), no aquí.
  expired: [],
  // Terminales — sin reapertura en MVP (PRD §16.1).
  closed: [],
  rented: [],
  sold: [],
  deleted_soft: [],
  deleted_hard: [],
};

/**
 * Construye el PropertyStatusUpdater real contra un cliente supabase-js.
 * Responsabilidades (en una sola llamada .update()):
 *   1. Verificar existencia + ownership (query con owner_user_id filter).
 *   2. Distinguir not-found vs unauthorized (segunda query sin owner filter).
 *   2.b Membresía vigente si la fila tiene agency_id (#202).
 *   3. Validar transición de estado contra VALID_TRANSITIONS.
 *   4. Aplicar UPDATE (status, closed_reason, updated_at).
 *   5. Retornar la propiedad actualizada.
 *
 * El parámetro `client` es duck-typed para facilitar el testing con fakes.
 * `agency_role_resolver` es requerido a propósito (#202): no se puede construir
 * este updater sin decidir cómo se comprueba la membresía — el mismo adaptador
 * (_shared/clients.ts) que inyecta edit-property.
 */
export function make_property_status_updater(
  // deno-lint-ignore no-explicit-any
  client: { from(table: string): any },
  agency_role_resolver: AgencyRoleResolver,
): PropertyStatusUpdater {
  return {
    async update(params: UpdatePropertyStatusParams): Promise<UpdatePropertyStatusResult> {
      // 1. Verificar existencia + ownership en una query
      //    agency_id (#202): la fila puede estar publicada bajo una agencia,
      //    y entonces pausarla/cerrarla es actuar en nombre de esa agencia.
      const { data: existing, error: find_error } = await client
        .from("properties")
        .select("id, status, agency_id")
        .eq("id", params.property_id)
        .eq("owner_user_id", params.user_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (find_error) {
        return { ok: false, error_code: "DB_ERROR", message: find_error.message };
      }

      // 2. Si no se encontró con owner filter: distinguir not-found vs unauthorized
      if (!existing) {
        const { data: any_prop } = await client
          .from("properties")
          .select("id")
          .eq("id", params.property_id)
          .is("deleted_at", null)
          .maybeSingle();

        if (!any_prop) {
          return { ok: false, error_code: "PROPERTY_NOT_FOUND" };
        }
        return {
          ok: false,
          error_code: "UNAUTHORIZED_OWNER",
          message: "El caller no es el dueño de la propiedad",
        };
      }

      // 2.b #202 — «suspender congela la capacidad de ACTUAR en nombre de la
      //     agencia». Aquí importa MÁS que en edit-property: pausar y cerrar
      //     son el camino para VACIAR el inventario de la inmobiliaria, y esta
      //     EF corre con service_role (bypass de RLS), así que la policy
      //     properties_update endurecida por 202.1 no la cubre.
      //     Va ANTES de validar la transición: el agente tiene que leer por qué
      //     no puede actuar, no un "transición no permitida" que lo manda a
      //     buscar el bug donde no está (#200).
      //     El dueño independiente (agency_id null) no tiene membresía que mirar.
      if (existing.agency_id) {
        const member_role = await agency_role_resolver.resolve(
          params.user_id,
          existing.agency_id,
        );
        // ponytail: mismo código para suspendido y removido — el resolver
        // devuelve null para ambos (y para un error de query: fail-closed).
        if (member_role === null) {
          return {
            ok: false,
            error_code: "AGENCY_MEMBERSHIP_SUSPENDED",
            message:
              "Tu membresía en la inmobiliaria no está activa: no puedes cambiar el estado de publicaciones a su nombre",
          };
        }
      }

      // 3. Validar transición de estado
      const current = existing.status as PropertyStatusEnum;
      const next = params.new_status;
      // El fallback [] solo puede activarse si la DB tiene un valor de enum más
      // nuevo que este código (deploy desfasado) — fail closed, no crash (#128).
      const allowed: PropertyStatusTarget[] = VALID_TRANSITIONS[current] ?? [];
      if (!allowed.includes(next)) {
        return {
          ok: false,
          error_code: "INVALID_TRANSITION",
          message: `Transición ${current}→${next} no está permitida`,
        };
      }

      // 4. Aplicar UPDATE: ownership en .eq garantiza RLS de backup
      const { data: updated, error: update_error } = await client
        .from("properties")
        .update({
          status: params.new_status,
          closed_reason: params.closed_reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.property_id)
        .eq("owner_user_id", params.user_id)
        .select("id, status, closed_reason")
        .maybeSingle();

      if (update_error || !updated) {
        return {
          ok: false,
          error_code: "DB_ERROR",
          message: update_error?.message ?? "UPDATE no devolvió filas",
        };
      }

      return {
        ok: true,
        property: {
          id: updated.id,
          status: updated.status as PropertyStatusEnum,
          closed_reason: updated.closed_reason ?? null,
        },
      };
    },
  };
}
