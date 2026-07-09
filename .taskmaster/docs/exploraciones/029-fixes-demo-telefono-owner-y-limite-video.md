---
tipo: fix          # feature | fix | refactor | chore | proyecto
nivel: S           # el mayor de los dos pendientes (P1=XS, P2=S). Ver "Alcance".
fecha: 2026-07-07
estado: aprobado
tarea_id: 48, 49
motivo_descarte:
---

# Fixes de feedback de demo: teléfono de owner sembrado + crash por límite de video

> Documento de exploración/planeación de `/tm-explore`. Dos pendientes reportados por
> el cliente sobre la demo. Son **técnicamente independientes** (uno es un fix de datos
> en BD sin build; el otro es un fix de crash en el cliente que sí requiere build) →
> **recomiendo promoverlos como DOS tareas separadas** (ver "Promoción / descarte").

## Idea original
Dos pendientes de la demo, tal como llegaron:

1. **Teléfono de owner sembrado por SQL.** La cuenta owner "Vlad" (de "Tu Casa con Vlad",
   sembrada vía `supabase/scripts/seed-clientes.sql`, no pasó por `/register`) tiene el
   teléfono sin el número real. ¿Se puede registrar/setear ese número a nivel BD
   (UPDATE directo o vía Supabase) SIN un nuevo build de la app?

2. **Límite de tamaño de subida de video.** El bucket `property-videos` tiene
   `file_size_limit=104857600` (100 MB). El cliente reporta que la app **CRASHEA** al
   sobrepasarlo, sin manejo de error visible al usuario.

## Lluvia de ideas (solo si la idea era abstracta)
n/a para P1 (concreto: es una pregunta de viabilidad de un UPDATE, respondida en el análisis).
Para P2 ver "Alcance" — hay 3 direcciones (a/b/c) que **no son excluyentes**; la recomendación
es b+c (y opcionalmente a). Se detallan como opciones en las preguntas abiertas.

## Problema / Motivación
Ambos son fricción real detectada en el build de feedback de clientes (2026-07-07, ver
memoria `demo_account_credentials`), directamente sobre el hito **demo cerrada** ([[0005-demo-cerrada-3-semanas]]).

- **P1:** El CTA "Contactar por WhatsApp" del detalle de propiedad **solo se renderiza si
  `agent.phone !== null`** (`PropertyDetailScreen.tsx:187`), y la EF `contact-agent` devuelve
  `400 AGENT_PHONE_MISSING` si `public.users.phone IS NULL`. Sin teléfono real del owner, el
  flujo estrella de la demo (contacto por WhatsApp) queda con un número placeholder. **Ojo:**
  `seed-clientes.sql` (líneas 63-67) **YA** setea `phone = '+523312345678'` para Ramos y Vlad,
  y la migración `20260630000001_seed_demo_agent_phone.sql` siembra ese mismo placeholder a
  todos los agentes. Por tanto lo que el cliente pide **no es "está vacío"** sino **"pon el
  número REAL"** (el placeholder no sirve para que le lleguen mensajes de verdad). **Resuelto
  en intake:** son **números distintos por owner** — Ramos `+52 33 1563 7152`, Vlad
  `+52 33 3578 5799` (ver "Decisiones del intake").

- **P2:** Un crash sin manejo de error en el paso 3 del wizard es un bug de robustez que
  cualquier tester puede disparar subiendo un video largo grabado con el teléfono (fácilmente
  >100 MB en 4K). Rompe la percepción de calidad de la demo.

## Resultado esperado
- **P1:** El owner (Vlad y/o Ramos) tiene su teléfono real en `public.users.phone`; el CTA de
  WhatsApp del detalle abre un chat al número correcto. **Sin build de la app** (solo dato en BD).
- **P2:** Al elegir un video que excede el límite, la app **muestra un mensaje claro**
  ("El video supera el tamaño máximo de N MB, elige uno más corto o de menor calidad") **en
  lugar de crashear**. Idealmente lo detecta **antes** de intentar subir (validación pre-upload).

## Alcance
- **P1 — SÍ entra:** `UPDATE public.users SET phone = '<real>' WHERE id = '<owner>'` sobre el
  remoto `urbea-app` (vía SQL/MCP `apply_migration` o consola Supabase). Es un fix de **dato**,
  no de schema. **Nivel: XS.** No requiere build.
