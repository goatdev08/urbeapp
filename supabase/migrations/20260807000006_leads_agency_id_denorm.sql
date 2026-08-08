-- Migración 20260807000006 — leads.agency_id denormalizado + visibilidad de owner/admin
-- escapada a la agencia REAL del lead (tarea derivada fix(75.5), origen: review del PR de
-- la rama tarea/75-crm-estados-scoring — hallazgo ALTO #2, "fuga de PII cross-agencia: se
-- repitió el defecto que la #100 ya había corregido").
--
-- BUG: 20260807000005 agregó private.is_agency_admin_of como copy-paste EXACTO de
-- private.is_agency_owner_of (20260604000010:38-50): ambos filtran por membresía
-- COMPARTIDA HOY entre el caller (owner/admin) y el agente dueño del lead (leads.agent_id),
-- nunca por la agencia a la que pertenecía el AGENTE cuando el lead nació. Como
-- public.leads no tenía su propio agency_id, la visibilidad de "gestor de agencia" sobre
-- un lead seguía la membresía ACTUAL del agente, no la histórica. Es el MISMO defecto que
-- ya se corrigió para public.properties en la tarea derivada #100 (20260805000011) — se
-- repitió aquí porque leads nunca recibió el mismo tratamiento de denormalización.
--
-- Escenario verificado por el revisor (agente que cambia de agencia X -> Y):
--   admin de X (donde NACIÓ el lead) ve el lead?  -> 0   (el legítimo pierde acceso)
--   admin de Y (agencia NUEVA) ve el lead viejo?  -> 1   (el ajeno lo gana, incluye PII:
--                                                          private.can_view_user_as_lead_
--                                                          searcher es la puerta a nombre,
--                                                          teléfono y correo del buscador)
--
-- FIX (mismo patrón que la #100, 20260805000011:206-273 — léela, es el precedente literal):
--   1) public.leads.agency_id uuid (FK agencies, nullable) — poblado por un trigger BEFORE
--      INSERT desde la membresía ACTIVA del agente AL MOMENTO de crear el lead. Nunca se
--      actualiza después (igual que properties.agency_id): captura la agencia vigente en
--      el momento del hecho, no la membresía actual del agente. NULL si el agente era
--      independiente (sin agencia) -- ver DECISIÓN abajo.
--   2) leads_select, private.can_view_lead y private.can_view_user_as_lead_searcher pasan
--      de "is_agency_owner_of(agent_id) OR is_agency_admin_of(agent_id)" (membresía HOY) a
--      "private.agency_role_of(leads.agency_id) in ('owner','admin')" (agencia REAL de la
--      fila, siempre escapada -- mismo patrón que properties_update tras el fix #100).
--   3) private.is_agency_admin_of se ELIMINA: era el helper recién introducido por
--      20260807000005 y, tras este fix, se queda sin consumidores (mantenerlo vivo y
--      *incorrecto* junto a sus 3 llamadores ya migrados sería peor que borrarlo). El
--      rollback de ESTA migración lo restaura si hace falta revertir.
--
-- ⚠️ Backfill: leads YA creados antes de este fix nunca tuvieron agency_id (columna nueva).
-- Igual que en #100 (comentario 20260805000011:207-222), no hay forma de recuperar la
-- agencia HISTÓRICA exacta de esas filas -- se usa la membresía ACTIVA HOY del agente como
-- mejor aproximación disponible (determinístico, solo toca filas agency_id IS NULL cuyo
-- agente tiene HOY una membresía activa; un agente sin membresía activa hoy se queda NULL
-- -- independiente, correcto). Limitación conocida y documentada, no una garantía nueva.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DECISIÓN — lead de un agente independiente (sin agencia)
-- ════════════════════════════════════════════════════════════════════════════
-- agency_id queda NULL. private.agency_role_of(NULL) siempre retorna NULL (la query interna
-- filtra por agency_id = NULL, que en SQL nunca iguala nada), así que
-- "agency_role_of(NULL) in ('owner','admin')" es NULL -> false en la policy: NINGÚN
-- owner/admin de NINGUNA agencia ve ese lead. Solo lo ve el agente dueño (agent_id = caller)
-- o el admin de plataforma (private.is_admin()). Fail-closed por construcción, sin caso
-- especial en el código.
--
-- 🔴 Solo amplía/corrige SELECT. leads_update NO se toca -- la escritura sigue restringida
-- a agent_id = caller (o admin de plataforma), misma línea que separó 75.5 de la #31
-- diferida. Ver assert I5 del RED.
--
-- Tests: supabase/tests/31_leads_agency_id_denorm_test.sql (plan 16, shape + 8 DELTA de
-- visibilidad + 5 INVARIANTE + 1 INVARIANTE de escritura).
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER/POLICY IF
-- EXISTS antes de CREATE.
-- Rollback: supabase/migrations/rollbacks/20260807000006_leads_agency_id_denorm.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Columna leads.agency_id + índice (mismo patrón que properties.agency_id, 0005/0011)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.leads
  add column if not exists agency_id uuid references public.agencies (id) on delete set null;

