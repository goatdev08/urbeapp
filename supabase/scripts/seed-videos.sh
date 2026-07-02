#!/usr/bin/env bash
# supabase/scripts/seed-videos.sh
#
# Carga los videos demo al bucket `property-videos` del STACK LOCAL de Supabase
# y actualiza property_videos SET storage_path, status='ready', ready_at=now().
#
# Prerrequisito: el stack local debe estar corriendo (`supabase start`).
# NO ejecutar contra el proyecto remoto (urbea-app) — es exclusivo para desarrollo local.
#
# Mecanismo (local):
#   - Subida vía Storage REST API con curl + SERVICE_ROLE_KEY (bypassa RLS).
#     `supabase storage cp` NO sirve aquí: exige --experimental y un proyecto
#     linkeado; contra el stack local da LegacyProjectNotLinkedError.
#   - Las credenciales locales (API_URL, SERVICE_ROLE_KEY, DB_URL) se leen de
#     `supabase status -o env` — nada hardcodeado.
#
# Idempotente:
#   - storage: header `x-upsert: true` sobrescribe el objeto si ya existía.
#   - BD: el UPDATE siempre se aplica.
#
# Uso (desde la raíz del repo):
#   supabase start
#   supabase db reset          # aplica migraciones + seed.sql
#   bash supabase/scripts/seed-videos.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="${SCRIPT_DIR}/../demo-assets"

# ── Credenciales del stack local ─────────────────────────────────────────────
# (sobrescribibles por entorno; default: leerlas de `supabase status`)
if [ -z "${API_URL:-}" ] || [ -z "${SERVICE_ROLE_KEY:-}" ] || [ -z "${DB_URL:-}" ]; then
  eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|SERVICE_ROLE_KEY|DB_URL)=')"
fi
if [ -z "${API_URL:-}" ] || [ -z "${SERVICE_ROLE_KEY:-}" ]; then
  echo "[ERROR] No pude obtener API_URL/SERVICE_ROLE_KEY. ¿Está corriendo 'supabase start'?"
  exit 1
fi

# ── Helper SQL: psql si existe, si no docker exec al contenedor de la BD ──────
run_sql() {
  if command -v psql >/dev/null 2>&1; then
    psql "${DB_URL}" -q -c "$1"
  else
    local cid
    cid="$(docker ps --filter name=supabase_db --format '{{.Names}}' | head -1)"
    [ -n "$cid" ] || { echo "[ERROR] sin psql y sin contenedor supabase_db"; exit 1; }
    docker exec -i "$cid" psql -U postgres -d postgres -q -c "$1"
  fi
}

# ── Videos locales disponibles ───────────────────────────────────────────────
# Descargados por 18.4; gitignored. Para descargarlos ver supabase/README.md.
VIDEOS=(
  "${ASSETS_DIR}/sample-1.mp4"
  "${ASSETS_DIR}/sample-2.mp4"
  "${ASSETS_DIR}/sample-3.mp4"
  "${ASSETS_DIR}/sample-4.mp4"
  "${ASSETS_DIR}/sample-5.mp4"
)
N=${#VIDEOS[@]}

# ── Mapeo property_video: "owner_user_id:property_video_id" ──────────────────
# UUIDs coordinados con seed.sql. Convención de path: {owner_user_id}/{property_video_id}.mp4
ENTRIES=(
  "10000000-0000-0000-0000-000000000002:40000000-0000-0000-0000-000000000001"  # agent1 → vid01 (prop01 Providencia dept rent)
  "10000000-0000-0000-0000-000000000002:40000000-0000-0000-0000-000000000002"  # agent1 → vid02 (prop02 Zapopan casa sale)
  "10000000-0000-0000-0000-000000000001:40000000-0000-0000-0000-000000000003"  # owner1 → vid03 (prop03 Americana oficina rent)
  "10000000-0000-0000-0000-000000000004:40000000-0000-0000-0000-000000000004"  # agent2 → vid04 (prop04 Tlaquepaque casa sale)
  "10000000-0000-0000-0000-000000000004:40000000-0000-0000-0000-000000000005"  # agent2 → vid05 (prop05 Americana dept rent)
  "10000000-0000-0000-0000-000000000005:40000000-0000-0000-0000-000000000006"  # agent3 → vid06 (prop06 Americana local sale)
  "10000000-0000-0000-0000-000000000005:40000000-0000-0000-0000-000000000007"  # agent3 → vid07 (prop07 Providencia dept rent)
  "10000000-0000-0000-0000-000000000007:40000000-0000-0000-0000-000000000008"  # agent4 → vid08 (prop08 Zapopan casa sale)
  "10000000-0000-0000-0000-000000000007:40000000-0000-0000-0000-000000000009"  # agent4 → vid09 (prop09 Tlaquepaque terreno sale)
  "10000000-0000-0000-0000-000000000006:40000000-0000-0000-0000-00000000000a"  # owner3 → vid0A (prop0A Providencia casa rent)
)

echo "==> seed-videos.sh — ${#ENTRIES[@]} videos → bucket property-videos (stack local)"
echo "    API: ${API_URL}"
echo ""

# Verifica que haya al menos un video disponible
FOUND=0
for v in "${VIDEOS[@]}"; do [ -f "$v" ] && FOUND=$((FOUND+1)); done
if [ "$FOUND" -eq 0 ]; then
  echo "[ERROR] No se encontró ningún video en ${ASSETS_DIR}/"
  echo "        Descarga los videos primero (ver supabase/README.md — sección 'Videos demo')"
  exit 1
fi
echo "    Videos locales disponibles: ${FOUND}/${N}"
echo ""

idx=0
for entry in "${ENTRIES[@]}"; do
  OWNER="${entry%%:*}"
  VID_ID="${entry##*:}"
  LOCAL="${VIDEOS[$((idx % N))]}"
  SPATH="${OWNER}/${VID_ID}.mp4"
  idx=$((idx + 1))

  # Si el video asignado no existe, rota al primero disponible
  if [ ! -f "$LOCAL" ]; then
    for v in "${VIDEOS[@]}"; do
      if [ -f "$v" ]; then LOCAL="$v"; break; fi
    done
  fi

  echo "  [${idx}/10] Subiendo property-videos/${SPATH}  (${LOCAL##*/})"

  # Sube al bucket local vía Storage REST API (service_role bypassa RLS; x-upsert idempotente)
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "${API_URL}/storage/v1/object/property-videos/${SPATH}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "x-upsert: true" \
    -H "Content-Type: video/mp4" \
    --data-binary "@${LOCAL}")
  if [ "$code" != "200" ]; then
    echo "             [ERROR] subida falló (HTTP ${code})"; exit 1
  fi

  # Actualiza la BD: storage_path, status='ready', ready_at
  run_sql "UPDATE public.property_videos
              SET storage_path = '${SPATH}', status = 'ready', ready_at = now()
            WHERE id = '${VID_ID}';"

  echo "             OK — storage_path='${SPATH}' status='ready'"
done

echo ""
echo "==> Listo. ${#ENTRIES[@]} property_videos ahora en status='ready'."
echo "    Verifica la BD: SELECT id, status, storage_path FROM public.property_videos;"
