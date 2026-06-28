// supabase/functions/update-property-status/index.ts
// Entry point de producción — STUB fase RED.
// En GREEN: armar deps reales (callerVerifier + propertyStatusUpdater) con service_role client.

import { handler } from "./handler.ts";

Deno.serve((req) => handler(req));
