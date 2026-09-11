-- Migración 20260910300001 — notificaciones sociales de comentarios (subtarea 289.4,
-- tarea #289): comment_on_my_property (al publicador), comment_hidden (al autor) y
-- admin_comment_report (a los admins de plataforma vivos). Calco de
-- 20260826000001_notify_moderation_mirrors.sql (espejo por transición, sin EXCEPTION) +
-- 20260905200002_notify_admin_advertising_request.sql (índice único parcial + fan-out
-- admin + ON CONFLICT DO NOTHING) + 20260905300001_notificaciones_moderacion_con_motivo.sql
-- (naming de columnas `data`). Contrato completo (D-DEDUPE/D-REASON/D-CICLO, edge cases,
-- por qué el dedupe de admin_comment_report vive en el CUERPO del trigger y no en un
-- índice): ver cabecera de supabase/tests/115_notify_social_comments_test.sql (RED,
-- test-author, 59 asserts).
--
-- 🔴 PRODUCCIÓN VIVA (§0.5): aditivo puro, sin riesgo.
--   · 1 índice único parcial nuevo (dedupe de comment_on_my_property) + 3 funciones nuevas
--     + 3 triggers nuevos. Ninguna tabla, columna, policy o función existente se toca.
--   · public.notifications.type es TEXT libre ("catálogo crece -> text, no enum",
--     20260604000007) — 3 types nuevos no necesitan ALTER TYPE. NotificationCard es
--     presentacional (title/body/deep_link vienen del INSERT) → CERO cambios en
--     mobile/src/features/notifications/** (deep_links '/property/<id>' y
--     '/admin/reports' ya existen bajo mobile/app/).
--   · SECURITY DEFINER necesario en las 3: quien comenta/reporta no tiene GRANT INSERT
--     sobre notifications para user_id ajeno (20260604000008:415-416 solo otorga
--     UPDATE(read_at, deleted_at) a authenticated).
--   · Idempotente: create unique index if not exists · create or replace function ·
--     drop trigger if exists + create trigger. Rollback 1:1 en supabase/migrations/
--     rollbacks/20260910300001_notify_social_comments.sql.
--
-- ── 1) comment_on_my_property — trigger en comments (AFTER INSERT OR UPDATE OF status) ────
-- Dispara en 2 caminos: INSERT status='visible' directo, o UPDATE held_for_review→visible
-- (moderación libera el comentario) — ningún otro camino. Guard "nunca el autor==dueño"
-- (self-comment no se autoavisa, en AMBOS caminos). Destinatario properties.owner_user_id,
-- deep_link '/property/'||property_id, data->>'address'. Dedupe: índice único parcial
-- (user_id, related_entity_id, type) where type='comment_on_my_property' (mismo patrón que
-- notifications_admin_advertising_request_anchor_idx) + ON CONFLICT DO NOTHING — UN aviso
-- por comment_id en TODA su vida, incluso si el ciclo held_for_review→visible se repite
-- (COMP-CYCLE del RED).
--
-- ── 2) comment_hidden — trigger en comments (AFTER UPDATE OF status) ───────────────────────
-- Dispara SOLO en la transición OLD.status<>'hidden' AND NEW.status='hidden' (nunca hacia
-- 'deleted', nunca si ya estaba 'hidden'; "nada para held_for_review"). Destinatario
-- comments.user_id (el autor). data->>'reason' = 'oculto_por_moderacion': 🔴 DECISIÓN
-- test-author (cabecera del RED) — el trigger NO puede distinguir si el UPDATE lo mandó un
-- gestor humano o el auto-ocultar de 289.3 (check_comment_reports_autohide, mismo evento
-- SQL, sin metadata de actor en NEW/OLD) — un motivo genérico documentado en vez de una
-- distinción que el trigger no puede observar. SIN índice de dedupe (a diferencia de
-- comment_on_my_property): un comentario puede recuperarse (resolve_comment_reports_atomic
-- 'restore') y volver a ocultarse legítimamente — cada ciclo de "entrar a hidden" genera un
-- aviso NUEVO (guard de TRANSICIÓN únicamente, mismo patrón que moderate_ad_atomic
-- v_old_status IS DISTINCT FROM p_next_status).
--
-- ── 3) admin_comment_report — trigger en comment_reports (AFTER INSERT, NUNCA UPDATE) ──────
-- Fan-out a TODOS los public.users.role='admin' VIVOS (deleted_at is null, #223.2a),
-- EXCLUYENDO al propio reportante si resulta ser admin (guard "nunca el actor"). deep_link
-- '/admin/reports' (ruta ya viva, #220.4). 🔴 DECISIÓN de diseño (cabecera del RED): el
-- patrón estándar de índice único parcial (user_id, related_entity_id, type) NO SIRVE aquí
-- — bloquearía el aviso para siempre tras el 1er reporte, y la subtarea exige que un
-- reporte posterior a que resolve_comment_reports_atomic cierra el ciclo anterior SÍ vuelva
-- a avisar. El dedupe vive en el CUERPO: notifica solo si NO existe otra fila de
-- comment_reports con el mismo comment_id y status='new' (excluyendo la propia fila
-- insertada) — válido porque resolve_comment_reports_atomic cierra TODOS los 'new' de ese
-- comment_id a 'resolved' en la misma transacción de la resolución (113, RPC8/RPC9).
--
-- Sin bloque EXCEPTION en ninguna de las 3 (mismo criterio que #219.1/#219.2/#246): si el
-- escritor de notifications truena, revierte TODO el evento (el comentario/reporte tampoco
-- se persiste).
--
-- Tests: supabase/tests/115_notify_social_comments_test.sql (59 asserts).
-- Rollback: supabase/migrations/rollbacks/20260910300001_notify_social_comments.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) comment_on_my_property
-- ════════════════════════════════════════════════════════════════════════════

create unique index if not exists notifications_comment_on_my_property_anchor_idx
  on public.notifications (user_id, related_entity_id, type)
  where type = 'comment_on_my_property';

comment on index public.notifications_comment_on_my_property_anchor_idx is
  'Ancla de idempotencia de comment_on_my_property (289.4): UN aviso por comment_id en '
  'toda su vida — el ciclo held_for_review->visible puede repetirse (moderación) sin '
  'duplicar el aviso al publicador (COMP-CYCLE del RED, 115).';

create or replace function public.notify_comment_on_my_property()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_should_notify boolean := false;
  v_owner   uuid;
  v_address text;
begin
  if TG_OP = 'INSERT' then
    v_should_notify := (new.status = 'visible');
  elsif TG_OP = 'UPDATE' then
    v_should_notify := (old.status = 'held_for_review' and new.status = 'visible');
  end if;

  if not v_should_notify then
    return new;
  end if;

  select owner_user_id, address into v_owner, v_address
    from public.properties
   where id = new.property_id;

  -- Guard "nunca el autor==dueño": el publicador comentando su propia propiedad no se
  -- autoavisa, en ninguno de los 2 caminos (COMP9/COMP10 del RED).
  if v_owner is null or v_owner = new.user_id then
    return new;
  end if;

  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  )
  values (
    v_owner,
    'comment_on_my_property',
    'Nuevo comentario en tu propiedad',
    'Tu propiedad en "' || v_address || '" recibió un nuevo comentario.',
    '/property/' || new.property_id,
    'comment',
    new.id,
    jsonb_build_object('address', v_address)
  )
  on conflict (user_id, related_entity_id, type) where type = 'comment_on_my_property'
    do nothing;

  return new;
end;
$$;

comment on function public.notify_comment_on_my_property() is
  'AFTER INSERT OR UPDATE OF status en comments (289.4): avisa al publicador '
  '(properties.owner_user_id) cuando un comentario de un tercero se vuelve visible -- '
  'INSERT status=visible directo, o UPDATE held_for_review->visible (moderación lo '
  'libera). Nunca al autor==dueño (self-comment). Dedupe: índice único parcial '
  'notifications_comment_on_my_property_anchor_idx + ON CONFLICT DO NOTHING -- UN aviso '
  'por comment_id en toda su vida. Sin bloque EXCEPTION.';

drop trigger if exists comments_notify_on_my_property on public.comments;
create trigger comments_notify_on_my_property
  after insert or update of status on public.comments
  for each row
  execute function public.notify_comment_on_my_property();

-- ════════════════════════════════════════════════════════════════════════════
-- 2) comment_hidden
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.notify_comment_hidden()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_address text;
begin
  -- Guard de TRANSICIÓN únicamente (D-CICLO): entrar a 'hidden' notifica, sin importar si
  -- lo mandó un gestor humano o el auto-ocultar de 289.3 (check_comment_reports_autohide) --
  -- ambos llegan como este mismo AFTER UPDATE OF status. Nunca si ya estaba 'hidden',
  -- nunca hacia 'deleted' ni 'held_for_review'.
  if old.status = 'hidden' or new.status <> 'hidden' then
    return new;
  end if;

  select address into v_address
    from public.properties
   where id = new.property_id;

  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  )
  values (
    new.user_id,
    'comment_hidden',
    'Tu comentario fue ocultado',
    'Tu comentario en "' || v_address || '" fue ocultado por moderación.',
    '/property/' || new.property_id,
    'comment',
    new.id,
    jsonb_build_object('reason', 'oculto_por_moderacion')
  );

  return new;
end;
$$;

comment on function public.notify_comment_hidden() is
  'AFTER UPDATE OF status en comments (289.4): avisa al AUTOR (comments.user_id) cada vez '
  'que su comentario ENTRA a status=hidden (guard de transición OLD<>hidden AND '
  'NEW=hidden, mismo patrón que moderate_ad_atomic). data->>reason es siempre el genérico '
  '''oculto_por_moderacion'' -- el trigger no puede distinguir un gestor humano del '
  'auto-ocultar de 289.3 (check_comment_reports_autohide), ambos llegan como el mismo '
  'evento SQL sin metadata de actor. SIN índice de dedupe: un restore (resolve_comment_'
  'reports_atomic) y un 2o ocultamiento del mismo comentario generan un 2o aviso legítimo '
  '(HID-CYCLE del RED). Sin bloque EXCEPTION.';

drop trigger if exists comments_notify_hidden on public.comments;
create trigger comments_notify_hidden
  after update of status on public.comments
  for each row
  execute function public.notify_comment_hidden();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) admin_comment_report
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.notify_admin_comment_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open_sibling boolean;
  v_address      text;
begin
  -- Dedupe por CICLO ABIERTO (D-DEDUPE de la cabecera, NUNCA un índice único): reporte-2/3/N
  -- del mismo ciclo (ya hay otra fila 'new' del mismo comment_id) no notifica de nuevo;
  -- resolve_comment_reports_atomic cierra TODOS los 'new' a 'resolved' en su transacción,
  -- así que el siguiente reporte ve 0 hermanos 'new' y abre un ciclo nuevo.
  select exists (
    select 1 from public.comment_reports
     where comment_id = new.comment_id
       and status = 'new'
       and id <> new.id
  ) into v_open_sibling;

  if v_open_sibling then
    return new;
  end if;

  select p.address into v_address
    from public.comments c
    join public.properties p on p.id = c.property_id
   where c.id = new.comment_id;

  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  )
  select
    u.id,
    'admin_comment_report',
    'Comentario reportado',
    'Un comentario en "' || v_address || '" fue reportado.',
    '/admin/reports',
    'comment',
    new.comment_id,
    jsonb_build_object('address', v_address)
  from public.users u
  where u.role = 'admin'
    and u.deleted_at is null
    and u.id is distinct from new.reported_by_user_id;

  return new;
end;
$$;

comment on function public.notify_admin_comment_report() is
  'AFTER INSERT en comment_reports (289.4, NUNCA UPDATE): avisa a los admin de plataforma '
  'VIVOS (deleted_at is null, #223.2a) cuando la fila recién insertada es el ÚNICO reporte '
  'en estado new abierto de ese comment_id -- dedupe por CICLO ABIERTO en el CUERPO del '
  'trigger (NO un índice único: bloquearía el aviso para siempre tras el 1er reporte). '
  'Nunca al reportante si resulta admin (guard nunca el actor). deep_link /admin/reports '
  '(ruta ya viva, #220.4). Sin bloque EXCEPTION.';

drop trigger if exists comment_reports_notify_admin on public.comment_reports;
create trigger comment_reports_notify_admin
  after insert on public.comment_reports
  for each row
  execute function public.notify_admin_comment_report();
