// supabase/functions/publish-property/index.ts
// Entry de PRODUCCIÓN (Supabase Edge Function) — stub fase RED.
// La implementación GREEN importará make_caller_verifier y make_property_publisher
// desde _shared/clients.ts y los inyectará al handler.

import { handler } from "./handler.ts";

Deno.serve((req: Request) => handler(req));
