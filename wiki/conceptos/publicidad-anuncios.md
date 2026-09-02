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
  - supabase/functions/moderate-ad/
  - supabase/migrations/20260822000002_moderate_ad_atomic.sql
  - supabase/migrations/20260822000003_ads_reject_from_pending_review.sql
  - mobile/app/admin/ads/index.tsx
  - mobile/src/features/ads/hooks/usePendingAds.ts
  - mobile/src/features/ads/hooks/useModerateAd.ts
  - supabase/functions/stream-webhook/handler.ts
  - supabase/migrations/20260820000001_ads_zone_bbox_determinism.sql
  - supabase/migrations/20260820000002_ad_creatives_failure_reason.sql
  - supabase/migrations/20260821000001_ad_metrics_for_agency.sql
  - supabase/migrations/20260822000001_notify_ads_expiring_soon.sql
  - mobile/src/features/ads/
  - mobile/app/(protected)/ads/
  - supabase/migrations/20260903300001_ads_property_id.sql
  - supabase/migrations/20260903300002_promote_property_atomic.sql
  - supabase/migrations/20260903300003_ads_for_zone_promos.sql
  - supabase/migrations/20260903200001_municipality_at_point.sql
  - supabase/tests/87_ads_property_id_test.sql
  - supabase/tests/88_promote_property_atomic_test.sql
  - supabase/tests/89_ads_for_zone_promos_test.sql
  - mobile/src/features/ads/hooks/usePromoteProperty.ts
  - supabase/functions/record-ad-impressions/types.ts
actualizado: 2026-08-21
---

# Publicidad: anuncios de terceros

> Negocios locales (créditos, seguros, mudanzas, notarías…) pagan por aparecer en el feed con un video corto y un CTA hacia fuera de la app. Construido por **#169**; **nada desplegado** todavía.

## Las cuatro tablas (#169.1)
`ad_creatives` (el video: `cloudflare_uid`, `duration_seconds` 6–30, `uploading→processing→ready|failed`) · `ads` (la campaña: título, CTA, vigencia, estado) · `ad_zones` (municipio **XOR** colonia, contra el catálogo de [[mapa-y-ubicacion]]) · `ad_prices` (PRD §17.2: **precios en tabla, jamás en código**).

🔒 **Cero filas en `ad_zones` = inventario nacional.** No es un error de formulario — validarlo como tal rompería el modelo de venta. Es un invariante que atraviesa RPC, validación de cliente y wizard.

Tabla **propia**, no `property_videos`: eso es lo que permite que el 409 de concurrencia de anuncios y el de propiedades convivan **sin un solo condicional de dominio** (ver abajo).

## La máquina de estados (#169.2, corregida en #208.1)
`draft → pending_review → {active | rejected}`; `active → paused|expired|rejected`; `paused → active`. `rejected` y `expired` son **terminales**.

