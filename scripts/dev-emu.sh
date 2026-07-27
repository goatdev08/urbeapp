#!/usr/bin/env bash
# Levanta el entorno local COMPLETO en el EMULADOR Android con UN comando:
#   Stack Supabase + Edge Functions (Cloudflare Stream real) + emulador + Metro.
#   Inmune a la IP: usa `adb reverse`, la app apunta a http://localhost:54321.
# Uso:  ./scripts/dev-emu.sh          (Ctrl-C baja Metro; el stack queda arriba)
#       ./scripts/dev-emu.sh --stop   (baja stack y functions serve)
#
# Para TELÉFONO real usa ./scripts/dev-local.sh (apunta a la IP de la LAN).
set -e
cd "$(dirname "$0")/.."

export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
export ANDROID_HOME=$ANDROID_SDK_ROOT
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"

FN_LOG=/tmp/urbea-functions-serve.log
FN_PID=/tmp/urbea-functions-serve.pid

if [ "$1" = "--stop" ]; then
  [ -f "$FN_PID" ] && kill "$(cat "$FN_PID")" 2>/dev/null && rm -f "$FN_PID" && echo "✔ functions serve detenido"
  supabase stop
  exit 0
fi

# 1. Stack Supabase (idempotente)
supabase status >/dev/null 2>&1 || { echo "▶ Arrancando stack Supabase..."; supabase start; }
echo "✔ Stack Supabase arriba"

# 2. Edge Functions — llaman a la API REAL de Cloudflare Stream con los secrets de .env (gitignored).
if ! kill -0 "$(cat "$FN_PID" 2>/dev/null)" 2>/dev/null; then
  nohup supabase functions serve \
    --env-file supabase/functions/.env \
    --import-map supabase/functions/deno.json >"$FN_LOG" 2>&1 &
  echo $! >"$FN_PID"
  sleep 3
fi
echo "✔ Edge Functions sirviendo (log: $FN_LOG)"

# 3. Emulador (si no hay uno corriendo)
if ! adb devices | grep -q "emulator-"; then
  echo "▶ Arrancando emulador urbea..."
  nohup emulator -avd urbea -gpu auto >/tmp/urbea-emulator.log 2>&1 &
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
fi
echo "✔ Emulador listo"

# 3.5 Fix de GPS a GDL centro — MISMAS coords que `.maestro/helpers/launch.yaml`.
#   Sin esto el emulador arranca con su default de fábrica (Mountain View, CA):
#   `properties_within_radius` busca a ~2,500 km del seed (todo el seed vive en
#   la ZMG) y la expansión ×2 topa en 40 km → el feed sale VACÍO y el orden por
#   cercanía no se puede apreciar. La suite E2E ya mockeaba la coord; el arranque
#   manual no, y esa asimetría se leía como "en dev el feed no funciona".
adb emu geo fix -103.3496 20.6597 >/dev/null 2>&1 \
  && echo "✔ GPS del emulador -> GDL centro (20.6597, -103.3496)" \
  || echo "⚠ No pude fijar el GPS (adb emu geo fix); el feed puede salir vacío"

# 4. adb reverse → la app usa localhost para Metro Y Supabase (inmune a Wi-Fi/IP)
adb reverse tcp:8081 tcp:8081 >/dev/null
adb reverse tcp:54321 tcp:54321 >/dev/null
echo "✔ adb reverse (localhost:8081 -> Metro, localhost:54321 -> Supabase)"

# 5. .env.local → localhost (el emulador lo resuelve por adb reverse)
sed -i '' -E "s#^EXPO_PUBLIC_SUPABASE_URL=http://[0-9A-Za-z.]+:54321#EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321#" mobile/.env.local
echo "✔ .env.local -> http://localhost:54321"

# 6. Abrir la app APENAS Metro responda (en segundo plano). Si se abre antes,
#    el dev-client encuentra el puerto vacío y muestra "unexpected end of stream".
( until curl -s -o /dev/null http://localhost:8081/status 2>/dev/null; do sleep 1; done
  adb shell am start -a android.intent.action.VIEW \
    -d "urbea://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null 2>&1 ) &

# 7. Metro (Fast Refresh). Deja esta terminal abierta.
echo "▶ Metro arriba — edita y guarda, el cambio aparece solo en el emulador."
# `cd`, no `pnpm --dir/-C`: bajo pnpm 11 esos flags no se parsean aquí y toma "mobile" como el comando.
cd mobile
exec pnpm expo start --dev-client
