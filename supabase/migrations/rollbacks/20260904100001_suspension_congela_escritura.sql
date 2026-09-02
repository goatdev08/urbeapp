-- Rollback de 20260904100001 (#202) — restaura las definiciones EXACTAS
-- previas: properties_update de 20260805000011 (fix #100, con el bypass
-- `owner_user_id = auth.uid()` a secas), properties_delete de 20260604000010:281
-- (mismo bypass, sin comment) y private.can_view_user_as_lead_searcher de
-- 20260807000006 (75.5-bis, con el atajo `l.agent_id = auth.uid()`).
--
-- ⚠️ Al revertir, un agente SUSPENDIDO vuelve a poder editar/pausar/cerrar/BORRAR
-- sus propiedades publicadas bajo la marca de la agencia y a ver el teléfono del
-- buscador de sus leads. Solo para revertir #202 si algo truena.
-- Idempotente y no destructivo (drop policy if exists + create or replace).

drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (
    owner_user_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  )
  with check (
    owner_user_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  );

comment on policy properties_update on public.properties is
  'Fix 100: reemplaza private.is_agency_owner_of(owner_user_id) (membresía '
  'compartida HOY, ignoraba la agency_id real de la property -- tras un switch '
  'dejaba al owner de la agencia NUEVA editar properties VIEJAS de otra agencia, '
  'y simultáneamente bloqueaba al owner REAL de esas properties) por '
  'agency_role_of(agency_id) in (owner,admin) -- siempre escapada a la agencia '
  'real de la fila. private.is_agency_owner_of sigue vigente para leads (sin tocar).';

-- properties_delete vuelve a 20260604000010:279-281 — que NO tenía comment,
-- así que se retira el de #202 para no dejar documentación de una regla que ya
-- no rige (comment on ... is null es la forma de borrarlo).
drop policy if exists properties_delete on public.properties;
create policy properties_delete on public.properties for delete to authenticated
  using (owner_user_id = (select auth.uid()) or private.is_admin());

comment on policy properties_delete on public.properties is null;

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
