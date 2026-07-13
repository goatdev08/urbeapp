# PRD-beta — Urbea (camino demo → beta → producción)

> **Estado:** vivo · **v0.2** (2026-07-13) · **Spec completa: todas las olas (0–4) detalladas y descompuestas en 107 subtareas** (épicas TM 67–84). Decisiones locked por módulo. Listo para ejecutar por `/tm-plan`/`/tm-tarea`.
> **Fuente de verdad de producto:** `docs/PRD.md` (v1.0, 35 secciones). Este documento **acota y prioriza** ese alcance para la beta y define la secuencia de construcción. Decisión de arquitectura: `wiki/decisiones/0008-arquitectura-real-prd.md`. Brechas: `wiki/estado/brechas-demo-vs-prd.md`.

## 0. Cómo leer este documento
Cada módulo referencia su sección canónica en `PRD.md` (ej. `→ PRD §19`). El **detalle ejecutable sin ambigüedad** (modelo de datos delta, RLS, Edge Functions, pantallas, máquina de estados, edge cases, estrategia de test, subtareas) se redacta **al entrar cada ola** y se ancla aquí + en la épica de Taskmaster correspondiente. Este backbone fija lo que NO cambia: alcance de beta, decisiones transversales y orden.

## 1. Alcance de la beta: "casi-final sin cobrar"
La beta es la versión **más cercana al producto final** — todo lo primordial **visible y usable** — **excepto el cobro real**. Los videos se publican "gratis" (slot auto-otorgado por feature-flag). Audiencia: **beta pública limitada** (registro libre de buscadores + agentes por invitación). KPIs objetivo: `PRD §34.2` (≥50 agentes, ≥150 buscadores).

**Dentro de beta:** Olas 0–3 (núcleo + engagement + datos/admin).
**Fuera de beta (capstone final):** Ola 4 — pasarela de pagos (se construye al final, en Stripe test-mode, flip-ready a cobro real).

## 2. Decisiones transversales (aplican a todo el desarrollo)

### 2.1 Storage híbrido — Stream (feed) + R2 (assets)
Stream transcodifica el feed a HLS (`cloudflare_uid`); R2 guarda originales/imágenes/documentos (`storage_path`/`r2_key`, egress $0). Patrón EF-minter reutilizado. → ADR 0008 §2, [[propiedades-y-video]].

### 2.2 Pagos = capstone, flip-ready
Modelo de datos (`purchase`/`video_slot`/precios configurables/vigencia) **temprano (Ola 1)**; slots gratis por flag en beta. Pasarela Stripe **test-mode al final (Ola 4)**; cobro real = flip `test`→`live` + apagar flag, sin migración. → ADR 0008 §4, `PRD §17`.
- **Abstracción de slot cableada desde el inicio:** publicación, vigencia del video (`PRD §17.6`: avisos 7d/1d, `expired`, renovación), caducidad de crédito (90d) y las notificaciones asociadas se implementan **aunque el slot sea gratis** — así el cobro real no toca esa lógica.

### 2.3 Migración aditiva (expand·migrate·contract)
Nada de renombrar/borrar en caliente; columnas/tablas nuevas con default; EF retrocompatibles. → [[estrategia-releases]].

### 2.4 Entrega
OTA para JS/UI; rebuild solo para módulos nativos. `runtimeVersion` migra a `fingerprint` (Ola 0). **Web unificado en Next.js/Vercel** (decisión 2026-07-13, reemplaza Astro del PRD §27 para no mezclar stacks): repo público (landing + `/v/[id]`) + repo admin aparte. Push = Expo Notifications (envuelve FCM/APNs). Observabilidad = Sentry/Logflare + deep links `urbea.com/v/[id]`.

## 3. Mapa de módulos → olas → tareas

