-- Rollback: 20260914100001_follows.sql (subtarea 78.1, tarea #78 «follow de cuentas F1»)
--
-- Efecto: agent_public_profiles vuelve a sus 4 columnas previas (sin follower_count);
-- follows deja de existir (RLS, policies, trigger, función y tabla); users.follower_count
-- desaparece.
--
-- ⚠️ ORDEN: revertir esto DESPUÉS de revertir el cliente (OTA) si el cliente ya lee
-- follower_count de agent_public_profiles — mismo razonamiento que el rollback de
-- 20260905200003 (el cliente viejo no pide la columna, así que en la práctica el
-- orden solo importa si un build nuevo depende de ella).
--
-- `drop view` (no `create or replace`): Postgres no deja quitarle columnas a una vista
-- con replace.

do $$ begin raise notice '20260914100001 rollback: restaurando agent_public_profiles a 4 columnas (sin follower_count)...'; end $$;

drop view if exists public.agent_public_profiles;

create view public.agent_public_profiles
with (security_invoker = false) as
  select up.user_id,
         up.full_name,
         up.profile_photo_url,
         (u.phone is not null) as has_phone
  from public.user_preferences up
  join public.users u on u.id = up.user_id;

comment on view public.agent_public_profiles is
  'Identidad pública de CUALQUIER usuario (nombre + foto R2 key + has_phone derivado) '
  'legible por cualquier sesión autenticada. Brinca la RLS de user_preferences SOLO en '
  'estas columnas (#145, #250, #254). El teléfono crudo NO sale de aquí: el botón de '
  'WhatsApp se decide con has_phone y el número lo resuelve la EF contact-agent.';

revoke all on public.agent_public_profiles from anon, public;
grant select on public.agent_public_profiles to authenticated;

do $$ begin raise notice '20260914100001 rollback: quitando grants y policies de follows...'; end $$;

revoke all on public.follows from anon, authenticated;

drop policy if exists follows_select on public.follows;
drop policy if exists follows_insert on public.follows;
drop policy if exists follows_delete on public.follows;

do $$ begin raise notice '20260914100001 rollback: quitando trigger y función de conteo...'; end $$;

drop trigger if exists trg_follower_count on public.follows;
drop function if exists public.update_follower_count();

do $$ begin raise notice '20260914100001 rollback: quitando users.follower_count (columna + check)...'; end $$;

alter table public.users drop constraint if exists users_follower_count_no_negativo;
alter table public.users drop column if exists follower_count;

do $$ begin raise notice '20260914100001 rollback: quitando tabla follows (índice + tabla)...'; end $$;

drop index if exists public.follows_followed_user_id_idx;
drop table if exists public.follows;

do $$ begin raise notice '20260914100001 rollback: completo.'; end $$;
