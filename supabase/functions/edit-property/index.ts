// supabase/functions/edit-property/index.ts
// Entry de PRODUCCIÓN (Supabase Edge Function). Construye las dependencias reales
// (supabase-js service_role) e inyecta al handler. La lógica vive en handler.ts
// y revision_upserter.ts — AMBOS con cobertura completa (handler.test.ts,
// revision_upserter.test.ts); los tests NO pasan por este archivo.
//
// ⚠️ Deliberadamente delgado (lección de 73.4: el cableo params→RPC de
// publish-property/index.ts no tenía NINGÚN test y casi deja pending_review
// sin efecto real, ver 20260805000011). Cada adaptador de abajo es UNA sola
// query directa y obvia — sin ramas, sin lógica de negocio — para minimizar
// la superficie sin test. La lógica real (diff §15.5, ownership, upsert de
// property_revisions) vive toda en los módulos SÍ cubiertos.

import { handler } from "./handler.ts";
import { make_revision_upserter } from "./revision_upserter.ts";
import { service_client } from "../_shared/clients.ts";
import type {
  AgencyRoleResolver,
  CallerVerifier,
  CallerVerifyResult,
  CurrentPropertySnapshot,
  DirectPropertyUpdater,
  DirectUpdateResult,
  EditPropertyInput,
  PropertyFetcher,
  PropertyFetchResult,
} from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → is_admin desde public.users.role.
  // Ownership (owner_user_id) se resuelve en el handler contra el snapshot
  // que trae propertyFetcher, no aquí.
  const callerVerifier: CallerVerifier = {
    async verify_caller(
      authHeader: string | null,
    ): Promise<CallerVerifyResult> {
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

      return { ok: true, user_id: user.id, is_admin: user_row.role === "admin" };
    },
  };

  // PropertyFetcher real: snapshot ACTUAL (current_published) de los campos
  // que participan en el diff §15.5 + owner_user_id (ownership). `location`
  // se deja TAL CUAL la devuelve PostgREST (EWKB hex) — location.ts sabe
  // parsear ese formato, no hace falta castear aquí.
  const propertyFetcher: PropertyFetcher = {
    async fetch(property_id: string): Promise<PropertyFetchResult> {
      const { data, error } = await client
        .from("properties")
        .select(
          "id, owner_user_id, agency_id, operation_type, property_type, price, address, location, description",
        )
        .eq("id", property_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) {
        return { ok: false, error_code: "DB_ERROR", message: error.message };
      }
      if (!data) {
        return { ok: false, error_code: "PROPERTY_NOT_FOUND" };
      }
      return { ok: true, property: data as CurrentPropertySnapshot };
    },
  };

  // DirectPropertyUpdater real: camino "sin re-revisión" — UPDATE de TODO el
  // payload (críticos que no cambiaron + no-críticos) en una sola llamada.
  // Mismo shape que el edit_payload que usePublish.ts armaba client-side
  // (decisión de #53) — location solo se incluye si el usuario tocó el mapa.
  const directPropertyUpdater: DirectPropertyUpdater = {
    async apply(
      property_id: string,
      input: EditPropertyInput,
    ): Promise<DirectUpdateResult> {
      const update_payload: Record<string, unknown> = {
        operation_type: input.operation_type,
        property_type: input.property_type,
        price: input.price,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        square_meters: input.square_meters,
        address: input.address,
        price_visible: input.price_visible,
        pet_friendly: input.pet_friendly,
        allows_no_guarantor: input.allows_no_guarantor,
        student_friendly: input.student_friendly,
        description: input.description,
      };
      if (input.location !== undefined) {
        update_payload.location = input.location;
      }

      const { error } = await client
        .from("properties")
        .update(update_payload)
        .eq("id", property_id);

      if (error) {
        return { ok: false, error_code: "DB_ERROR", message: error.message };
      }
      return { ok: true };
    },
  };

  const revisionUpserter = make_revision_upserter(client);

  // AgencyRoleResolver real (#142): réplica de private.agency_role_of pero
  // parametrizada por user_id (aquí no hay auth.uid() — corre con service_role).
  // Membresía ACTIVA en la agencia REAL de la fila; error o sin fila → null
  // (fail-closed: sin rol no hay autorización extra).
  const agencyRoleResolver: AgencyRoleResolver = {
    async resolve(user_id: string, agency_id: string): Promise<string | null> {
      const { data, error } = await client
        .from("agency_members")
        .select("member_role")
        .eq("agency_id", agency_id)
        .eq("user_id", user_id)
        .eq("status", "active")
        .maybeSingle();

      if (error || !data) {
        return null;
      }
      return data.member_role as string;
    },
  };

  return handler(req, {
    callerVerifier,
    propertyFetcher,
    directPropertyUpdater,
    revisionUpserter,
    agencyRoleResolver,
  });
});
