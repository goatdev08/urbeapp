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
2. **El entorno `development` de EAS está incompleto**: solo tiene `GOOGLE_MAPS_API_KEY`; le
   faltan las 3 `EXPO_PUBLIC_*`. Hoy no duele porque el dev-client toma su JS (y sus vars) de
   Metro vía `.env.local`, pero un build `development` sin Metro se queda sin backend.
3. **`.env.local` es un interruptor mutable y silencioso**: los scripts lo reescriben
   (`localhost` vs IP de la LAN). Correr dos scripts distintos deja el archivo apuntando al
   último. Es el diseño elegido (un solo archivo, cero ceremonia), pero conviene saberlo.
4. **No existe una compuerta de smoke contra preview/production.** Es lo que dejó pasar el bug
   de abajo.

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
