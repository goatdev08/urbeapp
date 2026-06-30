// supabase/functions/contact-agent/index.ts
// Entry point de producción — stub fase RED 14.2.
// La lógica vive en handler.ts con DI inyectable; este archivo es un thin wrapper.
//
// GREEN conectará deps reales:
//   - service_client() de _shared/clients.ts
//   - CallerVerifier real: JWT → getUser → user_id

import { make_contact_agent_handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  PropertyResolver,
  PropertyResolveResult,
} from "./types.ts";

// ponytail: stub — se completará en GREEN con deps reales
const callerVerifier: CallerVerifier = {
  verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
    throw new Error("not_implemented");
  },
};

// ponytail: stub — se conectará al repo Postgres real en 14.3 GREEN
const propertyResolver: PropertyResolver = {
  resolve(_propertyId: string): Promise<PropertyResolveResult> {
    throw new Error("not_implemented");
  },
};

const handle = make_contact_agent_handler({ callerVerifier, propertyResolver });

Deno.serve((req: Request) => handle(req));
