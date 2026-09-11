-- Migración 20260910200001 — comment_reports: dedupe, auto-ocultar 3/24h y RPC de
-- resolución atómica (subtarea 289.3, tarea #289). Calco de
-- 20260828000001_property_reports_other_requires_text.sql (CHECK other_requires_text) +
-- 20260828000002_property_reports_autosuspend.sql (trigger AFTER INSERT sin EXCEPTION) +
-- 20260828000004_resolve_property_reports_atomic.sql (RPC atómica) +
-- 20260828000005_user_reports.sql (grant mecánico de tabla nueva) +
-- 20260910100001_comments.sql (289.2, tabla comments/comment_count/gestor sobre la que
-- este archivo se apoya).
--
-- 🔴 PRODUCCIÓN VIVA (§0.5): aditivo puro, sin riesgo.
--   · Tabla nueva (comment_reports) — nada que romper para clientes vivos.
--   · Reusa el enum property_report_reason SIN tocarlo (sin ALTER TYPE, sin nuevo label).
--   · admin_actions.action_type es TEXT libre sin CHECK (verificado contra
--     20260604000007_analytics_moderation_audit.sql) — nada que ensanchar, los 3 literales
--     nuevos (comment_restore/comment_keep_hidden/comment_delete) entran sin migración.
--   · Sin DROP, sin pérdida de datos, sin revoke de un grant que un cliente vivo use.
--   · Idempotente: `create table if not exists`, `create or replace function`,
--     `drop trigger/policy if exists` antes de crear, `revoke ... ; grant ...` repetible.
--     Rollback 1:1 en supabase/migrations/rollbacks/.
--
-- Contrato completo (edge cases, decisiones (a)-(d), orden de guards de la RPC): ver
-- cabecera de supabase/tests/113_comment_reports_test.sql (96 asserts) — todas esas
-- decisiones ya estaban FIJADAS por el test-author; este archivo solo las implementa.
--
-- ── Resumen de las decisiones que este archivo respeta ──────────────────────────────────
-- (a) status es TEXT con CHECK IN ('new','resolved') — NO el enum property_report_status
--     (trae 'reviewing'/'dismissed' que este flujo no usa: el auto-ocultar decide solo y
--     la RPC resuelve directo). Ponytail: 2 estados reales, no 4 especulativos.
-- (b) "el autor no puede reportar su propio comentario" vive en el WITH CHECK de
--     comment_reports_insert (subquery a public.comments.user_id) — NUNCA un CHECK de
--     columna, porque la tabla no guarda el autor del comentario. Un intento del autor
--     lanza 42501 (RLS), no 23514. Inline (no un helper `private.*`): un solo consumidor,
--     duplicarlo no aplica (a diferencia de private.is_property_comment_manager de 289.2,
--     que sirve 2 policies).
-- (c) Trigger AFTER INSERT en comment_reports, SIN bloque EXCEPTION (calco textual de
--     20260828000002): lockea la fila de comments (`for update`), no-op si ya
--     hidden/deleted, si no cuenta reported_by_user_id DISTINTOS en la ventana de 24h
--     (incluye la fila recién insertada) → >=3 oculta. El trigger de 289.2
--     (trg_comment_count) hace el resto (decrementa properties.comment_count) — este
--     archivo NO duplica esa lógica, solo la dispara al mutar comments.status.
-- (d) resolve_comment_reports_atomic(p_comment_id, p_action, p_reason): SIN p_admin_id (a
--     diferencia de resolve_property_reports_atomic) — el actor es SIEMPRE auth.uid(), la
--     función se GRANTea a authenticated y el guard de admin vive DENTRO
--     (private.is_admin()), evaluado ANTES de resolver p_comment_id (no revela existencia a
--     un no-admin). Guard de origen status<>'hidden' → no-op total (retry-dedup + comentario
--     que nunca estuvo oculto). SIN bloque EXCEPTION: el fallo del INSERT de admin_actions
--     revierte TODO (status, comment_reports.status, comment_count vía 289.2).
--     🔴 Grants: revoke execute ... from public, anon ANTES de grant ... to authenticated
--     (Postgres otorga EXECUTE a PUBLIC por default en toda función nueva).
--
-- Tests: supabase/tests/113_comment_reports_test.sql (96 asserts).
-- Rollback: supabase/migrations/rollbacks/20260910200001_comment_reports.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Tabla public.comment_reports
-- ════════════════════════════════════════════════════════════════════════════
-- ponytail: sin reviewed_by_admin_id/reviewed_at/resolution (a diferencia de
-- property_reports/user_reports) -- techo: esos 3 campos existen ahí para alimentar una
-- cola de revisión manual leída directo de la tabla; acá la resolución es SOLO vía
-- resolve_comment_reports_atomic, que ya escribe ese mismo rastro (admin_id, reason,
-- created_at) en admin_actions -- duplicarlo en comment_reports sería la misma info dos
-- veces sin un lector que la necesite (96 asserts del RED no ejercitan ninguna). Se agregan
-- si una pantalla de cola futura los necesita leer directo de comment_reports.
create table if not exists public.comment_reports (
  id                   uuid primary key default gen_random_uuid(),
  comment_id           uuid not null references public.comments (id) on delete cascade,
  reported_by_user_id  uuid not null references public.users (id) on delete cascade,
  reason               property_report_reason not null,
  reason_text          text,
  status               text not null default 'new',
  created_at           timestamptz not null default now(),
  constraint comment_reports_other_requires_text
    check (reason <> 'other' or (reason_text is not null and reason_text ~ '\S')),
  constraint comment_reports_status_check
    check (status in ('new', 'resolved'))
);

comment on table public.comment_reports is
  'Reportes de un comentario (subtarea 289.3). Un usuario no reporta dos veces el mismo '
  'comentario (comment_reports_one_per_user) ni puede reportar el suyo propio (RLS, no '
  'CHECK — la tabla no guarda el autor). status TEXT (new/resolved), NO el enum '
  'property_report_status: el auto-ocultar (trigger check_comment_reports_autohide) decide '
  'solo y resolve_comment_reports_atomic resuelve directo, sin cola manual de revisión '
  'intermedia. Solo se muta vía el trigger o la RPC — sin policy de UPDATE/DELETE para '
  'nadie, ni siquiera admin.';

-- UNIQUE(comment_id, reported_by_user_id) como índice único suelto (patrón
-- property_reports_one_per_user / user_reports_one_per_user), no constraint nombrado.
create unique index if not exists comment_reports_one_per_user
  on public.comment_reports (comment_id, reported_by_user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Trigger AFTER INSERT — auto-ocultar 3 reportantes distintos / 24h (calco textual de
--    notify_property_report_and_autosuspend, 20260828000002, sin la parte de
--    notificaciones -- fuera del footprint de esta subtarea, decisión (c) de la cabecera).
--    SECURITY DEFINER: el reportante (REP1/REP2/REP3) no tiene privilegio UPDATE sobre
--    comments (comments_update exige ser gestor o autor->deleted, ninguno aplica aquí).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.check_comment_reports_autohide()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.comment_status;
  v_count  int;
begin
  -- Bloquea la fila del comentario (carrera entre reportes concurrentes) y lee su estado.
  select status into v_status
    from public.comments
   where id = new.comment_id
     for update;

  -- Ya oculto o borrado: no-op total (el reporte ya se persistió, este trigger corre
  -- AFTER INSERT, no hace falta tocar nada más).
  if v_status in ('hidden', 'deleted') then
    return new;
  end if;

  -- Ventana deslizante REAL de 24h por created_at, contando reported_by_user_id DISTINTOS
  -- (incluye la fila recién insertada, misma transacción, MVCC ve su propia escritura).
  select count(distinct reported_by_user_id)
    into v_count
    from public.comment_reports
   where comment_id = new.comment_id
     and created_at >= now() - interval '24 hours';

  if v_count >= 3 then
    update public.comments
       set status = 'hidden'
     where id = new.comment_id;
  end if;

  return new;
end;
$$;

comment on function public.check_comment_reports_autohide() is
  'AFTER INSERT en comment_reports (#289.3): ventana deslizante REAL de 24h por created_at, '
  'contando reported_by_user_id DISTINTOS -- al llegar a 3 oculta el comentario '
  '(comments.status=''hidden''). Comentario ya hidden/deleted = no-op total. El trigger de '
  '289.2 (trg_comment_count) decrementa properties.comment_count como efecto colateral de '
  'ese UPDATE -- esta función no lo duplica. Sin bloque EXCEPTION: cualquier fallo revierte '
  'el reporte entero.';

drop trigger if exists comment_reports_autohide on public.comment_reports;
create trigger comment_reports_autohide
  after insert on public.comment_reports
  for each row
  execute function public.check_comment_reports_autohide();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) RLS — insert propio (no autor), select propio o admin, sin update/delete para nadie.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.comment_reports enable row level security;

-- INSERT: reported_by_user_id = auth.uid() Y NO autor del comentario reportado (decisión
-- (b) de la cabecera) -- subquery a public.comments.user_id, un único consumidor por lo
-- que va inline, no como helper `private.*`.
drop policy if exists comment_reports_insert on public.comment_reports;
create policy comment_reports_insert on public.comment_reports for insert to authenticated
  with check (
    reported_by_user_id = (select auth.uid())
    and not exists (
      select 1 from public.comments c
       where c.id = comment_id
         and c.user_id = (select auth.uid())
    )
  );

-- SELECT: el reportante ve lo suyo, el admin de plataforma ve todo -- el GESTOR de la
-- propiedad (private.is_property_comment_manager) NO ve reportes, solo resuelve vía RPC.
drop policy if exists comment_reports_select on public.comment_reports;
create policy comment_reports_select on public.comment_reports for select to authenticated
  using (
    reported_by_user_id = (select auth.uid())
    or private.is_admin()
  );

-- Sin comment_reports_update ni comment_reports_delete: la resolución es SOLO por
-- resolve_comment_reports_atomic (SECURITY DEFINER). Sin GRANT UPDATE/DELETE de tabla
-- (ver §4) -- 42501 de privilegio, ni siquiera el admin puede mutar la fila directo.

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Grants de tabla (mecánico -- tabla nueva NO hereda el GRANT blanket de 0008/0014,
--    patrón 20260828000005/20260910100001). Solo select+insert: sin update/delete para
--    nadie, la resolución pasa por la RPC.
-- ════════════════════════════════════════════════════════════════════════════
revoke all on public.comment_reports from anon, authenticated;
grant select, insert on public.comment_reports to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) resolve_comment_reports_atomic — RPC de resolución atómica (calco de
--    resolve_property_reports_atomic, 20260828000004, sin p_admin_id: el actor es
--    SIEMPRE auth.uid(), decisión (d) de la cabecera).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.resolve_comment_reports_atomic(
  p_comment_id uuid,
  p_action     text,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id       uuid;
  v_status_before  public.comment_status;
begin
  -- 1) Admin ANTES que todo lo demás (no revela existencia de p_comment_id a un no-admin).
  v_admin_id := auth.uid();
  if v_admin_id is null or not private.is_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;

  -- 2) Acción válida.
  if p_action is null or p_action not in ('restore', 'keep_hidden', 'delete_comment') then
    raise exception 'INVALID_ACTION' using errcode = 'P0001';
  end if;

  -- 3) Lock + snapshot del estado ANTERIOR del comentario.
  select status into v_status_before
    from public.comments
   where id = p_comment_id
     for update;

  if not found then
    raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 4) Guard de origen COMÚN a las 3 acciones: comentario que no está 'hidden' (nunca lo
  -- estuvo, o una llamada previa ya lo transicionó) -> no-op total, silencioso.
  if v_status_before is distinct from 'hidden' then
    return;
  end if;

  -- 5) Transición.
  if p_action = 'restore' then
    update public.comments set status = 'visible' where id = p_comment_id;
  elsif p_action = 'delete_comment' then
    update public.comments set status = 'deleted' where id = p_comment_id;
  end if;
  -- keep_hidden: comments no se toca (status ya es 'hidden').

  -- 6) Cierra los reportes 'new' de ESTE comentario (idempotente por construcción,
  -- independiente del guard #4).
  update public.comment_reports
     set status = 'resolved'
   where comment_id = p_comment_id
     and status = 'new';

  -- 7) Auditoría -- llegar aquí siempre implicó trabajo real (los guards de arriba ya
  -- filtraron los no-ops). admin_actions.action_type es TEXT libre, sin CHECK que ensanchar.
  insert into public.admin_actions (
    admin_id, action_type, entity_type, entity_id, reason
  )
  values (
    v_admin_id,
    case p_action
      when 'restore' then 'comment_restore'
      when 'keep_hidden' then 'comment_keep_hidden'
      when 'delete_comment' then 'comment_delete'
    end,
    'comment',
    p_comment_id,
    p_reason
  );
end;
$$;

comment on function public.resolve_comment_reports_atomic(uuid, text, text) is
  'Resolución ATÓMICA de la cola de reportes de un comentario OCULTO (289.3): '
  'restore/keep_hidden/delete_comment. Actor SIEMPRE auth.uid() (sin p_admin_id), guard '
  'private.is_admin() evaluado ANTES de resolver p_comment_id. Guard de origen '
  'status=''hidden'' (no-op total si no). Cierra comment_reports ''new''->''resolved'' de '
  'ESE comment_id, escribe admin_actions (comment_restore/comment_keep_hidden/'
  'comment_delete). Sin bloque EXCEPTION: el fallo del INSERT de admin_actions revierte '
  'TODO el evento (status, comment_reports.status, comment_count vía el trigger de 289.2).';

revoke execute on function public.resolve_comment_reports_atomic(uuid, text, text) from public, anon;
grant execute on function public.resolve_comment_reports_atomic(uuid, text, text) to authenticated;
