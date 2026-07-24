#!/usr/bin/env bash
# Levanta el entorno local COMPLETO en el SIMULADOR iOS con UN comando:
#   Stack Supabase + Edge Functions (Cloudflare Stream real) + simulador + Metro.
# Uso:  ./scripts/dev-ios.sh [nombre-de-simulador]   (default: iPhone 17 Pro)
#       ./scripts/dev-ios.sh --stop                  (baja stack y functions serve)
#
# Diferencia clave con Android: el simulador iOS COMPARTE la red del Mac, así que
# `localhost` funciona directo — no hace falta ningún túnel (`adb reverse`).
#
# Hermanos:  ./scripts/dev-emu.sh (emulador Android) · ./scripts/dev-local.sh (teléfono real)
set -e
cd "$(dirname "$0")/.."

FN_LOG=/tmp/urbea-functions-serve.log
FN_PID=/tmp/urbea-functions-serve.pid
SIM="${1:-iPhone 17 Pro}"

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

# 3. Simulador
UDID=$(xcrun simctl list devices available | grep -m1 "$SIM (" | grep -oE "[0-9A-F-]{36}")
[ -z "$UDID" ] && { echo "✖ No encontré el simulador '$SIM'. Disponibles:"; xcrun simctl list devices available | grep -E "iPhone"; exit 1; }
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator
echo "✔ Simulador '$SIM' listo"

# 4. .env.local → localhost (el simulador comparte la red del Mac)
sed -i '' -E "s#^EXPO_PUBLIC_SUPABASE_URL=http://[0-9A-Za-z.]+:54321#EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321#" mobile/.env.local
echo "✔ .env.local -> http://localhost:54321"

# 5. ¿Está instalado el dev-client? Sin él no hay nada que abrir.
if ! xcrun simctl get_app_container "$UDID" com.urbea.app >/dev/null 2>&1; then
  echo
  echo "⚠️  El dev-client NO está instalado en este simulador."
  echo "    Compílalo UNA vez (tarda unos minutos):  cd mobile && pnpm expo run:ios"
  echo "    Después vuelve a correr este script."
  exit 1
fi

# 6. Abrir la app APENAS Metro responda (en segundo plano). Si se abre antes,
#    el dev-client encuentra el puerto vacío y falla al cargar.
( until curl -s -o /dev/null http://localhost:8081/status 2>/dev/null; do sleep 1; done
  xcrun simctl openurl "$UDID" "urbea://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null 2>&1 ) &

# 7. Metro (Fast Refresh). Deja esta terminal abierta.
echo "▶ Metro arriba — edita y guarda, el cambio aparece solo en el simulador."
# `cd`, no `pnpm --dir/-C`: bajo pnpm 11 esos flags no se parsean aquí y toma "mobile" como el comando.
cd mobile
exec pnpm expo start --dev-client
