// supabase/functions/mint-r2-url/index.ts
// Entry point de producción — STUB fase RED.
// En GREEN: armar deps reales (callerVerifier, agencyOwnershipVerifier vía
// service_role client, r2UrlMinter con aws4fetch contra el endpoint S3 de R2).

import { handler } from "./handler.ts";

Deno.serve((req) => handler(req));
