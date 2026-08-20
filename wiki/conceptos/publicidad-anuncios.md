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

## Servir los anuncios en el feed (#170)

El feed es heterogéneo: `interleave_ads` (pura, 8 invariantes) decide dónde cae cada anuncio, y `useFeedProperties` lo compone tras cada fetch. **Fail-soft absoluto**: cualquier fallo del kill-switch, de `ads_for_zone` o de la firma degrada a feed de solo propiedades, sin error visible.

🔴 **Degradar en silencio hacia el usuario y hacia el operador son dos decisiones distintas** (#196). Desde el negocio, «la RPC lleva tres días fallando» se veía igual que «no hay inventario contratado». Ahora el fail-soft deja rastro: un `ads_fetch_failed` en `events_raw` con **exactamente cuatro claves** (sin `property_id`, sin coordenadas, sin `ad_id`), deduplicado por (sesión, tramo). El dedupe se marca **después** del insert exitoso — marcarlo al intentar dejaría que un error transitorio silenciara la señal el resto de la sesión.

🔴 **Un anuncio sin URL firmada NO se sirve** (#170.8). Una impresión que el anunciante paga y que no muestra su video es peor que no servir el anuncio, y se registraría igual porque el registro no sabe si el video pintó.

**La zona vista gana sobre el GPS** (#195), pero solo por PUNTO: cuando hay «buscar en esta zona» activa, `ads_for_zone` recibe el centro del área. La precedencia por **id** de colonia/municipio sigue sin llamador — ese id vive solo en el `useState` de `MapScreen` — y hay un assert que lo fija para que no se vuelva una defensa afirmada que nadie ejerce.

## Medición e impresiones (#170.5–170.7)

`ad_impressions` es base de **facturación**, así que la escribe una EF con `service_role`: RLS activa y **cero policies**.

🔴 **El id lo deriva el SERVIDOR** (#193): `uuid_v5(ns, "user_id:ad_id:session_id")` con el `user_id` del JWT. El cliente dejó de mandarlo. Construir el id de otra persona exige conocer su `user_id`, que no sale de nuestros sistemas — el vector se **elimina**, no se blinda.

🔴 **`ON CONFLICT DO NOTHING` = gana la primera escritura**, lo contrario de lo que sugiere «upsert». Por eso `adImpressionQueue` marca el par (sesión, anuncio) al ENCOLAR, no al enviar: el dedupe **gatea la emisión**. Y como solo se encola al TERMINAR la exposición, la cola nunca contiene un `watched_ms` parcial.

🔴 **El tap al CTA nunca viaja en un POST anterior al de su impresión.** `record_cta_tap` es un UPDATE (su firma acotada es lo que impide que toque `watched_ms`/`viewed`/`completed`), así que un tap que llega antes no matchea nada y se pierde — y es el evento que se factura por clic. La defensa es el guard de `flush`, **no** que `report_cta_tap` no dispare flush (comprobado por mutación). La otra mitad es `cta_taps_orphaned` (#198): el cliente controla el orden en que EMITE, no en que los POST LLEGAN.

## Lo que NO existe todavía
- **Ningún pago.** El slot lo otorga el admin a mano con `grant_ad_slot_atomic` (`service_role`); `ads.purchase_id` queda NULL toda la beta, listo para que Stripe solo lo llene ([[monetizacion-pago-por-video]]).
- ~~Ninguna ruta para que el anunciante cree su campaña~~ — **cerrado en #191**: `create_ad_campaign_atomic`, security definer y granted a `authenticated`. 🔒 La agencia sale del JWT, nunca de un parámetro. Nace en `pending_review`; activarla sigue siendo exclusivo del admin.
- **La UI de moderación admin** llega con #81; en beta se modera por Studio/SQL, igual que #71.5.
- ~~Servir los anuncios en el feed~~ — **hecho en #170** (ver arriba).
- ⚠️ **La vigencia se fija al CREAR, no al aprobar** (`starts_at`/`ends_at` son NOT NULL): si la campaña queda días en `pending_review`, esos días se consumen. En beta no hay pago y la aprobación es rápida; el día que haya dinero, esto se revisa.

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
