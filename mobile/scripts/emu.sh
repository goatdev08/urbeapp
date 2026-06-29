#!/usr/bin/env bash
# Arranca el emulador Android + Metro para iterar Urbea en la Mac (Fast Refresh).
# Uso:  pnpm emu      (o ./scripts/emu.sh desde mobile/)
set -e

export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
export ANDROID_HOME=$ANDROID_SDK_ROOT
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"

# 1. Emulador (si no hay uno corriendo)
if ! adb devices | grep -q "emulator-"; then
  echo "▶ Arrancando emulador urbea..."
  nohup emulator -avd urbea -gpu auto >/tmp/urbea-emulator.log 2>&1 &
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
fi
echo "✔ Emulador listo"

# 2. Mapear el puerto de Metro al emulador (inmune a Wi-Fi/IP)
adb reverse tcp:8081 tcp:8081 >/dev/null && echo "✔ adb reverse (localhost:8081 -> Metro)"

# 3. Abrir la app apuntada a Metro (deep link del dev-client)
adb shell am start -a android.intent.action.VIEW \
  -d "urbea://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null 2>&1 || true

# 4. Metro (Fast Refresh). Deja esta terminal abierta.
echo "▶ Arrancando Metro — edita y guarda, el cambio aparece solo en el emulador."
exec pnpm expo start --dev-client
