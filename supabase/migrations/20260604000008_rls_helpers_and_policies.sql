-- Migración 0008 — RLS: funciones helper, habilitación y políticas (bloque revisable)
-- Propósito: RLS como SEGUNDA capa de seguridad (lineamientos §2/§8). La autorización fina
-- vivirá en Edge Functions; aquí dejamos políticas correctas + grants a nivel de columna para
-- bloquear escalación de privilegios incluso si el cliente accede a las tablas directamente.
--
-- Convenciones: helpers SECURITY DEFINER STABLE (corren como owner -> evitan recursión de RLS).
-- Políticas idempotentes vía "drop policy if exists" previo a cada "create policy".

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Funciones helper
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.current_user_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid() and deleted_at is null;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

create or replace function public.manages_agency(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency_id
      and m.user_id = auth.uid()
      and m.member_role = 'owner'
      and m.status = 'active'
  );
$$;

create or replace function public.is_agency_owner_of(p_target_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.agency_members owner_m
    join public.agency_members agent_m on agent_m.agency_id = owner_m.agency_id
    where owner_m.user_id = auth.uid()
      and owner_m.member_role = 'owner'
      and owner_m.status = 'active'
      and agent_m.user_id = p_target_user_id
      and agent_m.status = 'active'
  );
$$;

create or replace function public.current_user_agency_id()
returns uuid language sql stable security definer set search_path = public as $$
  select agency_id from public.agency_members
  where user_id = auth.uid() and status = 'active' limit 1;
$$;

create or replace function public.owns_property(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties
    where id = p_property_id and owner_user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_property(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties pr
    where pr.id = p_property_id
      and (pr.owner_user_id = auth.uid()
           or public.is_agency_owner_of(pr.owner_user_id)
           or public.is_admin())
  );
$$;

create or replace function public.property_is_public(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties
    where id = p_property_id and status = 'active' and deleted_at is null
  );
$$;

create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (l.agent_id = auth.uid()
           or public.is_agency_owner_of(l.agent_id)
           or public.is_admin())
  );
$$;

create or replace function public.can_edit_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id and (l.agent_id = auth.uid() or public.is_admin())
  );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Habilitar RLS en todas las tablas
-- ════════════════════════════════════════════════════════════════════════════
alter table public.users                     enable row level security;
alter table public.user_preferences          enable row level security;
alter table public.terms_versions            enable row level security;
alter table public.user_consents             enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.agencies                  enable row level security;
alter table public.agency_members            enable row level security;
alter table public.agency_invitation_tokens  enable row level security;
alter table public.agent_applications        enable row level security;
alter table public.agent_interest_submissions enable row level security;
alter table public.properties                enable row level security;
alter table public.property_videos           enable row level security;
alter table public.likes                     enable row level security;
alter table public.saves                     enable row level security;
alter table public.leads                     enable row level security;
alter table public.lead_origin_properties    enable row level security;
alter table public.events_raw                enable row level security;
alter table public.property_reports          enable row level security;
alter table public.notifications             enable row level security;
alter table public.admin_actions             enable row level security;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Políticas
-- ════════════════════════════════════════════════════════════════════════════

-- ── users ───────────────────────────────────────────────────────────────────
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.is_agency_owner_of(id)
    or (role = 'agent' and deleted_at is null and is_verified_agent = true)  -- perfil público de agente
  );
-- INSERT lo hace el trigger handle_new_user (SECURITY DEFINER) -> sin policy de cliente.
drop policy if exists users_update on public.users;
create policy users_update on public.users for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
drop policy if exists users_delete on public.users;
create policy users_delete on public.users for delete to authenticated
  using (public.is_admin());

-- ── user_preferences ────────────────────────────────────────────────────────
drop policy if exists user_prefs_select on public.user_preferences;
create policy user_prefs_select on public.user_preferences for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists user_prefs_insert on public.user_preferences;
create policy user_prefs_insert on public.user_preferences for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists user_prefs_update on public.user_preferences;
create policy user_prefs_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists user_prefs_delete on public.user_preferences;
create policy user_prefs_delete on public.user_preferences for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ── terms_versions (lectura pública; escritura admin) ───────────────────────
drop policy if exists terms_select on public.terms_versions;
create policy terms_select on public.terms_versions for select to anon, authenticated
  using (true);
drop policy if exists terms_write on public.terms_versions;
create policy terms_write on public.terms_versions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── user_consents (inmutable: solo SELECT/INSERT) ───────────────────────────
drop policy if exists consents_select on public.user_consents;
create policy consents_select on public.user_consents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists consents_insert on public.user_consents;
create policy consents_insert on public.user_consents for insert to authenticated
  with check (user_id = auth.uid());

-- ── account_deletion_requests ───────────────────────────────────────────────
drop policy if exists deletion_select on public.account_deletion_requests;
create policy deletion_select on public.account_deletion_requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists deletion_insert on public.account_deletion_requests;
create policy deletion_insert on public.account_deletion_requests for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists deletion_update on public.account_deletion_requests;
create policy deletion_update on public.account_deletion_requests for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists deletion_delete on public.account_deletion_requests;
create policy deletion_delete on public.account_deletion_requests for delete to authenticated
  using (public.is_admin());