| Ola | Módulo | PRD § | Épica TM | Esf. |
|---|---|---|---|---|
| **0** | PRD-beta + ADR 0008 | — | 66 | S |
| 0 | runtimeVersion → fingerprint | §33 | 67 | S |
| 0 | Cloudflare Stream (video feed) | §13 | 68 | XL |
| 0 | Cloudflare R2 (assets/originales) | §13,§32 | 69 | M |
| **1** | Roles y multi-tenant | §4 | **71** (7 sub) | L |
| 1 | Auth completo (Google OAuth, email real, LFPDPPP) | §5 | **72** (7 sub) | L |
| 1 | Publicación 5-pasos + estados + moderación | §14–16 | **73** (10 sub) | L |
| 1 | Feed ranking §9.8 + mapa/búsqueda | §9–11 | **74** (9 sub) | M |
| 1 | CRM completo (9 estados + scoring) | §19 | **75** (8 sub) | M |
| 1 | Modelo de datos de pagos (sin gateway) | §17.7 | **76** (6 sub) | M |
| **2** | Notificaciones (in-app + push Expo) | §22 | **77** (7 sub) | L |
| 2 | Comentarios + Follow + Compartir + web /v/[id] | §18,§20,§21 | **78** (6 sub) | M |
| 2 | Reportes + antifraude | §24,§30 | **79** (4 sub) | M |
| **3** | Métricas y eventos | §26 | **80** (5 sub) | M |
| 3 | Panel admin web (Next.js, repo aparte) | §28 | **81** (6 sub) | XL |
| 3 | Landing (Next.js, no Astro) | §27 | **82** (4 sub) | L |
| — | Observabilidad + deep links (transversal) | §33 | **83** (4 sub) | M |
| **4** | Pasarela Stripe test-mode (capstone) | §17.4 | **84** (6 sub) | XL |

## 4. Especificación por módulo
> Se rellena **secuencial por olas**. Cada entrada crecerá a spec completa (modelo de datos, RLS, EF, pantallas, estados, edge cases, tests) al entrar su ola. Hoy = alcance + límite de beta.

### Ola 0 — Consolidación en infra de producción  ✅ *spec cerrada (2026-07-13)*
Orden de ejecución: **67 (fingerprint) → 69 (R2 minter) → 68 (Stream)**. R2 va antes que Stream porque el archivado en frío (68.8) usa el minter de R2.

**Decisiones (locked):**
| Tema | Decisión |
|---|---|
| Subida | Directo **tus → Stream**: EF `mint-upload-url` mintea URL tus de un solo uso; el cliente sube resumible directo a Cloudflare (egress $0, reanudable nativo, §13.3). |
| Datos demo | **Empezar limpio**; respaldo puntual (bajar originales de Storage a disco, script one-off) antes de apagar el bucket. Re-subida manual con contenido real. |
| R2 (alcance Ola 0) | **Mínimo**: avatares, logos y **originales archivados** (cold-store). Thumbnails NO (los renderiza Stream). |
| Playback | **HLS firmado TTL corto** (~4h, configurable en `app_config`) reusando `mint-video-url`; mismo contrato al feed (ADR 0008 §2). |
| Procesamiento | **Webhook de Stream → EF `stream-webhook`** (firma validada) actualiza estado + encola push "video listo/falló" (gancho; envío real en Ola 2). |
| Retención archived | **R2 frío + borrar de Stream al instante**; ventana `archived_retention_days=7` (configurable en `app_config`); `pg_cron` diario borra R2 > ventana; métricas permanentes en DB. |
| Fingerprint | PR **aislado primero** (`runtimeVersion.policy: fingerprint`), recompilar build, verificar OTA. |
| Thumbnail | Guardar **solo el timestamp** (`thumbnail_pct`); Stream renderiza on-the-fly (3 auto 25/50/75% + slider por `?time=`, §13.5). |

**Delta de datos (aditivo):** `ALTER TYPE property_video_status ADD VALUE 'archived'`; en `property_videos`: `tus_upload_url, thumbnail_pct, ready_at, error_reason, archived_at, r2_archive_key`. Nueva tabla `app_config(key, value jsonb)` sembrando `{video_slot_free, archived_retention_days:7, signed_url_ttl_seconds:14400}` (RLS: solo service role/admin).

**Edge Functions:** `mint-upload-url` (tus + concurrencia 1/agente §13.2 + límites) · `stream-webhook` (firma + estado + push) · `mint-video-url` (adaptado a HLS firmado de Stream) · `mint-r2-url` (presigned PUT/GET avatar/logo/archive).

