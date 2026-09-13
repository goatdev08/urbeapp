-- Migración 20260914100001 — follows: tabla, users.follower_count por trigger atómico,
-- RLS y agent_public_profiles ampliada con follower_count (subtarea 78.1, tarea #78 «follow
-- de cuentas F1», doc 048).
--
-- Patrón heredado: 20260701000001_engagement_count_triggers.sql (trigger de conteo
-- SECURITY DEFINER, search_path='', GREATEST(0,...) contra decrementos concurrentes,
-- backfill idempotente) + 20260905200003_identidad_publica_todos_los_roles.sql
-- (CREATE OR REPLACE VIEW agent_public_profiles, security_invoker=false, columna nueva
-- AL FINAL) + 20260910100001_comments.sql (RLS con helper en `private`, grants mecánicos
-- explícitos porque la tabla es nueva).
--
-- ── Decisión de producto (doc 048) ──────────────────────────────────────────────────
-- Cualquier publicador con perfil público (no solo agentes) puede ser seguido. El
-- agente/publicador ve SOLO el CONTEO de seguidores (follower_count, vía
-- agent_public_profiles) — NUNCA la lista de quién lo sigue. Por eso follows_select
-- solo abre la fila al PROPIO follower (o al admin de plataforma): un publicador no
-- puede leer follows para enumerar a sus seguidores por esta tabla.
--
-- 🔴 PRODUCCIÓN VIVA (§0.5): aditivo puro.
--   · Tabla nueva (follows) — nada que romper para clientes vivos.
--   · users.follower_count se agrega AL FINAL de la tabla (ADD COLUMN IF NOT EXISTS):
--     un `select('*')` de un build instalado que no conoce la columna no se desordena.
--   · agent_public_profiles gana follower_count como ÚLTIMA columna (contrato ya
--     publicado #250/#254: los 5 consumidores actuales listan columnas explícitas,
--     ninguno hace `select('*')` sobre la vista — confirmado en el footprint de la
--     subtarea).
--   · Sin DROP, sin pérdida de datos, sin revoke de un grant que un cliente vivo use.
--   · Idempotente: `create table if not exists`, `add column if not exists`, DO block
--     para el CHECK (Postgres no soporta `add constraint if not exists`), `drop
--     trigger/policy if exists` antes de crear, `create or replace` en función y vista.
--
-- Tests: supabase/tests/117_follows_test.sql (53 asserts).
-- Rollback: supabase/migrations/rollbacks/20260914100001_follows.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Tabla public.follows
-- ════════════════════════════════════════════════════════════════════════════
-- PK compuesta (follower_user_id, followed_user_id): un follow es único por par —
-- la unicidad la impone la PK, no un índice adicional; la idempotencia (evitar el
-- 23505 de un doble follow) la resuelve el cliente/EF, no esta tabla.
create table if not exists public.follows (
  follower_user_id uuid not null references public.users (id) on delete cascade,
  followed_user_id uuid not null references public.users (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (follower_user_id, followed_user_id),
  constraint follows_no_self check (follower_user_id <> followed_user_id)
);

comment on table public.follows is
  'Follow de cuentas (#78, doc 048): follower_user_id sigue a followed_user_id. Cascade '
  'en ambas FKs — borrar un usuario borra tanto sus follows hechos como los recibidos. '
  'Mantiene public.users.follower_count vía el trigger public.update_follower_count(). '
  'Sin policy de UPDATE: un follow se crea o se borra, nunca se edita.';

-- Índice sobre followed_user_id: es la columna que filtra el backfill de
-- follower_count (§3) y cualquier consulta futura de "quién sigue a X" desde el propio
-- publicador (fuera del footprint de esta subtarea, pero la ruta de acceso ya existe).
create index if not exists follows_followed_user_id_idx
  on public.follows (followed_user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.users.follower_count — AL FINAL de la tabla
-- ════════════════════════════════════════════════════════════════════════════
alter table public.users
  add column if not exists follower_count integer not null default 0;

comment on column public.users.follower_count is
  'Contador denormalizado de seguidores (#78). Mantenido por el trigger '
  'public.update_follower_count() sobre public.follows. El publicador ve SOLO este '
  'conteo (vía agent_public_profiles), nunca la lista de sus seguidores.';

-- CHECK idempotente (Postgres no soporta `add constraint if not exists`, patrón de
-- 20260816000003_advertiser_category_required.sql).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_follower_count_no_negativo'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_follower_count_no_negativo check (follower_count >= 0);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Trigger atómico de follower_count — mismo patrón que update_like_count/
--    update_save_count/update_comment_count: SECURITY DEFINER (el UPDATE de users
--    requiere ser el propio dueño de la fila por RLS 0008, pero quien sigue a alguien
--    es cualquier otro usuario autenticado), search_path='' + referencias public.
--    calificadas, GREATEST(0,...) contra decrementos concurrentes/inconsistentes.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.update_follower_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    update public.users
       set follower_count = follower_count + 1
     where id = NEW.followed_user_id;
  elsif TG_OP = 'DELETE' then
    update public.users
       set follower_count = GREATEST(0, follower_count - 1)
     where id = OLD.followed_user_id;
  end if;
  return null;
end;
$$;

comment on function public.update_follower_count() is
  'AFTER INSERT OR DELETE en public.follows: mantiene users.follower_count '
  'sincronizado. SECURITY DEFINER necesario: el UPDATE de users requiere ser el propio '
  'usuario (RLS 0008) pero quien sigue/deja de seguir es otra persona.';

drop trigger if exists trg_follower_count on public.follows;
create trigger trg_follower_count
  after insert or delete on public.follows
  for each row execute function public.update_follower_count();

-- Backfill idempotente: recomputa follower_count de TODOS los usuarios a partir del
-- conteo real de follows. Sobre datos de producción (follows es tabla nueva, 0 filas
-- hasta que este archivo despliegue) es un no-op seguro; se ejecuta igual por
-- consistencia con el patrón de 20260701000001/20260910100001 y para que un re-run
-- manual (tras un bug de trigger) sea siempre correcto.
update public.users u
   set follower_count = (
     select count(*)::int from public.follows f
      where f.followed_user_id = u.id
   );

-- ════════════════════════════════════════════════════════════════════════════
-- 4) RLS — follows_select / follows_insert / follows_delete (sin UPDATE)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.follows enable row level security;

-- SELECT: cada quien ve SOLO los follows que ÉL hizo (follower_user_id propio) o el
-- admin de plataforma ve todos. A propósito NO se abre por followed_user_id: el
-- publicador ve su conteo por agent_public_profiles, nunca la lista de quién lo sigue
-- (doc 048).
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select to authenticated
  using (follower_user_id = (select auth.uid()) or private.is_admin());

-- INSERT: nadie puede crear un follow a nombre de otro (WITH CHECK, no USING —
-- un INSERT no tiene fila vieja que evaluar).
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert to authenticated
  with check (follower_user_id = (select auth.uid()));

-- DELETE: cada quien borra SOLO su propio follow (dejar de seguir). Sin rama de
-- admin: un follow no es contenido que moderar (doc 048); si algún día hace falta,
-- entra con su test (guardian 78.1: la rama sin cobertura sobrevivía al mutante).
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated
  using (follower_user_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Grants (mecánico — tabla nueva NO hereda el GRANT blanket de 0008/0014, patrón de
--    20260828000005_user_reports.sql/20260910100001_comments.sql). Sin UPDATE: un follow
--    se crea o se borra, nunca se edita. anon sin ningún privilegio.
-- ════════════════════════════════════════════════════════════════════════════
revoke all on public.follows from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) agent_public_profiles + follower_count AL FINAL (contrato ya publicado)
-- ════════════════════════════════════════════════════════════════════════════
-- Copia literal de la definición vigente (20260905200003) + follower_count como
-- ÚLTIMA columna. El join a public.users ya es INNER (todo user_preferences.user_id
-- referencia una fila real de users con follower_count NOT NULL DEFAULT 0) — no hace
-- falta coalesce.
create or replace view public.agent_public_profiles
with (security_invoker = false) as
  select up.user_id,
         up.full_name,
         up.profile_photo_url,
         (u.phone is not null) as has_phone,
         u.follower_count
  from public.user_preferences up
  join public.users u on u.id = up.user_id;

comment on view public.agent_public_profiles is
  'Identidad pública de CUALQUIER usuario (nombre + foto R2 key + has_phone derivado + '
  'follower_count) legible por cualquier sesión autenticada. Brinca la RLS de '
  'user_preferences/users SOLO en estas columnas (#145, #250, #254, #78). El teléfono '
  'crudo NO sale de aquí (has_phone decide el botón de WhatsApp, la EF contact-agent '
  'resuelve el número); la LISTA de seguidores tampoco (#78: solo el conteo).';

-- Grants: CREATE OR REPLACE VIEW conserva los de 20260905200003, pero si la vista
-- no existiera (rollback previo) se recrearía sin ellos — se re-emiten para que la
-- migración sea autosuficiente (guardian 78.1). anon sigue sin acceso.
revoke all on public.agent_public_profiles from anon, public;
grant select on public.agent_public_profiles to authenticated;
