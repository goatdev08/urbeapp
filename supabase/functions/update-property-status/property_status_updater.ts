// supabase/functions/update-property-status/property_status_updater.ts
// Fábrica del PropertyStatusUpdater real. Separado de index.ts para ser testeable.
// La lógica de dominio (valid_transitions, ownership, UPDATE shape) vive aquí
// y es ejercitada por property_status_updater.test.ts con un fake client.

import type {
  PropertyStatusEnum,
  PropertyStatusUpdater,
  UpdatePropertyStatusParams,
  UpdatePropertyStatusResult,
} from "./types.ts";

// Tabla de transiciones válidas — toda transición no listada → INVALID_TRANSITION.
// closed: [] = propiedad cerrada es estado terminal.
const VALID_TRANSITIONS: Record<PropertyStatusEnum, PropertyStatusEnum[]> = {
  draft: ["active"],
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: [],
};

/**
 * Construye el PropertyStatusUpdater real contra un cliente supabase-js.
 * Responsabilidades (en una sola llamada .update()):
 *   1. Verificar existencia + ownership (query con owner_user_id filter).
 *   2. Distinguir not-found vs unauthorized (segunda query sin owner filter).
 *   3. Validar transición de estado contra VALID_TRANSITIONS.
 *   4. Aplicar UPDATE (status, closed_reason, updated_at).
 *   5. Retornar la propiedad actualizada.
 *
 * El parámetro `client` es duck-typed para facilitar el testing con fakes.
 */
// deno-lint-ignore no-explicit-any
export function make_property_status_updater(client: { from(table: string): any }): PropertyStatusUpdater {
  return {
    async update(params: UpdatePropertyStatusParams): Promise<UpdatePropertyStatusResult> {
      // 1. Verificar existencia + ownership en una query
      const { data: existing, error: find_error } = await client
        .from("properties")
        .select("id, status")
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

      // 3. Validar transición de estado
      const current = existing.status as PropertyStatusEnum;
      const next = params.new_status;
      if (!VALID_TRANSITIONS[current]?.includes(next)) {
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
