---
titulo: Entornos de desarrollo — las tres ramas (local · preview · production)
estado: vivo
actualizado: 2026-07-24
tags: [concepto, entornos, deploy, dx]
codigo:
  - scripts/dev-emu.sh
  - scripts/dev-ios.sh
  - scripts/dev-local.sh
  - mobile/eas.json
  - mobile/.env.local
---

# Entornos de desarrollo

Las **tres ramas** por las que pasa un cambio antes de llegar a un tester. Complementa
[[estrategia-releases]] (que decide *OTA vs rebuild*); esta página dice *contra qué backend
corre la app* en cada etapa y cómo se levanta cada una.

## Tabla maestra

| | **local** | **preview** | **production** |
|---|---|---|---|
| **Para qué** | iterar con Fast Refresh | testers Android (APK) | TestFlight iOS / tienda |
| **Backend** | stack Supabase en Docker | remoto `urbea-app` | remoto `urbea-app` |
| **JS viene de** | Metro (tu Mac) | bundle embebido + OTA | bundle embebido + OTA |
| **Vars** | `mobile/.env.local` | EAS env `preview` | EAS env `production` |
| **Canal OTA** | — | `preview` | `production` |
| **Perfil EAS** | `development` | `preview` | `production` |
| **Cloudflare Stream** | **API real** | API real | API real |

⚠️ **Cloudflare Stream y R2 son SIEMPRE reales**, incluso en local: no hay emulador de
Stream. Los secrets locales viven en `supabase/functions/.env` (gitignored). Subir un video
en local consume cuota real de Cloudflare.

## Cómo se levanta cada rama

### local — un comando por objetivo

| Objetivo | Comando | Cómo alcanza el backend |
|---|---|---|
| **Emulador Android** | `./scripts/dev-emu.sh` | `adb reverse` → `localhost:54321` |
| **Simulador iOS** | `./scripts/dev-ios.sh` | comparte la red del Mac → `localhost:54321` directo |
| **Teléfono real** | `./scripts/dev-local.sh` | IP de la LAN (`http://192.168.x.x:54321`) |

Los tres levantan lo mismo (stack Supabase + Edge Functions + Metro) y **solo difieren en
cómo el dispositivo nombra a tu Mac**. `--stop` en cualquiera baja stack y functions.

> 🔑 **`localhost` no es una dirección, es "yo mismo".** Desde un teléfono, `localhost` es el
> teléfono. Por eso el teléfono necesita la IP de la LAN, mientras que el emulador Android la
> evita con el túnel de `adb` y el simulador iOS ni la necesita (comparte red con el Mac).

**Requisito único:** el dev-client debe estar instalado.
Android: `cd mobile && pnpm expo run:android`. iOS: `cd mobile && pnpm expo run:ios` (el
script de iOS detecta si falta y te lo dice). Un APK *release* NO sirve para iterar — trae el
JS embebido y nunca habla con Metro ([[dev_client_vs_release_apk]]).

### preview / production
Ver [[estrategia-releases]]: cambio de JS → `cd mobile && pnpm ota "<msg>"`; cambio nativo →
`eas build --profile preview|production`.

## 🔴 Riesgos vivos de esta configuración

1. **`preview` y `production` apuntan al MISMO proyecto Supabase** (`urbea-app`), con las
   mismas keys. No hay aislamiento: lo que un tester crea entra a la misma base que
   producción. Aceptable en beta cerrada; **hay que separarlo antes de cobrar** (Ola 4).
2. ~~El entorno `development` de EAS está incompleto~~ — **FALSO, corregido el 2026-07-25.**
   Que solo tenga `GOOGLE_MAPS_API_KEY` es **correcto por diseño**, no un hueco:
   `mobile/app.config.js` es el único que lee `process.env` en tiempo de build (línea 40) y esa
   llave se hornea en el **manifiesto nativo**, así que tiene que estar en EAS. Las 3
   `EXPO_PUBLIC_*` se **inlinean en el bundle de JS**, y en un dev-client ese bundle lo sirve
   **Metro** leyendo `mobile/.env.local`. Por eso las demos y los previews siempre funcionaron.
   - 🔴 El riesgo real es otro: el prefijo `EXPO_PUBLIC_` significa **"cualquiera puede leerlo
     en el bundle"**. Y hoy en EAS `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` y `GOOGLE_MAPS_API_KEY`
     tienen **exactamente el mismo valor** → la llave de Maps queda expuesta. Partirlas en dos y
     restringir cada una por app/API es la **tarea #36**.
