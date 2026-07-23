// supabase/functions/stream-webhook/index.ts
// Entry point de producción. Webhook PÚBLICO de Cloudflare Stream — se despliega
// SIN verificación de JWT del gateway (--no-verify-jwt): lo llama Cloudflare
// server-to-server, no un cliente con JWT de Supabase. La verificación de firma
// HMAC (header Webhook-Signature, ver handler.ts) es la ÚNICA barrera de
// autenticación de esta función.
//
// Deploy (gotchas documentados):
//   supabase functions deploy stream-webhook \
//     --import-map supabase/functions/deno.json --no-verify-jwt --use-api
//   (--import-map porque esta EF importa _shared/clients.ts; --use-api porque el
//   bundler local requiere Docker, ver supabase_deploy_import_map_gotcha).
//
// Tras deployar, registra el webhook en Cloudflare Stream:
//   PUT https://api.cloudflare.com/client/v4/accounts/{STREAM_ACCOUNT_ID}/stream/webhook
//   body { notificationUrl: "<url de esta función>" }
// La respuesta trae el secret HMAC que Cloudflare usará para firmar — ese valor
// es el que hay que cargar como STREAM_WEBHOOK_SECRET en los secrets de Supabase
// (cierra el ciclo diferido de la subtarea 68.1). NO se despliega/registra aquí.

import { make_stream_webhook_handler } from "./handler.ts";
import {
  make_video_event_notifier,
  make_video_status_updater,
  service_client,
} from "../_shared/clients.ts";

const client = service_client();
const respond = make_stream_webhook_handler({
  webhookSecret: Deno.env.get("STREAM_WEBHOOK_SECRET") ?? "",
  videoStatusUpdater: make_video_status_updater(client),
  notifier: make_video_event_notifier(),
});

Deno.serve((req: Request) => respond(req));
