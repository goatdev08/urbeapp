// supabase/functions/record-ad-impressions/index.ts
// Entry point de producción — GREEN, subtarea 170.6. Construye las
// dependencias reales (supabase-js service_role) e inyecta al handler. La
// lógica de negocio (elegibilidad, derivación del id, umbral de viewed)
// vive en handler.ts/types.ts; los adapters (AdsRepository/ZoneResolver/
// ImpressionsWriter) viven en _shared/clients.ts
// (make_ads_repository/make_zone_resolver/make_impressions_writer), mismo
// patrón que make_ad_url_minter (169.5) — los tests importan handler.ts
// directo y NO pasan por este archivo.
//
// Deploy (mismo gotcha que mint-ad-urls, documentado ahí): esta EF importa
// _shared/clients.ts →
//   supabase functions deploy record-ad-impressions --import-map supabase/functions/deno.json --use-api

import { handler } from "./handler.ts";
import {
  make_ads_repository,
  make_impressions_writer,
  make_zone_resolver,
  service_client,
} from "../_shared/clients.ts";
import type { CallerVerifier, CallerVerifyResult } from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  const callerVerifier: CallerVerifier = {
    async verify_caller(authHeader: string | null): Promise<CallerVerifyResult> {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      const jwt = authHeader.replace(/^Bearer\s+/, "");
      const { data: { user }, error } = await client.auth.getUser(jwt);
      if (error || !user) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      return { ok: true, user_id: user.id };
    },
  };

  return handler(req, {
    callerVerifier,
    adsRepository: make_ads_repository(client),
    zoneResolver: make_zone_resolver(client),
    impressionsWriter: make_impressions_writer(client),
    now: () => new Date(),
  });
});
