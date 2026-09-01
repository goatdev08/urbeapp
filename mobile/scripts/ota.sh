#!/usr/bin/env bash
# Publica un OTA (JS-only) de Urbea a los canales de testers.
#   production -> iOS   ·   preview -> Android   (runtime por fingerprint, #67)
#
# Workaround del gotcha pnpm: `eas update` truena al bundlear bajo pnpm
# (TypeError transformFile). Por eso separamos en 2 pasos:
#   1) `expo export`  -> genera dist/ (bundle sano, a mano)
#   2) `eas update --skip-bundler`  -> sube dist/ sin re-bundlear
# La eas-cli global está rota (MODULE_NOT_FOUND) -> siempre npx -y eas-cli@latest.
# Módulos nativos nuevos NO viajan por OTA (subir version + recompilar).
#
# Uso:  pnpm ota "mensaje del update" [android|ios|all]   (default: all)
set -euo pipefail

MSG="${1:?Uso: pnpm ota \"mensaje del update\" [android|ios|all]}"
TARGET="${2:-all}"

cd "$(dirname "$0")/.."   # -> mobile/

# Aviso honesto: un OTA sube el código del working dir. Debería ser main limpio.
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "▶ Publicando OTA desde rama '$BRANCH' (@$COMMIT) — mensaje: \"$MSG\""
if [ "$BRANCH" != "main" ]; then
  echo "⚠ No estás en 'main'. El OTA subirá lo que hay en esta rama. Ctrl-C para abortar."
  sleep 3
fi

# 🔴 Ref del proyecto de PRODUCCIÓN (urbea-app). Todo OTA a testers debe apuntar
# aquí. Ver assert_backend_de_produccion.
PROD_REF="mvpvqmyhrrkwbnpctpuq"

# 🔴 GUARD (incidente 2026-08-31): `expo export` bundlea EN LOCAL y hornea las
# EXPO_PUBLIC_* desde .env.local — NO desde el entorno de EAS. `eas update
# --skip-bundler` ya no re-bundlea, así que el mensaje "Environment variables
# loaded from the '<env>' environment on EAS" que imprime NO describe el bundle
# que se sube: es puro ruido. Con .env.local apuntando a la rama preview-ads se
# publicó un OTA que mandó a los testers de PRODUCCIÓN a otra base de datos —
# sus cuentas no existían ahí y el login fallaba con "credenciales inválidas".
# Nada en la salida del script lo delataba. Este assert lee la URL REAL horneada
# en el bundle y aborta antes de subir.
assert_backend_de_produccion() {
  local platform="$1" urls
  urls="$(find dist -name '*.hbc' ! -name '*.map' -exec strings {} \; 2>/dev/null \
          | grep -oE 'https://[a-z0-9]+\.supabase\.co' | sort -u)"

  if [ -z "$urls" ]; then
    echo "✖ ABORTADO ($platform): no se encontró ninguna URL de Supabase en el bundle."
    echo "  Revisa EXPO_PUBLIC_SUPABASE_URL en mobile/.env.local."
    exit 1
  fi
  if [ "$urls" != "https://${PROD_REF}.supabase.co" ]; then
    echo "✖ ABORTADO ($platform): el bundle NO apunta a producción."
    echo "  Esperado: https://${PROD_REF}.supabase.co"
    echo "  Horneado: $urls"
    echo "  Causa típica: mobile/.env.local apunta a una rama (preview-ads) o al stack local."
    echo "  Arréglalo ahí y vuelve a correr — NO se subió nada."
    exit 1
  fi
  echo "✔ Backend verificado ($platform): https://${PROD_REF}.supabase.co"
}

publish() {
  local platform="$1" channel="$2" environment="$3"
  echo "▶ Export ($platform)…"
  npx expo export --output-dir dist --experimental-bundle --non-interactive \
    --dump-sourcemap --dump-assetmap --platform="$platform" --clear
  assert_backend_de_produccion "$platform"
  echo "▶ OTA -> canal '$channel' ($platform)…"
  npx -y eas-cli@latest update --channel "$channel" --environment "$environment" \
    --platform "$platform" --skip-bundler --non-interactive --message "$MSG"
  echo "✔ $platform publicado a '$channel'"
}

case "$TARGET" in
  android) publish android preview    preview    ;;
  ios)     publish ios     production production ;;
  all)     publish android preview    preview
           publish ios     production production ;;
  *) echo "Target inválido: '$TARGET' (usa android|ios|all)"; exit 1 ;;
esac

echo "✔ Listo. Los testers lo bajan al abrir la app; se aplica al siguiente arranque (cerrar/abrir)."
