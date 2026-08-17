---
tipo: concepto
dominio: negocio
estado: vivo
fuentes: [.taskmaster/docs/exploraciones/039-cuenta-comercial-anunciantes.md, docs/PRD.md §17.2]
codigo:
  - supabase/migrations/20260816000005_ads_schema.sql
  - supabase/migrations/20260816000006_ads_state_machine.sql
  - supabase/migrations/20260816000007_grant_ad_slot_rpc.sql
  - supabase/migrations/20260816000008_org_can_advertise_public_wrapper.sql
  - supabase/functions/mint-ad-upload-url/
  - supabase/functions/mint-ad-urls/
  - supabase/functions/stream-webhook/handler.ts
  - mobile/src/features/ads/
  - mobile/app/(protected)/ads/
actualizado: 2026-08-17
---

# Publicidad: anuncios de terceros

> Negocios locales (créditos, seguros, mudanzas, notarías…) pagan por aparecer en el feed con un video corto y un CTA hacia fuera de la app. Construido por **#169**; **nada desplegado** todavía.

## Las cuatro tablas (#169.1)
`ad_creatives` (el video: `cloudflare_uid`, `duration_seconds` 6–30, `uploading→processing→ready|failed`) · `ads` (la campaña: título, CTA, vigencia, estado) · `ad_zones` (municipio **XOR** colonia, contra el catálogo de [[mapa-y-ubicacion]]) · `ad_prices` (PRD §17.2: **precios en tabla, jamás en código**).

🔒 **Cero filas en `ad_zones` = inventario nacional.** No es un error de formulario — validarlo como tal rompería el modelo de venta. Es un invariante que atraviesa RPC, validación de cliente y wizard.

Tabla **propia**, no `property_videos`: eso es lo que permite que el 409 de concurrencia de anuncios y el de propiedades convivan **sin un solo condicional de dominio** (ver abajo).

## La máquina de estados (#169.2)
`draft → pending_review → active → paused|expired|rejected`; `paused → active`. `rejected` y `expired` son **terminales**.

- **`draft → active` directo falla.** Ése es el criterio de "jamás se sirve sin moderación".
- **No existe estado `approved`**: un intermedio entre `pending_review` y `active` es exactamente el deadlock que [[moderacion]] tuvo que cortar en propiedades (#153).
- 🔒 **Servir = `status='active'` AND `now()` BETWEEN `starts_at` AND `ends_at`.** El estado no basta; todo consumidor evalúa las dos condiciones.
- **La auditoría no es best-effort**: toda transición escribe en `admin_actions` en la MISMA transacción. Si la auditoría falla, la transición se revierte.

**Suspender la organización pausa el reloj** (decisión de Abraham): sus anuncios vigentes pasan a `paused` conservando los días, y al reactivar se recalcula `ends_at`. Requirió extender la máquina de estados de `agencies` (`active ↔ suspended`), que hasta entonces solo admitía `pending_approval → active|rejected` — la decisión presuponía un estado inalcanzable.

🔒 **`paused_by_suspension`** distingue el pausado por cascada del pausado a mano por un admin: sin esa columna, reactivar una organización **resucitaría un anuncio apagado por moderación**.

## El pipeline del creativo (#169.4, #169.5)
`mint-ad-upload-url` → subida a Cloudflare Stream → `stream-webhook` → `ready`. Calca el de propiedades ([[propiedades-y-video]]) con dos diferencias: `maxDurationSeconds=30` y **concurrencia scoped por `agency_id` sobre `ad_creatives`**.

La rama del webhook es **aditiva**: solo se alcanza cuando el UPDATE sobre `property_videos` afecta 0 filas. Criterio de aceptación literal: la suite Deno existente pasa **sin modificarse**.

🔒 **La duración se valida CRUDA y se redondea después.** Al revés, un video de 5.7 s redondea a 6 y entra violando el mínimo — que es lo único que esta validación existe para imponer, porque Stream ya capa el máximo.

## El gate de capacidad (#169.8)
`can_advertise` nace en `false` para toda organización ([[inmobiliarias-y-agentes]]), así que la épica **nace apagada por datos**.

🔒 **Sin la capacidad, la RUTA no existe** — ocultar el botón no detiene un deep link. El gate vive en `ads/_layout.tsx` con `<Redirect>`.

🔒 **Falla cerrado ante `42703`/`42P01`**: si el JS sale por OTA contra un backend sin el schema, la feature queda apagada en vez de rota. Ver [[estrategia-releases]].

El cliente **no** puede llamar a `org_can_advertise` (el wrapper `public` está revocado a `authenticated` a propósito), así que espeja las 4 causas leyendo columnas — con filtrado **explícito en el hook**, porque la policy `agencies_select` deja al manager ver su agencia aunque esté suspendida o soft-deleted.

## Lo que NO existe todavía
- **Ningún pago.** El slot lo otorga el admin a mano con `grant_ad_slot_atomic` (`service_role`); `ads.purchase_id` queda NULL toda la beta, listo para que Stripe solo lo llene ([[monetizacion-pago-por-video]]).
- **Ninguna ruta para que el anunciante cree su campaña** — el wizard solo persiste el creativo. Derivada **#187**.
- **La UI de moderación admin** llega con #81; en beta se modera por Studio/SQL, igual que #71.5.
- **Servir los anuncios en el feed** es la tarea siguiente (170), no ésta.

## Reglas no obvias que costaron caro
- El cliente y el servidor comparten el literal `AD_DURATION_INVALID`: el mismo problema no puede producir dos mensajes distintos.
- `validate_ad_cta` devuelve `normalized_value` — se validaba una cadena y se guardaba otra.
- El CTA se valida por **allowlist** de esquema `http`/`https`, no por blocklist de `javascript:`/`data:`.
- `mark_failed` **descarta** el `reason_code`: `ad_creatives` no tiene columna de razón, así que el anunciante no sabe por qué se rechazó su video.

Ver también [[rls-seguridad]], [[feed-vertical-video]], [[privacidad-datos]].
