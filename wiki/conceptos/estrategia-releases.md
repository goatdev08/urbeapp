---
titulo: Estrategia de releases (OTA vs rebuild + migración sin romper la DB)
estado: vivo
actualizado: 2026-07-13
tags: [concepto, deploy, eas, ota]
codigo:
  - mobile/eas.json
  - mobile/app.config.js
---

# Estrategia de releases multiplataforma

Cómo enviar cambios a clientes/beta testers (Android + iOS) **sin recompilar cada vez** ni romper base de datos/backend con apps viejas en la calle.


## 🔴 El OTA hornea el backend desde `.env.local`, no desde EAS (incidente 2026-08-31)

`pnpm ota` corre `expo export` **en local** y luego `eas update --skip-bundler`. El bundle se arma en el paso local, así que las `EXPO_PUBLIC_*` salen de **`mobile/.env.local`** — nunca del entorno de EAS. El mensaje que imprime `eas update` (*"Environment variables … loaded from the 'production' environment on EAS"*) **no describe el bundle que sube**: con `--skip-bundler` ya venía armado. Es ruido.

**Qué pasó:** con `.env.local` apuntando a la rama `preview-ads`, el OTA del release mandó a los testers de producción a esa otra base. Sus cuentas no existen ahí → login con "credenciales inválidas", y en producción **no aparecía ni un intento de login** en `auth_logs`. Esa ausencia fue la pista.

**La verificación que no miente** — leer la URL horneada en el bundle:
```bash
find dist -name '*.hbc' ! -name '*.map' -exec strings {} \; | grep -oE 'https://[a-z0-9]+\.supabase\.co' | sort -u
```

Automatizado en `assert_backend_de_produccion` (`mobile/scripts/ota.sh`): corre entre el export y el upload y **aborta antes de subir** si la URL no es la de producción. Verificado con el mutante real.

⚠️ Ojo también con la **anon key**: `.env.local` tiene varias comentadas por bloques; al descomentar la URL de producción es fácil dejar activa la key de otro proyecto, y URL + key de proyectos distintos también rompe auth.

