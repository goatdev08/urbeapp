-- Migración 20260808000001 — RLS de events_raw: el usuario escribe SUS propios eventos;
-- el agente (y el owner de su agencia / admin) lee los eventos de SUS propiedades
-- (subtarea 112.1, origen: producto(75.2) "estadísticas tangibles del lead" -> tarea 112).
--
-- ESTADO ANTERIOR (verificado, 20260604000007/000008): public.events_raw existe con el
-- shape correcto y RLS habilitado, pero SIN policies y SIN grant de tabla a `authenticated`
-- (`revoke all on public.events_raw from anon, authenticated` en 20260604000008:419). Era
-- deliberado: hasta ahora events_raw era "solo service_role" (comentario 20260604000008:354).
-- Con 112 el CLIENTE necesita escribir telemetría cruda directo (mismo precedente que
-- likes/saves: `user_id = auth.uid()` sin pasar por una Edge Function) y el agente necesita
-- leerla para armar las estadísticas tangibles del lead (consumo agregado: subtarea 112.3,
-- NO tocada aquí).
--
-- CAMBIOS:
--   1) GRANT insert, select on public.events_raw to authenticated -- sin esto las policies
--      no bastan: un rol sin grant de tabla truena con "permission denied" (42501) ANTES de
--      evaluar cualquier policy. anon NO recibe grant (fail-closed, sigue igual que 0008).
--   2) Policy events_raw_insert: with check (user_id = (select auth.uid())) -- el usuario
--      solo puede escribir eventos a SU propio nombre; suplantar a otro (user_id de un
--      tercero) o mandar user_id NULL falla siempre (NULL = auth.uid() nunca es true, no es
--      un escape hatch del with_check).
--   3) Policy events_raw_select: using (user_id = (select auth.uid()) or
--      private.can_manage_property(property_id)) -- 🔴 REUSA private.can_manage_property
--      (20260604000010:66-75), NO se escribe un helper nuevo. Ese helper ya compone dueño
--      directo de la propiedad + private.is_agency_owner_of (owner de la agencia del agente)
--      + private.is_admin() -- exactamente la composición que #100 (20260805000011) tuvo que
--      corregir a mano para properties/videos/leads porque un helper ad-hoc de "membresía
--      compartida" filtraba filas de otra agencia. Reusar can_manage_property trae esa
--      corrección gratis en vez de repetir el error.
--      Nota: property_id puede ser NULL (evento sin propiedad, p.ej. app_open) --
--      can_manage_property(NULL) es siempre false (busca properties.id = NULL, que nunca
--      matchea; mismo comportamiento documentado en 20260807000001:14-16), así que esos
--      eventos solo los ve su propio dueño vía la primera rama -- correcto, nadie más debe
--      ver un evento sin propiedad ajeno.
--   4) Índices nuevos para las agregaciones del CRM (consumidas por 112.3, fuera de esta
--      subtarea): events_raw_user_property_idx (user_id, property_id) y
--      events_raw_property_event_type_idx (property_id, event_type). No se tocan los 4
--      índices existentes de 20260604000007 (type/property/user/created, todos con
--      created_at) ni events_raw_agent_idx/events_raw_video_idx de 20260604000010 -- sirven
--      a otros patrones de consulta y quedan vivos.
--
-- 🔴 NO se toca leads_select / leads.score / leads.level -- la fórmula de scoring sigue
-- viva tal cual (deuda conocida #108); esta migración es SOLO la puerta de datos crudos de
-- events_raw. Tampoco se toca ninguna Edge Function: la escritura es directa desde el
-- cliente bajo RLS, siguiendo el precedente de likes/saves (mismo patrón user_id = auth.uid()
-- sin intermediario).
--
-- ⚠️ Efecto colateral documentado en 02_rls_test.sql:144 -- ese archivo tenía
-- `throws_ok($$ select 1 from public.events_raw $$, ...)` bajo `authenticated` sin ninguna
-- policy: cierto HOY, falso en cuanto esta migración aplica (un authenticated SÍ puede leer
-- SUS propios eventos). Se retira en este mismo cambio con un comentario que apunta a
-- 33_events_raw_rls_test.sql (SEL1-4/OWN1-3/ISO1-3) como su reemplazo -- ese archivo ya
-- cubre "no lee eventos ajenos" con fixtures dedicados; duplicar una fixture de events_raw
-- en 02_ (smoke genérico de RLS, sin fixtures de events_raw hoy) habría sido más ruido que
-- señal. plan() baja de 17 a 16 en ese archivo.
--
-- Idempotente: grant (repetible sin error), drop policy if exists + create policy, create
-- index if not exists.
-- Tests: supabase/tests/33_events_raw_rls_test.sql (plan 16: 2 shape + 4 insert + 4 select
-- propio + 3 select del agente/owner + 3 aislamiento cross-agente/cross-agencia).
-- Rollback: supabase/migrations/rollbacks/20260808000001_events_raw_rls.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Grant de tabla -- primera puerta, sin esto las policies no se llegan a evaluar.
-- ════════════════════════════════════════════════════════════════════════════
grant insert, select on public.events_raw to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Policies
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists events_raw_insert on public.events_raw;
create policy events_raw_insert on public.events_raw for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists events_raw_select on public.events_raw;
create policy events_raw_select on public.events_raw for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.can_manage_property(property_id)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Índices para las agregaciones del CRM (112.3)
-- ════════════════════════════════════════════════════════════════════════════
create index if not exists events_raw_user_property_idx
  on public.events_raw (user_id, property_id);

create index if not exists events_raw_property_event_type_idx
  on public.events_raw (property_id, event_type);