**Prereqs externos (Abraham):** habilitar Cloudflare **Stream** (API token, signing key, webhook secret) y **R2** (bucket + S3 keys); cargar todo por `supabase secrets set` (nunca commit).

**Criticidad:** EFs y migración = **CRÍTICAS → TDD estricto**. Cliente (subida tus, thumbnail UI) = verificación reforzada + smoke. Cierre: E2E publicar→feed + smoke OOM (#57 resuelto de raíz por HLS adaptativo).

- *Subtareas:* TM 67 (3) · 69 (5) · 68 (10). *Exploración base:* `036-camino-a-produccion.md`.

### Ola 1 — Núcleo del producto  ✅ *spec cerrada (2026-07-13)*
Orden por dependencias: **72 (auth) → 71 (roles) → 76 (pagos-model) → 68… → 73 (publicación) → 74 (feed) → 75 (CRM)**. Admin en beta = super-admin por **Supabase Studio/SQL** sobre las mismas EFs de transición (panel web real = Ola 3).

**72 · Auth (§5) — épica 72 (7 subtareas):** verificación **real de email** (apagar autoconfirm + **Resend** SMTP); **Google OAuth** (Apple oculto tras flag, bloqueante pre-iOS por guía 4.8); **OTP de teléfono diferido** (guardar campo, verificar solo email en beta); **catálogo oficial MX** (estados+municipios INEGI) para ubicación normalizada; campos requeridos + único email/teléfono + mayoría de edad; **términos/LFPDPPP versionados** con re-aceptación en login; consentimiento WhatsApp.

**71 · Roles/multi-tenant (§4) — épica 71 (7 subtareas):** **premium derivado** de estado (sin tocar el enum `user_role`); `agency_member_role` extendido a **4** (owner/admin/agente/**solo-lectura**, el viewer se usa en beta); wizard upgrade a agente (Camino A token / Camino B solicitud admin); registro de inmobiliaria (pending→approved); **aprobaciones admin vía estado** (Studio en beta) + `admin_actions` inmutable; gestión de agentes + cambio de agencia conserva seguidores.

**76 · Modelo de pagos (§17.7) — épica 76 (6 subtareas):** `purchases` + `video_slots` + `plans` (precios configurables §17.2, precio histórico por compra); **ciclo completo de vigencia con slots gratis** (ADR §2.2): caducidad de crédito 90d, vigencia 1/3/6m, avisos 7d/1d (gancho notif → Ola 2), transición a `expired`, renovación → `pending_review`. Jobs por **pg_cron**. Sin gateway (Ola 4).

**73 · Publicación (§14–16) — épica 73 (10 subtareas):** estados = **mapear, no aplanar** (mantener `closed`+`closed_reason`+`deleted_at`, añadir operativos: uploading_media/media_failed/pending_payment/approved/rejected); doble versión de edición vía tabla **`property_revisions`** (snapshot, current_published sigue visible §15.6); wizard 5 pasos + autoguardado; envío con **slot gratis por flag** → `pending_review` (salta pending_payment); pipeline de moderación + **firma de duplicados dirección+agente** (video-igual diferido); re-revisión por edición (§15.5); publicación rápida; cierre sold/rented (§16).

**74 · Feed/mapa/búsqueda (§9–11) — épica 74 (9 subtareas):** ranking §9.8 = **RPC PostGIS con score + anti-clustering en post-pass** (5 posiciones); estado de sesión (seed/cursor/radio) **sin tabla, lo lleva el cliente** (RPC determinista); expansión de radio 2/5/10/20 + loop; autocompletado de zona con **catálogo MX propio** (colonias/CP, sin API externa); **`public_code`** corto (URB-XXXXX) al aprobar para búsqueda; búsqueda §11 (zona/agente/inmobiliaria/código + chips + lista/mapa + recientes); mapa con clustering + pin cards.

**75 · CRM (§19) — épica 75 (8 subtareas):** `lead_status` **mapeado** a §19.8 (+ whatsapp_opened/interested/closed_won_rent/sale) con **`is_follow_up` como bandera** (no estado); **scoring denormalizado** (peso por acción, una vez por video) → **nivel frío/tibio/caliente automático** por umbrales en `app_config` (el ESTADO lo mueve el agente, manual); privacidad §19.2 (agente ve datos + historial retroactivo solo tras crear lead, por RLS); contacto WhatsApp template fijo + unificación un-lead-por-agente-usuario; acciones del agente + timeline; export CSV + retención (§19.10).

**Prereqs externos (Abraham):** cuenta **Resend** + dominio verificado (DNS); **Google Cloud OAuth** client.
**Criticidad:** migraciones, RLS, RPCs y EFs = **CRÍTICAS → TDD estricto**; pantallas = verificación reforzada + smoke.

### Ola 2 — Engagement  ✅ *spec cerrada (2026-07-13)*
**77 · Notificaciones (§22) — 7 subtareas:** transporte **Expo Push** (envuelve FCM+APNs, ADR §2.4); despacho por **trigger sobre `notifications` → EF push-dispatch** (la tabla es fuente única in-app+push, respeta toggles §22.3 y `device_tokens`); conectar el **catálogo ~18 eventos** (los ganchos ya sembrados en Olas 0/1 se enchufan aquí); centro in-app (retención 30d) + toggles por categoría + resumen semanal (pg_cron).

**78 · Comentarios/Follow/Compartir (§18/20/21) — 6 subtareas:** `comments` con **filtro por reglas/lista configurable** (§18.2 → held_for_review, admin edita la lista §28.9); agente oculta sin borrar; `follows` solo de agentes (§20); compartir con **deep link permanente** + `share_clicked`; **página web mínima `urbea.com/v/[id]`** (reproduce HLS, datos públicos, CTA descarga, fallback "no disponible" §4.3/§21) → hace Compartir 100% funcional en beta.

**79 · Reportes/antifraude (§24/30) — 4 subtareas:** reportes de propiedad (1 por usuario, **3/24h → `suspended`** automático, 1-2 → cola prioritaria); reportes de perfil y comentario (sin bloqueo entre usuarios en MVP); **evidencia antifraude §30** al publicar (identidad/teléfono/IP/dispositivo/dirección/timestamp/autorización).

### Ola 3 — Datos & admin  ✅ *spec cerrada (2026-07-13)*
**80 · Métricas (§26) — 5 subtareas:** evento `view` (≥3s, %máx, completado ≥95%, §26.5) a `events_raw`; **rollup diario por pg_cron → `metrics_daily`** (dashboards 30d instantáneos, contadores vivos para totales); dashboard por publicación (§26.6) + analítica agregada del agente (§26.7).

**81 · Admin web (§28) — 6 subtareas:** repo `urbea-admin` **Next.js/Vercel aparte** + auth super-admin; **reusa las MISMAS EFs** de Olas 1-2 (una sola lógica app↔web); 10 pantallas §28.3 (dashboard, colas de moderación, gestión usuarios/inmobiliarias, reportes, invitaciones, captación, config, auditoría `admin_actions` inmutable); comunicación admin-publicador con motivo → notif 3 vías (§28.4).

**82 · Landing (§27) — 4 subtareas:** **repo web público Next.js** (el mismo de `/v/[id]` de 78.5, crece aquí; reemplaza Astro); secciones §27.1; captación de agente → `agent_interest_submissions` (§27.2); waitlist beta.

**Transversal · 83 (§33) — 4 subtareas:** Sentry (app+EFs) + Logflare (logs Supabase); deep links universales (AASA/assetlinks) con lógica §4.3.

### Ola 4 — Capstone: pagos  ✅ *spec cerrada (2026-07-13)*
**84 · Stripe test-mode (§17.4) — 6 subtareas:** **PaymentSheet nativo** (`@stripe/stripe-react-native`) + Payment Intents (EF) + **webhook EF** (firma, Stripe CLI local) → crea `purchase`+`video_slot` (modelo de 76); **los 4 métodos** en test (tarjeta+Apple/Google Pay full; OXXO/SPEI cableados, validar en live); recibo por Resend (§17.5, sin CFDI); **flip-ready** = apagar flag + llaves `test`→`live`, sin migración. Facturación CFDI = post-MVP.

## 5. Fuera de alcance (post-beta / post-MVP)
Cobro real activo · Virtual Open House (§29) · Facturación CFDI 4.0 (§17.5) · lo listado en `PRD §35.2`.
