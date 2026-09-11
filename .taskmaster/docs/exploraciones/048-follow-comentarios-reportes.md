---
tipo: proyecto
nivel: XL
fecha: 2026-09-10
estado: aprobado
tarea_id: 289, 78
motivo_descarte:
---

# Follow de cuentas + comentarios (integrados con reportes)

> Exploración de `/tm-explore`. **Fase PROPUESTA**: se exige divergencia (2–4 direcciones por bloque);
> ponytail NO aplica aquí, vuelve a aplicar al plan de implementación que salga de este doc.
> Nada se decide en este documento: las decisiones son de Abraham.

## Idea original

Abraham, 2026-09-10 (verbatim): *"después de eso sería trabajar en una función de follow para las cuentas y los comentarios, que estén integrados con reportes"*.

Contexto: sale de la lista de pendientes anunciados a los testers el 2026-09-05 (memoria `roadmap_pendientes_sep_2026`: remodelación del feed ✅ #285, comentarios, follow, pin del mapa, CRM ✅ #266–#274). Es lo siguiente en su lista después de #285.

## Problema / Motivación

Urbea tiene hoy **interacción de una sola dirección**: se ve, se da like, se guarda, se contacta por WhatsApp. Falta la capa social que hace que un feed vertical retenga: **seguir a quien publica** (volver por la cuenta, no por la propiedad) y **conversar sobre la publicación** (prueba social visible). Ambas cosas se le prometieron a testers reales el 5 de septiembre.

La coletilla *"que estén integrados con reportes"* es el requisito duro: contenido generado por usuarios en **producción viva** (§0.5) no puede entrar sin su vía de reporte y su cola de moderación. Ese aparato ya existe para propiedades (#220) y no hay que inventarlo, hay que extenderlo.

⚠️ Fuera del hito de la demo de 3 semanas: esto es camino a producción / Ola 2 ([[estrategia-releases]], ADR 0008).

## Estado actual — qué existe hoy (rutas reales)

**Social / engagement (existe)**
- `likes` (por `property_video_id`) y `saves` (por `property_id`): `supabase/migrations/20260604000006_engagement_crm.sql`. Contadores `properties.like_count`/`save_count` por **trigger atómico** `SECURITY DEFINER search_path=''`: `supabase/migrations/20260701000001_engagement_count_triggers.sql` + pgTAP `supabase/tests/07_engagement_counts_test.sql`. Cliente: `mobile/src/features/feed/hooks/useLikeProperty.ts`, `useSaveProperty.ts`, `mobile/src/components/LikeButton.tsx`, `SaveButton.tsx`.
- Comportamiento de video en `events_raw` (`20260604000007_analytics_moderation_audit.sql`; `event_type` es **texto de catálogo abierto**, no enum): escritores `mobile/src/features/feed/hooks/useVideoEngagementEvents.ts` (`video_view`, `video_completed`, `video_progress`), `zone_search` en el mapa, `contact_repeat` en la EF `contact-agent`. RLS append-only reescrita dos veces: `20260808000001_events_raw_rls.sql` → `20260809000001_events_raw_lead_gate.sql`.
- Compartir: **ya existe parcialmente** — `mobile/src/lib/shareProperty.ts` (share sheet nativo con la URL firmada). NO existe la página web del deep link (`docs/PRD.md` §21 / subtarea 78.5).

**Identidad pública (existe, y es la base del follow)**
- Vista `agent_public_profiles` (`user_id, full_name, profile_photo_url, has_phone`), `security_invoker=false`, grant solo a `authenticated`, **cubre todos los roles** desde `supabase/migrations/20260905200003_identidad_publica_todos_los_roles.sql` (pgTAP `96_identidad_publica_test.sql`). 🔒 Regla derivada: *para exponer un dato público de una tabla con RLS restrictiva se agrega una **vista con columnas curadas**, nunca una rama a la policy* ([[rls-seguridad]]).
- Perfil ajeno: `mobile/app/(protected)/profile/[id].tsx` → `mobile/src/features/profile/ProfileScreen.tsx` (`ProfileHeader.tsx`, `ProfessionalStats.tsx`, `ProfileActions.tsx`, `PropertiesGrid.tsx`). Hoy los stats son **Publicaciones · Guardados · Me gusta** (propio) y **Publicaciones · Me gusta** (ajeno) — «Leads» salió a propósito en #180.1 por privacidad.
- Feed: `mobile/src/features/feed/components/PropertyOverlay.tsx` ya pinta **fila de agente** (foto real + nombre, tap → perfil público, #145.4) y un rail con like/guardar/compartir/WhatsApp. Ahí cabe la píldora «Seguir» sin inventar layout.

**Reportes y moderación (existe casi entero — esto es lo que NO hay que reescribir)**
- `property_reports` (0007) + CHECK «other exige texto» `20260828000001` + **auto-suspensión** por 3 reportantes distintos en 24 h `20260828000002` + resolución atómica `20260828000004`. EF única `supabase/functions/moderate-property/` con `action` parametrizada (`restore | request_changes | keep_suspended | delete`), todas escribiendo `admin_actions`.
- `user_reports` (`20260828000005`, #220.6): reportes de **perfil**, reusa el enum `property_report_reason`, **sin cola de resolución y sin auto-suspensión de cuentas** — la ausencia está anclada por asserts (`supabase/tests/76_user_reports_test.sql`).
- UI: `mobile/src/features/property-detail/components/ReportPropertySheet.tsx` (hoja de motivos reutilizable, ya la reusan propiedad y perfil), `hooks/useReportProperty.ts`, `hooks/useReportUser.ts`, `components/ActionButtons.tsx`, `components/AgentCard.tsx`. Cola admin: `mobile/app/admin/reports/index.tsx` + `mobile/src/features/admin/hooks/useAdminReports.ts`, `useResolveReport.ts`.
- Decisión viva (Abraham 2026-08-28): **crear un reporte es INSERT directo del cliente bajo RLS**, sin Edge Function; el contrato vive en SQL.

**Notificaciones (existe; el catálogo crece por agregación)**
- Tabla `notifications` (0007), centro in-app vivo (#219): `mobile/src/features/notifications/hooks/useNotifications.ts`, `components/NotificationCard.tsx`, `NotificationBellButton.tsx`, pantalla `mobile/app/(protected)/notifications.tsx`. Escritores: `20260825000001_notify_admin_events.sql`, `20260826000001_notify_moderation_mirrors.sql`, `20260905300001_notificaciones_moderacion_con_motivo.sql`.
- 🔒 Invariante bloqueante: el INSERT del aviso va en la **misma transacción** del evento, **sin bloque EXCEPTION**. Sin push (FCM/APNs) — es fase 2 (§28.4).

**CRM / privacidad (lo que restringe el diseño)**
- Temperatura T1 `supabase/migrations/20260906100001_crm_temperature.sql` (+ `20260906300001` matching espacial, rollup diario `20260906100002`), pesos en `app_config`.
- **Radar anónimo** `supabase/migrations/20260906100005_crm_radar_anon.sql` (pgTAP `104_crm_radar_anon_test.sql`): k-anonimato por propiedad, sin identidad. 🔴 Su anonimato **depende de que `likes_select` / `saves_select` / `events_raw_select` no den al agente identidad+timestamp de un no-lead** ([[privacidad-datos]]).

**Lo que NO existe (todo esto es nuevo)**
Tabla de follows, contador de seguidores, lista de seguidores, tabla de comentarios, hoja de comentarios en la UI, reportes de comentarios, cola de moderación de comentarios, ocultar comentario por el agente/agencia, filtro de contenido, notificaciones de tipo social, preferencias de notificación (§22.4), suspensión de **cuentas** (§28.3-4).

**Tareas ya abiertas en Taskmaster** — `#78` «Ola 2 — Comentarios + Follow + Compartir (deep links)» (6 subtareas *pending*, deps 66/71/74) y `#79` «Ola 2 — Reportes, bloqueos y moderación» (79.1 y 79.2 **cancelled**, absorbidas por #220; sobreviven 79.3 antifraude y 79.4 ingest). Sus `details` dicen literalmente que el spec detallado *"se redacta SECUENCIAL al entrar su ola, con aprobación de Abraham"* — **este documento es ese spec**.

## Resultado esperado (happy path)

1. En el feed y en el perfil ajeno aparece **Seguir**; al pulsarlo el conteo del perfil sube y el agente recibe un aviso «Nuevo seguidor».
2. En el detalle de la propiedad hay **comentarios**: se abren en una hoja, se escribe uno, aparece de inmediato con nombre y foto públicos; el dueño de la publicación recibe aviso.
3. Cualquier comentario tiene **Reportar** (mismos motivos que ya existen); a N reportantes distintos el comentario se **oculta solo** y entra a la cola `/admin/reports` con su tipo; el admin resuelve (restaurar / mantener oculto / eliminar) y queda en `admin_actions`.
4. El agente (o el owner/admin de su agencia) puede **ocultar** comentarios en sus propias publicaciones, **nunca eliminarlos** (PRD §18.1).
5. Nada de esto expone datos que hoy estén cerrados, ni rompe un contrato que los builds instalados ya llaman.

## Alcance

- **SÍ entra:** follow de cuentas (modelo + botón + conteo + avisos), comentarios por publicación (modelo + hoja UI + conteo + avisos), reportes de comentarios integrados a la cola existente, ocultar por el publicador/agencia, auditoría en `admin_actions`.
- **NO entra (out of scope, salvo que Abraham lo suba):** push notifications (§28.4 fase 2); página web del deep link (78.5); sección «Siguiendo» del feed (depende de la dirección **B** de #285); comentario/follow como **señal de temperatura** del CRM (toca un contrato publicado, §Fase 5); suspensión de **cuentas** y bloqueo entre usuarios (§24.2 lo excluye explícitamente del MVP: *"el contacto real ocurre en WhatsApp, que tiene su propio bloqueo"*); moderación por IA/NLP (§18.3 la deja como mejora); rating y reseñas (post-MVP); preferencias de notificación por tipo (§22.4).

## Roles afectados

- **Buscador (usuario):** gana seguir, comentar y reportar comentarios. Su nombre y foto públicos (`agent_public_profiles`) pasan a ser visibles **junto a un texto que él escribe** — superficie de exposición nueva, ver §Privacidad.
- **Agente / publicador:** recibe seguidores y comentarios; puede ocultar comentarios en lo suyo; ve su conteo de seguidores. 🔴 Decisión pendiente: si ve **la lista** de seguidores (PRD §23.1 dice que sí).
- **Owner/admin de agencia:** puede ocultar comentarios en publicaciones de sus agentes (PRD §18.2) — misma frontera de `agency_role_of` que ya usan `properties_update` y `leads_update`.
- **Admin de plataforma:** cola de moderación de comentarios y reportes; acciones de resolución con auditoría.
- **anon:** sin cambios. Comentarios visibles **solo a autenticados** (§18.1).

---

# Bloque 1 — FOLLOW

## Modelo de datos propuesto

```
follows (
  follower_user_id  uuid  → users(id) on delete cascade,
  followed_user_id  uuid  → users(id) on delete cascade,
  created_at        timestamptz default now(),
  primary key (follower_user_id, followed_user_id),
  check (follower_user_id <> followed_user_id)   -- 🔒 nadie se sigue a sí mismo
)
users.follower_count int not null default 0 check (>= 0)   -- columna aditiva, trigger atómico
```
- **Unidireccional, no recíproco** (modelo Instagram/TikTok, no "amistad"). El PRD §20 no contempla reciprocidad.
- **Sin estado ni aprobación**: no hay cuentas privadas en Urbea, así que no hay `pending`.
- **Contador por trigger atómico** — calco exacto de `20260701000001` (`AFTER INSERT OR DELETE`, `SECURITY DEFINER`, `search_path=''`, `GREATEST(0, count-1)`). ⚠️ El pgTAP corre como superusuario y **no detecta** la falta de `SECURITY DEFINER`: se garantiza por revisión (lección viva de #13.2).
- **Portabilidad**: el follow apunta a la **persona** (`users.id`), no a la agencia, así que "conserva sus seguidores si cambia de inmobiliaria" (§20) sale gratis del modelo.
- **RLS:** `follows_select` = `follower_user_id = auth.uid() OR is_admin()` **(+ la rama que decida Q4)**; `follows_insert/delete` = `follower_user_id = auth.uid()`; cero grants a `anon`; sin UPDATE (un follow no se edita). El conteo público NO sale de contar filas: sale de `users.follower_count` expuesto por la **vista** `agent_public_profiles` (columna aditiva al final, §0.5.2).

### Direcciones (elige Abraham)

| # | Dirección | En qué consiste | Trade-off | Costo |
|---|---|---|---|---|
| **F1** ⭐ REC | **«Guardar agente» + aviso de nuevo seguidor** | Tabla + trigger de conteo + botón en `PropertyOverlay` y en `ProfileActions`/`ProfileHeader` + notificación `new_follower`. El feed **no cambia**. | Es el 20 % del esfuerzo con el 80 % del valor visible, y no toca nada crítico. Contra: sin feed de seguidos, seguir "no sirve para nada" hasta que haya avisos de publicación nueva. | **M** |
| **F2** | F1 + **«nuevo video de un agente que sigues»** | Fan-out de `notifications` al publicar (trigger o EF `publish-property`). | Da sentido al follow… pero **in-app sin push casi nadie lo ve** (§28.4 es fase 2) y el fan-out choca con el invariante 🔒 «aviso en la misma transacción sin EXCEPTION»: con N seguidores, si el fan-out truena **revienta la publicación entera**. Exige decidir si ese invariante se relaja (job/cron) o se acepta el riesgo. | +S (con la decisión del invariante: +M) |
| **F3** | F1 + **sección «Siguiendo» en el feed** | Tercera pestaña o filtro `owner_user_id IN (seguidos)`. | ⚠️ Choca de frente con un invariante vivo: **la sección del feed ES `filters.operation_types`** (`mobile/src/features/search/lib/feedSection.ts`) — «Siguiendo» no es una operación, así que rompe la única-verdad del `FilterState`. Además con poco inventario la pantalla queda vacía. Su casa natural es la **dirección B de #285** (RPC `feed_page` con ranking servidor), reservada como derivada. | **L** (o **XL** con B) |
| **F4** | Follow polimórfico (**cuenta o agencia**) | `followed_type ('user'\|'agency')` en la PK. | El PRD §20 dice explícitamente *"follow aplica solo a perfiles de agentes"* y **hoy no existe pantalla pública de agencia** → habría que inventarla. Cuesta poco en schema y mucho en producto. | +S schema / +M producto |

**Recomendación:** **F1 ahora**; F2 solo si Abraham quiere el aviso (con la decisión de invariante encima de la mesa); F3 **reservada** hasta que exista la RPC de la dirección B; F4 fuera.

## ¿Follow necesita ya la dirección B de #285?

**No.** La exploración 047 §21 reservó B *"como la casa natural de follow y comentarios"*, y eso sigue siendo cierto **solo para el feed de seguidos (F3)** y para el ranking «prioriza lo que tiene comentarios». F1/F2 y todo el bloque de comentarios viven en el **detalle y el perfil**, que no pasan por `feedProperties.ts`. Tomar B ahora sería pagar una **L** de backend (RPC `feed_page` + pgTAP + reescritura de ~15 call sites) antes de saber si alguien usa el follow. Recomendación: **F1 primero, medir, y abrir B cuando F3 se apruebe**.

---

# Bloque 2 — COMENTARIOS

## Modelo de datos propuesto

```
comments (
  id             uuid pk default gen_random_uuid(),
  property_id    uuid → properties(id) on delete cascade,   -- (o property_video_id, ver Q7)
  user_id        uuid → users(id),
  body           text not null check (body ~ '\S' and length(body) <= 500),
  status         comment_status not null default 'visible',  -- visible | held_for_review | hidden | deleted
  hidden_by_user_id uuid null,   -- quién ocultó (publicador/agencia/admin)
  hidden_reason  text null,
  created_at / updated_at / deleted_at timestamptz
)
properties.comment_count int not null default 0 check (>= 0)  -- aditiva, trigger atómico
```
🔴 **Dos sutilezas de CHECK que ya costaron un guardian** (`property_reports`, #220): `trim()` de Postgres recorta **solo espacio ASCII** → la expresión correcta es `body ~ '\S'`; y un CHECK que evalúa a NULL se considera **CUMPLIDO** → el `is not null` explícito es obligatorio.

**RLS (2ª capa):**
- `comments_select`: `status = 'visible'` para cualquier `authenticated` (§18.1) **OR** `user_id = auth.uid()` (ver el propio aunque esté oculto) **OR** `can_manage_property(property_id)` **OR** `is_admin()`. Cero a `anon`.
- `comments_insert`: `user_id = auth.uid()` + membresía vigente si aplica. ⚠️ Precedente #202: *ser dueño de la fila no basta cuando la fila lleva la marca de una organización* — aquí el autor es una persona, así que no aplica; pero el **ocultar** sí pasa por `agency_role_of`.
- `comments_update`: **solo el cambio de `status`** por el publicador/agencia/admin. 🔒 Regla viva ([[rls-seguridad]]): *al dar visibilidad nueva a un rol se AMPLÍA SELECT, NUNCA la escritura* — y si `comments_update` comparte expresión con `comments_select`, **los negativos por conteo de filas no prueban nada** (lección 269.3): los asserts van contra el helper `SECURITY DEFINER` o aislando la policy dentro de la transacción del test.
- `comments_delete`: **nadie** desde el cliente (§18.1: *"el agente puede ocultar pero no eliminar"*). Borrado propio del autor = `status='deleted'` + `deleted_at`, con el cuerpo conservado para la auditoría del §18.2.

**Escritura — dos caminos posibles:**
- **INSERT directo bajo RLS** (precedente `property_reports`, decisión Abraham 2026-08-28: *"el contrato vive en SQL"*). Más barato, cero EF.
- **EF `post-comment`** (`supabase/functions/post-comment/`). Se justifica **solo si hay filtro de contenido**: eso es lógica de negocio y `docs/lineamientos-desarrollo.md` la manda a Edge Functions.

### Direcciones (elige Abraham)

| # | Dirección | En qué consiste | Trade-off | Costo |
|---|---|---|---|---|
| **C1** ⭐ REC | **Planos, publicación inmediata, moderación reactiva** | Comentarios sin hilos, sin edición, borrado propio lógico; reportes + ocultar como única moderación. INSERT directo bajo RLS. | Es exactamente el §18.3 (*"iniciar con reglas, reportes y cola manual"*) menos las reglas. Barato y entendible. Contra: el primer spam con teléfono/link aparece **publicado** y depende de que alguien lo reporte. | **M** |
| **C2** | C1 + **filtro determinista mínimo en EF** | EF `post-comment` que marca `held_for_review` si detecta teléfono, email, URL o palabra de una lista en `app_config`. | Protege el modelo de negocio (evitar que el contacto se salte la plataforma) y es el §18.2 real. Contra: una EF más que desplegar, falsos positivos («llámame al depa 5B»), y una cola que hay que atender. La lista en `app_config` se calibra **sin publicar app** (patrón #266). | +S/M |
| **C3** | **Hilos de 1 nivel** (respuesta del agente) | `parent_comment_id` nullable, máximo un nivel. | La respuesta pública del agente es donde está el valor Q&A… pero el PRD §18.1 dice explícitamente que *"las preguntas directas se hacen por WhatsApp, no como comentario público tipo Q&A"* — sería revertir una decisión de producto. Multiplica la superficie de moderación (ocultar un padre, ¿oculta los hijos?). | +M |
| **C4** | **Moderación previa para todo** (`held_for_review` por default) | Nada se publica sin admin. | Máxima seguridad legal, valor social **cero** (comentar y no ver tu comentario mata la feature) y una cola que crece más rápido que el equipo. El §18.2 la reserva para lo que el filtro marca, no para todo. | M (y coste operativo permanente) |

**Recomendación:** **C1 + C2** (planos, publicación inmediata, con filtro determinista mínimo que solo desvía lo que matchea). C3 y C4 fuera de esta ola.

**Unidad del comentario — decisión pendiente (Q7):** el PRD §17 dice *"comentar: se aplica al video específico"* y `likes` es por `property_video_id`; pero `saves` y toda la UI de detalle son por `property_id`, y hoy **una propiedad = un video** (slot único). *Por propiedad* es más simple y sobrevive al día en que una propiedad tenga varios videos (los comentarios no se fragmentan); *por video* es literal al PRD y al patrón de `likes`. Es una decisión de una línea en el schema y de mucho después.

---

# Bloque 3 — REPORTES E INTEGRACIÓN

Este es el bloque donde **más hay que reusar y menos que inventar**. El aparato de #220 ya define la forma canónica: tabla de reportes con dedupe por (objeto, reportante), motivo del enum `property_report_reason`, CHECK «other exige texto», auto-acción por N reportantes distintos en ventana de 24 h vía trigger `AFTER INSERT` **sin bloque EXCEPTION**, resolución por la EF única con `action` parametrizada, auditoría obligatoria en `admin_actions` y espejos a `notifications`.

### Direcciones (elige Abraham)

| # | Dirección | En qué consiste | Trade-off | Costo |
|---|---|---|---|---|
| **R1** ⭐ REC | **Calco del patrón vivo: `comment_reports`** | Tabla gemela de `property_reports` (reusa el enum, no lo duplica — precedente `user_reports`), trigger de **auto-ocultar** a N reportantes distintos en 24 h (`comments.status='hidden'` en la misma transacción), resolución en la cola `/admin/reports` existente con acciones `restore / keep_hidden / delete_comment`, todo a `admin_actions` + espejo al autor. | Cero conceptos nuevos: el admin ya sabe usar esa pantalla, los tests ya tienen forma (73/74/75) y el riesgo está medido. Contra: una tabla más de reportes (van 3) — la deuda de consolidación se pospone conscientemente. | **M** |
| **R2** | **Tabla polimórfica `content_reports(target_type, target_id)`** | Unifica property + user + comment. | Es el modelo "correcto" en abstracto y el **prohibido en concreto**: `property_reports` es **contrato publicado** (los builds instalados hacen INSERT directo, §0.5.2) → exige expand → migrate → contract con OTA primero. Migrar tres tablas a media ola es justo lo que producción viva frena. | **L/XL** |
| **R3** | **Solo-ocultar, sin cola** | A N reportes el comentario se oculta y ahí muere. | Barato, pero (a) el §18.2 exige *"auditoría de comentario original, autor, propiedad, acción tomada y actor"*, (b) 3 cuentas coordinadas pueden **censurar** cualquier comentario sin que nadie lo revise, y (c) no hay forma de restaurar un falso positivo. | **S** |
| **R4** | R1 + **resolución de `user_reports` y sanción de cuentas** | Cierra la derivada que #220.6 dejó nombrada + §28.3-4 (suspender personas). | Un reporte de comentario sin poder sancionar al **autor reincidente** es media solución. Pero suspender personas toca login, propiedades, leads y membresías: es un dominio nuevo entero, no un anexo. | **L** |

**Recomendación:** **R1** ahora; **R4** como épica aparte cuando haya volumen real (es literalmente el *"siguiente paso natural"* que la enmienda de §24.2 dejó escrito).

**Ocultar por el publicador (§18.1/§18.2), no confundir con reportar:** acción directa del dueño de la propiedad o del owner/admin de su agencia sobre `comments.status`, sin pasar por reportes, sin poder borrar. Gate = `private.can_manage_property(property_id)` (ya existe) + `agency_role_of`. Se audita igual.

---

## Privacidad y reglas no obvias (lo que puede salir mal en silencio)

1. 🔴 **Un comentario público deanonimiza el radar del CRM.** [[privacidad-datos]] dice, literal, que el anonimato de `crm_radar_anon` *"depende de tres policies, no del cuerpo de la RPC"*: sería cruzable si el agente tuviera **otra fuente con identidad + timestamp de un no-lead**. Un comentario público sobre **su propia propiedad** es exactamente esa fuente: nombre + foto + `created_at`. Cruzado con la tupla `(temperature, delta, last_activity_at, sparkline)` del radar, una fila "anónima" puede quedar identificada. **Ningún test del `104` se pondría rojo.** — Matiz importante: comentar es un **acto deliberadamente público** (a diferencia de ver un video, que es comportamiento), así que puede ser un riesgo *aceptable*; pero tiene que ser **decidido y escrito**, no descubierto. → Q10.
2. 🔴 **La lista de seguidores tiene el mismo perfil de riesgo.** El PRD §23.1 la da al dueño; eso entrega al agente identidad + `created_at` de personas que **nunca lo contactaron**. → Q4.
3. **Registrar ≠ exponer** ([[privacidad-datos]], PRD §19.1): comentar, seguir y compartir son **interacciones, no leads** (§19.1 lo dice con todas sus letras). No pueden abrir el CRM ni crear filas de lead.
4. **Nunca ampliar `users_select`**: la identidad del comentarista sale de `agent_public_profiles` (o de una vista hermana), jamás de una rama nueva en la policy — regla 🔒 de [[rls-seguridad]] tras #250/#254.
5. **Policies con `OR is_admin()` → el cliente filtra explícito.** `.eq('user_id', …)` / `.eq('property_id', …)` siempre, aunque "la RLS ya filtre" (memoria `flatlist_numcolumns_row_keys`, y `useNotifications` lo hace así a propósito).
6. **Contratos publicados (§0.5.2):** `properties.comment_count` y `users.follower_count` son columnas **aditivas** (los `select('*')` viejos las ignoran) ✅. Ensanchar el `RETURNS TABLE` de una RPC ya publicada (p. ej. meter `is_following` en `crm_leads_page` o en `ads_for_zone`) exige **DROP+CREATE** con gente conectada — lección #275: *antes de ensanchar un contrato publicado, mira si el cliente ya tiene una lectura viva por donde el dato cabe*. `agent_public_profiles` conserva orden de columnas; lo nuevo va **al final**.
7. **Migraciones**: aditivas + idempotentes + rollback 1:1 probado + pgTAP. 🔴 *Un rollback debe fallar RUIDOSO* (lección 220.3): nada de stubs no-op que devuelvan éxito.
8. **Triggers solo atómicos**; la lógica (filtro de contenido, fan-out) vive en Edge Functions (`docs/lineamientos-desarrollo.md`).
9. **Notificaciones**: los `deep_link` son **contrato con Expo Router** y los typed routes están **desactivados** → `router.push('/ruta-inexistente')` pasa `tsc` sin quejarse. Cada type nuevo (`new_follower`, `comment_on_my_property`, `comment_hidden`, `admin_comment_report`…) exige verificar que la ruta existe bajo `mobile/app/`.
10. **OTA vs rebuild**: nada nativo nuevo. La hoja de comentarios se hace con primitivas RN + `Modal`/`KeyboardAvoidingView` y reusando la forma de `ReportPropertySheet.tsx`; los íconos son `phosphor-react-native` (ya instalado). → **JS puro = OTA**. Si alguien propone `@gorhom/bottom-sheet` o un input con emoji picker nativo, eso es **rebuild** y cambia la ecuación.
11. **PNPM siempre**; identificadores propios en **snake_case**.
12. 🟡 **Aviso de privacidad**: el vigente es un **placeholder de 113 caracteres** que personas reales ya aceptaron ([[legal-consentimientos]]). Publicar contenido de usuarios con su nombre y foto amplía lo que se recolecta y se muestra: conviene decir en voz alta que esto **acerca** la necesidad de activar `docs/aviso-privacidad.md` (que fuerza re-consentimiento de todos).

## UI / interacción fuera del mockup

Abiertos `urbea-identidad-visual.html` (lenguaje visual) y `Urbea Prototipo (standalone).html` (layout):
- **Follow — el layout SÍ existe en el prototipo**: píldora **«Seguir»** en la fila del agente del overlay del feed (borde blanco 1.5 px, radio 20, padding 6/16, texto 700 13 px) y stat **«Seguidores»** en el header del perfil (`Publicaciones · Seguidores · Leads`). ⚠️ El perfil real hoy muestra `Publicaciones · Guardados · Me gusta` y **«Leads» se quitó a propósito en #180.1**: meter «Seguidores» reemplaza una columna decidida.
- **Comentarios — NO existen en ninguna de las dos referencias.** Ni hoja, ni contador en el rail, ni card de comentario.

`UI_FUERA_DEL_MOCKUP: hoja de comentarios (lista + card autor/texto/fecha + input con teclado + acciones ocultar/reportar) · el bloque 2 no existe sin ella; es la superficie principal de la feature y es COMPONENTE DE FIRMA (nueva tipografía de UGC sobre gestión-claro) · costo M`
  → **opción 1 (en conjunto):** diseñarla dentro de la tarea de comentarios — implica una ronda de **preview HTML aprobable** por el cliente (§8) **antes** de portar a RN, y bloquea el arranque del TDD de UI hasta que Abraham apruebe.
  → **opción 2 (DEFAULT):** derivada `producto(<origen>)` — título: *"producto(<origen>): preview HTML de la hoja de comentarios"*; descripción: *"Origen: subtarea <id.n> · Detectado por: usuario. Diseñar en HTML aprobable la hoja de comentarios (lista, card de comentario, input, estados vacío/oculto/reportado) con el lenguaje visual de `urbea-identidad-visual.html` y la escala de layout del prototipo; portar a RN solo tras el OK del cliente."* Deps: la tarea origen.

`UI_FUERA_DEL_MOCKUP: stat «Seguidores» en el header del perfil · el conteo no tiene dónde vivir; el prototipo lo dibuja pero la app decidió otras 3 columnas en #180 · costo XS`
  → **opción 1 (en conjunto):** sustituir una columna en `ProfessionalStats.tsx` (propio: Publicaciones · Seguidores · Me gusta; ajeno: Publicaciones · Seguidores · Me gusta) dentro de la tarea de follow.
  → **opción 2 (DEFAULT):** derivada `producto(<origen>)` que decida las columnas finales con Abraham viendo la pantalla.

*(Cupo §8 = 2 propuestas. Solo se **nombra**, sin proponer: contador de comentarios en el rail del `PropertyOverlay`, junto a like/guardar.)*

**APROBACIÓN DE DISEÑO (§8): SÍ.** La hoja de comentarios es componente de firma → preview HTML aprobable por el cliente antes de portarse a RN. La píldora «Seguir» **no** lo necesita: el prototipo ya la dibuja y son tokens existentes (mini-spec escrito basta).

## Arquitectura / enfoque técnico

- **Follow:** 1 migración (tabla + columna contadora + trigger atómico + RLS + grants + vista ampliada) · sin EF · cliente: hook `useFollow` (optimista con rollback, calcado de `useLikeProperty`) + botón reusable + conteo en `useAgentProfile`/`ProfessionalStats`.
- **Comentarios:** 1–2 migraciones (tabla + enum `comment_status` — ⚠️ `ALTER TYPE ADD VALUE` y uso en la misma transacción es el gotcha que obligó a migración SOLA en `20260809000002` — + contador + RLS) · EF `post-comment` **solo si entra C2** · cliente: `useComments` (paginado por cursor, patrón `crm_leads_page`), hoja de UI, contador en detalle y overlay.
- **Reportes:** 1 migración (`comment_reports` + trigger de auto-ocultar + RPC de resolución atómica) · **extensión ADITIVA de `moderate-property`** o EF hermana `moderate-comment` — el precedente #220.3 dice que el diseño «1 EF con `action` parametrizada» aguantó la presión, pero moderar un comentario no es moderar una propiedad: **evaluar en el plan**, no decidir aquí · cliente: filtro por tipo en `mobile/app/admin/reports/index.tsx`.
- **Notificaciones:** funciones nuevas siguiendo `20260826000001` (misma transacción, sin EXCEPTION, dedupe por índice único parcial donde el evento sea de disparo único, **motivo en el `body` además de en `data`** — lecciones #234/#237/#240).

## Fases / épicas sugeridas (con dependencias)

| Fase | Qué | Depende de | Nivel | OTA / deploy |
|---|---|---|---|---|
| **0** | Decisiones de este doc (Q1–Q10) + **preview HTML de la hoja de comentarios** aprobado | — | S | n/a |
| **1** | **Follow F1**: migración + trigger + RLS + pgTAP; botón en overlay y perfil; conteo; aviso `new_follower` | 0 | **M** | migración → OTA |
| **2** | **Comentarios C1**: migración + RLS + pgTAP; hoja UI; contador; aviso `comment_on_my_property` | 0, 1 (reusa el patrón de hook y el trigger de conteo) | **M/L** | migración → OTA |
| **3** | **Reportes R1**: `comment_reports` + auto-ocultar + resolución + cola admin + espejos; **ocultar por publicador/agencia** | 2 | **M** | migración + EF → OTA |
| **4** | *(C2 opcional)* filtro determinista en EF `post-comment` + lista en `app_config` | 2 | S/M | EF → OTA |
| **5** | *(reservada)* **F3 «Siguiendo» en el feed** vía dirección **B** de #285 (RPC `feed_page`) | 1 + decisión de B | **L/XL** | migración + OTA |
| **6** | *(reservada)* comentario/follow como **señal de temperatura** del CRM (§19.6 les da 3 y 0 pts) | 2 | M | ⚠️ toca `crm_temperature` + `lead_temperature_daily` = **contrato publicado**, cambia números que el agente ya ve |

**Orden recomendado: 0 → 1 → 2 → 3.** Follow primero porque es la pieza **aislada** (no depende de moderación, no genera contenido que reportar, y su riesgo de privacidad se decide con una sola pregunta). Comentarios y reportes van **pegados**: no se debería mergear a `main` una feature de UGC sin su vía de reporte, porque *todo lo mergeado es candidato a release por OTA a testers reales* (§0.5.3).

**Encaje con Taskmaster:** lo natural es **redefinir #78** (hoy «Comentarios + Follow + Compartir + deep links»: compartir ya existe parcialmente en `shareProperty.ts` y la página web del deep link es otro proyecto) y abrir una tarea nueva para la fase 3, con dependencia a #78. → Q2.

## Criterios de aceptación

- [ ] Seguir/dejar de seguir es idempotente y el conteo público coincide con las filas reales tras like/unlike repetido (pgTAP con backfill, calco de `07_engagement_counts_test.sql`).
- [ ] Nadie puede seguirse a sí mismo (CHECK) ni insertar un follow a nombre de otro (RLS, verificado por impersonación JWT).
- [ ] Un comentario con solo whitespace Unicode es **rechazado** (`body ~ '\S'`), y `body` nulo no pasa por CHECK-NULL-es-verdadero.
- [ ] Un usuario **no autenticado** no lee ni un comentario; un usuario autenticado no ve los `hidden`; el autor sí ve el suyo oculto.
- [ ] El publicador puede **ocultar** y NO puede **borrar**; el owner/admin ACTIVO de su agencia puede lo mismo; un miembro `suspended` no puede nada (precedente #202).
- [ ] N reportantes distintos en 24 h ocultan el comentario **en la misma transacción**, sin bloque EXCEPTION, y el 4º reporte es no-op total.
- [ ] Toda resolución de admin escribe `admin_actions` y el fallo de auditoría revienta la operación (no best-effort).
- [ ] Cada `deep_link` nuevo corresponde a una ruta que **existe** bajo `mobile/app/` (verificado montando la pantalla, no con `tsc`).
- [ ] Rollback de cada migración probado en round-trip y **ruidoso** (no stubs no-op).
- [ ] {? Q10 — la posición sobre la deanonimización del radar queda escrita en [[privacidad-datos]] antes de mergear comentarios}
- [ ] Smoke en dispositivo real con Abraham (comentar, reportar, ocultar, seguir) — el testing manual se hace juntos.

## Dependencias

- Taskmaster: **#78** (Ola 2 comentarios/follow/compartir, *pending*), **#79** (79.3/79.4 vivas), #220 (reportes, done), #219/#223 (notificaciones, done), #250/#254 (identidad pública, done), #266/#267 (CRM y radar, done), **#285** (feed infinito — su dirección B reservada es la dependencia de la fase 5).
- Código a reusar (rutas reales arriba): `ReportPropertySheet.tsx`, `useReportProperty.ts`, `mobile/app/admin/reports/index.tsx`, `useAdminReports.ts`, `useResolveReport.ts`, `20260701000001_engagement_count_triggers.sql` (patrón), `agent_public_profiles`, `useNotifications.ts`, `useLikeProperty.ts` (patrón optimista).
- Migraciones base: `20260604000006` (engagement), `20260604000007` (reportes/notificaciones/auditoría), `20260604000008`/`000010` (helpers `private.*`), `20260828000002` (auto-suspensión = patrón del auto-ocultar).

## Edge cases / riesgos

- **Deanonimización del radar del CRM por comentarios/lista de seguidores** — el mayor; ningún test existente lo detecta (§Privacidad 1 y 2).
- **Fan-out de avisos a N seguidores dentro de la transacción bloqueante**: si truena, revierte la publicación. El invariante 🔒 se diseñó para eventos 1→pocos.
- **Auto-ocultar como arma de censura**: N cuentas coordinadas ocultan cualquier comentario. Mitiga la cola de resolución + `restore` (por eso R3 se descarta).
- **Cola de moderación que nadie atiende** — el admin es una persona; el aviso `admin_comment_report` puede volverse ruido. El dedupe por ancla ya existe como patrón.
- **Usuario eliminado**: §25 pide que sus comentarios se conserven **anonimizados** ("Usuario eliminado") para no romper el hilo → la FK no puede ser `on delete cascade` si se quiere conservar el texto. Decisión de esquema con consecuencia legal.
- **Comentario sobre propiedad suspendida/borrada**: `on delete cascade` desde `properties` borra comentarios; con soft-delete (`deleted_at`) quedan huérfanos visibles. Hay que definir el filtro en `comments_select`.
- **Aviso de privacidad placeholder** vigente (riesgo legal, §Privacidad 12).
- **Teclado + hoja modal en Android** con edge-to-edge SDK 56: usar `react-native-safe-area-context`, **nunca** `SafeAreaView` de `react-native` (memoria `android_overlay_scrollview_dead_zone`).

## Plan de pruebas (alto nivel)

- **CRÍTICO → TDD estricto** (regla determinista por path, §5): todas las migraciones (`supabase/migrations/**`), la EF `post-comment`/`moderate-comment` (`supabase/functions/**`) y los hooks/lib del cliente (`mobile/**/hooks/**`, `**/lib/**`). RED → GREEN → guardian con **mutación real**.
- **pgTAP**: RLS por impersonación JWT (autor / tercero / publicador / owner de agencia / miembro suspendido / admin / anon), CHECKs (whitespace Unicode, NULL), dedupe de reportes, ventana deslizante de 24 h contando **reportantes distintos**, auditoría obligatoria, round-trip del rollback. ⚠️ Cuando la policy bajo prueba comparta expresión con su `*_select`, asertar contra el helper `SECURITY DEFINER` o aislar la policy dentro de la transacción (lección 269.3).
- **Deno** para la EF; **Jest/RNTL** para hooks y pantallas (⚠️ RNTL 14: `renderHook` async + `await act`; `fireEvent` async; `unmount()` dentro de `act`).
- **Bombas de fecha**: fijar el reloj en TODOS los casos con ventana de 24 h y verificar en 4 zonas horarias (memoria `tests_bomba_de_fecha_y_estado_inicial`).
- **Smoke**: emulador por CLI (`adb`/Maestro, nunca computer-use) + dispositivo real con Abraham. Sondas SQL contra producción con el patrón **DO block + RAISE** (read-only, rollback forzado).

## Impacto en PRD (solo referencia — NO se edita)

`docs/PRD.md` §18 (comentarios y su moderación), §20 (follow), §22 (catálogo de notificaciones: «Nuevo seguidor», «Nuevo comentario en mi publicación», «Nuevo video de un agente que sigues»), §23.1 (lista de seguidores visible al dueño), §24.2 (reportes de comentarios), §19.1/§19.6 (interacciones vs leads; comentario = 3 pts en el embudo — hoy la fórmula T1 no lo contempla), §25 (comentarios de cuenta eliminada). Cualquier decisión de este doc que contradiga el PRD (p. ej. no dar la lista de seguidores, o comentar por propiedad y no por video) es **enmienda al PRD**, decisión del dueño, fuera de esta exploración.

## Decisiones del intake

Respondidas por Abraham vía `AskUserQuestion` (2026-09-10, tres rondas) y una enmienda de orden el mismo día:

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿Qué se construye primero? | Primero respondió **Follow**; **enmienda 2026-09-10 (noche): «Primero hay que trabajar en los comentarios, ya después con el follow»** → orden final **comentarios+reportes (#289) → follow (#78)** |
| 2 | ¿Cómo se promueve? | Redefinir **#78 = Follow F1** (dependiente de #289) + tarea nueva **#289 = Comentarios C1+C2 con reportes R1** |
| 3 | ¿A quién se puede seguir? | Cualquier publicador con perfil público |
| 4 | ¿Qué ve el agente de sus seguidores? | **Solo el conteo** |
| 5 | ¿Sección «Siguiendo» en el feed? | Ninguno por ahora (reservado a la dirección B de #285) |
| 6 | ¿Aviso «nuevo video de quien sigues»? | Ninguno por ahora |
| 7 | Modelo del comentario | **Plano, por propiedad, sin edición**, borrado propio lógico |
| 8 | ¿Filtro previo a publicar? | **EF `post-comment` con filtro determinista mínimo** (C2) |
| 9 | Reportes de comentarios | **`comment_reports` + auto-ocultar 3/24 h + cola existente** (R1) |
| 10 | Deanonimización del radar del CRM | **Aceptar y documentar** en [[privacidad-datos]] antes de mergear |
| UI-a | Hoja de comentarios (fuera del mockup, firma) | **Preview HTML dentro de la tarea de comentarios** (289.1) |
| UI-b | Stat «Seguidores» en el perfil | **Sustituir una columna ahora**, dentro de la tarea de follow (78.4) |
| — | ¿Aprobar y promover? | **Aprobado** |

## Preguntas abiertas (para `AskUserQuestion` del orquestador)

**A · Alcance y promoción**
1. **¿Qué se construye primero?** → (REC) Follow completo y luego comentarios+reportes · Comentarios+reportes primero (es lo que más pidió el cliente) · Los tres bloques por capas (todo el backend, luego toda la UI).
2. **¿Cómo se promueve a Taskmaster?** → (REC) Redefinir **#78** como «Follow» + tarea nueva «Comentarios + reportes de comentarios» dependiente · Tareas nuevas independientes dejando #78/#79 como épicas históricas · Expandir #78 tal cual está (incluye compartir y deep links, que ya no aplican igual).

**B · Follow**
3. **¿A quién se puede seguir?** → (REC) A cualquier publicador con perfil público (agente, admin, premium) — la identidad pública ya cubre todos los roles desde #250/#254 · Solo a agentes verificados (literal del PRD §20) · A cuentas **y** a inmobiliarias (exige inventar pantalla de agencia).
4. 🔴 **¿Qué ve el agente de sus seguidores?** → (REC) **Solo el conteo** — protege el k-anonimato del radar del CRM · Lista con nombre y foto (lo que dice el PRD §23.1) · Lista con nombre, foto y fecha de seguimiento.
5. **¿Sección «Siguiendo» en el feed?** → (REC) Después, atada a la dirección **B** de #285 (RPC `feed_page`) · Ahora, con filtro en cliente (rompe el invariante «sección = operación» de `feedSection.ts`) · No hacerla.
6. **¿Aviso «nuevo video de un agente que sigues»?** → (REC) No por ahora — in-app sin push casi nadie lo ve y el fan-out amenaza el invariante bloqueante · Sí, en la misma transacción de publicar (si el fan-out truena, la publicación revierte) · Sí, pero asíncrono (relaja explícitamente el invariante 🔒 de 2026-08-25).

**C · Comentarios**
7. **Modelo del comentario** → (REC) **Plano, por propiedad, sin edición**, borrado propio lógico · Plano **por video** (literal del PRD §17 y patrón de `likes`) · Con **hilos de 1 nivel** para que el agente responda (contradice §18.1, que manda las preguntas a WhatsApp).
8. **¿Filtro de contenido antes de publicar?** → (REC) EF `post-comment` con filtro **determinista mínimo** (teléfono, email, URL, lista de palabras en `app_config`) → `held_for_review` solo lo que matchea · INSERT directo bajo RLS sin filtro (patrón `property_reports`, más barato) · Cola de aprobación previa para **todo** comentario.

**D · Reportes y privacidad**
9. **Reportes de comentarios** → (REC) **`comment_reports`** calcando `property_reports` + auto-ocultar a **3** reportantes distintos en 24 h + resolución en `/admin/reports` · Solo ocultar por el publicador/agencia, sin cola ni auto-ocultar · Tabla polimórfica `content_reports` unificando las tres (expand→migrate→contract sobre contrato publicado).
10. 🔴 **Deanonimización del radar del CRM** (un comentario público da al agente identidad + timestamp de un no-lead) → (REC) **Aceptar y documentar**: comentar es un acto deliberadamente público, distinto del comportamiento que el radar protege · Excluir del radar a quien comentó en propiedades de ese agente (cuesta cobertura del radar) · Comentarios con **alias** o sin nombre visible (mata la prueba social).

## Promoción / descarte

**Promovida el 2026-09-10** (escritura directa en `tasks.json`, `add-task` roto §4; `.bak` + `validate-dependencies` OK):
- **#289** `comentarios por publicación con filtro mínimo y reportes integrados a la cola de moderación (C1+C2+R1)` — prioridad high, deps #219/#220, 9 subtareas (preview HTML → migración comments → comment_reports → notificaciones → EF post-comment → moderación admin → hooks → UI → privacidad/deploy/cierre).
- **#78** redefinida como `follow de cuentas (F1)` — prioridad medium, **depende de #289** (orden enmendado por Abraham), 5 subtareas. Compartir (ya existe parcialmente) y la página web del deep link quedan fuera de #78, como proyecto aparte.
- Fases 5 (F3 «Siguiendo» vía dirección B) y 6 (señal de temperatura) quedan **reservadas**, sin tarea.

Siguiente paso: `/tm-plan 289`.
