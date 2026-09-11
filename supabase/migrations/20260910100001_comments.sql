-- Migración 20260910100001 — comments: enum, tabla, properties.comment_count por trigger
-- atómico, RLS y grants (subtarea 289.2, tarea #289). Patrón heredado de
-- 20260701000001_engagement_count_triggers.sql (trigger SECURITY DEFINER search_path='',
-- GREATEST(0,...), backfill) + 20260828000005_user_reports.sql (grant mecánico de tabla
-- nueva: NO hereda el GRANT blanket de 0008/0014) + 20260807000004_lead_scoring.sql (DO
-- block para el enum idempotente).
--
-- 🔴 PRODUCCIÓN VIVA (§0.5): aditivo puro, sin riesgo.
--   · Tabla nueva (comments) — nada que romper para clientes vivos.
--   · properties.comment_count se agrega AL FINAL de la lista de columnas (POS1 del test):
--     un `select('*')` de un build instalado (que no conoce la columna) no se desordena.
--   · Sin DROP, sin pérdida de datos, sin revoke de un grant que un cliente vivo use.
--   · Idempotente: DO block con pg_type para el enum, `create table if not exists`,
--     `add column if not exists`, `create or replace function`, `drop trigger/policy if
--     exists` antes de crear. Rollback 1:1 en supabase/migrations/rollbacks/.
--
-- ── Correcciones al plan (verificación empírica del test-author, ver header de
--    supabase/tests/112_comments_test.sql) que este archivo respeta ────────────────────────
-- (a) comments.user_id referencia public.users(id) on delete cascade — NO auth.users
--     (patrón de TODA tabla de contenido: property_reports/notifications/admin_actions/
--     events_raw/likes/saves/leads/properties.owner_user_id).
-- (b) <gestor> usa la expresión VIVA de properties_update tras #202
--     (20260904100001_suspension_congela_escritura.sql), NO private.can_manage_property()
--     (desactualizado — REUSO_CON_RESERVA nombrado en la bitácora, derivada
--     hardening(289.2)): el dueño exige membresía VIGENTE en la agencia de la propiedad;
--     el owner/admin de la agencia gestiona TODO sin verse afectado por la suspensión
--     individual del dueño.
--
-- ── private.is_property_comment_manager — por qué existe (no es especulativo) ──────────────
-- La expresión <gestor> de #202 se necesita en 2 policies de ESTE archivo (comments_select
-- y comments_update): duplicarla inline sería la MISMA violación de Duplicated Code que
-- can_manage_property() ya arrastra (diverge de properties_update sin que nadie lo note).
-- Se centraliza aquí, vía subquery a properties por comments.property_id (patrón
-- private.owns_property / private.property_is_public de 0010: STABLE SECURITY DEFINER,
-- (select auth.uid())). Nombre distinto de private.can_manage_property a propósito — no se
-- toca ese helper (10 policies lo usan, fuera del footprint de esta subtarea).
--
-- Tests: supabase/tests/112_comments_test.sql (83 asserts).
-- Rollback: supabase/migrations/rollbacks/20260910100001_comments.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Enum comment_status (DO block, patrón 0001/20260807000004)
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'comment_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.comment_status as enum ('visible', 'held_for_review', 'hidden', 'deleted');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Tabla public.comments
-- ════════════════════════════════════════════════════════════════════════════
-- CHECK del body: \S (no trim() — lección 220.1, trim() solo recorta espacio ASCII y deja
-- pasar tabs/saltos de línea) + longitud máxima 500. La columna ya es NOT NULL, así que un
-- INSERT con body NULL lanza 23502 (violación de NOT NULL) antes de llegar al CHECK — no
-- hace falta repetir "body is not null" dentro del CHECK (CHK1 del test lo ancla).
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  body        text not null check (body ~ '\S' and length(body) <= 500),
  status      public.comment_status not null default 'visible',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.comments is
  'Comentarios de usuarios sobre una propiedad. status controla visibilidad '
  '(visible/held_for_review/hidden/deleted); solo status=visible cuenta en '
  'properties.comment_count (trigger public.update_comment_count). Sin policy de INSERT '
  'para authenticated: la EF de moderación de comentarios escribe con service_role '
  '(subtarea 289.x, fuera del footprint de esta migración).';

-- Lista paginada por propiedad, filtrada por status, ordenada por fecha (patrón pedido
-- por el plan registrado de la subtarea).
create index if not exists comments_property_status_created_idx
  on public.comments (property_id, status, created_at desc);

-- ponytail: sin trigger set_updated_at aquí (a diferencia de property_reports/user_reports)
-- -- public.set_updated_at() NO es SECURITY DEFINER y rompería SECDEF1 (el test exige que
-- TODOS los triggers no-internos de comments sean SECURITY DEFINER, catálogo puro vía
-- pg_trigger/pg_proc). Ningún caso de RED ejercita updated_at en UPDATE (solo created_at/
-- updated_at como columnas NOT NULL con default). Techo: si una EF futura necesita
-- actualizar updated_at en cambios de status, se hace explícito en esa misma función
-- SECURITY DEFINER (update_comment_count), no con un segundo trigger genérico.

-- ════════════════════════════════════════════════════════════════════════════
-- 3) properties.comment_count — AL FINAL de la tabla (select('*') de builds instalados)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.properties
  add column if not exists comment_count integer not null default 0;

