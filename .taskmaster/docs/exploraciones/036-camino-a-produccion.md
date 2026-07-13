---
tipo: proyecto      # feature | fix | refactor | chore | proyecto
nivel: XL           # XS | S | M | L | XL — épica multi-fase, toca app + Edge Functions + migraciones/RLS + web
fecha: 2026-07-12
estado: borrador     # borrador → en-revision → aprobado | descartado
tarea_id:            # se llena SOLO al promover (estado: aprobado)
motivo_descarte:
---

# Camino a producción (demo → beta → PRD)

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ se promueve a tarea[s] en Taskmaster) o **DESCARTARSE** (queda como registro de decisión).
> NO edita los PRD maestros; "Impacto en PRD" es solo referencia.
> Este doc es **XL / proyecto**: mapea el salto completo de la demo cerrada a la versión del PRD, con foco en las 4 brechas de infra. El desglose fino en subtareas lo hará `/tm-plan` / `task-master expand` por épica al promover.

## Idea original
> "036 — Camino a producción (demo → beta → PRD). Alcance = full camino demo→PRD, cubre las 4 brechas grandes de infra, no solo storage." Con dos decisiones **ya tomadas por Abraham** (locked, punto de partida):
> 1. **Video/storage híbrido Cloudflare: Stream (feed) + R2 (assets).** Complementarios, NO excluyentes. Precisa/reemplaza la decisión previa del vault que decía "solo Cloudflare Stream" (2026-07-09).
> 2. Cubrir el camino completo demo→PRD (las 4 brechas: video, pagos, admin web, push), no solo storage.

## Lluvia de ideas (solo si la idea era abstracta)
La idea llegó **concreta en su rumbo** (híbrido Stream + R2 ya decidido; alcance = 4 brechas). No hace falta abrir direcciones alternativas de arquitectura de storage. La lluvia de ideas se concentra en las **decisiones aún abiertas** de las otras 3 brechas (pagos, admin, push) → se devuelven como **Preguntas para el orquestador** al final, no como enfoques a converger aquí. n/a como brainstorming de rumbo.

## Problema / Motivación
La **demo cerrada de 3 semanas** ([[0005-demo-cerrada-3-semanas]]) cumplió su objetivo: validar el flujo end-to-end con inmobiliarias reales sobre el stack objetivo (Supabase + PostGIS + RLS + Edge Functions). Pero la demo tomó atajos deliberados que **hoy topan con pared** y bloquean pasar a una **beta pública/abierta** y de ahí a la versión del PRD:

