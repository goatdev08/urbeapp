// supabase/functions/record-ad-impressions/index.ts
// Entry point de producción — STUB, fase RED (subtarea 170.6). CallerVerifier
// es infraestructura genérica (idéntica a mint-ad-urls/mint-poster-urls,
// JWT → uid); AdsRepository/ZoneResolver/ImpressionsWriter son la lógica de
// negocio de esta EF y quedan sin implementar a propósito (GREEN, fuera de
// esta fase) — lanzan not_implemented si algo llega a invocarlos.
//
// Deploy (mismo gotcha que mint-ad-urls, documentado ahí): si esta EF
// termina importando _shared/clients.ts, el deploy necesita
//   supabase functions deploy record-ad-impressions --import-map supabase/functions/deno.json --use-api

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { handler } from "./handler.ts";
import type {
  AdRecord,
  AdsRepository,
  CallerVerifier,
  CallerVerifyResult,
  ImpressionRow,
  ImpressionsWriter,
  ResolvedZone,
  ZoneResolver,
} from "./types.ts";

function service_client(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

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

  const adsRepository: AdsRepository = {
    fetch_ads(_ad_ids: string[]): Promise<AdRecord[]> {
      throw new Error("not_implemented");
    },
  };

  const zoneResolver: ZoneResolver = {
    resolve_zone(_lat: number, _lng: number): Promise<ResolvedZone> {
      throw new Error("not_implemented");
    },
  };

  const impressionsWriter: ImpressionsWriter = {
    upsert_impressions(_rows: ImpressionRow[]): Promise<void> {
      throw new Error("not_implemented");
    },
    record_cta_tap(_id: string, _cta_tapped_at: string): Promise<void> {
      throw new Error("not_implemented");
    },
  };

  return handler(req, {
    callerVerifier,
    adsRepository,
    zoneResolver,
    impressionsWriter,
    now: () => new Date(),
  });
});
