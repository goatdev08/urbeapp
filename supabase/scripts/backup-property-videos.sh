#!/usr/bin/env bash
# supabase/scripts/backup-property-videos.sh
#
# Respaldo puntual (one-off) de los videos legacy de `property_videos` que viven en
# Supabase Storage (bucket `property-videos`), ANTES de apagar ese flujo viejo
# (migración a Cloudflare Stream, tarea #68). Solo LEE — nunca borra nada del bucket.
#
# Uso:
#   export SUPABASE_SERVICE_ROLE_KEY="..."   # requerido — Storage/PostgREST del proyecto
#   # opcionales (con default al proyecto remoto urbea-app, ver supabase/README.md):
#   export SUPABASE_URL="https://mvpvqmyhrrkwbnpctpuq.supabase.co"
#   export BUCKET="property-videos"
#   export OUTPUT_DIR="supabase/scripts/video-backups"
#   bash supabase/scripts/backup-property-videos.sh
#
# Mecanismo:
#   1. Lista `public.property_videos` con storage_path no nulo vía PostgREST
#      (`${SUPABASE_URL}/rest/v1/property_videos`) autenticado con la service_role key
#      (bypassa RLS — necesario porque cada video es privado a su dueño).
#      # ponytail: PostgREST + service_role en vez de psql/DATABASE_URL — un solo
#      # mecanismo de auth para listar y descargar, sin pedir otra credencial más.
#   2. Descarga cada objeto del bucket a `${OUTPUT_DIR}/<storage_path>` (la ruta ya
#      trae la estructura `<owner_user_id>/<property_video_id>.mp4`, se preserva tal cual).
#   3. Idempotente: si el archivo de salida ya existe, se SALTA (no se re-descarga).
#      Usa FORCE=1 para sobrescribir.
#   4. Imprime un resumen final: filas en BD vs archivos descargados/existentes.
#
# Fail-safe: solo GET (Storage + PostgREST). Ningún DELETE/UPDATE contra el proyecto.
#
# BLOQUEANTE CONOCIDO (2026-07-21): el gateway del proyecto remoto `urbea-app` está en
# HTTP 402 (exceed_cached_egress_quota) — Storage también lo sufre (mismo dominio de
# egress), no solo Edge Functions. El script detecta un 402/403 en el primer intento de
# descarga, avisa y se detiene sin marcar error fatal: correr de nuevo cuando el proyecto
# libere la restricción de billing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Credenciales / configuración ─────────────────────────────────────────────
SUPABASE_URL="${SUPABASE_URL:-https://mvpvqmyhrrkwbnpctpuq.supabase.co}"
BUCKET="${BUCKET:-property-videos}"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/video-backups}"
FORCE="${FORCE:-0}"

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "[ERROR] Falta SUPABASE_SERVICE_ROLE_KEY (service_role key del proyecto ${SUPABASE_URL})."
  echo "        Se necesita para leer property_videos (bypass RLS) y descargar del bucket ${BUCKET}."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[ERROR] Falta 'jq' (parseo del JSON de PostgREST). Instálalo (brew install jq) y reintenta."
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"

echo "==> backup-property-videos.sh"
echo "    Proyecto: ${SUPABASE_URL}"
echo "    Bucket:   ${BUCKET}"
echo "    Salida:   ${OUTPUT_DIR}"
echo ""

# ── 1. Listar property_videos con storage_path no nulo (vía PostgREST) ──────
LIST_TMP="$(mktemp)"
trap 'rm -f "${LIST_TMP}"' EXIT
LIST_HTTP_CODE="$(curl -sS -o "${LIST_TMP}" -w '%{http_code}' \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Accept: application/json" \
  "${SUPABASE_URL}/rest/v1/property_videos?select=id,storage_path&storage_path=not.is.null")"
ROWS_JSON="$(cat "${LIST_TMP}")"

if [ "${LIST_HTTP_CODE}" = "402" ] || [ "${LIST_HTTP_CODE}" = "403" ]; then
  echo "    [BLOQUEANTE] PostgREST devolvió HTTP ${LIST_HTTP_CODE} al listar property_videos:"
  echo "    $(echo "${ROWS_JSON}" | head -c 300)"
  echo ""
  echo "    El gateway del proyecto remoto está restringido (billing). No se puede ni"
  echo "    listar ni descargar. Vuelve a correr este script cuando se libere la restricción."
  exit 0