comment on column public.leads.agency_id is
  'Agencia del agente dueño del lead AL MOMENTO de crearse (denormalizado, fix 75.5-bis). '
  'NULL si el agente era independiente. Nunca se actualiza tras el INSERT -- captura la '
  'agencia vigente en el momento del hecho, no la membresía actual del agente (mismo '
  'criterio que properties.agency_id, fix #100). Mantenida por private.set_lead_agency_id, '
  'nunca escrita a mano.';

create index if not exists leads_agency_idx
  on public.leads (agency_id) where deleted_at is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) private.set_lead_agency_id — BEFORE INSERT en leads: denormaliza la agencia del
--    agente en el momento de crear el lead.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.set_lead_agency_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agency_id is null then
    select am.agency_id into new.agency_id
      from public.agency_members am
     where am.user_id = new.agent_id
       and am.status = 'active'
     limit 1;  -- agency_members_one_active_per_user (0003) garantiza a lo más 1 fila
  end if;
  return new;
end;
$$;

comment on function private.set_lead_agency_id() is
  'BEFORE INSERT en public.leads: fija agency_id = la agencia donde el agente (agent_id) '
  'está ACTIVO al momento de crear el lead (NULL si es independiente). Nunca se reevalúa '
  'después -- un switch_agency_atomic posterior no reescribe leads ya creados (fix 75.5-bis).';

drop trigger if exists trg_set_lead_agency_id on public.leads;
create trigger trg_set_lead_agency_id
  before insert on public.leads
  for each row execute function private.set_lead_agency_id();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Backfill — leads YA creados antes de este fix (ver limitación documentada arriba).
-- ════════════════════════════════════════════════════════════════════════════
update public.leads l
   set agency_id = am.agency_id
  from public.agency_members am
 where l.agency_id is null
   and am.user_id = l.agent_id
   and am.status = 'active';

-- ════════════════════════════════════════════════════════════════════════════
-- 4) leads_select / can_view_lead / can_view_user_as_lead_searcher -- una sola fuente de
--    verdad (agency_role_of, escapada a leads.agency_id) para owner Y admin, en vez de los
--    2 helpers de membresía compartida (is_agency_owner_of / is_agency_admin_of).
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    agent_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  );

comment on policy leads_select on public.leads is
  'Fix 75.5-bis: reemplaza is_agency_owner_of(agent_id) OR is_agency_admin_of(agent_id) '
  '(membresía compartida HOY entre caller y agente, ignoraba la agencia REAL del lead) por '
  'agency_role_of(agency_id) in (owner,admin), siempre escapada a la agencia donde nació '
  'el lead.';

create or replace function private.can_view_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (l.agent_id = (select auth.uid())
           or private.agency_role_of(l.agency_id) in ('owner', 'admin')
           or private.is_admin())
  );
$$;

create or replace function private.can_view_user_as_lead_searcher(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.user_id = p_user_id
      and l.deleted_at is null
      and (l.agent_id = (select auth.uid())
           or private.agency_role_of(l.agency_id) in ('owner', 'admin'))
  );
$$;

comment on function private.can_view_user_as_lead_searcher(uuid) is
  'RLS: true si p_user_id es el buscador (leads.user_id) de un lead ACTIVO cuyo agente '
  'dueño (leads.agent_id) es el usuario autenticado, o el owner/admin de la agencia donde '
  'ese lead NACIÓ (leads.agency_id vía agency_role_of -- fix 75.5-bis, reemplaza la '
  'membresía compartida HOY del agente). Usado por users_select para exponer la identidad '
  'de contacto del buscador (first_name, last_name, phone, avatar_url).';

-- ════════════════════════════════════════════════════════════════════════════
-- 5) private.is_agency_admin_of -- sin consumidores tras este fix, se elimina (era '
--    incorrecto por diseño: copy-paste de is_agency_owner_of, mismo defecto de #100).
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists private.is_agency_admin_of(uuid);
