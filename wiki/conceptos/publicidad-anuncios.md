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
  - supabase/migrations/20260820000001_ads_zone_bbox_determinism.sql
  - supabase/migrations/20260820000002_ad_creatives_failure_reason.sql
  - mobile/src/features/ads/
  - mobile/app/(protected)/ads/
actualizado: 2026-08-20
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
- **Ninguna ruta para que el anunciante cree su campaña** — el wizard solo persiste el creativo. Derivada **#191**.
- **La UI de moderación admin** llega con #81; en beta se modera por Studio/SQL, igual que #71.5.
- **Servir los anuncios en el feed** es la tarea siguiente (170), no ésta.

## Dos definiciones de «vista», divergentes A PROPÓSITO (#197)

El producto usa la palabra *vista* para dos números que **miden cosas distintas y no se suman jamás**. La divergencia es una decisión (Abraham, 2026-08-20), no un descuido pendiente de unificar.

| | Anuncio | Propiedad |
| --- | --- | --- |
| Qué cuenta | `viewed` = **≥ 3 s** de reproducción | `video_view` = el video se volvió activo, **sin umbral** |
| Dónde se decide | EF `record-ad-impressions` (servidor; ignora lo que declare el cliente) | `VideoFeedItem.tsx` dispara `report_view()` al `isActive` |
| Para qué sirve | **base facturable** frente a un anunciante | señal de interés de una persona frente a un agente |

**Por qué no se unificaron.** Son métricas de dominios distintos con consecuencias distintas. Del lado del anunciante hay dinero y hay un estándar de industria (YouTube cuenta vista a los 3 s): bajar el umbral sería inflar la factura. Del lado del agente el número no se cobra — describe interés, y ahí el scroll-by ya queda filtrado aguas abajo por el **like como filtro de entrada** de [[crm-leads]] (sin like a la propiedad de origen, `get_lead_stats` no devuelve fila). Unificar en 3 s habría movido hacia abajo, sin beneficio, números que agentes REALES ya ven hoy en producción — y habría creado una discontinuidad en la serie histórica que hay que explicar para siempre.

🔴 **Lo que esta decisión obliga a sostener:** que nadie sume ni compare los dos números, y que cualquier reporte que los cruce diga cuál es cuál. El día que #172 construya el panel del anunciante, ese panel dice **impresiones**, nunca "vistas" a secas.

## Reglas no obvias que costaron caro
- El cliente y el servidor comparten el literal `AD_DURATION_INVALID`: el mismo problema no puede producir dos mensajes distintos.
- `validate_ad_cta` devuelve `normalized_value` — se validaba una cadena y se guardaba otra.
- El CTA se valida por **allowlist** de esquema `http`/`https`, no por blocklist de `javascript:`/`data:`.
- ~~`mark_failed` **descarta** el `reason_code`~~ — **arreglado en #189**: `ad_creatives.failure_reason` existe (nullable, sin default, vocabulario abierto) y el adapter la escribe. Vale la pena recordar el patrón: la columna faltante no era un hueco cosmético, **forzaba al cliente a adivinar**. `useAdUpload` infería "por eliminación, esto es transcodificación" y esa inferencia solo se sostenía mientras el pre-flight fuera fail-closed ante duración ausente — o sea, el mensaje equivocado y el bloqueo del anunciante con picker Android viejo eran **el mismo defecto**, y no se podían arreglar por separado sin empeorar las cosas.
- **La duración ausente es fail-OPEN en el cliente (#189)**, igual que en propiedades. La versión anterior fail-closed se justificaba como "paridad con el servidor" y era paridad **formal, no semántica**: el `null` del servidor significa "Cloudflare decodificó y no pudo determinar la duración"; el del cliente significa "este picker no lee metadata". El literal `AD_DURATION_INVALID` no cambió — cambió *cuándo* se emite.

Ver también [[rls-seguridad]], [[feed-vertical-video]], [[privacidad-datos]].
