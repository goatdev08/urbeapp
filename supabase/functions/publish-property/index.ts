// supabase/functions/publish-property/index.ts
// Entry de PRODUCCIÓN (Supabase Edge Function). Construye las dependencias reales
// (supabase-js service_role) e inyecta al handler. La lógica vive en handler.ts;
// los tests importan handler.ts directamente y NO pasan por este archivo.

import { handler } from "./handler.ts";
import {
  make_duplicate_property_checker,
  make_video_status_checker,
  service_client,
} from "../_shared/clients.ts";
import { extract_publish_error_code } from "./types.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  PropertyPublishParams,
  PropertyPublishResult,
  PropertyPublisher,
} from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → role IN ('agent', 'admin')
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

      // Roles permitidos: agent o admin (no 'user')
      if (user_row.role !== "agent" && user_row.role !== "admin") {
        return { ok: false, error_code: "FORBIDDEN" };
      }

      return { ok: true, user_id: user.id };
    },
  };

  // PropertyPublisher real: llama RPC publish_property_atomic (migración 0017,
  // fix 100 en 20260805000011, extendida en 20260809000005 con
  // p_property_status — 73.4: SIN este campo, la RPC hardcodeaba 'active' y
  // el handler.ts que ya mandaba 'pending_review' a este params.property_status
  // se quedaba sin efecto real; ver 20260809000005 para el detalle del fix).
  const propertyPublisher: PropertyPublisher = {
    async publish(
      params: PropertyPublishParams,
    ): Promise<PropertyPublishResult> {
      const { data, error } = await client.rpc("publish_property_atomic", {
        p_user_id: params.user_id,
        p_operation_type: params.operation_type,
        p_property_type: params.property_type,
        p_price: params.price,
        p_bedrooms: params.bedrooms ?? null,
        p_bathrooms: params.bathrooms ?? null,
        p_square_meters: params.square_meters ?? null,
        p_address: params.address,
        p_lat: params.lat,
        p_lng: params.lng,
        p_pet_friendly: params.pet_friendly,
        p_allows_no_guarantor: params.allows_no_guarantor,
        p_student_friendly: params.student_friendly,
        p_price_visible: params.price_visible,
        p_description: params.description ?? null,
        p_cloudflare_uid: params.cloudflare_uid,
        p_property_status: params.property_status,
        p_built_square_meters: params.built_square_meters ?? null,
        p_half_bathrooms: params.half_bathrooms ?? null,
        p_currency: params.currency,
      });

      if (error) {
        // Fix 100 + #173: distinguir los P0001 tipados del RPC del resto de
        // fallas de DB. El mapeo ya NO vive inline aquí: es una función pura en
        // types.ts, porque inline era inalcanzable para los tests y así fue como
        // AGENCY_CANNOT_PUBLISH_PROPERTIES se perdió en un DB_ERROR genérico
        // durante 168.3 sin que ninguna suite lo notara.
        const error_code = extract_publish_error_code(error.message);
        return {
          ok: false,
          error_code,
          message: error.message,
        };
      }

      const row = Array.isArray(data) ? data[0] : data;
      return { ok: true, property_id: row.property_id };
    },
  };

  // 73.4 — pipeline de moderación (PRD §15.2), instanciado con el mismo cliente
  // service_role que el resto de deps.
  const videoStatusChecker = make_video_status_checker(client);
  const duplicatePropertyChecker = make_duplicate_property_checker(client);

  return handler(req, {
    callerVerifier,
    propertyPublisher,
    videoStatusChecker,
    duplicatePropertyChecker,
  });
});
