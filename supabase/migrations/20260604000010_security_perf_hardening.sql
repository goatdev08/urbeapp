-- Migración 0010 — Endurecimiento de seguridad y performance (resuelve advisors)
-- Cambios:
--  (A) Mueve las funciones helper de RLS al esquema `private` (NO expuesto por PostgREST),
--      eliminando los avisos anon/authenticated_security_definer_function_executable.
--  (B) Recrea TODAS las políticas usando private.* y `(select auth.uid())` (corrige auth_rls_initplan).
--  (C) Blinda los trigger functions: fija search_path y revoca EXECUTE (los triggers siguen disparando).
--  (D) Agrega índices de cobertura a los 11 foreign keys sin índice.
--  (E) Separa la escritura admin de terms_versions (corrige multiple_permissive_policies).
--  (F) Restringe el INSERT público de agent_interest_submissions (corrige rls_policy_always_true).

-- ════════════════════════════════════════════════════════════════════════════
-- (A) Esquema private + helpers
-- ════════════════════════════════════════════════════════════════════════════
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.current_user_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.users where id = (select auth.uid()) and deleted_at is null;
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(private.current_user_role() = 'admin', false);
$$;

create or replace function private.manages_agency(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency_id
      and m.user_id = (select auth.uid())
      and m.member_role = 'owner'
      and m.status = 'active'
  );
$$;

create or replace function private.is_agency_owner_of(p_target_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.agency_members owner_m
    join public.agency_members agent_m on agent_m.agency_id = owner_m.agency_id
    where owner_m.user_id = (select auth.uid())
      and owner_m.member_role = 'owner'
      and owner_m.status = 'active'
      and agent_m.user_id = p_target_user_id
      and agent_m.status = 'active'
  );
$$;

create or replace function private.current_user_agency_id()
returns uuid language sql stable security definer set search_path = public as $$
  select agency_id from public.agency_members
  where user_id = (select auth.uid()) and status = 'active' limit 1;
$$;

create or replace function private.owns_property(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties
    where id = p_property_id and owner_user_id = (select auth.uid())
  );
$$;

create or replace function private.can_manage_property(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties pr
    where pr.id = p_property_id
      and (pr.owner_user_id = (select auth.uid())
           or private.is_agency_owner_of(pr.owner_user_id)
           or private.is_admin())
  );
$$;

create or replace function private.property_is_public(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties
    where id = p_property_id and status = 'active' and deleted_at is null
  );
$$;

create or replace function private.can_view_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (l.agent_id = (select auth.uid())
           or private.is_agency_owner_of(l.agent_id)
           or private.is_admin())
  );
$$;

create or replace function private.can_edit_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id and (l.agent_id = (select auth.uid()) or private.is_admin())
  );
$$;

grant execute on all functions in schema private to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (B,E,F) Recrear políticas (private.* + (select auth.uid()))
-- ════════════════════════════════════════════════════════════════════════════

-- users
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or private.is_agency_owner_of(id)
    or (role = 'agent' and deleted_at is null and is_verified_agent = true)
  );
drop policy if exists users_update on public.users;
create policy users_update on public.users for update to authenticated
  using (id = (select auth.uid()) or private.is_admin())
  with check (id = (select auth.uid()) or private.is_admin());
drop policy if exists users_delete on public.users;
create policy users_delete on public.users for delete to authenticated
  using (private.is_admin());

-- user_preferences
drop policy if exists user_prefs_select on public.user_preferences;
create policy user_prefs_select on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists user_prefs_insert on public.user_preferences;
create policy user_prefs_insert on public.user_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists user_prefs_update on public.user_preferences;
create policy user_prefs_update on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists user_prefs_delete on public.user_preferences;
create policy user_prefs_delete on public.user_preferences for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- terms_versions (SELECT público; escritura admin separada por comando)
drop policy if exists terms_select on public.terms_versions;
create policy terms_select on public.terms_versions for select to anon, authenticated
  using (true);
drop policy if exists terms_write on public.terms_versions;
drop policy if exists terms_insert on public.terms_versions;
create policy terms_insert on public.terms_versions for insert to authenticated
  with check (private.is_admin());
drop policy if exists terms_update on public.terms_versions;
create policy terms_update on public.terms_versions for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
drop policy if exists terms_delete on public.terms_versions;
create policy terms_delete on public.terms_versions for delete to authenticated
  using (private.is_admin());

-- user_consents (inmutable)
drop policy if exists consents_select on public.user_consents;
create policy consents_select on public.user_consents for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists consents_insert on public.user_consents;
create policy consents_insert on public.user_consents for insert to authenticated
  with check (user_id = (select auth.uid()));

