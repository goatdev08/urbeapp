-- Migración 20260805000003 — matriz de permisos por rol de agencia (subtarea 71.2)
-- PRD §4.10: owner=todo sobre su agencia; admin=gestión delegada (agency_members,
-- properties) sin tocar `agencies` ni la fila del owner; agent=sin cambios; viewer=solo
-- SELECT, cero escritura. Requiere que 20260805000002 ya haya committeado los valores
-- 'admin'/'viewer' del enum (corre después, migración separada por el ADD VALUE gotcha).
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1) Helpers (schema private, SECURITY DEFINER STABLE, patrón 0010 / 20260702000001 /
--    20260805000001): agency_role_of es el SEAM mínimo pedido por el RED; el resto de
--    la lógica de la matriz vive en cómo las políticas lo componen.
-- ════════════════════════════════════════════════════════════════════════════

-- Rol ACTIVO del usuario autenticado en una agencia dada, o NULL si no es miembro activo.
create or replace function private.agency_role_of(p_agency_id uuid)
returns agency_member_role language sql stable security definer set search_path = public as $$
  select member_role from public.agency_members
  where agency_id = p_agency_id
    and user_id = (select auth.uid())
    and status = 'active'
  limit 1;
$$;

comment on function private.agency_role_of(uuid) is
  'RLS: rol ACTIVO ((select auth.uid())) del usuario en la agencia p_agency_id, o NULL si '
  'no es miembro activo. SEAM mínimo de la matriz de permisos PRD §4.10 (subtarea 71.2). '
  'GRANT EXECUTE explícito solo a authenticated (mismo criterio que private.is_premium). '
  'OJO: por el default de Postgres (EXECUTE a PUBLIC) anon HOY puede ejecutarla igual — '
  'hueco de familia registrado en la tarea #96 (REVOKE FROM PUBLIC pendiente). Aun así las '
  'políticas que la usan van en una policy adicional scoped a authenticated, nunca en la '
  'policy anon+authenticated existente, para no acoplar lecturas públicas a este helper.';

grant execute on function private.agency_role_of(uuid) to authenticated;

-- Compone la regla "quién puede escribir una fila de agency_members" (INSERT/UPDATE/DELETE):
-- el owner de la agencia (manages_agency) siempre puede; un admin de la agencia puede
-- EXCEPTO sobre una fila cuyo member_role sea (o vaya a ser) 'owner' -- así se bloquea en
-- un solo lugar tanto "tocar la fila del owner" (USING, p_member_role = fila vieja) como
-- "promover a owner" (WITH CHECK, p_member_role = fila nueva); el admin_global sigue
-- pasando por private.is_admin(). Reusado en 4 políticas (insert/update-using/update-check/
-- delete) -- se centraliza aquí para no repetir la expresión (patrón private.can_manage_property).
create or replace function private.can_manage_agency_member(p_agency_id uuid, p_member_role agency_member_role)
returns boolean language sql stable security definer set search_path = public as $$
  select
    private.manages_agency(p_agency_id)
    or (private.agency_role_of(p_agency_id) = 'admin' and p_member_role <> 'owner')
    or private.is_admin();
$$;

comment on function private.can_manage_agency_member(uuid, agency_member_role) is
  'RLS: true si el usuario autenticado puede escribir (insert/update/delete) una fila de '
  'agency_members con member_role=p_member_role en la agencia p_agency_id -- owner de la '
  'agencia (todo) o admin de la agencia (todo EXCEPTO filas owner, ni promover a owner) o '
  'admin global. p_member_role es la fila vieja en USING, la fila nueva en WITH CHECK.';

grant execute on function private.can_manage_agency_member(uuid, agency_member_role) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) agency_members: admin gestiona (excepto la fila owner / promover a owner);
--    viewer y admin ganan SELECT de los miembros de su agencia.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists members_select on public.agency_members;
create policy members_select on public.agency_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.manages_agency(agency_id)
    or private.agency_role_of(agency_id) in ('admin', 'viewer')
    or private.is_admin()
  );

drop policy if exists members_insert on public.agency_members;
create policy members_insert on public.agency_members for insert to authenticated
  with check (private.can_manage_agency_member(agency_id, member_role));

drop policy if exists members_update on public.agency_members;
create policy members_update on public.agency_members for update to authenticated
  using (private.can_manage_agency_member(agency_id, member_role))
  with check (private.can_manage_agency_member(agency_id, member_role));

drop policy if exists members_delete on public.agency_members;
create policy members_delete on public.agency_members for delete to authenticated
  using (private.can_manage_agency_member(agency_id, member_role));

-- ════════════════════════════════════════════════════════════════════════════
-- 3) properties: owner de agencia y admin de agencia pueden UPDATE properties de
--    cualquier miembro de su agencia (delegación de gestión, PRD §4.10). Capacidad
--    NUEVA para el owner: HOY properties_update solo permitía owner_user_id=self o
--    is_admin() global (20260604000010) -- el owner de agencia no podía tocar
--    properties de sus agentes, pese a que la matriz dice "owner=todo sobre su
--    agencia". Ver header del RED (supabase/tests/21_..._test.sql, sección 31).
--
--    properties_select NO se toca: es `for ... to anon, authenticated`. Aunque hoy
--    anon puede ejecutar agency_role_of() vía el grant PUBLIC por default (deuda
--    tarea #96), cuando ese hardening aterrice (REVOKE FROM PUBLIC) una policy
--    anon que la referencie rompería CUALQUIER lectura anónima de properties draft
--    (Postgres evalúa el OR completo fila por fila cuando la primera cláusula no
--    basta para decidir). Se agrega una policy PERMISSIVE adicional, scoped SOLO a
--    authenticated, que Postgres combina con OR sobre la policy existente.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (
    owner_user_id = (select auth.uid())
    or private.is_agency_owner_of(owner_user_id)
    or private.agency_role_of(agency_id) = 'admin'
    or private.is_admin()
  )
  with check (
    owner_user_id = (select auth.uid())
    or private.is_agency_owner_of(owner_user_id)
    or private.agency_role_of(agency_id) = 'admin'
    or private.is_admin()
  );

drop policy if exists properties_select_agency_role on public.properties;
create policy properties_select_agency_role on public.properties for select to authenticated
  using (private.agency_role_of(agency_id) in ('admin', 'viewer'));