- **P1 — NO entra (out of scope):** Capturar teléfono en el flujo de registro/onboarding/edición
  de perfil. **Confirmado: la app NUNCA captura teléfono** — ni `register.tsx`, ni onboarding, ni
  `useEditProfile`/`profile/edit.tsx`. Ese hueco de producto (que es la causa raíz de por qué
  cualquier cuenta registrada por `/register` también nace sin teléfono) es una **tarea aparte
  nivel M** que SÍ requiere build — se anota como pregunta abierta, no se resuelve aquí.

- **P2 — SÍ entra:** (b) validación pre-upload del tamaño del archivo (client-side, con
  `expo-file-system` `getInfoAsync`) + (c) `try/catch` robusto alrededor del upload con mensaje
  legible. Toca `useVideoUpload.ts` (hooks — **CRÍTICA TDD**), `validation.ts` (**CRÍTICA TDD**),
  `step3.tsx` (UI, no crítica). **Nivel: S.** **Requiere build/EAS update.**
- **P2 — SÍ entra (decidido en intake):** (a) subir el `file_size_limit` del bucket de
  **100 MB (`104857600`) → 500 MB (`524288000`)**. Migración idempotente + rollback sobre
  `storage.buckets`. Además **alinea el código con `docs/PRD.md:627`**, que ya mencionaba 500 MB.
  La combinación final es **a+b+c** (el cliente eligió explícitamente subir el tope). La constante
  que valida el cliente (b) DEBE ser el mismo `524288000` — no puede quedar desincronizada del bucket.
- **P2 — NO entra:** Compresión/transcodificación de video en cliente, subida por streaming
  (`createSignedUploadUrl` + `FileSystem.uploadAsync`) para archivos grandes — es la evolución
  natural (ya anotada como `ponytail:` en `useVideoUpload.ts:124`) pero es otra tarea.

## Roles afectados
- **P1:** Inmobiliaria/agente (owner Vlad/Ramos — su teléfono de contacto) y, en cascada, el
  Comprador (recibe el WhatsApp al número correcto). Admin: n/a.
- **P2:** Inmobiliaria/agente (publica video → hoy crashea). Comprador/Admin: n/a.

## Impacto en datos
- **P1:** Solo **dato**, no schema. `public.users.phone` es `text` **nullable, SIN constraint,
  SIN índice único, SIN trigger** que dependa de él (verificado: migración 0002 lo declara;
  la única validación de longitud de `phone` está en `agent_interest_submissions`, tabla distinta,
  migración 0010). **NO toca `auth.users.phone`** (no hay phone-auth/OTP en el proyecto; el login
  es email/password) → un UPDATE a `public.users.phone` **no dispara** ningún flujo de verificación
  de GoTrue. Es un campo de perfil de negocio **sin verificar**. RLS: `users_update` + el
  column-grant de la migración 0008 (línea 405) **ya incluyen `phone`**, así que el propio usuario
  podría actualizarlo desde el cliente si hubiera UI — pero como no la hay, se hace por SQL directo.
  **Resuelto en intake:** se hace como **migración idempotente + rollback** (NO UPDATE suelto por
  consola), en la línea de `20260630000001`, para trazabilidad. Un UPDATE por owner con guarda
  `WHERE id=<owner> AND phone IS DISTINCT FROM '<real>'`.
- **P2:** (a) migración idempotente + rollback sobre `storage.buckets`: `UPDATE storage.buckets
  SET file_size_limit = 524288000 WHERE id = 'property-videos'` (rollback → `104857600`). El bucket
  se creó con un upsert `on conflict (id) do update` en `20260604000011_storage_property_videos.sql:12-23`;
  seguir ese mismo patrón de migración+rollback del repo. (b)(c) no tocan BD.

## Impacto en UI
- **P1:** Ninguno directo (el CTA ya existe y se prende solo con que `phone` deje de ser null).
- **P2:** `step3.tsx` — mensaje de error legible en el área de estado del upload (ya existe
  `is_error` + `error_container`/`error_text` + botón "Reintentar"; se reusa ese slot, no se
  diseña UI nueva). ⚠️ `step3.tsx` usa colores **hardcodeados** (`COLOR_ERROR` etc., no
  `theme.ts`) — es deuda preexistente; el mensaje nuevo debe seguir el patrón del archivo o,
  mejor, migrar a tokens. **No es un componente de firma → NO dispara el gate de branding #19.**

