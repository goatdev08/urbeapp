---
tipo: concepto
dominio: arquitectura
estado: vivo
fuentes: [docs/lineamientos-desarrollo.md, supabase/README.md]
codigo: [supabase/migrations/0008_rls_helpers_and_policies.sql, supabase/migrations/0010_security_perf_hardening.sql, supabase/migrations/0014_service_role_grants.sql, supabase/migrations/20260702000001_rls_lead_searcher_identity.sql, supabase/migrations/20260807000001_video_in_flight_owner_select.sql, supabase/migrations/20260807000005_lead_admin_visibility.sql, supabase/tests/27_video_in_flight_select_test.sql, supabase/tests/30_leads_admin_visibility_test.sql]
actualizado: 2026-08-07
---

# RLS y seguridad

> Row Level Security como **2ª capa** de defensa, endurecida. La lógica de negocio vive en Edge Functions, no en RLS.

## Patrón (migraciones 0008 → 0010)
- RLS habilitado en las **20 tablas**, ~**65 políticas** (SELECT/INSERT/UPDATE/DELETE).
- **0008**: 10 helpers en schema `public`. **0010**: los mueve a schema **`private`** (no expuesto por PostgREST) y los reescribe con `(select auth.uid())` para evitar el *init-plan* recursivo; además blinda triggers (search_path fijo) y agrega 11 índices FK.
- **12 helpers** (`private.*`, SECURITY DEFINER STABLE): `current_user_role`, `is_admin`, `manages_agency`, `is_agency_owner_of`, `current_user_agency_id`, `owns_property`, `can_manage_property`, `property_is_public`, `can_view_lead`, `can_edit_lead`, **`can_view_user_as_lead_searcher`** (#30, migración `20260702000001`, `set search_path=public`): permite al agente dueño de un lead activo (o al owner/admin de su agencia) leer la fila `public.users` del **buscador** — se añade como cláusula OR a `users_select`. Fix del "Usuario sin nombre" en el CRM sin denormalizar. Ver [[crm-leads]]. Y **`is_agency_admin_of`** (#75.5, migración `20260807000005`): calco exacto de `is_agency_owner_of` con `member_role='admin'` — el rol `admin` de la Ola 1 (#71) quedaba como agente raso y no veía el pipeline de su equipo.

## Reglas clave
- 🔒 **Acotar al DUEÑO, nunca a "membresía compartida"** (patrón con dos precedentes vivos). Cuando una fila necesita visibilidad nueva, la condición correcta es la identidad de su dueño, no un helper de pertenencia a la misma agencia: la #100 tuvo que **reemplazar** un helper de membresía compartida que filtraba filas de otra agencia, y la **tercera rama de `videos_select`** (#103, migración `20260807000001`) se escribió deliberadamente como `(property_id is null and agent_id = (select auth.uid()) and deleted_at is null)` — sin helpers de agencia. ⚠️ El bug que la motivó es un modo de falla propio del **upload-first**: `property_videos` nace con `property_id = NULL`, y **toda** rama de policy que dependa de la propiedad (`private.property_is_public(NULL)`, `private.can_manage_property(NULL)`) devuelve **false en silencio** (busca `id = NULL`, que nunca matchea) → ni el propio dueño veía su fila. `deleted_at is null` en cada rama nueva = fail-closed explícito. pgTAP `27` (`plan(8)`: 2 DELTA + 6 invariantes, incl. el ancla de que el dueño **no** ve su fila soft-deleted). Ver [[propiedades-y-video]].
- 🔒 **Al dar visibilidad nueva a un rol: se AMPLÍA SELECT, NUNCA la escritura** (#75.5). `is_agency_admin_of` entra como cláusula OR en los **3 puntos de lectura** del CRM (`leads_select`, `can_view_lead`, `can_view_user_as_lead_searcher`) y **`leads_update` no se toca** — la escritura sigue acotada al agente dueño, con **2 asserts pgTAP que custodian** que no se amplió (`30_leads_admin_visibility_test.sql`, plan 15 = 5 DELTA + 10 INVARIANTE). Extender la edición al owner/admin es una decisión de producto pendiente (tarea #31), no un efecto colateral de una policy. Es la otra cara de la regla de arriba: **acotar al dueño** vale para escribir; para leer, ampliar con un helper de rol **explícito y simétrico** (ambos `active` en la MISMA agencia, join por `agency_id` — precedente #100), nunca con un "pertenece a la misma agencia" laxo.
- Matriz **multi-tenant de 4 niveles** (owner/admin/agent/viewer) y sus fixes: migraciones `20260805000002`–`000011` (#71, #99, #100) — no detallada aquí, ver [[roles-y-permisos]] y [[mapa-codebase]].
- 🔒 **Grants column-level** bloquean auto-escalación: el cliente no puede cambiar `users.role`, `agencies.status`, `is_verified_agent`, ni el contenido de `notifications`.
- 🔒 `events_raw` y `admin_actions` → **solo `service_role`** (sin políticas para anon/authenticated; append-only). ⚠️ **`events_raw` no tiene un solo escritor** (0 referencias en código, 0 filas en el remoto, verificado en #75.2): cualquier diseño que "lea de events_raw" está leyendo un pipeline inexistente.
- 🔒 **Append-only con dientes** (patrón `user_consents` → reusado por `lead_status_history`, #75.1): la tabla la puebla un **trigger SECURITY DEFINER**, la policy expone solo SELECT, y se hace `revoke all … from anon, authenticated` **antes** de re-otorgar el `grant select` — porque Supabase concede SELECT/INSERT/UPDATE/DELETE de fábrica a toda tabla nueva de `public`, así que "no crear policy de INSERT" no basta por sí solo. Efecto: ni el dueño de la fila puede escribirla a mano; el trigger no necesita esos grants porque corre como el owner de la función.
- **Público (anon):** `properties` con `status='active'` + `property_videos` con `status='ready'` + `agencies` approved|active + `terms_versions`.
- Lógica de negocio → **Edge Functions** (validación→autorización→lógica→persistencia). RLS no orquesta; triggers solo atómicos. Ver `docs/lineamientos-desarrollo.md`.
- ⚠️ **`service_role` tiene `bypassrls` pero NO grants DML automáticos en este proyecto.** 0008 otorgó `select/insert/update/delete` solo a `authenticated`/`anon`; en una instalación Supabase normal `service_role` los recibe vía *default privileges* del rol dueño, pero al aplicar migraciones por MCP quedó sin ellos → la capa de servicio supabase-js (Edge Functions con `service_role`) recibía **403** de PostgREST en cualquier lectura/escritura de tabla. **Migración 0014** restablece `grant all on all tables/sequences/routines … to service_role` + `alter default privileges`. Las RPC `SECURITY DEFINER` (p. ej. `redeem_invitation_atomic`) NO se ven afectadas porque corren como su dueño (`postgres`) — por eso el hueco puede pasar desapercibido hasta probar una función que lea tablas directamente.

## Al construir features nuevas (demo)
Toda tabla/feature respeta este patrón: políticas idempotentes (`drop policy if exists … ; create policy …`), helpers `private.*`, grants mínimos. Cualquier dato sensible → test pgTAP en `02_rls_test.sql`.

## Detalle exhaustivo
- migraciones `0008` / `0010` · `supabase/tests/02_rls_test.sql` (15 asserts) · `docs/lineamientos-desarrollo.md`

## Relacionados
[[roles-y-permisos]] · [[inmobiliarias-y-agentes]] · [[crm-leads]] · [[db-schema-map]]
