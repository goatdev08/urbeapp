#!/usr/bin/env bash
# fake-stream-webhook.sh — simula el webhook de Cloudflare Stream contra el
# stack LOCAL. Solo para desarrollo; en remoto Cloudflare lo entrega solo.
#
# EL PROBLEMA QUE RESUELVE: Cloudflare no puede alcanzar tu localhost, así que
# un video subido desde el wizard se queda en 'uploading' para siempre y
# useAdUpload se rinde a los ~30 s (10 intentos × 3 s) con un mensaje neutro.
#
# QUÉ HACE: busca creativos que aún no están 'ready', le pregunta a la API de
# Stream si ya terminaron de codificar, y le entrega al EF stream-webhook LOCAL
# el MISMO payload firmado que mandaría Cloudflare. Va por el camino real
# (firma HMAC incluida), no por un UPDATE a la DB: así el ramal de anuncios del
# webhook (#170.4) queda ejercitado de verdad.
#
# Uso:  ./fake-stream-webhook.sh [segundos_de_espera]     # default 120
# Requiere: `supabase functions serve` corriendo y supabase/functions/.env.
#
# Contra una RAMA preview de Supabase (Cloudflare tampoco la alcanza, su webhook
# apunta a producción) — exporta antes:
#   WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/stream-webhook
#   PSQL_CMD="docker exec -i supabase_db_urbea-app psql <db-url-de-la-rama> -tAc"

set -euo pipefail
cd "$(dirname "$0")/.."          # → supabase/
DEADLINE=$(( $(date +%s) + ${1:-120} ))
PSQL="${PSQL_CMD:-docker exec -i supabase_db_urbea-app psql -U postgres -d postgres -tAc}"
WEBHOOK_URL="${WEBHOOK_URL:-http://127.0.0.1:54321/functions/v1/stream-webhook}"

set -a && . functions/.env && set +a
: "${STREAM_ACCOUNT_ID:?falta STREAM_ACCOUNT_ID}" "${STREAM_API_TOKEN:?falta STREAM_API_TOKEN}" "${STREAM_WEBHOOK_SECRET:?falta STREAM_WEBHOOK_SECRET}"

echo "→ vigilando creativos pendientes (hasta $(( (DEADLINE - $(date +%s)) ))s)…"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  # Ambas tablas: el handler intenta property_videos primero y cae a
  # ad_creatives solo si aquella afectó 0 filas (ver stream-webhook/index.ts).
  uids=$($PSQL "select cloudflare_uid from public.ad_creatives   where status <> 'ready' and cloudflare_uid is not null
                union
                select cloudflare_uid from public.property_videos where status <> 'ready' and cloudflare_uid is not null;")
  for uid in $uids; do
    payload=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${STREAM_ACCOUNT_ID}/stream/${uid}" \
      -H "Authorization: Bearer ${STREAM_API_TOKEN}" \
      | python3 -c '
import sys, json
r = (json.load(sys.stdin).get("result") or {})
if (r.get("status") or {}).get("state") != "ready":
    sys.exit(1)
# Shape exacto del webhook de Cloudflare: uid, status.state, duration, thumbnail.
print(json.dumps({"uid": r["uid"], "status": {"state": "ready"},
                  "duration": r.get("duration"), "thumbnail": r.get("thumbnail")}))') || continue

    # sig1 = HMAC-SHA256(secret, "<time>.<raw_body>") — el raw body EXACTO.
    ts=$(date +%s)
    sig=$(python3 -c '
import hashlib, hmac, sys
print(hmac.new(sys.argv[1].encode(), f"{sys.argv[2]}.{sys.argv[3]}".encode(), hashlib.sha256).hexdigest())' \
      "$STREAM_WEBHOOK_SECRET" "$ts" "$payload")

    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" -H "Webhook-Signature: time=${ts},sig1=${sig}" -d "$payload")
    echo "   ${uid:0:8}… → webhook HTTP ${code}"
  done
  [ -z "$uids" ] && { echo "✓ no quedan creativos pendientes"; exit 0; }
  sleep 5
done
echo "⏱  se acabó el tiempo; quedan creativos sin marcar (revisa functions serve)."
