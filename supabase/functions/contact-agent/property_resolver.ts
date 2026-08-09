// supabase/functions/contact-agent/property_resolver.ts
// Fábrica del PropertyResolver real — GREEN 75.4.
//
// Extraído (no reescrito) del closure inline de `Deno.serve` en index.ts:43-85,
// mismo movimiento que 75.1 hizo con lead_repo.ts: el adapter vivía dentro del
// entry point y por eso NADIE lo testeaba. El hueco que eso escondía: el resolver
// nunca llenaba `video_id` (había un `ponytail:` admitiéndolo), así que
// lead_origin_properties.property_video_id era NULL en TODA la producción — y §9.6
// pide que el contacto quede asociado a propiedad **y video** de origen.
//
// Cambios de columnas respecto al closure viejo:
//   + property_type, zone  → insumos del template §19.3 ("[tipo + zona]")
//   + property_videos      → video de origen (§9.6)
//   − price, operation_type → el template ya no lleva precio; ver types.ts

import type { PropertyResolveResult, PropertyResolver } from "./types.ts";

interface VideoRow {
  id: string;
  position: number;
  deleted_at: string | null;
}

/**
 * Video de origen = el principal de la propiedad: `position` más baja entre los vivos.
 * El orden del array que devuelve PostgREST NO es confiable, así que se ordena aquí.
 * Sin videos vivos → undefined (insert_origin lo traduce a property_video_id = NULL).
 */
function pick_origin_video(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  const vivos = (raw as VideoRow[])
    .filter((v) => v !== null && typeof v === "object" && v.deleted_at === null)
    .sort((a, b) => a.position - b.position);
  return vivos.length > 0 ? vivos[0].id : undefined;
}

// deno-lint-ignore no-explicit-any
export function make_property_resolver(client: { from(table: string): any }): PropertyResolver {
  return {
    async resolve(propertyId: string): Promise<PropertyResolveResult> {
      const { data, error } = await client
        .from("properties")
        .select(
          `id, address, property_type, zone, status, owner_user_id,
           users!properties_owner_user_id_fkey(id, first_name, last_name, phone),
           property_videos(id, position, deleted_at)`,
        )
        .eq("id", propertyId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) return { ok: false, error_code: "DB_ERROR" };
      if (!data) return { ok: false, error_code: "PROPERTY_NOT_FOUND" };

      // PostgREST retorna to-one join como objeto; guard de array por robustez
      // (mismo patrón que make_invitation_db en _shared/clients.ts).
      const raw_user = data.users;
      const agent_user = (Array.isArray(raw_user) ? raw_user[0] : raw_user) as
        | { id: string; first_name: string; last_name: string; phone: string | null }
        | undefined
        | null;

      // Propiedad sin dueño en users → tratar como no encontrada
      if (!agent_user) return { ok: false, error_code: "PROPERTY_NOT_FOUND" };

      return {
        ok: true,
        data: {
          id: data.id,
          address: data.address,
          property_type: data.property_type,
          zone: data.zone,
          status: data.status,
          owner_user_id: data.owner_user_id,
          agent_id: agent_user.id,
          agent_name: `${agent_user.first_name} ${agent_user.last_name}`,
          agent_phone: agent_user.phone,
          video_id: pick_origin_video(data.property_videos),
        },
      };
    },
  };
}
