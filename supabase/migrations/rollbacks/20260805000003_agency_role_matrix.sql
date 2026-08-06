-- Rollback: 20260805000003_agency_role_matrix.sql
-- Restaura agency_members (select/insert/update/delete) y properties_update a su
-- definición EXACTA de 20260604000010 (líneas 200-212 y 275-278), elimina la policy
-- nueva properties_select_agency_role y dropea los helpers private.agency_role_of /
-- private.can_manage_agency_member.
-- Nota: el enum agency_member_role conserva 'admin'/'viewer' (ver rollback de
-- 20260805000002 -- un valor de enum no es removible).

drop policy if exists members_select on public.agency_members;
create policy members_select on public.agency_members for select to authenticated
  using (user_id = (select auth.uid()) or private.manages_agency(agency_id) or private.is_admin());

drop policy if exists members_insert on public.agency_members;
create policy members_insert on public.agency_members for insert to authenticated
  with check (private.manages_agency(agency_id) or private.is_admin());

drop policy if exists members_update on public.agency_members;
create policy members_update on public.agency_members for update to authenticated
  using (private.manages_agency(agency_id) or private.is_admin())
  with check (private.manages_agency(agency_id) or private.is_admin());

drop policy if exists members_delete on public.agency_members;
create policy members_delete on public.agency_members for delete to authenticated
  using (private.is_admin());

drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (owner_user_id = (select auth.uid()) or private.is_admin())
  with check (owner_user_id = (select auth.uid()) or private.is_admin());

drop policy if exists properties_select_agency_role on public.properties;

drop function if exists private.can_manage_agency_member(uuid, agency_member_role);
drop function if exists private.agency_role_of(uuid);
