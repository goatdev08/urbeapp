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

publish() {
  local platform="$1" channel="$2" environment="$3"
  echo "▶ Export ($platform)…"
  npx expo export --output-dir dist --experimental-bundle --non-interactive \
    --dump-sourcemap --dump-assetmap --platform="$platform" --clear
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