- 🔴 **Video en Supabase Storage no escala:** el plan Free capa la subida global a **50 MB** (videos >50 MB → 413), y sin transcodificación el feed bufferea **MP4 crudo** que reventaba el heap Java de Android (OOM #57, mitigado por OTA pero no resuelto de raíz). Ver [[feed-vertical-video]], [[propiedades-y-video]].
- 🔴 **Sin pagos:** la monetización (pago por video / créditos, [[0002-monetizacion-pago-por-video]]) es el modelo de negocio y está totalmente fuera de la demo.
- 🔴 **Admin en la app:** el alta de inmobiliarias vive dentro de la app móvil; el PRD pide un **panel web Next.js** separado.
- 🔴 **Sin notificaciones:** solo existe el schema; no hay centro in-app ni push (FCM/APNs), pieza que el PRD usa para ~18 eventos (incl. "tu video está listo").

`wiki/estado/brechas-demo-vs-prd.md` sintetiza estas **4 brechas de infra grandes** + 6 módulos que solo tienen schema. Este doc las convierte en un plan de fases aprobable, y produce los dos artefactos de proceso que faltan: **`docs/PRD-beta.md`** (alcance intermedio) y **`ADR 0008`** (formaliza "construir la versión del PRD" y la arquitectura de storage híbrida) — el "cabo suelto de proceso" que nota `brechas-demo-vs-prd.md`.

## Resultado esperado
Un plan por fases, aditivo y sin rewrite, que lleve de la demo actual a una **beta pública** con:
- Video servido por **Cloudflare Stream** (HLS adaptativo, sin cap de 50 MB, sin OOM) y assets/originales en **Cloudflare R2** (egress $0).
- Infra de las otras 3 brechas **preparada** (schema, EFs, superficies) aunque la beta arranque **sin pagos activos** (decisión de `estado-actual`: "beta sin pagos activos pero con infra preparada").
- Dos artefactos de proceso creados: `docs/PRD-beta.md` + `ADR 0008`.
- Una descomposición en épicas lista para promover a Taskmaster (tag `master`), ordenada por dependencia.

## Alcance
- **SÍ entra (este doc):**
  - Arquitectura objetivo de **storage/video híbrido** (Stream + R2) mapeada al schema existente.
  - Esbozo a nivel épica de las otras **3 brechas** (pagos, admin web, push).
  - **Estrategia de entrega aditiva** (expand·migrate·contract) para no romper apps en la calle.
  - **Entregables**: esqueleto de `docs/PRD-beta.md`, título+decisión de `ADR 0008`, descomposición en épicas candidata.
  - Estimación gruesa de **costos** a escala demo/beta.
  - **Preguntas abiertas** para que Abraham las resuelva.
- **NO entra (out of scope de ESTE doc):**
  - Escribir código, migraciones o EFs (esto es EXPLORE, pre-TDD).
  - Crear las tareas en Taskmaster (lo hace el orquestador al aprobar).
  - Editar los PRD maestros (`docs/PRD.md`, `docs/PRD-MVP-demo.md`) ni `mobile/**` / `supabase/**`.
  - Módulos de producto que NO son las 4 brechas de infra (moderación, analítica/eventos, comentarios/follow, OAuth, VOH) — quedan referenciados en `brechas-demo-vs-prd.md` como olas posteriores, fuera del foco de infra.

## Roles afectados
- **Comprador / buscador:** feed más fluido (HLS), recibe push (video de agente seguido, etc. — post-follow), eventualmente paga nada (consumo gratis).
- **Inmobiliaria + agente:** subida de video por pipeline resumible a Stream; recibe push "video listo / falló"; **paga** por publicar (pago por video / créditos) cuando se activen pagos.
- **Admin de plataforma:** deja de operar desde la app; migra a **panel web Next.js** (alta de agencias, moderación, auditoría `admin_actions`).

## Impacto en datos
El schema **ya reserva** casi todo lo necesario (base reutilizable, no rewrite — `brechas-demo-vs-prd.md`):
- **Video:** `property_videos.cloudflare_uid` (HASH) y `storage_path` **ya coexisten**; el CHECK `property_videos_ready_requires_storage` (0012) acepta **cualquiera** de las dos refs (`status <> 'ready' OR storage_path IS NOT NULL OR cloudflare_uid IS NOT NULL`). → migrar a Stream es **poblar `cloudflare_uid`** en vez de `storage_path`, **sin cambiar el CHECK**. Ver [[propiedades-y-video]].
- **Tablas ya sembradas (solo schema):** `notifications`, `property_reports`, `events_raw`, `purchase`/`video_slot` (billing), legal, VOH.
- **Nuevo probable:** columnas de estado de procesamiento de Stream (webhook), tabla/columna de **push tokens** por dispositivo, columnas de pago/crédito activas, posibles buckets R2 (fuera de Postgres — es S3-compatible, no Storage de Supabase).
- Todo aditivo: columnas con default, tablas nuevas → **una app vieja las ignora** (expand·migrate·contract, [[estrategia-releases]]).
- Reglas duras: migraciones **idempotentes + rollback + pgTAP**, RLS como 2ª capa, triggers solo atómicos, snake_case.

## Impacto en UI
- **Feed / detalle / player:** cambiar la fuente de MP4 firmado a **HLS de Stream** (`.m3u8` con signed URL / token). `expo-video` soporta HLS nativo — probable que resuelva #57 de raíz (sin buffer de MP4 crudo). Superficie: `VideoFeedItem`, `PropertyVideoPlayer`, preview `step3`.
- **Wizard de publicación:** paso de video pasa a **subida resumible directa a Stream** (upload URL / tus) + estado `processing` + thumbnails sugeridos (PRD §13.4-13.5).
- **Centro de notificaciones** in-app (tab del bottom bar, PRD §22) + prompt de permiso push.
- **Panel admin web** (fuera de `mobile/`, nuevo proyecto Next.js).
- ⚠️ **Branding:** cualquier pantalla nueva (centro de notificaciones, panel web) toca diseño visual. Gate #8/#19 **LEVANTADO** (cliente, 2026-06-26), pero el **panel web no tiene mockup canónico** en `urbea-identidad-visual.html` (solo cubre las ~13 pantallas de la demo móvil) → diseño del admin web = trabajo de diseño nuevo, no cubierto por el techo de alcance existente. Ver Preguntas abiertas.

## Reglas no obvias aplicables
- **CHECK dual de referencia de video** — un video `ready` exige `storage_path` **o** `cloudflare_uid`; migrar a Stream no toca el CHECK. `[[propiedades-y-video]]` · migración 0012.
- **Signed URLs server-side vía EF `mint-video-url`** — el patrón actual (service_role minta signed URLs, el filtro SQL es la ÚNICA barrera, fail-closed) es **exactamente** el patrón para Stream (signed URLs / tokens) y R2 (presigned). El vault ya lo anota: "mismo patrón que la futura migración a Cloudflare R2 (presigned server-side)". `[[propiedades-y-video]]`.
- **Lógica de negocio en Edge Functions, RLS 2ª capa, triggers solo atómicos** — `docs/lineamientos-desarrollo.md`, `[[rls-seguridad]]`. Webhooks de Stream y de Stripe = EFs (PRD §33.3).
- **Aditivo (expand·migrate·contract), nunca renombrar/borrar en caliente** — apps viejas conviven contra la misma DB. `[[estrategia-releases]]`.
- **`runtimeVersion.policy: appVersion` hoy** → se recomienda migrar a `fingerprint` para que EAS decida OTA vs rebuild (Stream y push meten **módulos nativos** → rebuild obligado). `[[estrategia-releases]]`.
- **Deploy de EFs necesita `--import-map supabase/functions/deno.json`** y migraciones al remoto vía `apply_migration` (NO `db push`) — memorias del proyecto.
- **PNPM siempre**; testing en emulador solo por CLI (adb/simctl/Maestro), nunca computer-use — CLAUDE.md §3.

## Arquitectura / enfoque técnico  (L/XL)

### Brecha 1 — Storage/video híbrido Cloudflare (decisión LOCKED)
**Stream y R2 se reparten responsabilidades, son complementarios:**

| Pieza | Responsabilidad | Qué resuelve | Mapeo al schema |
|---|---|---|---|
| **Cloudflare Stream** | El **video del feed**: transcodifica el original → **HLS adaptativo** (adaptive bitrate) + CDN global + thumbnails automáticos | ✅ mata el **cap de 50 MB** (subida directa a Stream, no a Supabase) · ✅ mata el **OOM #57** (el player consume HLS segmentado, no MP4 crudo) · ✅ thumbnails (PRD §13.5) sin trabajo extra | **`property_videos.cloudflare_uid`** = uid del video en Stream |
| **Cloudflare R2** | **Originales** del video (respaldo/auditoría/reproceso), **imágenes** (avatares, thumbnails custom), **documentos** legales. S3-compatible | ✅ **egress $0** (vs Supabase Storage con egress facturado) · ✅ sin cap de 50 MB · ✅ almacenamiento barato de originales | **`storage_path`** re-interpretado como key del objeto en bucket R2 (o columna nueva `r2_key` si conviene distinguir del path de Supabase — decisión de plan) |

**Pipeline de subida (propuesto, a validar en `/tm-plan`):**
1. Cliente pide a una EF (`create-video-upload`, patrón de `create-invitation`) una **URL de subida directa a Stream** (Direct Creator Upload, tus-resumable — encaja con "subida resumible" del PRD §13.3). Se crea la fila `property_videos` en `uploading`/`processing` con el `cloudflare_uid` que Stream asigna.
2. El binario sube **directo del dispositivo a Stream** (no pasa por Supabase → sin cap de 50 MB; resumible por tus).
3. *(Opcional)* el **original** se archiva a **R2** (respaldo/reproceso) vía presigned PUT server-side.
4. Stream transcodifica async → **webhook** a una EF (`stream-webhook`) que marca el video `ready` y persiste `cloudflare_uid` + thumbnails. Aquí dispara la **push** "tu video está listo" (Brecha 4). El CHECK 0012 ya permite `ready` con solo `cloudflare_uid`.
5. **Reproducción:** una EF tipo `mint-video-url` (misma forma que la actual) devuelve **signed HLS URL / token de Stream** (y presigned R2 para imágenes) — mismo contrato hacia el feed, cambia el minter por dentro. El feed y el detalle **no cambian su llamada**, solo la fuente pasa a `.m3u8`.

**Migración de datos de la demo:** decisión abierta (ver Preguntas). Opciones: (a) **greenfield en beta** — se arranca limpio, los videos demo se re-suben a Stream; (b) **backfill** — job que baja cada `storage_path` de Supabase, lo sube a Stream, puebla `cloudflare_uid`, y en un release posterior (contract) se limpia `storage_path`. Dado que el remoto ya se ha vaciado/re-sembrado varias veces (memorias del proyecto) y la demo tiene **poquísimos videos**, greenfield es probablemente lo más barato.

**Qué se reusa:** el patrón EF-minter (`make_video_url_minter`, `supabase/functions/mint-video-url/`), el CHECK dual (0012), el bucket privado + RLS (para lo que quede en Supabase), el `useVideoUpload` por streaming (#52) como base del cliente. Ver [[mapa-codebase]], [[propiedades-y-video]].

### Brecha 2 — Pagos (Stripe + OXXO + SPEI)  (esbozo a nivel épica)
- Modelo: **pago por video / créditos** ([[0002-monetizacion-pago-por-video]], PRD §17): Premium $399/mes (1 video), paquetes de agente, crédito caduca **90 días**, slots de vigencia.
- Schema `purchase` + `video_slot` **ya reservado** en la DB (solo falta activarlo).
- Pasarela: **Stripe** principal (tarjeta + Apple/Google Pay + **OXXO Pay** + **SPEI**), respaldos a evaluar MercadoPago/Conekta/OpenPay (PRD §17, §33.2). ⚠️ **Decisión de provider abierta** — Stripe cubre OXXO/SPEI en MX pero conviene validar vs Conekta/MercadoPago (ver Preguntas).
- Implementación: **Edge Functions** para checkout + **webhook de Stripe** (PRD §33.3 lo lista explícito); RLS sobre `purchase`.
- **Beta puede ir con infra preparada pero pagos NO activos** (sandbox / feature-flag off) — decisión de `estado-actual`. Dependencia dura: publicación (para gatear "publicar consume un slot").

### Brecha 3 — Admin web (Next.js separado)  (esbozo a nivel épica)
- PRD §33.2: **Next.js + Tailwind + Supabase Client**, hosting **Vercel**. ~10 pantallas (alta de agencias, cola de moderación, `admin_actions` inmutable, dashboards).
- Reusa el backend existente: RPC `admin_create_agency_atomic` (0016), EF `admin-create-agency`, tabla `admin_actions`. El admin **deja de vivir en la app** (hoy en `mobile/app/admin/`).
- **Decisión abierta:** ¿mismo monorepo o repo aparte? (ver Preguntas). El CLAUDE.md dice "no edites `mobile/**`" — un admin web es un **nuevo paquete/proyecto**, no toca `mobile/`.
- Dependencia: moderación (Brecha de producto) para que la cola tenga sentido; puede arrancar solo con alta de agencias (paridad con la app hoy).

### Brecha 4 — Push (FCM/APNs vía Expo Notifications)  (esbozo a nivel épica)
- PRD §22, §33.2: **FCM como hub unificado** iOS+Android **vía Expo Notifications** (o FCM/APNs directo — decisión abierta). Catálogo de ~18 eventos; en MVP el primero y más útil es **"tu video está listo / falló"** (se engancha al webhook de Stream de la Brecha 1).
- Requiere: tabla de **push tokens** por dispositivo, EF para enviar, centro in-app (`notifications` ya en schema), permiso nativo.
- ⚠️ **Módulo nativo** (expo-notifications) → **rebuild** obligatorio, no OTA.
- Se invalida el token al cerrar sesión (PRD §22.2).

## Fases / épicas  (L/XL)

Orden por dependencia (olas). Estimación gruesa de tamaño por épica:

| # | Épica candidata | Tamaño | Depende de | Notas |
|---|---|---|---|---|
| **A** | **ADR 0008 + `docs/PRD-beta.md`** (formalizar rumbo y alcance de beta) | **S** | — | Artefactos de proceso; desbloquea todo lo demás con un norte escrito. Sin código. |
| **B** | **Video → Cloudflare Stream** (pipeline subida resumible + webhook + minter HLS + player) | **XL** | A | La brecha con más ROI: resuelve cap 50 MB + OOM + thumbnails. Reusa el patrón minter y el CHECK dual. |
| **C** | **Assets → Cloudflare R2** (originales, imágenes, presigned server-side) | **M** | A (puede solaparse con B) | Egress $0; migra avatares/thumbnails/originales. Independiente de la ruta de Stream. |
| **D** | **Push / centro de notificaciones** (tokens + EF envío + in-app + "video listo") | **L** | B (para el evento "video listo") | Módulo nativo → rebuild. Primer evento se engancha al webhook de Stream. |
| **E** | **Admin web Next.js** (alta de agencias + auditoría; moderación después) | **L→XL** | A | Repo/monorepo por decidir. Reusa backend existente. Diseño web nuevo (sin mockup canónico). |
| **F** | **Pagos** (Stripe + OXXO/SPEI, checkout EF + webhook, slots/créditos) | **XL** | A, (E útil para admin de cobros) | Puede ir con **infra lista pero inactiva** en beta. Provider por decidir. |
| **G** | **Migración `runtimeVersion` a `fingerprint`** (release engineering para la beta) | **S** | — | Habilita que EAS decida OTA vs rebuild automáticamente; útil antes de los rebuilds de B/D. |

**Olas sugeridas:** Ola 1 = A + G (proceso/release). Ola 2 = B + C (storage/video, el corazón). Ola 3 = D (push, engancha al webhook de B). Ola 4 = E (admin web). Ola 5 = F (pagos, activable después). El desglose fino en subtareas lo hace `task-master expand` / `/tm-plan` por épica al promover.

## Criterios de aceptación
Del **documento de exploración** (para poder aprobarlo/promoverlo):
- [x] Arquitectura Stream+R2 descrita con reparto de responsabilidades y mapeo al schema (`cloudflare_uid`/`storage_path`/CHECK 0012).
- [x] Pipeline de subida y de reproducción esbozado (resumible a Stream, webhook, minter HLS).
- [x] Las otras 3 brechas esbozadas a nivel épica con dependencias y orden.
- [x] Estrategia aditiva (expand·migrate·contract) explicitada.
- [x] Entregables propuestos: esqueleto `PRD-beta.md`, título+decisión ADR 0008, descomposición en épicas.
- [x] Costos a orden de magnitud.
- [ ] **Preguntas abiertas resueltas por Abraham** ← bloquea `LISTO_PARA_PROMOVER`.

De la **beta** (norte, no verificable aún — irá a `PRD-beta.md`):
- [ ] Video del feed servido por Stream (HLS), sin OOM en Android de gama media, sin cap de 50 MB.
- [ ] Assets en R2 con egress $0.
- [ ] Push "tu video está listo" funcionando E2E.
- [ ] Admin web operando alta de agencias fuera de la app.
- [ ] Pagos con infra desplegada (activables por flag).

## Dependencias
- **Cuentas externas:** Cloudflare (Stream + R2), Stripe (o alternativa), Firebase (FCM), Vercel (hosting web). **Abraham debe provisionarlas** — bloqueante para B/C/D/E/F.
- **Código a reusar:** EF `mint-video-url` + `make_video_url_minter`, `useVideoUpload` (#52), CHECK 0012, RPC `admin_create_agency_atomic` (0016) + EF `admin-create-agency`, schema reservado (`notifications`, `purchase`, `video_slot`, `property_reports`).
- **Migraciones base:** 0005 (videos), 0011 (bucket/storage_path), 0012 (CHECK dual), 0016 (admin).
- **Proceso:** crear ADR 0008 (el "cabo suelto" que `brechas-demo-vs-prd.md` señala: el 0001 aún dice que el norte es el MVP-demo).

## Edge cases / riesgos
- ⚠️ **Costos de Stream por minuto** — Stream cobra por **minuto almacenado + minuto entregado**; un feed de video puede acumular entrega. A escala demo/beta es marginal, pero conviene modelar el peor caso (ver Costos) — el PRD ya asume Stream.
- ⚠️ **Rebuild obligado** — Stream (si mete módulo nativo de player HLS; `expo-video` ya soporta HLS, a validar) y push (expo-notifications) exigen **build nativo nuevo**, no OTA → hay que coordinar reinstalación de testers. Migrar a `runtimeVersion: fingerprint` primero (épica G) evita adivinar.
- ⚠️ **Webhooks = superficie de seguridad** — el webhook de Stream y el de Stripe deben verificar firma (fail-closed), EF sin `verify_jwt` pero con validación de firma propia.
- ⚠️ **Apps viejas en la calle durante la migración** — si un tester tiene el build demo (lee MP4 de Supabase) y el backend ya migró a Stream, se rompe. Mitigación: expand·migrate·contract — mantener ambos caminos de reproducción hasta que todos actualicen; el CHECK dual **ya permite** coexistencia (`storage_path` viejo + `cloudflare_uid` nuevo).
- ⚠️ **Diseño del admin web sin mockup canónico** — `urbea-identidad-visual.html` solo cubre móvil; el panel web es diseño nuevo (gate de branding aplica pero sin techo definido).
- ⚠️ **Provider de pagos MX** — Stripe soporta OXXO/SPEI pero la cobertura/UX de OXXO ha variado; validar antes de comprometer (respaldos Conekta/MercadoPago en el PRD).

## Plan de pruebas (alto nivel)
- **Crítico (TDD estricto, por regla de path):** todo `supabase/functions/**` (EFs de upload/webhook/minter/checkout) y `supabase/migrations/**` (nuevas columnas/RLS) → RED→GREEN→guardian. Deno tests para EFs (patrón DI handler/adapter como `mint-video-url`), **pgTAP** para RLS/CHECK/constraints. Lógica móvil pura (`lib/**`, `hooks/**` del nuevo upload/minter) = crítica.
- **Ligero:** pantallas (centro de notificaciones, admin web UI), navegación, estilos = `pnpm tsc --noEmit` + `pnpm lint` + smoke.
- **E2E:** Maestro para el flujo de publicación con Stream (subir → processing → ready → aparece en feed) contra stack de prueba.
- **Webhooks:** test de verificación de firma (fail-closed) obligatorio.
- Cada épica define su seed. Testing en emulador **solo por CLI** (adb/simctl).

## Costos (orden de magnitud — demo/beta)
Escala beta según PRD §33.4: **0–500 usuarios ≈ $80–120 USD/mes** (todo el stack). Desglose de las piezas nuevas:
- **Cloudflare Stream:** ~$5 USD por **1,000 min almacenados** + ~$1 por **1,000 min entregados**. A escala demo (decenas de videos de 1–2 min, entrega baja) → **$5–15/mes**. La decisión del vault ya citaba **~$5/mes** para Stream.
- **Cloudflare R2:** almacenamiento ~$0.015/GB-mes, **egress $0** (la razón de elegirlo). Originales + imágenes de la beta → **<$5/mes**.
- **Supabase:** el plan actual (Free/Pro); pasar a **Pro (~$25/mes)** probablemente necesario en beta (quita el cap de 50 MB global si algo sigue en Storage, más conexiones, backups).
- **Stripe:** sin costo fijo, ~2.9%+$3 MXN por transacción (o comisión OXXO/SPEI) — solo con pagos activos.
- **Firebase FCM:** gratis en el volumen de la beta.
- **Vercel (admin+landing):** free/hobby para la beta.
- **Total nuevo estimado a escala demo/beta:** orden de **$35–60 USD/mes** por encima de lo actual, dominado por Supabase Pro + Stream. Consistente con el rango del PRD.

## Impacto en PRD (solo referencia — NO se edita)
- `docs/PRD.md` §13 (subida/procesamiento/thumbnails de video), §17 (pagos), §22 (notificaciones), §33.2 (stack: Stream, R2, FCM, Stripe, Next.js admin) → este plan **implementa** lo ya escrito ahí; no lo cambia.
- **Nuevo artefacto propuesto:** `docs/PRD-beta.md` (alcance intermedio demo→PRD). Esqueleto/índice propuesto:
  1. Objetivo y audiencia de la beta (pública/abierta vs cerrada — decisión abierta).
  2. Qué entra vs qué sigue diferido respecto al PRD (tabla de brechas priorizada).
  3. Arquitectura de storage/video híbrida (Stream + R2) — remite a ADR 0008.
  4. Pagos: infra lista, activación por flag (o sandbox).
  5. Admin web: alcance mínimo (alta de agencias) + roadmap.
  6. Push: catálogo mínimo de eventos para la beta.
  7. Estrategia de release (fingerprint, OTA vs rebuild, testers).
  8. KPIs de beta (PRD §34.2: ≥50 agentes, ≥150 buscadores).
  9. Fuera de alcance de la beta (moderación completa, analítica, comentarios/follow, OAuth, VOH).
- **Nuevo ADR propuesto — `wiki/decisiones/0008-arquitectura-real-prd.md`:**
  - **Título:** "0008 — Arquitectura real (PRD): storage/video híbrido Cloudflare + camino demo→beta→producción".
  - **Decisión:** (1) se construye la versión del PRD (el norte deja de ser la demo — supera al 0001/0005); (2) **video/storage híbrido: Cloudflare Stream para el feed (HLS, `cloudflare_uid`) + Cloudflare R2 para originales/imágenes/documentos (egress $0, `storage_path`/`r2_key`)** — precisa y reemplaza la nota previa "solo Cloudflare Stream" (2026-07-09); (3) migración **aditiva** (expand·migrate·contract). Consecuencia: reactivar `notifications`/`purchase`/`video_slot`, admin web separado, push. Enlaza `[[brechas-demo-vs-prd]]`, `[[estrategia-releases]]`, `[[propiedades-y-video]]`, `[[0002-monetizacion-pago-por-video]]`.

## Decisiones del intake
- **LOCKED (Abraham, punto de partida):** storage híbrido Stream+R2 (complementarios); alcance = 4 brechas de infra, no solo storage.
- **LOCKED (vault):** beta "sin pagos activos pero con infra preparada" (`estado-actual` 2026-07-09); migración aditiva (`estrategia-releases`); video migra fuera de Supabase Storage (OOM #57 + cap 50 MB).
- **Abiertas → sección siguiente** (las resuelve Abraham con el orquestador).

## Preguntas para el orquestador
> Para `AskUserQuestion`. Agrupadas por tema; cada una con opción recomendada (REC).

**1. Migración de datos del video de la demo**
¿Migrar los videos existentes de Supabase Storage a Stream, o arrancar limpio en beta?
- **(REC) Greenfield en beta** — el remoto ya se ha vaciado/re-sembrado varias veces y hay poquísimos videos; re-subir es más barato que un job de backfill.
- Backfill (job que baja de Supabase → sube a Stream → puebla `cloudflare_uid` → contract limpia `storage_path`).

**2. Provider de pagos MX**
¿Con qué pasarela cubrir tarjeta + OXXO + SPEI?
- **(REC) Stripe** — es el del PRD, cobertura completa MX, webhooks maduros, Apple/Google Pay.
- Conekta (fuerte en OXXO/SPEI local) · MercadoPago · evaluar como respaldo.

**3. ¿Beta con pagos reales o sandbox/inactivos?**
- **(REC) Infra lista + pagos inactivos (feature-flag)** — coincide con la decisión ya tomada en `estado-actual`; valida producto sin fricción de cobro.
- Sandbox (modo test de Stripe, cobros ficticios) · Pagos reales desde beta.

**4. Admin web: ¿mismo monorepo o repo aparte?**
- **(REC) Repo/paquete aparte** (o `apps/admin` en un monorepo nuevo) — no toca `mobile/`, deploy Vercel independiente, ciclo propio.
- Monorepo con `mobile/` (comparte tipos/cliente Supabase, un solo repo).

**5. Push: ¿Expo Notifications o FCM/APNs directo?**
- **(REC) Expo Notifications** — integración nativa con Expo/EAS, hub unificado, menos fontanería (el PRD lo contempla "FCM vía Expo Notifications").
- FCM/APNs directo (más control, más trabajo).

**6. Alcance/audiencia de la beta**
¿La beta es abierta al público o sigue cerrada por invitación (ampliada)?
- **(REC) Beta pública limitada** (registro libre de buscadores ya vive; agentes por invitación) — permite medir los KPIs del PRD §34.2 (≥50 agentes, ≥150 buscadores).
- Cerrada ampliada (más inmobiliarias invitadas, sin registro libre).

**7. Orden de olas / qué primero después del ADR**
Confirmar la secuencia B (Stream) → C (R2) → D (push) → E (admin) → F (pagos).
- **(REC) Sí, Stream primero** — es la brecha con más ROI (mata cap 50 MB + OOM + thumbnails) y desbloquea el primer evento de push.
- Reordenar (p.ej. admin web antes, si el cliente necesita gestionar agencias ya).

**8. ¿Se archiva el original en R2 en el pipeline de subida?**
- **(REC) Sí** — respaldo/reproceso/auditoría barato (egress $0), y R2 ya está en la arquitectura.
- No en beta (solo Stream; ahorra un paso de subida) — se puede añadir después.

## Promoción / descarte
**Al aprobar:** promover como **épica raíz** (o 7 tareas A–G) al tag `master`, en el orden de olas; correr análisis de complejidad y `/tm-plan` empezando por **A (ADR 0008 + PRD-beta)** y **G (fingerprint)**, luego **B (Stream)**. Registrar el `tarea_id` aquí y crear `wiki/decisiones/0008-arquitectura-real-prd.md`.
**Al descartar:** n/a (rumbo ya validado por Abraham; a lo sumo se pospone el arranque).

## ✅ Resolución — Abraham (2026-07-12) — APROBADA
Respuestas a las preguntas abiertas + defaults confirmados:
- **1. Video demo:** greenfield en beta (re-subir), sin backfill.
- **2. Provider de pagos MX: Stripe** (tarjeta + OXXO + SPEI). Registrado para la épica F (ola tardía).
- **3. Beta con pagos inactivos por feature-flag** (infra lista).
- **4. Admin web: repo/paquete aparte** (no toca `mobile/`, deploy Vercel independiente). ⚠️ sin mockup canónico → diseño = trabajo nuevo.
- **5. Push: Expo Notifications.**
- **6. Audiencia: beta pública limitada.**
- **7. Orden de olas confirmado:** A+G → B (Stream) → C (R2) → D (push) → E (admin) → F (pagos).
- **8. Sí, archivar el original en R2** en el pipeline de subida.

**Promoción a Taskmaster (decisión: "olas listas + graphify"):** se crean SOLO las olas desbloqueadas — épica **A** (ADR 0008 + `docs/PRD-beta.md`), **G** (runtimeVersion→fingerprint), **B** (Cloudflare Stream), **C** (Cloudflare R2). Las épicas **D (push), E (admin web), F (pagos-Stripe)** quedan documentadas aquí como pendientes y NO se crean como tareas hasta resolver el resto de sus decisiones + provisionar cuentas (Cloudflare, Stripe, Firebase, Vercel). IDs de tareas creadas: ver `wiki/log.md` [2026-07-12].