## Reglas no obvias aplicables
- **Teléfono = campo de perfil de negocio, NO identidad de Auth.** El login es email/password;
  `public.users.phone` ≠ `auth.users.phone`. Tocar el de Auth abriría flujos OTP innecesarios. —
  `wiki/conceptos/roles-y-permisos.md` · migración 0002 líneas 9,54-58.
- **El flujo de invitación/registro nunca captura teléfono** → toda cuenta no sembrada nace con
  `phone NULL` y el CTA de WhatsApp no aparece. Es la causa raíz documentada en la migración
  `20260630000001_seed_demo_agent_phone.sql` (que existe justo para parchear esto en la demo). —
  `wiki/conceptos/crm-leads.md`.
- **`service_role` / column-grants:** el column-grant de `phone` a `authenticated` ya existe
  (0008 línea 405); RLS `users_update` permite `id=auth.uid()`. — [[rls-seguridad]].
- **Migraciones idempotentes + rollback + pgTAP** para cualquier cambio de schema/dato durable
  (aplica si P1 se hace como migración y si se elige P2-a). — `docs/lineamientos-desarrollo.md`.
- **Criticidad TDD determinista por path:** P2 toca `mobile/**/hooks/**` (`useVideoUpload.ts`) y
  `**/validation*` (`validation.ts`) → **CRÍTICA → TDD estricto (RED→GREEN→guardian)**. `step3.tsx`
  (pantalla) → verificación ligera (`tsc`+`lint`+smoke). — CLAUDE.md §5.
- **Despliegue al remoto vía `apply_migration`**, NO `db push` (memoria `supabase_remote_deploy_apply_migration`).

## Arquitectura / enfoque técnico  (L/XL — n/a para fixes)
n/a (fixes chicos). Notas técnicas puntuales:
- **P2 causa raíz del crash (hipótesis fuerte):** `useVideoUpload.ts:125` hace
  `await (await fetch(local_uri)).arrayBuffer()` — carga el **video COMPLETO en memoria JS**
  como ArrayBuffer antes de subir. Para un archivo >100 MB esto puede **reventar por OOM en
  Hermes**, y ese `fetch`/`arrayBuffer` **no está dentro de un try/catch** → excepción no capturada
  → `hook.upload()` rechaza → el `await` en `handle_pick_video` (`step3.tsx:115`) propaga sin
  catch → unhandled rejection / red screen. Nota: el rechazo **del Storage por `file_size_limit`
  sí está manejado** (supabase-js devuelve `{error}`, no throw; se cae en `if (upload_error)` y
  muestra `upload_error.message` — pero en inglés crudo). El crash real ocurre **antes**, al leer
  el archivo. Por eso (b) validación pre-upload es el fix de causa raíz y (c) el try/catch es la
  red de seguridad.
- **Reuso P2:** el slot de error de `step3.tsx` ya existe; `validation.ts` ya expone
  `validate_step3` (patrón `{valid, errors}`) — se añade una validación de tamaño ahí o un helper
  puro nuevo `validate_video_size(bytes, max)`. `expo-file-system` `getInfoAsync(uri)` da `.size`.

## Fases / épicas  (L/XL — n/a para cambios chicos)
n/a.

## Criterios de aceptación
**P1 (teléfono owner) — migración idempotente + rollback, sin build:**
- [ ] Migración nueva (patrón `20260630000001`) que setea, por owner, con guarda `phone IS DISTINCT FROM`:
      - `s.ramos2308@gmail.com` (id `1a000000-0000-0000-0000-0000000000a1`) → `+523315637152`
      - `vladimiryeh@gmail.com` (id `1a000000-0000-0000-0000-0000000000a2`) → `+523335785799`
      (Formato E.164, solo dígitos tras el `+`; el código sanitiza a dígitos en `whatsapp.ts:24`.)
- [ ] Idempotente (2ª ejecución no cambia nada) + archivo de rollback en `supabase/migrations/rollbacks/`.
- [ ] Desplegada al remoto `urbea-app` vía `apply_migration` (no `db push`), **sin build de la app**.
- [ ] Solo se tocó `public.users.phone` de esos dos ids; **NO** `auth.users.phone` ni otra columna/cuenta.
- [ ] Smoke manual: login como Ramos y como Vlad → el CTA "Contactar por WhatsApp" del detalle abre
      chat a `+52 33 1563 7152` y `+52 33 3578 5799` respectivamente.

