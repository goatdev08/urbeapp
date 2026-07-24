#!/usr/bin/env bash
# Levanta el entorno local COMPLETO de Urbea para probar en TELÉFONO REAL.
#   Stack Supabase + Edge Functions (Cloudflare Stream real) + Metro, con la IP de la LAN.
# Uso:  ./scripts/dev-local.sh          (Ctrl-C para bajar Metro; el stack queda arriba)
#       ./scripts/dev-local.sh --stop   (baja stack y functions serve)
#
# Para EMULADOR Android usa `pnpm emu` desde mobile/ (usa adb reverse, no necesita IP).
set -e
cd "$(dirname "$0")/.."

FN_LOG=/tmp/urbea-functions-serve.log
FN_PID=/tmp/urbea-functions-serve.pid

if [ "$1" = "--stop" ]; then
  [ -f "$FN_PID" ] && kill "$(cat "$FN_PID")" 2>/dev/null && rm -f "$FN_PID" && echo "✔ functions serve detenido"
  supabase stop
  exit 0
fi

# 1. IP de la LAN → .env.local. El teléfono NO puede usar localhost ni 10.0.2.2 (ese es solo del emulador).
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
[ -z "$IP" ] && { echo "✖ Sin IP de LAN (¿Wi-Fi apagado?)"; exit 1; }
sed -i '' -E "s#^EXPO_PUBLIC_SUPABASE_URL=http://[0-9.]+:54321#EXPO_PUBLIC_SUPABASE_URL=http://$IP:54321#" mobile/.env.local
echo "✔ .env.local apuntando a http://$IP:54321"

# 2. Stack Supabase (idempotente)
supabase status >/dev/null 2>&1 || { echo "▶ Arrancando stack Supabase..."; supabase start; }
echo "✔ Stack Supabase arriba"

# 3. Edge Functions — llaman a la API REAL de Cloudflare Stream con los secrets de .env (gitignored).
if ! kill -0 "$(cat "$FN_PID" 2>/dev/null)" 2>/dev/null; then
  nohup supabase functions serve \
    --env-file supabase/functions/.env \
    --import-map supabase/functions/deno.json >"$FN_LOG" 2>&1 &
  echo $! >"$FN_PID"
  sleep 3
fi
echo "✔ Edge Functions sirviendo (log: $FN_LOG)"

echo
echo "📱 Teléfono en la MISMA Wi-Fi. Abre el dev-client y apúntalo a:  http://$IP:8081"
echo "   Backend de la app:  http://$IP:54321"
echo
# `cd`, no `pnpm --dir/-C`: bajo pnpm 11 esos flags no se parsean aquí y toma "mobile" como el comando.
cd mobile
exec pnpm expo start --dev-client --host lan
