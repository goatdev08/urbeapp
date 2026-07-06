---
tipo: codebase
actualizado: 2026-07-04
---

# Comandos — Urbea

Referencia rápida de comandos del proyecto. **Regla de oro:** PNPM siempre (nunca `npm`/`yarn`); Taskmaster por CLI (nunca MCP). Todo lo de la app corre dentro de `mobile/`.

## 🚀 Desarrollo diario (preview en device)

| Comando | Para qué |
|---------|----------|
| `cd mobile && pnpm expo start --dev-client` | Levanta **Metro** (servidor de JS) y muestra el QR. Escanéalo **desde dentro de la app Urbea** instalada → carga tu código con **hot reload**. |
| `pnpm expo start --dev-client -c` | Igual, pero **limpia la caché** de Metro (úsalo si ves errores raros de bundle). |
| Tecla `r` en la terminal de Metro | Recarga la app manualmente. |
| Tecla `j` | Abre el debugger. |

> El servidor carga automáticamente `mobile/.env.local` (Supabase). Si cambias ese archivo, **reinicia** Metro.

## 📲 Builds nativos (EAS — nube)

Solo se necesita un build nuevo cuando cambian **dependencias nativas** o la config (`app.config.js`). Para cambios de **solo JS**, NO hace falta rebuild: basta `expo start`.

| Comando | Para qué |
|---------|----------|
| `npx eas-cli login` | Iniciar sesión en EAS. ⚠️ **`npx eas-cli`, nunca pnpm-global** (el global rompe por deps). |
| `npx eas-cli build --profile development --platform android` | Build de **desarrollo** Android (`.apk` con dev-client). El que instalamos. |
| `npx eas-cli build --profile development --platform ios` | Igual para iOS (requiere cuenta Apple Developer). |
| `npx eas-cli build --profile preview --platform android` | Build **preview** (`.apk` autónomo, sin Metro) para compartir la beta. |
| `npx eas-cli build:list` | Ver historial de builds y sus links de instalación. |

Perfiles definidos en `mobile/eas.json`: `development` · `preview` · `production`.

## ✅ Verificación (antes de cerrar una subtarea)

| Comando | Para qué |
|---------|----------|
| `cd mobile && pnpm tsc --noEmit` | Chequeo de tipos (TS strict). |
| `cd mobile && pnpm lint` | Linter. |

## 📋 Taskmaster (gestión de tareas — CLI)

| Comando | Para qué |
|---------|----------|
| `task-master next` | Siguiente tarea sugerida. |
| `task-master show <id>` | Detalle de tarea/subtarea. |
| `task-master list` | Todas las tareas. |
| `task-master set-status --id=<id> --status=<estado>` | Cambiar estado (`pending`/`in-progress`/`review`/`done`/…). |
| `task-master update-subtask --id=<id>.<n> --prompt="…"` | Bitácora de lo hecho en una subtarea. |

Flujo de planeación/ejecución: `/tm-explore` → `/tm-plan <id>` → `/tm-tarea <id>`.

## 📱 Emulador Android (Mac, sin builds nuevos)

Arranque diario recomendado: **`cd mobile && pnpm emu`** (script `mobile/scripts/emu.sh`, ver abajo qué hace paso a paso). Útil conocer el detalle manual para diagnosticar si el script falla.

| Paso | Comando |
|------|---------|
| 0. Variables de entorno (una vez por terminal) | `export JAVA_HOME=/opt/homebrew/opt/openjdk@17`<br>`export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools`<br>`export ANDROID_HOME=$ANDROID_SDK_ROOT`<br>`export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"` |
| 1. Arrancar el AVD (si no hay uno corriendo) | `emulator -avd urbea -gpu auto &` → esperar con `adb wait-for-device` y `adb shell getprop sys.boot_completed` hasta que devuelva `1` |
| 2. Mapear el puerto de Metro | `adb reverse tcp:8081 tcp:8081` (localhost del emulador → Metro; inmune a cambios de Wi-Fi/IP) |
| 3. Abrir el dev-client apuntado a Metro | `adb shell am start -a android.intent.action.VIEW -d "urbea://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"` |
| 4. Levantar Metro | `cd mobile && pnpm expo start --dev-client` |

- AVD registrado: **`urbea`** (Pixel 7, API 35, `system-images;android-35;google_apis;arm64-v8a` — arm64 porque la Mac es Apple Silicon).
- El `.apk` del dev-client (package `com.urbea.app`, scheme `urbea`) se instala **una vez** vía `eas build:run --platform android --latest`; solo hace falta reinstalarlo si cambian módulos nativos (ver tabla de EAS arriba).
- No hay simulador iOS configurado todavía — solo Android.
- Detalle de la instalación del SDK (homebrew casks, `sdkmanager`) en la memoria de sesión `android_emulator_mac_setup`; cuentas para probar login en [[entornos-y-cuentas]].

## 🔧 Gotchas (aprendidos en tarea #1)

- **`mobile/` es self-contained:** NO debe existir `pnpm-workspace.yaml` en la raíz del repo mientras `mobile/` sea standalone (rompe el hoisting de deps nativas → EAS falla en Gradle). El `.npmrc` con `node-linker=hoisted` **no basta** si un workspace padre captura el install.
- **Config en `app.config.js` (JS plano), no `.ts`:** la transpilación con ts-node falla en el servidor de EAS bajo pnpm.
- El `.apk` se instala **una vez**; de ahí en adelante solo `pnpm expo start --dev-client` para iterar.