**P2 (límite de video) — subir tope + validación pre-upload + manejo de error, con build, TDD crítico:**
- [ ] Migración idempotente que sube `storage.buckets.file_size_limit` del bucket `property-videos` de
      `104857600` (100 MB) a **`524288000` (500 MB)**, patrón upsert/`UPDATE` de
      `20260604000011_storage_property_videos.sql`, + archivo de rollback (→ `104857600`). Desplegada
      al remoto vía `apply_migration`. (Alinea con `docs/PRD.md:627`.)
- [ ] Existe una validación pura de tamaño (p.ej. `validate_video_size(bytes, max)`) contra el tope
      **`524288000` bytes (500 MB)** — el **mismo** del bucket, definido como **constante compartida**
      (no puede divergir del `file_size_limit`).
- [ ] **Pre-upload:** tras elegir el video, se lee su tamaño con `expo-file-system` `getInfoAsync(uri).size`
      **antes** de intentar subir; si excede, NO se sube y se muestra el mensaje (no se gasta el intento).
- [ ] Mensaje de error legible en español, del tipo: **"El video pesa {N} MB y supera el máximo de
      500 MB. Elige uno más corto o de menor resolución."** (copy exacto libre, mismo sentido).
- [ ] `try/catch` cubre `fetch(uri)` / `.arrayBuffer()` / `.upload()`; cualquier fallo (incluye OOM al
      leer el archivo y el `413` del Storage) cae en estado `error` con mensaje — **nunca crash /
      unhandled rejection / error boundary**.
- [ ] Tests RED→GREEN en `useVideoUpload.ts` (path crítico `hooks/**`) y en la validación de tamaño
      (path crítico `**/validation*`), guardian PASS.
- [ ] `pnpm tsc --noEmit` + `pnpm lint` verdes; smoke en device (dev build) con un `.mp4` >500 MB → mensaje, no crash.

## Dependencias
- P1: `seed-clientes.sql` / migración `20260630000001` (contexto del placeholder actual).
  Acceso de escritura al remoto `urbea-app` (MCP `apply_migration` o consola).
- P2: `mobile/src/features/publish/hooks/useVideoUpload.ts`, `.../validation.ts`,
  `mobile/app/(protected)/publish/step3.tsx`; `expo-file-system` (verificar que ya esté instalado;
  el proyecto usa Expo SDK 56). Requiere **nuevo dev build / EAS update** para probar en device.

## Edge cases / riesgos
- **P1:** Confusión Ramos vs Vlad — la agencia "Tu Casa con Vlad" tiene **DOS owners**
  (`s.ramos2308@gmail.com` y `vladimiryeh@gmail.com`), ambos con el mismo placeholder. Hay que
  saber **de quién** es el número real y si van números distintos por cada uno.
- **P1:** Formato del número — el código sanitiza a solo dígitos (`whatsapp.ts:24`,
  `contact-agent`); guardar en E.164 (`+52...`) es lo más seguro. WhatsApp usa el número tal cual.
- **P2:** El límite del bucket (500 MB) es del lado servidor; la validación cliente debe usar
  **el mismo número** (constante compartida `524288000`) para no divergir — la migración del bucket
  y la constante del cliente cambian en la MISMA tarea, o quedan desincronizados.
- **P2 — ⚠️ OOM con archivos grandes (riesgo conocido, no bloqueante):** subir el tope a 500 MB
  **NO resuelve** el problema de fondo de `fetch(uri).arrayBuffer()` (`useVideoUpload.ts:125`), que
  carga el archivo **completo en memoria JS** antes de subir. Un video de ~500 MB en un ArrayBuffer
  puede **seguir siendo pesado / tronar por OOM en dispositivos con poca RAM**, aunque ya no lo
  rechace el bucket. Por eso el `try/catch` robusto (c) es imprescindible: convierte ese OOM en un
  error manejado, no en crash. **Deuda a anotar** (`ponytail:` / riesgo): la solución real para
  videos grandes es subir por **streaming** (`createSignedUploadUrl` + `FileSystem.uploadAsync`),
  sin cargar todo en memoria — ya anotado como `ponytail:` en `useVideoUpload.ts:124`. Fuera de
  alcance de esta tarea, pero el riesgo queda registrado.