-- ── agencies ────────────────────────────────────────────────────────────────
drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies for select to anon, authenticated
  using (
    (status in ('approved', 'active') and deleted_at is null)
    or created_by_user_id = auth.uid()
    or public.manages_agency(id)
    or public.is_admin()
  );
drop policy if exists agencies_insert on public.agencies;
create policy agencies_insert on public.agencies for insert to authenticated
  with check (created_by_user_id = auth.uid());
drop policy if exists agencies_update on public.agencies;
create policy agencies_update on public.agencies for update to authenticated
  using (public.manages_agency(id) or public.is_admin())
  with check (public.manages_agency(id) or public.is_admin());
drop policy if exists agencies_delete on public.agencies;
create policy agencies_delete on public.agencies for delete to authenticated
  using (public.is_admin());

-- ── agency_members ──────────────────────────────────────────────────────────
drop policy if exists members_select on public.agency_members;
create policy members_select on public.agency_members for select to authenticated
  using (user_id = auth.uid() or public.manages_agency(agency_id) or public.is_admin());
drop policy if exists members_insert on public.agency_members;
create policy members_insert on public.agency_members for insert to authenticated
  with check (public.manages_agency(agency_id) or public.is_admin());
drop policy if exists members_update on public.agency_members;
create policy members_update on public.agency_members for update to authenticated
  using (public.manages_agency(agency_id) or public.is_admin())
  with check (public.manages_agency(agency_id) or public.is_admin());
drop policy if exists members_delete on public.agency_members;
create policy members_delete on public.agency_members for delete to authenticated
  using (public.is_admin());

-- ── agency_invitation_tokens (nunca público; token es hash) ─────────────────
drop policy if exists tokens_select on public.agency_invitation_tokens;
create policy tokens_select on public.agency_invitation_tokens for select to authenticated
  using (public.manages_agency(agency_id) or public.is_admin());
drop policy if exists tokens_insert on public.agency_invitation_tokens;
create policy tokens_insert on public.agency_invitation_tokens for insert to authenticated
  with check ((public.manages_agency(agency_id) and created_by_user_id = auth.uid()) or public.is_admin());
drop policy if exists tokens_update on public.agency_invitation_tokens;
create policy tokens_update on public.agency_invitation_tokens for update to authenticated
  using (public.manages_agency(agency_id) or public.is_admin())
  with check (public.manages_agency(agency_id) or public.is_admin());
drop policy if exists tokens_delete on public.agency_invitation_tokens;
create policy tokens_delete on public.agency_invitation_tokens for delete to authenticated
  using (public.is_admin());

-- ── agent_applications ──────────────────────────────────────────────────────
drop policy if exists agent_app_select on public.agent_applications;
create policy agent_app_select on public.agent_applications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists agent_app_insert on public.agent_applications;
create policy agent_app_insert on public.agent_applications for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists agent_app_update on public.agent_applications;
create policy agent_app_update on public.agent_applications for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists agent_app_delete on public.agent_applications;
create policy agent_app_delete on public.agent_applications for delete to authenticated
  using (public.is_admin());

-- ── agent_interest_submissions (landing pública: INSERT anon) ───────────────
drop policy if exists interest_insert on public.agent_interest_submissions;
create policy interest_insert on public.agent_interest_submissions for insert to anon, authenticated
  with check (true);
drop policy if exists interest_select on public.agent_interest_submissions;
create policy interest_select on public.agent_interest_submissions for select to authenticated
  using (public.is_admin());
drop policy if exists interest_update on public.agent_interest_submissions;
create policy interest_update on public.agent_interest_submissions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists interest_delete on public.agent_interest_submissions;
create policy interest_delete on public.agent_interest_submissions for delete to authenticated
  using (public.is_admin());

-- ── properties ──────────────────────────────────────────────────────────────
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select to anon, authenticated
  using (
    (status = 'active' and deleted_at is null)         -- público
    or owner_user_id = auth.uid()                      -- dueño (cualquier estado)
    or public.is_agency_owner_of(owner_user_id)        -- owner de su inmobiliaria
    or public.is_admin()
  );
drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert to authenticated
  with check (owner_user_id = auth.uid() and public.current_user_role() in ('agent', 'admin'));
drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (owner_user_id = auth.uid() or public.is_admin())
  with check (owner_user_id = auth.uid() or public.is_admin());
drop policy if exists properties_delete on public.properties;
create policy properties_delete on public.properties for delete to authenticated
  using (owner_user_id = auth.uid() or public.is_admin());

-- ── property_videos ─────────────────────────────────────────────────────────
drop policy if exists videos_select on public.property_videos;
create policy videos_select on public.property_videos for select to anon, authenticated
  using (
    (status = 'ready' and deleted_at is null and public.property_is_public(property_id))  -- público
    or public.can_manage_property(property_id)                                            -- dueño/owner/admin
  );
