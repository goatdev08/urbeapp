// supabase/functions/moderate-property/index.ts
// Entry point de producción. Construye las dependencias reales (supabase-js
// service_role) e inyecta al handler. La lógica de decisión (state machine)
// vive en handler.ts con su suite DI — este archivo se mantiene DELGADO a
// propósito (mismo patrón que update-property-status; riesgo ya visto en 73.4
// y mitigado en 73.6: un index.ts con lógica propia es lógica sin cobertura).
//
// #130: las tres dependencias de escritura previas (updater/resolver/recorder)
// se reemplazan por make_moderation_writer — UNA llamada a la RPC atómica
// moderate_property_atomic (20260809000007): snapshot + status + resolución de
// revisión + auditoría viajan juntas o se revierten juntas.

import { handler } from "./handler.ts";
import {
  make_admin_verifier,
  make_moderation_writer,
  make_property_fetcher,
  make_revision_finder,
  service_client,
} from "../_shared/clients.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  return handler(req, {
    adminVerifier: make_admin_verifier(client),
    propertyFetcher: make_property_fetcher(client),
    revisionFinder: make_revision_finder(client),
    moderationWriter: make_moderation_writer(client),
  });
});
