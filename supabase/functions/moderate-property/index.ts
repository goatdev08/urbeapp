// supabase/functions/moderate-property/index.ts
// Entry point de producción. Construye las 6 dependencias reales (supabase-js
// service_role) e inyecta al handler. La lógica de decisión (state machine +
// auditoría) vive en handler.ts, que ya tiene 39 tests — este archivo se
// mantiene DELGADO a propósito (mismo patrón que update-property-status;
// riesgo ya visto en 73.4 y mitigado en 73.6: un index.ts con lógica propia
// es lógica sin cobertura).

import { handler } from "./handler.ts";
import {
  make_admin_action_recorder,
  make_admin_verifier,
  make_property_fetcher,
  make_property_updater,
  make_revision_finder,
  make_revision_resolver,
  service_client,
} from "../_shared/clients.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  return handler(req, {
    adminVerifier: make_admin_verifier(client),
    propertyFetcher: make_property_fetcher(client),
    revisionFinder: make_revision_finder(client),
    propertyUpdater: make_property_updater(client),
    revisionResolver: make_revision_resolver(client),
    adminActionRecorder: make_admin_action_recorder(client),
  });
});