comment on column public.properties.comment_count is
  'Contador denormalizado de comentarios status=visible (subtarea 289.2). Mantenido por '
  'el trigger public.update_comment_count sobre public.comments. Agregada AL FINAL de la '
  'tabla a propósito: no desordena select(*) de builds instalados que ya la ignoran.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Trigger atómico de comment_count — mismo patrón que update_like_count/
--    update_save_count (20260701000001): SECURITY DEFINER, search_path='', referencias
--    public. calificadas, GREATEST(0,...) contra decrementos concurrentes/inconsistentes.
--    Cuenta SOLO status='visible'; AFTER INSERT OR DELETE OR UPDATE OF status (acotado a
--    esa columna -- TRIGDEF3 del test -- el body no puede mutar comment_count).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.update_comment_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'visible' then
      update public.properties set comment_count = comment_count + 1 where id = NEW.property_id;
    end if;
  elsif TG_OP = 'UPDATE' then
    if OLD.status = 'visible' and NEW.status <> 'visible' then
      update public.properties set comment_count = GREATEST(0, comment_count - 1) where id = NEW.property_id;
    elsif OLD.status <> 'visible' and NEW.status = 'visible' then
      update public.properties set comment_count = comment_count + 1 where id = NEW.property_id;
    end if;
  elsif TG_OP = 'DELETE' then
    if OLD.status = 'visible' then
      update public.properties set comment_count = GREATEST(0, comment_count - 1) where id = OLD.property_id;
    end if;
  end if;
  return null;
end;
$$;

comment on function public.update_comment_count() is
  'AFTER INSERT OR DELETE OR UPDATE OF status en public.comments: mantiene '
  'properties.comment_count sincronizado, contando solo status=visible. SECURITY DEFINER '
  'necesario: el UPDATE de properties requiere ser gestor (RLS) pero quien comenta puede '
  'ser cualquier usuario autenticado con acceso de lectura a la propiedad.';

drop trigger if exists trg_comment_count on public.comments;
create trigger trg_comment_count
  after insert or delete or update of status on public.comments
  for each row execute function public.update_comment_count();

-- Backfill idempotente: recomputa comment_count de TODAS las propiedades a partir del
-- conteo real de comments.status='visible'. Sobre datos de producción (comments es tabla
-- nueva, 0 filas hasta que este archivo despliegue) es un no-op seguro; se ejecuta igual
-- por consistencia con el patrón de 20260701000001 y para que un re-run manual del backfill
-- (tras un bug de trigger) sea siempre correcto.
update public.properties p
   set comment_count = (
     select count(*)::int from public.comments c
      where c.property_id = p.id and c.status = 'visible'
   );

-- ════════════════════════════════════════════════════════════════════════════
-- 5) RLS — helper private.is_property_comment_manager + policies select/update
-- ════════════════════════════════════════════════════════════════════════════
alter table public.comments enable row level security;

-- <gestor> de comments (ver nota de cabecera): forma VIVA de properties_update tras #202,
-- vía subquery a properties por p_property_id. STABLE SECURITY DEFINER + (select auth.uid())
-- -- mismo patrón que private.owns_property/private.property_is_public (0010).
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

grant execute on function private.is_property_comment_manager(uuid) to authenticated;

-- SELECT: visible para cualquier authenticated; el autor ve lo suyo en cualquier status;
-- el gestor de la propiedad ve todo. Sin policy anon (la tabla no tiene GRANT a anon).
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated
  using (
    status = 'visible'
    or user_id = (select auth.uid())
    or private.is_property_comment_manager(property_id)
  );

-- UPDATE (status-only, ver grants §6): el gestor alterna libremente entre cualquier status;
-- el autor SOLO puede pasar su propio comentario a 'deleted' (WITH CHECK — el USING solo ve
-- la fila VIEJA, así que "autor solo -> deleted" vive en el WITH CHECK y por eso un intento
-- de autor->hidden LANZA 42501 en vez de devolver 0 filas, ver UPD5 del test).
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated
  using (
    private.is_property_comment_manager(property_id)
    or user_id = (select auth.uid())
  )
  with check (
    private.is_property_comment_manager(property_id)
    or (user_id = (select auth.uid()) and status = 'deleted')
  );

-- Sin comments_insert (la EF de moderación escribe con service_role) ni comments_delete
-- (DELETE queda negado a todos: sin grant de tabla, sin policy -- 42501 real).

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Grants (mecánico -- tabla nueva NO hereda el GRANT blanket de 0008/0014, patrón
--    documentado en 20260809000004/20260828000005). UPDATE column-level (solo `status`):
--    comments_update es status-only y ningún actor (ni el gestor) puede tocar el body vía
--    UPDATE (UPD9 del test) -- el mecanismo es la ausencia de GRANT UPDATE sobre esa
--    columna, no un trigger que lo bloquee. service_role recibe DML completo vía las
--    ALTER DEFAULT PRIVILEGES de 20260604000014 (tabla nueva creada por el mismo rol de
--    migración) -- sin grant explícito aquí, igual que 20260828000005_user_reports.sql.
-- ════════════════════════════════════════════════════════════════════════════
revoke all on public.comments from anon, authenticated;
grant select on public.comments to authenticated;
grant update (status) on public.comments to authenticated;