- **`draft → active` directo falla.** Ése es el criterio de "jamás se sirve sin moderación".
- **No existe estado `approved`**: un intermedio entre `pending_review` y `active` es exactamente el deadlock que [[moderacion]] tuvo que cortar en propiedades (#153).
- 🔴 **`pending_review → rejected` NO existía hasta #208.1.** El grafo original solo llegaba a `rejected` desde `active`, así que un admin podía **aprobar** un anuncio en revisión pero **no rechazarlo**: para rechazarlo tendría que activarlo primero, publicando durante un instante exactamente el contenido que quería rechazar. No era una regla deliberada — la suite `48_ads_state_machine_test.sql` enumera las transiciones inválidas que sí se decidieron y ésta no está entre ellas, mientras que `rejection_reason`, el CHECK bidireccional y el propio enum la daban por hecha. Lo encontró el RED de #208.1, no una revisión de código.
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
- ~~La UI de moderación admin llega con #81~~ — **cerrado en #208**: `/admin/ads` es la cola de `pending_review`, con el creativo firmado bajo demanda y rechazo con motivo obligatorio. Se adelantó de #81 porque sin ella el circuito comercial no cerraba. ~~Lo que seguía sin interfaz era **encender `can_advertise`**~~ — **cerrado en #209 (2026-08-23, DESPLEGADO)**: EF `set-org-advertising` + overload de 4 args de `set_org_advertising_atomic` (`20260823000001`) + alta/toggle en el panel admin in-app. El circuito comercial completo ya se opera desde la app: encender capacidad → crear campaña (#191) → moderar (#208) → servir (#170, tras el flip de `ads_enabled`) → **bajar/pausar/reanudar un activo (#210, DESPLEGADO 2026-08-23)** — el botón de emergencia previo al flip: `moderate-ad` expone `pause`/`resume` (D2 verificado en vivo: la pausa congela el reloj), `reject` baja activos con motivo, y el guard `AD_PAUSED_BY_SUSPENSION` impide que un click revival un anuncio pausado por la suspensión de su organización (solo la cascada de reactivación de #169.2/#211 puede, vía GUC transacción-local).
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

## El dashboard por anuncio (#212, 2026-08-24) — la vista Meta-style

Sobre el mismo patrón de #171 pero POR anuncio: `ad_stats_totals` / `ad_stats_daily` /
`ad_stats_zones` (`20260824000001`, desplegadas en producción) resuelven la agencia vía
`ads.agency_id` y autorizan fail-closed igual que `ad_metrics_for_agency`. Dos decisiones
propias: **D-DAILY-ELIGIBLE** (la serie diaria sale SOLO del crudo elegible — un mes
congelado aporta 0 días aunque sí sume en totales/zonas vía monthly; sin umbral k porque
no tiene dimensión geográfica) y **D-GRANULARIDAD-AD** (el k≥5 de zonas se evalúa por
(ad, zona), nunca por (agencia, zona)). UI: `useAdStats` (todo-o-nada en error, «—»
nunca 0 fabricado) + `AdDailyLineChart`/`AdZoneBarsChart` + lista con 3 métricas y
detalle con selector Hoy/30días/Máximo — techo visual: `mobile/design-previews/212-dashboard-anuncios.html`
(aprobado por Abraham). El gate de entrada es `can_advertise` **o** ≥1 anuncio.

## El panel del anunciante (#171) — solo agregados, y el umbral que lo hace honesto

`ad_metrics_for_agency(p_agency_id, p_from?, p_to?)` es la única ruta por la que un
anunciante toca sus impresiones. `ad_impressions` tiene RLS activa y **cero policies**,
así que la RPC es `security definer` y la autorización vive EXPLÍCITA en su cuerpo:
`private.agency_role_of(...)` **y** `private.org_can_advertise(...)` — las dos, no una.
Sin autorización devuelve **0 filas, nunca una excepción**: un error distinguible
confirmaría que el recurso existe.

🔒 **El k-anonimato se mide en PERSONAS, no en eventos.** El umbral es
`count(distinct user_id) >= 5`, jamás `count(*)`. La diferencia no es de precisión sino
de sentido: con un umbral por impresiones, **una sola persona** que ve el anuncio 6 veces
desbloquea el desglose de su propia colonia con n=1 — que es exactamente la
re-identificación que el k-anonimato existe para impedir. Decisión de Abraham
(2026-08-20): gana usuarios distintos aunque al principio, con poca audiencia, se vean
más zonas colapsadas. Es el error correcto en privacidad. Ver [[privacidad-datos]].

Lo que no llega al umbral —y lo que **nunca resolvió zona**, que es lo normal cuando el
GPS está apagado o el punto cae fuera de polígono— se funde en **UNA sola** fila
`(NULL, NULL)`: el bucket «otras zonas». Colapsar nunca pierde impresiones: la suma de
las zonas desglosadas más el bucket es el total facturable. Un anunciante que ve menos de
lo que pagó es un problema comercial, no un detalle de implementación.

**La garantía es de ida y vuelta: el cliente tampoco puede deshacerla.** `useAdMetrics`
separa el bucket **estructuralmente** (`other_zones`, nunca dentro de `zones`) para que
la pantalla no pueda tratarlo como una zona más ni por accidente, y no reparte, estima ni
prorratea lo que el umbral ocultó. Reconstruirlo desde el cliente anularía el k-anonimato
que la RPC construyó server-side.

**`totals = null` no es cero.** `null` significa «cargando» o «no pudimos cargar»;
`{0,0,0}` significa «todavía no hay datos». Para alguien que pagó un slot son mensajes
opuestos, y confundirlos es mentirle sobre lo que compró.

## El aviso de expiración (#171.4) — el primer escritor de `notifications`

La tabla `public.notifications` existía desde `20260604000007` y **nunca se había escrito
ni leído**. `notify_ads_expiring_soon()` la estrena: avisa a los owner/admin **activos**
de la organización (no a `created_by_user_id`, que es nullable y esa persona pudo haberse
ido) de sus anuncios `active` con `ends_at` a ≤7 días.

🔴 **La idempotencia es el punto fino**, porque el job corre a diario y un anuncio a 7
días de expirar cumple la condición varios días seguidos. El ancla es un índice único
**parcial** sobre `(user_id, related_entity_id, type, ((data->>'ends_at')))`, y el
`ends_at` va dentro de la llave a propósito: sin él, un anuncio cuya vigencia se
**extiende** quedaría mudo para siempre. Se escribe con `to_char(... at time zone 'UTC',
...)` y nunca con `to_jsonb(timestamptz)`, que depende del DateStyle/timezone de la
sesión y volvería el ancla inestable entre corridas.

Un aviso **borrado** por la persona sigue anclando — también a propósito: anclar solo los
vivos haría que borrarlo lo trajera de vuelta mañana, y pasado, hasta que el anuncio
expirara. «Ya te avisé, tú lo borraste». #77 (UI de notificaciones) hereda esta decisión.

Solo se avisa de anuncios `active`. Que la vigencia pagada se pause o se pierda al
suspender el negocio **sigue siendo una pregunta abierta** de la exploración 039, y un job
diario no es el lugar donde se decide una regla de negocio en silencio.


## Entrada al wizard + paridad de video (#227/#228, 2026-09-01)

**#227**: el wizard (169.9) era inalcanzable — nada navegaba a `/ads/new/step1` (el techo R23 de 171.3 prohibía UI extra y el botón no estaba en ninguna lista). Entrada doble en `/ads`: «+» en headerRight y CTA del estado vacío (voz activa), ambas gated por `useCanAdvertise` (la ruta también sirve de dashboard histórico con capacidad revocada, donde mint daría 403). **#228** (decisión de producto 2026-08-31): el creativo acepta los MISMOS límites que el video de una propiedad — **10–120 s y 500 MB por TUS** (antes 6–30 s / 200 MB POST). Paridad POR CONSTRUCCIÓN: `ads/lib/validation.ts` importa `MIN/MAX_VIDEO_DURATION_SECONDS` de publish; `useAdUpload` usa `MAX_VIDEO_SIZE_BYTES` y reusa `publish/lib/tusUpload` (rama `protocol:'tus'` del mint, confluencia en el poll D1/#103 intacta); `mint-ad-upload-url` gana `size_bytes`→`create_tus_upload` + techo 400 `VIDEO_TOO_LARGE` + `protocol` en la respuesta (sin `size_bytes` = básico intacto, builds viejos); `stream-webhook` valida 10–120. Parity tests: `upload_window_parity.test.ts` (constantes entre EFs) y `validation.test.ts` (cliente). Desplegado 2026-09-01 (EFs + OTA).


## Subida resiliente a cambios de red (#229, 2026-09-01)

Incidente real: cambio de wifi durante el poll → excepción única del checker mataba el ciclo Y la fila `uploading` bloqueaba a la organización 15 min sin escape (el mint de anuncios no tenía `replace`). Fixes: `PendingAdCanceller` (body `replace:true` → cancela pendientes de la agencia como `failed/REPLACED` antes del 409; nunca un creativo referenciado por `ads`), polls tolerantes en `useAdUpload`/`useVideoUpload` (excepción = intento reintentable), y 40 intentos de poll (~2 min) para los videos largos de #228. Regla que deja: **al calcar un pipeline, los quick-fixes posteriores del original no viajan solos — buscar los commits del original POSTERIORES al calco.**


## La 4ª capa del rango + pre-aprobación (#230, 2026-09-01)

El CHECK de columna `ad_creatives_duration_seconds_check` seguía en 6–30 tras #228 → `mark_ready` 23514 → webhook 500 → creativo `uploading` eterno. Fix: migración `20260901000002` (10–120) + pgTAP 78 que ancla el CHECK a las constantes del webhook. **El rango vive en CUATRO capas**: cliente (`ads/lib/validation.ts`), mint (`maxDurationSeconds`), webhook (`AD_MIN/AD_MAX`) y el CHECK. Pre-aprobación: step1 deja continuar al 100% del binario (`on_minted` + `creative_ready` en el form); step5 resuelve la verdad con `wait_for_creative_ready` (`features/ads/lib/waitForCreativeReady.ts`) antes de la RPC.


## Promocionar una propiedad = el «boost» (#213, 2026-09-02) — dos productos, dos gates

Decisión de Abraham (exploración 040): la promoción **ES el video de la propiedad**. Sin creativo nuevo, sin CTA, sin selector de alcance, sin pago: municipio heredado de la propiedad + 30 días fijos, UN paso (Promocionar → confirmar → `pending_review`) y la misma cola de moderación de `/admin/ads`. Modelo Meta: **boost** (esto) vs **Ads Manager** (el display de #169). Por eso el gate NO es `can_advertise` — es el permiso de **publicar** de la organización (el predicado literal de la policy `properties_insert`: rol agent/admin + miembro). Reusar `org_can_advertise` aquí habría dejado la feature muerta para casi todas las organizaciones, que solo publican (HAPPY11/12 de la suite 88 promocionan desde una org con `can_advertise=false`).

- **Esquema**: `ads` gana una segunda fuente de video, excluyente: `property_id` XOR `creative_id` (`ads_exactly_one_source`). El CTA sigue obligatorio **solo** para display (`ads_cta_required_for_display`). Una sola promo ABIERTA por propiedad (`ads_one_open_promo_per_property`, parcial en `pending_review/active/paused`; `expired/rejected` liberan el cupo) — el candado del doble tap vive en el índice, no en un `select if not exists`.
- **RPC** `promote_property_atomic(p_property_id)`: el actor sale de `auth.uid()` y la organización de la propiedad (nada de actor viaja como parámetro). Cuatro causas (no existe / borrada / sin `agency_id` / ajena) → un solo `PROPERTY_NOT_FOUND` (anti-enumeración). Fuera de cobertura → `ZONE_UNRESOLVED` y NO se crea el ad: una promo nunca degrada a inventario nacional. `title = properties.address` (`properties` no tiene `title`).
- **Feed**: `ads_for_zone` devuelve las 9 columnas de siempre + `property_id` al final (drop+create con grants re-otorgados; los builds instalados leen por nombre). Una promo se sirve **solo** si la propiedad sigue `active` no borrada y tiene video `ready` no borrado — el MISMO criterio con el que `mint-video-url` firma; el estado de la publicación manda sobre el del anuncio (pausarla la saca del feed aunque el ad siga `active`). El cliente parte el lote: display → `mint-ad-urls`, promo → `mint_videos` (la función del feed), cada mitad falla suave por separado.
- **Cliente**: «Promocionar» en el menú de «Mis publicaciones» solo con `active` + `agency_id`; `AdFeedItem` rama promo = badge «Anuncio», sin CTA, tap → detalle y `cta_tap` (`// ponytail:` el contacto real ocurre en el detalle, que no conoce el ad). Admin y paneles del anunciante etiquetan «Promoción · <título>».
- **Deploy**: 3 migraciones a producción el 2026-09-02 (sondas verdes); **OTA y smoke en dispositivo pendientes** (sesión conjunta #222). Orden obligatorio: migraciones → OTA (los hooks seleccionan `property_id`; sin la columna caen a error neutro 42703, no crashean).

## Un solo desempate municipal (#235) y el clamp de `shown_at` (#214)

- **#235**: el `order by area asc, id asc` sobre el bbox de `mx_municipalities` (#194) vivía **triplicado** en `ads_for_zone`, `resolve_ad_zone` y `place_at_point` — tres copias que solo coincidían por disciplina. Ahora las tres delegan en `private.municipality_at_point(lat, lng)` (secdef, EXECUTE revocado a clientes) y la suite 86 ancla que ninguna vuelva a mencionar `mx_municipalities`: servir, cobrar y buscar resuelven el mismo municipio **por construcción**.
- **#214**: `record-ad-impressions` ya no confía en el reloj del cliente: `normalize_shown_at` deja pasar hasta 5 min de adelanto (→ `now`), descarta más de 5 min de futuro y más de 90 días de pasado (la retención de `purge_ad_impressions`). Rechazar la fila, no la petición. Deuda derivada: **#236** (`Date.parse` acepta formas que `timestamptz` rechaza). ⚠️ EF **sin desplegar** todavía (comando en la bitácora de 214).


## El rollup se vigila solo (#215/#216, 2026-09-02)

- **#215**: `public.check_rollup_health()` diaria (pg_cron 0 10 UTC, tras el rollup 0 8 y la purga 0 9) avisa a los admins (`admin_rollup_unhealthy`) si el job lleva 3 corridas sin `succeeded` o si un mes con crudo ya salió de la ventana sin consolidar. La «tolerancia ~90−len(M) días desde el fin de M» de 201.1 es algebraicamente el corte `M < now()−90d`: se reusa la constante 90 (cuarto consumidor: purga, rollup, métricas, monitor), no una cifra nueva. Desplegada 2026-09-02; hoy no puede disparar (rollup en `succeeded`, `ad_impressions` vacía en producción).
- **#216**: la suite 69 gana una segunda agencia con un **mes de frontera** real y rangos **interiores** a un mes congelado; las 3 mutaciones que sobrevivían al RED de 201.2 mueren. Regla: una mutación de frontera solo muere con un fixture que la CRUCE (mismo hallazgo que el guardian repitió en la 92 con la banda 60–90 días).