## Infra ya cableada
- `expo-updates` instalado; `updates.url` → proyecto EAS `85c7157a-…`; `checkAutomatically: ON_LOAD`.
- `runtimeVersion.policy: 'fingerprint'` (desde #67, 2026-07-13; antes `appVersion` fijo `1.0.x`). EAS calcula la **huella del código nativo** (deps, config, plugins) en build time y empareja cada OTA solo con builds de la misma huella. Canales en `eas.json`: **`preview`** (Android APK de feedback) y **`production`** (iOS/TestFlight).
- 🔴 **`mobile/.fingerprintignore` (#65.5, 2026-07-23) — no borrarlo.** Con la política `fingerprint`, **todo** build moría en la fase `CONFIGURE_EXPO_UPDATES` con `Runtime version mismatch`: los directorios de `@react-native-masked-view/masked-view` y `react-native-maps` (reason `rncoreAutolinkingAndroid`) hashean **distinto en macOS que en el Linux de EAS**, pese a ser idénticos al tarball de npm (20/20 archivos). El ignore los deja en `hash: null` en ambos lados. Es seguro: un cambio de versión igual mueve la huella vía `package.json`/lockfile, que sí se hashean. También se fijó `packageManager: pnpm@11.1.3` (EAS usaba 10.33.3; **no era la causa** —se descartó— pero el pin evita una variable suelta). Descartado y **no re-investigar**: artefactos `android/build` en `node_modules` (borrarlos no mueve el hash), lockfile, `.DS_Store`, parches pnpm, `nodeLinker`. Detalle en [[eas_fingerprint_mismatch_macos_linux]].
- ⚙️ **Leer logs de builds EAS:** `logFiles` viene en **Brotli sin header** → `gzip`/`inflate`/`strings` dan basura. Descomprimir con Node (`zlib.brotliDecompressSync`) y parsear cada línea como JSON (`.phase`, `.msg`). Sin esto el error real del build es invisible.

## Regla OTA vs rebuild
Solo el **código nativo** obliga a recompilar. El resto va por OTA, llega al reabrir la app, en segundos, sin tienda.

> ⚙️ **En este repo el OTA se dispara con `cd mobile && pnpm ota "<mensaje>" [android|ios|all]`** (script `mobile/scripts/ota.sh`), **no** con `eas update` directo: bajo pnpm el bundler de `eas update` truena (`TypeError transformFile`), así que el script separa `expo export` + `eas update --skip-bundler` y usa `npx -y eas-cli@latest`. Correr **desde `main` mergeado**. Detalle del gotcha en [[eas_update_pnpm_gotcha]].

| Va por **OTA** (`pnpm ota …` → `eas update --skip-bundler`) | Exige **REBUILD** (`eas build` + reinstalar / `eas submit`) |
|---|---|
| Pantallas, textos, estilos, layout | Instalar librería con módulo nativo nuevo |
| Lógica JS/RN, hooks, validaciones | Cambiar permisos, íconos, splash, versión de SDK |
| Fixes de UI, ajustes de copy | Cambios nativos en `app.config.js` (maps, location…) |

✅ **Hecho (#67, 2026-07-13):** `runtimeVersion.policy` migrado de `appVersion` a **`fingerprint`** → EAS calcula la huella del código nativo y decide solo si un cambio cabe por OTA o exige rebuild (se acabó el adivinar y el subir `version` a mano). Un cambio nativo genera huella distinta → EAS lo separa del canal OTA viejo automáticamente. En la práctica de la beta, ~80–90% de las iteraciones (UI/copy/lógica) van por OTA. ⚠️ El corte invalidó el emparejamiento OTA de los builds `appVersion` previos: los testers reinstalan **una vez** un build nuevo (huella fingerprint) para volver a recibir OTAs.

🔴 **El fingerprint también muerde al revés — OTA publicado a un runtime que NADIE tiene = no-op silencioso (lección #90, 2026-08-07).** `eas update` publica al runtime del código ACTUAL sin avisar si ningún build instalado lo tiene: el OTA del deploy-day (06-ago) salió para `4f7fcdc4`(iOS)/`e91240a7`(Android), pero los builds en la calle (v1.0.2, 2026-07-24) eran `1e7836e9`/`36277651` — `expo-web-browser` (#72, módulo nativo) había movido la huella y el OTA no le llegó a nadie. **Regla: tras publicar un OTA que siga a CUALQUIER dep/cambio nativo, comparar el runtime del update contra `eas build:list` (columna `runtimeVersion` de los builds entregados). Si difieren → version bump + `eas build` (así nacieron los builds v1.0.3).** Síntoma del lado del tester: "abrí y cerré dos veces y no veo nada nuevo".

## No romper la DB/backend: expand · migrate · contract
Con apps viejas y nuevas conviviendo contra la MISMA base:
- **Aditivo no rompe:** columnas nuevas con default, tablas nuevas → una app vieja las ignora y sigue funcionando.
- **Nunca renombres/borres en caliente:** primero agrega lo nuevo, migra el código, y borra lo viejo en un release **posterior** (cuando ya nadie use la app vieja).
- **Edge Functions retrocompatibles:** no cambies el contrato de una EF que consume una app publicada; agrega campos opcionales.
- Esto es lo que hace que **demo → beta → final** sea aditivo y no un rewrite. Ver [[brechas-demo-vs-prd]].

## Flujo de la beta
1. Cambio de UI/lógica → merge a `main` → `cd mobile && pnpm ota "<mensaje>"` (publica a `preview`/Android **y** `production`/iOS) → testers lo reciben al reabrir.
2. Cambio nativo → `eas build --profile preview --platform android` (APK) / `--profile production --platform ios` (TestFlight) → reinstalar.
3. iOS TestFlight: `eas submit` sube a App Store Connect → agregar tester → aceptar invitación.

Relacionado: [[brechas-demo-vs-prd]] · memorias [[eas_update_pnpm_gotcha]], [[dev_client_vs_release_apk]].