-- account_deletion_requests
drop policy if exists deletion_select on public.account_deletion_requests;
create policy deletion_select on public.account_deletion_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists deletion_insert on public.account_deletion_requests;
create policy deletion_insert on public.account_deletion_requests for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists deletion_update on public.account_deletion_requests;
create policy deletion_update on public.account_deletion_requests for update to authenticated
  using (user_id = (select auth.uid()) or private.is_admin())
  with check (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists deletion_delete on public.account_deletion_requests;
create policy deletion_delete on public.account_deletion_requests for delete to authenticated
  using (private.is_admin());

-- agencies
drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies for select to anon, authenticated
  using (
    (status in ('approved', 'active') and deleted_at is null)
    or created_by_user_id = (select auth.uid())
    or private.manages_agency(id)
    or private.is_admin()
  );
drop policy if exists agencies_insert on public.agencies;
create policy agencies_insert on public.agencies for insert to authenticated
  with check (created_by_user_id = (select auth.uid()));
drop policy if exists agencies_update on public.agencies;
create policy agencies_update on public.agencies for update to authenticated
  using (private.manages_agency(id) or private.is_admin())
  with check (private.manages_agency(id) or private.is_admin());
drop policy if exists agencies_delete on public.agencies;
create policy agencies_delete on public.agencies for delete to authenticated
  using (private.is_admin());

-- agency_members
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

-- agency_invitation_tokens
drop policy if exists tokens_select on public.agency_invitation_tokens;
create policy tokens_select on public.agency_invitation_tokens for select to authenticated
  using (private.manages_agency(agency_id) or private.is_admin());
drop policy if exists tokens_insert on public.agency_invitation_tokens;
create policy tokens_insert on public.agency_invitation_tokens for insert to authenticated
  with check ((private.manages_agency(agency_id) and created_by_user_id = (select auth.uid())) or private.is_admin());
drop policy if exists tokens_update on public.agency_invitation_tokens;
create policy tokens_update on public.agency_invitation_tokens for update to authenticated
  using (private.manages_agency(agency_id) or private.is_admin())
  with check (private.manages_agency(agency_id) or private.is_admin());
drop policy if exists tokens_delete on public.agency_invitation_tokens;
create policy tokens_delete on public.agency_invitation_tokens for delete to authenticated
  using (private.is_admin());

-- agent_applications
drop policy if exists agent_app_select on public.agent_applications;
create policy agent_app_select on public.agent_applications for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists agent_app_insert on public.agent_applications;
create policy agent_app_insert on public.agent_applications for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists agent_app_update on public.agent_applications;
create policy agent_app_update on public.agent_applications for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
drop policy if exists agent_app_delete on public.agent_applications;
create policy agent_app_delete on public.agent_applications for delete to authenticated
  using (private.is_admin());

-- agent_interest_submissions (INSERT público con check estructural, no "always true")
drop policy if exists interest_insert on public.agent_interest_submissions;
create policy interest_insert on public.agent_interest_submissions for insert to anon, authenticated
  with check (
    source = 'landing'
    and status = 'new'
    and char_length(email) between 3 and 320
    and char_length(phone) between 7 and 20
    and char_length(first_name) between 1 and 120
  );
drop policy if exists interest_select on public.agent_interest_submissions;
create policy interest_select on public.agent_interest_submissions for select to authenticated
  using (private.is_admin());
drop policy if exists interest_update on public.agent_interest_submissions;
create policy interest_update on public.agent_interest_submissions for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
drop policy if exists interest_delete on public.agent_interest_submissions;
create policy interest_delete on public.agent_interest_submissions for delete to authenticated
  using (private.is_admin());

-- properties
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select to anon, authenticated
  using (
    (status = 'active' and deleted_at is null)
    or owner_user_id = (select auth.uid())
    or private.is_agency_owner_of(owner_user_id)
    or private.is_admin()
  );
drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and private.current_user_role() in ('agent', 'admin'));
drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (owner_user_id = (select auth.uid()) or private.is_admin())
  with check (owner_user_id = (select auth.uid()) or private.is_admin());
drop policy if exists properties_delete on public.properties;
create policy properties_delete on public.properties for delete to authenticated
  using (owner_user_id = (select auth.uid()) or private.is_admin());

-- property_videos
drop policy if exists videos_select on public.property_videos;
create policy videos_select on public.property_videos for select to anon, authenticated
  using (
    (status = 'ready' and deleted_at is null and private.property_is_public(property_id))
    or private.can_manage_property(property_id)
  );
drop policy if exists videos_insert on public.property_videos;
create policy videos_insert on public.property_videos for insert to authenticated
  with check (private.owns_property(property_id) or private.is_admin());
drop policy if exists videos_update on public.property_videos;
create policy videos_update on public.property_videos for update to authenticated
  using (private.can_manage_property(property_id))
  with check (private.can_manage_property(property_id));
drop policy if exists videos_delete on public.property_videos;
create policy videos_delete on public.property_videos for delete to authenticated
  using (private.owns_property(property_id) or private.is_admin());

