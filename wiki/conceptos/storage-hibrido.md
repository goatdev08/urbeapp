---
tipo: concepto
dominio: infraestructura
estado: vivo
fuentes: [.taskmaster/docs/exploraciones/036-camino-a-produccion.md, wiki/decisiones/0008-arquitectura-real-prd.md, .taskmaster (tarea #69)]
codigo: [supabase/functions/mint-r2-url/, supabase/functions/_shared/clients.ts (make_r2_url_minter, make_agency_ownership_verifier), mobile/src/lib/profileService.ts, mobile/src/lib/r2Resolver.ts, mobile/src/hooks/useR2Urls.ts, mobile/app/(protected)/profile/edit.tsx]
actualizado: 2026-07-16
---

# Storage híbrido — Cloudflare Stream (feed) + R2 (assets)

Decisión de [[0008-arquitectura-real-prd]] (exploración 036): el video del feed va a **Cloudflare Stream** (HLS, épica B #68, pendiente) y los **assets** (avatares, logos, originales archivados, documentos) van a **Cloudflare R2** (S3-compatible, **egress $0**) — **vivo desde #69**.

## R2 — modelo (tarea #69, vivo)

- **Bucket `urbea-assets` PRIVADO** (decisión Abraham: "privado o al menos seguro"). Prefixes: `avatars/<uid>/…`, `logos/<agency_id>/…`, `archive/…` (este último lo consumirá #68).
- 🔒 **Toda lectura y escritura pasa por presigned URLs minteadas server-side** por la EF `mint-r2-url` — mismo patrón fail-closed que `mint-video-url`. Nunca hay URL pública.
- **EF `mint-r2-url`** (Deno, firma con **aws4fetch** vía esm.sh): POST `{kind: avatar|logo|archive, op: put|get, key?, keys?}`.
  - `op=put` → `{url, key, expires}`; TTL **900s**. El handler **deriva el key** del uid del JWT (`avatars/<uid>/<uuid>`) — el cliente no elige key. Autorización: avatar = solo el propio uid; logo = solo el **owner** de la agencia (`make_agency_ownership_verifier` → `agency_members` con `member_role='owner' AND status='active'`); archive por PUT del cliente = 403 (server-side de #68).
  - `op=get` → `{urls:[{key,url,expires}]}` en **lote**; TTL **3600s**. Basta estar autenticado (assets público-a-autenticados).
  - Toda la autz vive en el handler ANTES de invocar el minter; el minter (`make_r2_url_minter`) es un adapter puro de firma. 40 Deno tests, guardian PASS.
- **Persistencia**: se guarda el **r2_key** (no una URL) en las columnas existentes (`user_preferences.profile_photo_url`; futuro `agencies.logo_url`). Sin columna nueva (greenfield, aditivo).

## Cliente móvil (vivo)

- **`profileService.saveProfile`** — contrato de 3 estados en `imageUri` (**#69.6**): `undefined` = **KEEP** (el upsert OMITE la columna → on-conflict conserva), `null` = **REMOVE**, `string` local = **REPLACE** (mint put → upload streaming `File.createUploadTask` → guarda el key). 20 tests.
- **`r2Resolver.resolve_r2_urls(keys)`** — resolver batch key→presigned GET: UNA llamada a la EF con keys únicos, alineación 1:1, fail-soft (error → null, la UI no muestra avatar, nunca crashea). ⭐ **Passthrough legacy**: valores `http(s)://` (URLs públicas pre-R2 de Supabase Storage) se devuelven tal cual SIN llamar la EF — los avatares viejos siguen visibles durante la transición greenfield. 15 tests.
- **`useR2Urls(keys)`** — hook fino sobre el resolver (loading/urls, re-resuelve al cambiar keys). Consumidores: `ProfileHeader`, `AgentCard`, preview de `edit.tsx`.
- **`edit.tsx`** separa `saved_avatar_key` (valor de DB, solo preview vía resolver) de `picked_image_uri` (solo se setea al elegir foto nueva) → guardar sin cambiar foto manda `undefined` (KEEP). Bug original: mandaba el key guardado como archivo a subir.

## Greenfield (decisión #69.4)

Sin backfill ni dual-read: los assets viejos de Supabase Storage NO se migran; se re-suben desde la app. El passthrough legacy del resolver mantiene visibles los avatares antiguos mientras tanto. `profile-photos` (Storage) queda como legacy de solo-lectura.

## Secrets y deploy

- Secrets de EF (runtime, `Deno.env`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` (32 hex), `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`, sin bucket). Cambios de secret NO requieren redeploy.
- ⚠️ **Gotcha deploy sin Docker:** `supabase functions deploy … --use-api` bundlea server-side (el flujo Docker truena si el daemon no corre). Sigue aplicando `--import-map supabase/functions/deno.json`.
- ⚠️ **Gotcha visto en vivo:** si un secret guarda el NOMBRE en vez del valor (error de captura en el dashboard), la firma sale con `X-Amz-Credential=R2_ACCESS_KEY_ID` literal → R2 responde "length 16, should be 32"; `SignatureDoesNotMatch` = el secret no es el par del access key (tomar AMBOS de la misma pantalla del token).

## Pendientes (trabajo nuevo, fuera de #69)

- **CRM/leads**: los avatares del CRM leen `users.avatar_url` (columna distinta) — aún sin resolver keys R2 → cablear `useR2Urls` o unificar columna.
- **Logo de inmobiliaria**: no existe UI de edición de logo (diseño nuevo sin mockup canónico) — la EF ya lo autoriza por ownership.
- **`archive/`**: lo consume #68 (originales de video en frío).

Relacionado: [[propiedades-y-video]] · [[estrategia-releases]] · [[rls-seguridad]] · [[0008-arquitectura-real-prd]]