3. **`.env.local` es un interruptor mutable y silencioso**: los scripts lo reescriben
   (`localhost` vs IP de la LAN). Correr dos scripts distintos deja el archivo apuntando al
   último. Es el diseño elegido (un solo archivo, cero ceremonia), pero conviene saberlo.
4. **No existe una compuerta de smoke contra preview/production.** Es lo que dejó pasar el bug
   de abajo.
5. 💰 **Un emulador olvidado con el feed abierto factura solo.** El feed reproduce en **loop**:
   dejar la app abierta en un emulador (peor aún, en dos a la vez) consume cuota real de forma
   continua, sin que nadie lo esté viendo. **Así se quemó el egress de Supabase** que hoy tiene
   al proyecto en **402** — en la era del MP4 servido desde Storage, cada loop bajaba el archivo
   completo otra vez.
   - ⚠️ **Post-#68 cambió la factura, no el problema.** El video ya no sale de Supabase sino de
     **Cloudflare Stream**, así que el egress de Supabase ya no se toca; ahora se cobran
     **minutos entregados de Stream**. Más barato, pero igual de silencioso.
   - **Regla de trabajo:** en testing, verificar que reproduce y **parar** — no dejarlo corriendo.
     Mandar la app a segundo plano basta (`expo-video` pausa al perder foco): Android
     `adb shell input keyevent 3`, iOS `xcrun simctl terminate <udid> com.urbea.app`. Todo flujo
     de Maestro que abra el feed debe **terminar en `stopApp`** — no en un tap, que alterna
     play/pausa y puede dejarlo corriendo.

## ⚠️ Lección: el bug de `localizeSignedUrl` (#68.16, 2026-07-24)

**Qué pasó.** `mobile/src/lib/supabase/localizeSignedUrl.ts` nació en `829ab55` (2026-06-29)
como parche **solo para local**: el edge runtime en Docker firma las URLs de Storage con su
host interno (`kong:8000`), inalcanzable desde un emulador, así que el helper le reescribía el
origin. Era correcto **porque el video vivía en Supabase Storage — el mismo origin que la
API** (el commit incluso decía "no-op en remoto"). Cuando #68 movió el video a **Cloudflare
Stream**, esa premisa murió: el helper empezó a convertir
`https://videodelivery.net/<token>/manifest/video.m3u8` en
`http://localhost:54321/<token>/…` → **HTTP 404, feed sin video**.

**Por qué tardó en verse:**
- 🔇 **Rompía local Y remoto** (en remoto quedaba `https://<ref>.supabase.co/<token>/…`), pero
  el **402** del gateway impedía cualquier smoke remoto.
- 🎭 **La portada seguía cargando**, porque `posterUrl` NO pasa por el helper → la pantalla
  parecía "casi funcionando" en vez de rota.
- 🧪 **El helper no tenía ni un test** pese a vivir en `src/lib/**` (criticidad CRÍTICA por la
  regla de path de CLAUDE.md §5).

**Fix:** localizar **solo** URLs de Supabase Storage (path `/storage/v1/`) y devolver intacto
cualquier otro origin. 7 tests nuevos. Verificado en emulador: `state=PLAYING`, 0 respuestas 404.

**Reglas que deja:**
- 🔴 **Una adaptación de entorno local NUNCA debe mutar datos que también viajan a producción.**
  Si hay que adaptar, que la condición sea *provable y estrecha* (aquí: "es una URL de mi
  Storage"), no un catch-all sobre cualquier valor.
- Todo helper en `src/lib/**` nace con tests — es criticidad CRÍTICA por path, sin excepción.
- Cuando una migración cambia **de dónde viene un recurso** (Storage → CDN), hay que auditar a
  quién le importaba el origin viejo. `grep` del dominio/origin en el cliente, no solo del schema.

Relacionado: [[estrategia-releases]] · [[propiedades-y-video]] · [[storage-hibrido]] ·
[[dev_client_vs_release_apk]] · [[android_emulator_mac_setup]].
