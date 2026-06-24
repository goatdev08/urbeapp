---
tipo: codebase
actualizado: 2026-06-23
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

## 🔧 Gotchas (aprendidos en tarea #1)

- **`mobile/` es self-contained:** NO debe existir `pnpm-workspace.yaml` en la raíz del repo mientras `mobile/` sea standalone (rompe el hoisting de deps nativas → EAS falla en Gradle). El `.npmrc` con `node-linker=hoisted` **no basta** si un workspace padre captura el install.
- **Config en `app.config.js` (JS plano), no `.ts`:** la transpilación con ts-node falla en el servidor de EAS bajo pnpm.
- El `.apk` se instala **una vez**; de ahí en adelante solo `pnpm expo start --dev-client` para iterar.
