-- Migración 20260701000001 — Triggers de contadores denormalizados: like_count + save_count
-- Propósito: mantener properties.like_count y properties.save_count sincronizados
-- automáticamente vía triggers AFTER INSERT OR DELETE en likes y saves.
--
-- Subtareas 13.2 (like_count) + 13.4 (save_count).
--
-- SECURITY DEFINER — por qué es obligatorio:
--   El trigger ejecuta UPDATE en public.properties. La política RLS properties_update
--   (migración 0008) sólo permite UPDATE al dueño (owner_user_id = auth.uid()) o admin.
--   Quien dispara el INSERT/DELETE en likes/saves es un usuario autenticado que NO es
--   el dueño de la propiedad. Sin SECURITY DEFINER, el UPDATE del trigger sería bloqueado
--   por RLS y el INSERT de like fallaría en producción con un error de permisos.
--   Con SECURITY DEFINER la función corre como su owner (postgres/superuser) → bypasa RLS.
--
-- search_path = '' + referencias public. calificadas:
--   Previene ataques de search_path injection en funciones SECURITY DEFINER (patrón de
--   seguridad estándar de PostgreSQL / Supabase). Toda referencia a objetos es explícita.
--
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS antes de CREATE TRIGGER.
-- Rollback: supabase/migrations/rollbacks/20260701000001_engagement_count_triggers.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Función: incrementa / decrementa like_count
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.update_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    update public.properties
       set like_count = like_count + 1
     where id = NEW.property_id;
  elsif TG_OP = 'DELETE' then
    -- GREATEST(0, ...) garantiza que el contador no baje de 0, satisfaciendo el
    -- CHECK (like_count >= 0) incluso ante borrados concurrentes o inconsistencias.
    update public.properties
       set like_count = GREATEST(0, like_count - 1)
     where id = OLD.property_id;
  end if;
  -- AFTER triggers retornan NULL (el valor es ignorado por el motor).
  return null;
end;
$$;

comment on function public.update_like_count() is
  'AFTER INSERT OR DELETE en public.likes: mantiene properties.like_count sincronizado. '
  'SECURITY DEFINER necesario: el UPDATE de properties requiere ser dueño (RLS 0008) '
  'pero quien da like puede ser cualquier usuario autenticado.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Función: incrementa / decrementa save_count
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.update_save_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    update public.properties
       set save_count = save_count + 1
     where id = NEW.property_id;
  elsif TG_OP = 'DELETE' then
    update public.properties
       set save_count = GREATEST(0, save_count - 1)
     where id = OLD.property_id;
  end if;
  return null;
end;
$$;

comment on function public.update_save_count() is
  'AFTER INSERT OR DELETE en public.saves: mantiene properties.save_count sincronizado. '
  'SECURITY DEFINER necesario: mismo razonamiento que update_like_count.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Triggers en public.likes
-- ════════════════════════════════════════════════════════════════════════════
-- DROP IF EXISTS garantiza idempotencia (no falla si ya existe de una iteración previa).
-- El trigger AFTER DELETE también se dispara en borrados en cascada (ON DELETE CASCADE
-- de property_video_id y user_id), lo que mantiene los contadores correctos ante
-- eliminación de videos o usuarios.
drop trigger if exists trg_like_count on public.likes;
create trigger trg_like_count
  after insert or delete on public.likes
  for each row execute function public.update_like_count();

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Triggers en public.saves
-- ════════════════════════════════════════════════════════════════════════════
drop trigger if exists trg_save_count on public.saves;
create trigger trg_save_count
  after insert or delete on public.saves
  for each row execute function public.update_save_count();

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Backfill: reconciliar contadores de todas las propiedades existentes
-- ════════════════════════════════════════════════════════════════════════════
-- Garantiza que propiedades publicadas ANTES de esta migración tengan like_count
-- y save_count exactos (contando las filas reales en likes/saves). Requisito
-- explícito: la demo trabaja contra datos ya cargados y los contadores deben
-- reflejar la interacción real desde el arranque.
update public.properties p
   set like_count = (
         select count(*)::int
           from public.likes l
          where l.property_id = p.id
       ),
       save_count = (
         select count(*)::int
           from public.saves s
          where s.property_id = p.id
       );
