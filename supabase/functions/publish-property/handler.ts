// supabase/functions/publish-property/handler.ts
// STUB mínimo — fase RED subtarea 8.9.
// No implementa lógica de negocio. Siempre devuelve NOT_IMPLEMENTED (500)
// para que los tests fallen por aserción (no por import).
//
// La implementación real (GREEN) seguirá el patrón DI:
//   validación → autorización (CallerVerifier) → publicación (PropertyPublisher) → respuesta
//
// Flujo GREEN:
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405)
//   3. Parsear JSON body → parse_publish_property_input (validación, 400 si falla)
//   4. callerVerifier.verify_caller(authHeader) → 401/403 si falla
//   5. propertyPublisher.publish(params con property_status='active', video_status='ready')
//   6. Si publish falla → 500 propagado limpio
//   7. Si publish ok → 201 { property_id }

import { error_response } from "../_shared/response.ts";
import type { PublishPropertyDeps } from "./types.ts";

export async function handler(
  _req: Request,
  _deps?: PublishPropertyDeps,
): Promise<Response> {
  // ponytail: stub RED — lanza por aserción en tests, no por import
  return error_response("NOT_IMPLEMENTED", "not_implemented", 500);
}