drop policy if exists videos_insert on public.property_videos;
create policy videos_insert on public.property_videos for insert to authenticated
  with check (public.owns_property(property_id) or public.is_admin());
drop policy if exists videos_update on public.property_videos;
create policy videos_update on public.property_videos for update to authenticated
  using (public.can_manage_property(property_id))
  with check (public.can_manage_property(property_id));
drop policy if exists videos_delete on public.property_videos;
create policy videos_delete on public.property_videos for delete to authenticated
  using (public.owns_property(property_id) or public.is_admin());

-- ── likes ────────────────────────────────────────────────────────────────────
drop policy if exists likes_select on public.likes;
create policy likes_select on public.likes for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists likes_insert on public.likes;
create policy likes_insert on public.likes for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists likes_delete on public.likes;
create policy likes_delete on public.likes for delete to authenticated
  using (user_id = auth.uid());

-- ── saves ────────────────────────────────────────────────────────────────────
drop policy if exists saves_select on public.saves;
create policy saves_select on public.saves for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists saves_insert on public.saves;
create policy saves_insert on public.saves for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists saves_delete on public.saves;
create policy saves_delete on public.saves for delete to authenticated
  using (user_id = auth.uid());

-- ── leads (el buscador user_id NO ve el lead) ───────────────────────────────
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (agent_id = auth.uid() or public.is_agency_owner_of(agent_id) or public.is_admin());
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated
  with check (agent_id = auth.uid() or public.is_admin());
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (agent_id = auth.uid() or public.is_admin())
  with check (agent_id = auth.uid() or public.is_admin());
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (agent_id = auth.uid() or public.is_admin());

-- ── lead_origin_properties ──────────────────────────────────────────────────
drop policy if exists lead_origin_select on public.lead_origin_properties;
create policy lead_origin_select on public.lead_origin_properties for select to authenticated
  using (public.can_view_lead(lead_id));
drop policy if exists lead_origin_insert on public.lead_origin_properties;
create policy lead_origin_insert on public.lead_origin_properties for insert to authenticated
  with check (public.can_edit_lead(lead_id));
drop policy if exists lead_origin_delete on public.lead_origin_properties;
create policy lead_origin_delete on public.lead_origin_properties for delete to authenticated
  using (public.is_admin());

-- ── events_raw: SIN políticas -> solo service_role (RLS bloquea a anon/authenticated) ──

-- ── property_reports ────────────────────────────────────────────────────────
drop policy if exists reports_select on public.property_reports;
create policy reports_select on public.property_reports for select to authenticated
  using (reported_by_user_id = auth.uid() or public.is_admin());
drop policy if exists reports_insert on public.property_reports;
create policy reports_insert on public.property_reports for insert to authenticated
  with check (reported_by_user_id = auth.uid());
drop policy if exists reports_update on public.property_reports;
create policy reports_update on public.property_reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists reports_delete on public.property_reports;
create policy reports_delete on public.property_reports for delete to authenticated
  using (public.is_admin());

-- ── notifications (creadas por el notification service/service_role) ────────
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ── admin_actions (append-only: solo SELECT/INSERT admin) ───────────────────
drop policy if exists admin_actions_select on public.admin_actions;
create policy admin_actions_select on public.admin_actions for select to authenticated
  using (public.is_admin());
drop policy if exists admin_actions_insert on public.admin_actions;
create policy admin_actions_insert on public.admin_actions for insert to authenticated
  with check (public.is_admin() and admin_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Grants (RLS es la reja real; los grants son la primera puerta)
-- ════════════════════════════════════════════════════════════════════════════
grant usage on schema public to anon, authenticated;

-- authenticated: DML completo, RLS filtra filas
grant select, insert, update, delete on all tables in schema public to authenticated;

-- anon: solo lecturas públicas + alta del formulario de interesados
grant select on public.properties, public.property_videos, public.agencies, public.terms_versions to anon;
grant insert on public.agent_interest_submissions to anon;

-- Column-level: impedir escalación de privilegios vía escritura directa a la tabla.
-- users: el cliente NO puede tocar role / agency_id / is_verified_agent / email.
revoke update on public.users from authenticated;
grant update (first_name, last_name, phone, bio, avatar_url, city, state,
              date_of_birth, last_login_at, deleted_at, deletion_pending_at)
  on public.users to authenticated;

-- agencies: el owner NO puede auto-aprobar (status) ni reasignar created_by/approved_by.
revoke update on public.agencies from authenticated;
grant update (name, slug, logo_url, contact_name, contact_phone, contact_email, deleted_at)
  on public.agencies to authenticated;

-- notifications: el usuario solo marca leída / la borra (no edita contenido).
revoke update on public.notifications from authenticated;
grant update (read_at, deleted_at) on public.notifications to authenticated;

-- Tablas internas: nunca accesibles desde el cliente (defensa en profundidad).
revoke all on public.events_raw from anon, authenticated;