fi

if ! echo "${ROWS_JSON}" | jq -e 'type == "array"' >/dev/null 2>&1; then
  echo "[ERROR] Respuesta inesperada de PostgREST al listar property_videos (HTTP ${LIST_HTTP_CODE}):"
  echo "${ROWS_JSON}"
  exit 1
fi

DB_COUNT="$(echo "${ROWS_JSON}" | jq 'length')"
echo "    Filas en BD con storage_path: ${DB_COUNT}"
echo ""

if [ "${DB_COUNT}" -eq 0 ]; then
  echo "==> Nada que respaldar (0 filas con storage_path). Listo."
  exit 0
fi

# ── 2. Descargar cada objeto, preservando storage_path como ruta local ──────
DOWNLOADED=0
SKIPPED_EXISTING=0
BLOCKED=0

while IFS=$'\t' read -r id storage_path; do
  [ -n "${storage_path}" ] || continue
  DEST="${OUTPUT_DIR}/${storage_path}"

  if [ "${BLOCKED}" -eq 1 ]; then
    echo "  [SKIP] ${storage_path} (descarga bloqueada, ver resumen)"
    continue
  fi

  if [ -f "${DEST}" ] && [ "${FORCE}" != "1" ]; then
    echo "  [SKIP] ${storage_path} (ya existe en disco; FORCE=1 para sobrescribir)"
    SKIPPED_EXISTING=$((SKIPPED_EXISTING + 1))
    continue
  fi

  mkdir -p "$(dirname "${DEST}")"
  TMP="${DEST}.part"
  HTTP_CODE="$(curl -sS -o "${TMP}" -w '%{http_code}' \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storage_path}")"

  if [ "${HTTP_CODE}" = "200" ]; then
    mv "${TMP}" "${DEST}"
    echo "  [OK]   ${storage_path}"
    DOWNLOADED=$((DOWNLOADED + 1))
  elif [ "${HTTP_CODE}" = "402" ] || [ "${HTTP_CODE}" = "403" ]; then
    echo "  [BLOQUEADO] ${storage_path} — HTTP ${HTTP_CODE}"
    echo "              $(cat "${TMP}" 2>/dev/null | head -c 300)"
    rm -f "${TMP}"
    BLOCKED=1
  else
    echo "  [ERROR] ${storage_path} — HTTP ${HTTP_CODE}"
    rm -f "${TMP}"
  fi
done < <(echo "${ROWS_JSON}" | jq -r '.[] | [.id, .storage_path] | @tsv')

# ── 3. Resumen ────────────────────────────────────────────────────────────────
TOTAL_ON_DISK=$((DOWNLOADED + SKIPPED_EXISTING))
echo ""
echo "==> Resumen"
echo "    Filas en BD (storage_path):       ${DB_COUNT}"
echo "    Descargados en esta corrida:      ${DOWNLOADED}"
echo "    Ya existían en disco (saltados):  ${SKIPPED_EXISTING}"
echo "    Total en disco tras correr:       ${TOTAL_ON_DISK}"

if [ "${BLOCKED}" -eq 1 ]; then
  echo ""
  echo "    [BLOQUEANTE] Storage devolvió 402/403 (restricción de billing del proyecto"
  echo "    remoto, exceed_cached_egress_quota). La descarga real NO se completó."
  echo "    Vuelve a correr este script cuando el proyecto libere la restricción."
  exit 0
fi

if [ "${TOTAL_ON_DISK}" -ne "${DB_COUNT}" ]; then
  echo ""
  echo "    [ADVERTENCIA] # en disco (${TOTAL_ON_DISK}) != # en BD (${DB_COUNT})."
  echo "    Revisa los [ERROR] arriba."
  exit 1
fi

echo ""
echo "==> Listo. ${TOTAL_ON_DISK}/${DB_COUNT} videos respaldados en ${OUTPUT_DIR}"