- **P2:** `expo-file-system` — confirmar API v56 (`getInfoAsync` devuelve `size`); si no está
  instalado, `pnpm dlx expo install expo-file-system` (gotcha SDK56: usar `expo install`, no `pnpm add`).

## Plan de pruebas (alto nivel)
- **P1:** Smoke manual (login como Vlad/Ramos, ver que el CTA abre el número real). Si se hace
  como migración: pgTAP mínimo opcional (aserción de que el phone quedó seteado). No es lógica → TDD no estricto.
- **P2 (CRÍTICO, TDD estricto):** Jest en `useVideoUpload` — RED: video que excede → estado `error`
  con mensaje, sin throw; archivo dentro de límite → sube. Test puro de `validate_video_size`
  (límite exacto `524288000`, sobre, bajo, tamaño desconocido). Smoke en device con un `.mp4` >500 MB
  (rechazo con mensaje) y uno entre 100–500 MB (ahora se sube, antes lo rechazaba el bucket).
- Seed/datos de prueba: un video grande en galería del emulador (ver gotchas Maestro / `run-e2e.sh`).

## Impacto en PRD (solo referencia — NO se edita)
Ninguno para P1/P2 como fixes. La **captura de teléfono en registro** (out of scope, tarea M
futura) sí tocaría el flujo de onboarding descrito en `docs/PRD-MVP-demo.md` — decisión del dueño.

## Decisiones del intake
Respuestas de Abraham (2026-07-07) — todas las preguntas abiertas resueltas:

**P1 — Teléfono del owner:**
1. **Números distintos por owner** (números reales confirmados):
   - Ramos (`s.ramos2308@gmail.com`, id `1a000000-…-a1`) → **+52 33 1563 7152** (`+523315637152`).
   - Vlad (`vladimiryeh@gmail.com`, id `1a000000-…-a2`) → **+52 33 3578 5799** (`+523335785799`).
2. **Método = migración idempotente + rollback** (patrón `20260630000001`), NO update suelto por consola.
3. **Causa raíz (captura de teléfono en registro/perfil) → NO se abre tarea por ahora.** Fuera de
   alcance. (La "Tarea C opcional" queda descartada de esta ronda.)

**P2 — Crash por límite de video:**
4. **Fix = a + b + c:** validación pre-upload con `expo-file-system` (leer tamaño ANTES de subir) +
   manejo de error robusto (`try/catch` + mensaje legible) + **subir el tope del bucket**.
5. **SÍ se sube el tope del bucket:** de **100 MB (`104857600`) → 500 MB (`524288000` bytes)**
   (ajuste posterior de Abraham). Alinea con `docs/PRD.md:627` que ya decía 500 MB. La constante que
   valida el cliente = ese mismo `524288000`, compartida para no desincronizarse del bucket.
   Nota: es la combinación "a+b+c" que la exploración inicial marcó como no-recomendada solo si (a)
   iba sin (b)(c); aquí van las tres, así que el crash sí se cura y además se permiten videos grandes.

## Promoción / descarte
**Recomendación (confirmada tras intake):** promover como **DOS tareas separadas** — footprint,
criticidad y necesidad de build distintos; no comparten archivos:
- **Tarea A — P1 (fix, XS, sin build):** migración idempotente + rollback que setea
  `public.users.phone` de Ramos (`+523315637152`) y Vlad (`+523335785799`), desplegada al remoto.
  No crítica TDD (dato, no lógica). Ejecución directa o `/tm-plan` mínimo.
- **Tarea B — P2 (fix, S, con build, TDD crítico):** migración que sube el bucket a 500 MB
  (`524288000`) + validación pre-upload de tamaño (`expo-file-system`, mismo tope compartido) +
  manejo de error robusto (`try/catch` + mensaje) en el wizard de publicación. Paths críticos
  (`hooks/**`, `**/validation*`, migración) → TDD estricto. Requiere dev build/EAS update. → `/tm-plan {id}`.
- **Tarea C — captura de teléfono en registro/perfil (feature, M):** **DESCARTADA en este intake**
  (decisión de Abraham: fuera de alcance por ahora). Registrada aquí como causa raíz conocida para
  reabrirla si vuelve a doler.
