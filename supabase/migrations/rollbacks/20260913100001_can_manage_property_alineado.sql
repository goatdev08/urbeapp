-- Rollback: 20260913100001_can_manage_property_alineado.sql (subtarea 292.1, tarea #292).
-- Restaura byte a byte los cuerpos ANTERIORES de las dos funciones (create or replace,
-- idempotente):
--   · private.can_manage_property -- forma original de 20260604000010_security_perf_hardening.sql:66-75
--     (sin comment on function: esa migración nunca le puso uno).
--   · private.is_property_comment_manager -- forma original de 20260910100001_comments.sql:164-186
--     (con su comment on function original, incluida la nota "Deliberadamente distinto de
--     private.can_manage_property").
--
-- Aditivo (create or replace), sin pérdida de datos. Ejecutar con:
--   docker exec -i supabase_db_urbea-app psql -U postgres -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/rollbacks/20260913100001_can_manage_property_alineado.sql

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

comment on function private.can_manage_property(uuid) is null;

create or replace function private.is_property_comment_manager(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties p
    where p.id = p_property_id
      and (
        (p.owner_user_id = (select auth.uid())
         and (p.agency_id is null or private.agency_role_of(p.agency_id) is not null))
        or private.agency_role_of(p.agency_id) in ('owner', 'admin')
        or private.is_admin()
      )
  );
$$;

comment on function private.is_property_comment_manager(uuid) is
  'RLS (comments, #289.2): true si el usuario autenticado es GESTOR de comentarios de '
  'p_property_id -- dueño CON membresía vigente en la agencia de la fila (si tiene '
  'agencia), o owner/admin de esa agencia, o admin de plataforma. Forma VIVA de '
  'properties_update tras #202 (20260904100001): un dueño SUSPENDIDO pierde el poder de '
  'gestor sobre SU propia propiedad, pero el owner/admin de la agencia lo conserva. '
  'Deliberadamente distinto de private.can_manage_property (desactualizado -- le falta la '
  'rama agency_role_of=admin y la exigencia de membresía vigente -- REUSO_CON_RESERVA '
  'nombrado en la bitácora de 289.2, no se toca en este footprint).';
