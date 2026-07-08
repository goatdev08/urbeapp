---
titulo: Estrategia de releases (OTA vs rebuild + migración sin romper la DB)
estado: vivo
actualizado: 2026-07-07
tags: [concepto, deploy, eas, ota]
codigo:
  - mobile/eas.json
  - mobile/app.config.js
---

# Estrategia de releases multiplataforma

Cómo enviar cambios a clientes/beta testers (Android + iOS) **sin recompilar cada vez** ni romper base de datos/backend con apps viejas en la calle.

## Infra ya cableada
- `expo-updates` instalado; `updates.url` → proyecto EAS `85c7157a-…`; `checkAutomatically: ON_LOAD`.
- `runtimeVersion.policy: 'appVersion'` (hoy `1.0.1`). Canales en `eas.json`: **`preview`** (Android APK de feedback) y **`production`** (iOS/TestFlight).

## Regla OTA vs rebuild
Solo el **código nativo** obliga a recompilar. El resto va por OTA (`eas update`), llega al reabrir la app, en segundos, sin tienda.

| Va por **OTA** (`eas update --channel <canal>`) | Exige **REBUILD** (`eas build` + reinstalar / `eas submit`) |
|---|---|
| Pantallas, textos, estilos, layout | Instalar librería con módulo nativo nuevo |
| Lógica JS/RN, hooks, validaciones | Cambiar permisos, íconos, splash, versión de SDK |
| Fixes de UI, ajustes de copy | Cambios nativos en `app.config.js` (maps, location…) |

**Recomendación:** migrar `runtimeVersion.policy` de `appVersion` a **`fingerprint`** → EAS calcula la huella del código nativo y decide solo si un cambio cabe por OTA o exige rebuild (se acaba el adivinar). En la práctica de la beta, ~80–90% de las iteraciones (UI/copy/lógica) van por OTA.

## No romper la DB/backend: expand · migrate · contract
Con apps viejas y nuevas conviviendo contra la MISMA base:
- **Aditivo no rompe:** columnas nuevas con default, tablas nuevas → una app vieja las ignora y sigue funcionando.
- **Nunca renombres/borres en caliente:** primero agrega lo nuevo, migra el código, y borra lo viejo en un release **posterior** (cuando ya nadie use la app vieja).
- **Edge Functions retrocompatibles:** no cambies el contrato de una EF que consume una app publicada; agrega campos opcionales.
- Esto es lo que hace que **demo → beta → final** sea aditivo y no un rewrite. Ver [[brechas-demo-vs-prd]].

## Flujo de la beta
1. Cambio de UI/lógica → `eas update --channel preview` → testers Android lo reciben al reabrir.
2. Cambio nativo → `eas build --profile preview --platform android` (APK) / `--profile production --platform ios` (TestFlight) → reinstalar.
3. iOS TestFlight: `eas submit` sube a App Store Connect → agregar tester → aceptar invitación.

Relacionado: [[brechas-demo-vs-prd]] · memorias [[eas_update_pnpm_gotcha]], [[dev_client_vs_release_apk]].
