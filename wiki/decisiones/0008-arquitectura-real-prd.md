---
tipo: decision
estado: aceptada
fecha: 2026-07-12
---

# 0008 — Arquitectura real: camino demo → beta → PRD

## Contexto
La demo cerrada ([[0005-demo-cerrada-3-semanas]]) cumplió su fin. El norte ahora es la **versión real del producto** (`docs/PRD.md`, 35 secciones). El `0001` todavía apuntaba a la demo; este ADR **reorienta el proyecto** y fija las decisiones de arquitectura y secuencia que gobiernan el resto del desarrollo. Detalle de brechas en [[brechas-demo-vs-prd]]; spec ejecutable en `docs/PRD-beta.md`.

## Decisión

### 1. Base reutilizable, migración aditiva (no rewrite)
El backend de la demo ES el stack objetivo (Supabase + PostGIS + RLS + Edge Functions). El schema ya reserva las tablas faltantes. Todo avance es **aditivo** (expand·migrate·contract, [[estrategia-releases]]) para que apps viejas y nuevas convivan contra la misma base durante demo→beta.

### 2. Storage híbrido Cloudflare: Stream (feed) + R2 (assets)
- **Cloudflare Stream** transcodifica el video del feed a HLS adaptativo → resuelve el cap global de 50 MB del plan Free **y** el OOM #57 de raíz **y** da thumbnails automáticos. Ref en `property_videos.cloudflare_uid` (ya existe).
- **Cloudflare R2** (S3-compatible, egress $0) guarda originales, imágenes/avatares, thumbnails y documentos. Ref en `storage_path`/`r2_key`.
- Se **reusa el patrón EF-minter** (`mint-video-url`): mismo contrato al feed, cambia el minter para devolver signed HLS de Stream / presigned R2. Ver [[propiedades-y-video]].

### 3. Corte de beta = "casi-final sin cobrar" (Olas 0–3)
La beta incluye **todo lo primordial visible y usable** — núcleo (roles, auth, publicación completa, feed/mapa/búsqueda, CRM), engagement (notificaciones, comentarios, follow/compartir, reportes) y datos/admin (métricas, panel web, landing) — **excepto el cobro real**. Audiencia: **beta pública limitada** (registro libre de buscadores + agentes por invitación). Alineado a `PRD §17.1`: la pasarela de pagos **no se construye para beta**.

### 4. Pagos = capstone, con Stripe test-mode, flip-ready a cobro real
- El **modelo de datos** de pagos (`purchase` + `video_slot` + precios en tabla configurable + lógica de vigencia/expiración `PRD §17`) se siembra **temprano (Ola 1)**; en beta el slot se **auto-otorga gratis por feature-flag** → toda la lógica de vigencia/expiración/renovación ya queda cableada.
- La **pasarela se desarrolla al FINAL** (Ola 4), en **Stripe test-mode** (llaves `sk_test`, tarjetas de prueba, webhooks vía Stripe CLI) — real y probada. La transición a cobro real mexicano (tarjeta + OXXO Pay + SPEI, `PRD §17.4`) = cambiar llaves `test`→`live` + apagar el flag, sin migración de schema.

### 5. Secuencia por olas (prioridad determinista)
- **Ola 0 — Consolidar en infra de producción:** PRD-beta+ADR, fingerprint, Stream, R2, endurecer feed/lógica. (Tareas 66–69.)
- **Ola 1 — Núcleo:** roles/multi-tenant, auth completo, publicación 5-pasos+16-estados+moderación, feed ranking §9.8, mapa/búsqueda, CRM completo, **modelo de datos de pagos**.
- **Ola 2 — Engagement:** notificaciones (in-app+push), comentarios, follow/compartir, reportes/moderación.
- **Ola 3 — Datos & admin:** eventos/métricas, panel admin web Next.js (repo aparte), landing.
- **Ola 4 — Capstone:** pasarela Stripe test-mode (flip-ready a cobro real).
- Transversal: observabilidad (Sentry/Logflare) + deep links.

### 6. Admin web = repo/paquete aparte; push = Expo Notifications
Panel admin en Next.js separado (deploy independiente, no toca `mobile/`). Push vía Expo Notifications sobre FCM/APNs.

### 7. Stack web unificado en Next.js (enmienda 2026-07-13)
Todo el web (landing + página `/v/[id]` del deep link + panel admin) va en **Next.js/Vercel**, no Astro (reemplaza `PRD §27`), para no mezclar stacks. Dos repos: público (landing + `/v/[id]`, nace en Ola 2, crece en Ola 3) y admin (aparte, §6). El admin **reusa las mismas Edge Functions** de las Olas 1-2 (una sola fuente de lógica app↔web).

### 8. Spec detallada cerrada (2026-07-13)
El detalle sin ambigüedad de **todas las olas (0–4)** quedó redactado en `docs/PRD-beta.md` y descompuesto en **107 subtareas** (épicas TM 67–84), con decisión locked por módulo. Sesión de diseño extensiva (interrogatorio por olas). Ejecución por `/tm-plan` → `/tm-tarea`.

## Consecuencias
- Reemplaza el norte "demo" del `0001`. El vault y los MOC migran su narrativa a "beta→PRD" conforme cada ola cierra.
- Spec extensivo y sin ambigüedad se construye **secuencial por olas** en `docs/PRD-beta.md`, con aprobación entre olas.
- Cada módulo = épica en Taskmaster (tag `master`), descompuesta en subtareas al entrar su ola.

## Enlaces
- [[0005-demo-cerrada-3-semanas]] · [[0007-workflow-multiagente]] · [[brechas-demo-vs-prd]] · [[estrategia-releases]] · [[propiedades-y-video]] · `docs/PRD.md` · `docs/PRD-beta.md`
