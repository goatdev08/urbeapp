-- Migración 20260914100002 — aviso new_follower (subtarea 78.2, tarea #78 «follow de
-- cuentas F1», doc 048). Calco de notify_comment_on_my_property
-- (20260910300001_notify_social_comments.sql): función SECURITY DEFINER + trigger AFTER
-- INSERT en public.follows que inserta en public.notifications al seguido, en la MISMA
-- transacción (sin bloque EXCEPTION).
--
-- ── D-DEDUPE (decisión de Abraham 2026-09-13, fijada en el RED) ───────────────────────
-- CADA follow nuevo avisa. A diferencia de comment_on_my_property (índice único parcial
-- + ON CONFLICT DO NOTHING), aquí NO hay índice de dedupe: al dejar de seguir se borra
-- la fila de follows, y un refollow es un evento de TRANSICIÓN nuevo (mismo criterio que
-- notify_comment_hidden, HID-CYCLE) — genera un segundo aviso. Techo conocido:
-- ponytail: sin índice de dedupe — un refollow es evento nuevo, no un duplicado del
-- mismo hecho; techo: permite farmear el aviso con follow/unfollow repetido. Se acepta
-- (decisión explícita de Abraham); si aparece abuso real, añadir índice parcial
-- (user_id, related_entity_id, type) where type='new_follower', igual que
-- comment_on_my_property.
--
-- 🔴 PRODUCCIÓN VIVA (§0.5): aditivo puro, sin riesgo.
--   · 1 función nueva + 1 trigger nuevo. Ninguna tabla, columna, policy o función
--     existente se toca.
--   · public.notifications.type es TEXT libre (20260604000007) — 'new_follower' no
--     necesita ALTER TYPE. NotificationCard es presentacional (title/body/deep_link
--     vienen del INSERT) → CERO cambios en mobile/src/features/notifications/**
--     (deep_link '/profile/<id>' ya existe bajo mobile/app/(protected)/profile/[id].tsx).
--   · SECURITY DEFINER necesario: quien sigue a alguien no tiene GRANT INSERT sobre
--     notifications para user_id ajeno (20260604000008: solo UPDATE(read_at,
--     deleted_at) a authenticated).
--   · Idempotente: create or replace function · drop trigger if exists + create
--     trigger. Rollback 1:1 en
--     supabase/migrations/rollbacks/20260914100002_notify_new_follower.sql.
--
-- Tests: supabase/tests/118_notify_new_follower_test.sql (19 asserts).
-- Rollback: supabase/migrations/rollbacks/20260914100002_notify_new_follower.sql

create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_follower_name text;
begin
  select nullif(btrim(full_name), '') into v_follower_name
    from public.user_preferences
   where user_id = new.follower_user_id;

  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  )
  values (
    new.followed_user_id,
    'new_follower',
    'Nuevo seguidor',
    coalesce(v_follower_name, 'Alguien') || ' empezó a seguirte.',
    '/profile/' || new.follower_user_id,
    'user',
    new.follower_user_id,
    jsonb_build_object('follower_user_id', new.follower_user_id)
  );

  return new;
end;
$$;

comment on function public.notify_new_follower() is
  'AFTER INSERT en public.follows (78.2): avisa al seguido (followed_user_id) cuando '
  'alguien lo sigue. Nombre público del seguidor vía user_preferences.full_name '
  '(fallback ''Alguien'' si no tiene fila o full_name es cadena vacía). Sin índice de '
  'dedupe (D-DEDUPE, decisión de Abraham 2026-09-13): un unfollow + refollow es un '
  'evento de transición nuevo y genera un segundo aviso -- ponytail: techo conocido, '
  'permite farmear el aviso con follow/unfollow repetido, se acepta. Sin bloque '
  'EXCEPTION: si el insert en notifications falla, el follow falla en la misma '
  'transacción.';

drop trigger if exists follows_notify_new_follower on public.follows;
create trigger follows_notify_new_follower
  after insert on public.follows
  for each row
  execute function public.notify_new_follower();
