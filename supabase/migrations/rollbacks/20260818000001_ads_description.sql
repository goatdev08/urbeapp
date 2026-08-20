-- Rollback de 20260818000001_ads_description.sql (tarea #192)
--
-- 1) Restaura el body EXACTO de public.handle_ad_status_change() de
--    20260816000006 (pre-192): matriz SIN active->pending_review, sin el
--    bloque de democión de sistema.
-- 2) Elimina el trigger + función nuevos de public.ads
--    (ads_description_review / handle_ad_description_edit).
-- 3) Elimina el CHECK ads_description_length y la columna description --
--    aditiva de esta migración, sin nada más dependiendo de ella.
--
-- Re-ejecutable: create or replace + drop trigger/function/constraint/column
-- if exists.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.handle_ad_status_change() — restaura el body de 20260816000006.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_ad_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  -- Matriz de transiciones válidas (D2, 169.2). draft->active DIRECTO queda
  -- deliberadamente fuera: "jamás se sirve sin moderación". rejected/expired
  -- son TERMINALES (ninguna transición de salida).
  if not (
    (old.status = 'draft' and new.status = 'pending_review')
    or (old.status = 'pending_review' and new.status = 'active')
    or (old.status = 'active' and new.status in ('paused', 'expired', 'rejected'))
    or (old.status = 'paused' and new.status = 'active')
  ) then
    raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  -- Defensa en profundidad: exige un admin identificado ANTES de aplicar
  -- cualquier efecto, aunque el caller ya tenga GRANT de tabla (service_role).
  v_admin_id := private.resolve_admin_actor();

  -- Bloquea activar bajo una organización YA suspendida EN ESE MOMENTO (no
  -- reactivo a una suspensión futura -- decisión de Abraham, hueco que
  -- detectó el analista sobre el plan original).
  if old.status = 'pending_review' and new.status = 'active' then
    if exists (
      select 1 from public.agencies where id = new.agency_id and status = 'suspended'
    ) then
      raise exception 'ORGANIZATION_SUSPENDED' using errcode = 'P0001';
    end if;
  end if;

  -- D2 "pausar el reloj": conserva los días restantes en vez de perderlos.
  if old.status = 'active' and new.status = 'paused' then
    new.paused_at := now();
  elsif old.status = 'paused' and new.status = 'active' then
    -- El CHECK ads_paused_at_matches_status garantiza que un ad en 'paused'
    -- SIEMPRE trae paused_at no nulo (el único camino a 'paused' es
    -- active->paused, arriba, que lo estampa) -- sin coalesce: si paused_at
    -- llegara NULL aquí sería un bug real, no un estado legítimo a tolerar
    -- en silencio (D2: jamás perder días pagados sin que reviente).
    new.ends_at := old.ends_at + (now() - old.paused_at);
    new.paused_at := null;
    new.paused_by_suspension := false;
  end if;

  -- Auditoría SIEMPRE, en la MISMA transacción. Si este INSERT falla, TODO lo
  -- anterior se revierte (patrón moderate_property_atomic, 20260809000007).
  -- Sin bloque EXCEPTION a propósito -- cualquier fallo debe propagar.
  insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
  values (
    v_admin_id, 'change_ad_status', 'ad', new.id,
    jsonb_build_object('status', old.status::text),
    jsonb_build_object('status', new.status::text)
  );

  return new;
end;
$$;

comment on function public.handle_ad_status_change() is
  'Trigger BEFORE UPDATE en ads (subtarea 169.2): ÚNICA autoridad de la '
  'máquina de estados {draft->pending_review, pending_review->active, '
  'active->{paused,expired,rejected}, paused->active}. Exige un admin '
  'identificado (private.resolve_admin_actor), bloquea activar bajo una '
  'organización suspendida (ORGANIZATION_SUSPENDED), aplica D2 "pausar el '
  'reloj" y registra SIEMPRE en admin_actions en la misma transacción. Solo '
  'se dispara si status realmente cambia (WHEN clause del CREATE TRIGGER).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.ads — quita el trigger + función nuevos de la tarea #192.
-- ════════════════════════════════════════════════════════════════════════════

drop trigger if exists ads_description_review on public.ads;
drop function if exists public.handle_ad_description_edit();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) public.ads — quita el CHECK y la columna description.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ads drop constraint if exists ads_description_length;
alter table public.ads drop column if exists description;