-- likes
drop policy if exists likes_select on public.likes;
create policy likes_select on public.likes for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists likes_insert on public.likes;
create policy likes_insert on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists likes_delete on public.likes;
create policy likes_delete on public.likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- saves
drop policy if exists saves_select on public.saves;
create policy saves_select on public.saves for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists saves_insert on public.saves;
create policy saves_insert on public.saves for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists saves_delete on public.saves;
create policy saves_delete on public.saves for delete to authenticated
  using (user_id = (select auth.uid()));

-- leads
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (agent_id = (select auth.uid()) or private.is_agency_owner_of(agent_id) or private.is_admin());
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated
  with check (agent_id = (select auth.uid()) or private.is_admin());
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (agent_id = (select auth.uid()) or private.is_admin())
  with check (agent_id = (select auth.uid()) or private.is_admin());
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (agent_id = (select auth.uid()) or private.is_admin());

-- lead_origin_properties
drop policy if exists lead_origin_select on public.lead_origin_properties;
create policy lead_origin_select on public.lead_origin_properties for select to authenticated
  using (private.can_view_lead(lead_id));
drop policy if exists lead_origin_insert on public.lead_origin_properties;
create policy lead_origin_insert on public.lead_origin_properties for insert to authenticated
  with check (private.can_edit_lead(lead_id));
drop policy if exists lead_origin_delete on public.lead_origin_properties;
create policy lead_origin_delete on public.lead_origin_properties for delete to authenticated
  using (private.is_admin());

-- property_reports
drop policy if exists reports_select on public.property_reports;
create policy reports_select on public.property_reports for select to authenticated
  using (reported_by_user_id = (select auth.uid()) or private.is_admin());
drop policy if exists reports_insert on public.property_reports;
create policy reports_insert on public.property_reports for insert to authenticated
  with check (reported_by_user_id = (select auth.uid()));
drop policy if exists reports_update on public.property_reports;
create policy reports_update on public.property_reports for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
drop policy if exists reports_delete on public.property_reports;
create policy reports_delete on public.property_reports for delete to authenticated
  using (private.is_admin());

-- notifications
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) or private.is_admin())
  with check (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- admin_actions
drop policy if exists admin_actions_select on public.admin_actions;
create policy admin_actions_select on public.admin_actions for select to authenticated
  using (private.is_admin());
drop policy if exists admin_actions_insert on public.admin_actions;
create policy admin_actions_insert on public.admin_actions for insert to authenticated
  with check (private.is_admin() and admin_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════════
-- (A cont.) Eliminar los helpers públicos (ya no referenciados por políticas)
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.can_edit_lead(uuid);
drop function if exists public.can_view_lead(uuid);
drop function if exists public.property_is_public(uuid);
drop function if exists public.can_manage_property(uuid);
drop function if exists public.owns_property(uuid);
drop function if exists public.current_user_agency_id();
drop function if exists public.is_agency_owner_of(uuid);
drop function if exists public.manages_agency(uuid);
drop function if exists public.is_admin();
drop function if exists public.current_user_role();

-- ════════════════════════════════════════════════════════════════════════════
-- (C) Blindar trigger functions: search_path fijo + revocar EXECUTE
--     (los triggers siguen disparando: la ejecución por trigger no requiere EXECUTE)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_max_videos_per_property()
returns trigger language plpgsql set search_path = public as $$
declare
  v_count int;
begin
  perform 1 from public.properties where id = new.property_id for update;
  select count(*) into v_count
    from public.property_videos
    where property_id = new.property_id and deleted_at is null;
  if v_count >= 5 then
    raise exception 'max_videos_per_property_exceeded: una propiedad admite máximo 5 videos'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.cascade_soft_delete_property_videos()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.property_videos
      set deleted_at = new.deleted_at
      where property_id = new.id and deleted_at is null;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_updated_at()                    from public, anon, authenticated;
revoke execute on function public.handle_new_user()                   from public, anon, authenticated;
revoke execute on function public.enforce_max_videos_per_property()   from public, anon, authenticated;
revoke execute on function public.cascade_soft_delete_property_videos() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (D) Índices de cobertura para los foreign keys sin índice
-- ════════════════════════════════════════════════════════════════════════════
create index if not exists agencies_approved_by_idx
  on public.agencies (approved_by_admin_id);
create index if not exists agency_tokens_created_by_idx
  on public.agency_invitation_tokens (created_by_user_id);
create index if not exists agency_members_token_idx
  on public.agency_members (invitation_token_id);
create index if not exists agent_app_token_idx
  on public.agent_applications (invitation_token_id);
create index if not exists agent_app_reviewer_idx
  on public.agent_applications (reviewed_by_admin_id);
create index if not exists events_raw_agent_idx
  on public.events_raw (agent_id);
create index if not exists events_raw_video_idx
  on public.events_raw (property_video_id);
create index if not exists lead_origin_video_idx
  on public.lead_origin_properties (property_video_id);
create index if not exists likes_video_idx
  on public.likes (property_video_id);
create index if not exists property_reports_reporter_idx
  on public.property_reports (reported_by_user_id);
create index if not exists property_reports_reviewer_idx
  on public.property_reports (reviewed_by_admin_id);
