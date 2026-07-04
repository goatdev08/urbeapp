#!/usr/bin/env bash
# run-e2e.sh — corre la suite E2E Maestro contra el stack local (§6 auditoría pre-#20).
#
# Prerrequisitos (una vez por sesión):
#   - Docker corriendo + `supabase start` (raíz del repo)
#   - Emulador Android con el dev build instalado + Metro:  cd mobile && pnpm emu
#   - mobile/.env.local apuntando al stack LOCAL (bloque local descomentado)
#   - Edge Functions locales:  supabase functions serve --import-map supabase/functions/deno.json
#
# Uso:  bash mobile/.maestro/run-e2e.sh [flujo.yaml]   (sin arg = suite completa)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAESTRO_DIR="${REPO_ROOT}/mobile/.maestro"

export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:/opt/homebrew/share/android-commandlinetools/platform-tools:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

# 1. Seed fresco (determinista: cuentas, DEMO2026, created_at escalonado, videos)
echo "▶ supabase db reset + seed de videos…"
(cd "$REPO_ROOT" && supabase db reset >/dev/null && bash supabase/scripts/seed-videos.sh >/dev/null)
echo "✔ BD local sembrada"

# 2. Video corto en la galería del emulador (para publicar.yaml).
#    DCIM/Camera (indexado por MediaStore) + force-stop del MediaProvider:
#    el photo picker moderno sincroniza perezoso y sin esto sale vacío.
SAMPLE="${REPO_ROOT}/supabase/demo-assets/sample-1.mp4"
if [ -f "$SAMPLE" ]; then
  adb shell mkdir -p /sdcard/DCIM/Camera
  adb push "$SAMPLE" /sdcard/DCIM/Camera/urbea-e2e.mp4 >/dev/null
  adb shell content call --uri content://media/ --method scan_volume --arg external_primary >/dev/null 2>&1 || true
  adb shell am force-stop com.google.android.providers.media.module >/dev/null 2>&1 || true
  echo "✔ Video demo en la galería del emulador"
fi

# 3. Metro accesible desde el emulador
adb reverse tcp:8081 tcp:8081 >/dev/null

# 4. Suite (o un flujo específico)
if [ $# -ge 1 ]; then
  maestro test "${MAESTRO_DIR}/$1"
else
  maestro test "$MAESTRO_DIR"
fi
