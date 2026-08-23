-- Migración 20260822000003 — el grafo de ads admite pending_review → rejected
-- (tarea #208, subtarea 208.1). Aditiva e idempotente.
-- Rollback: rollbacks/20260822000003_ads_reject_from_pending_review.sql
-- Tests: supabase/tests/64_moderate_ad_atomic_test.sql (MOD9, MOD10)
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 EL HUECO, ENCONTRADO ESCRIBIENDO EL RED DE 208.1. El grafo de
-- handle_ad_status_change() nunca incluyó `pending_review → rejected`. La
-- única ruta hacia `rejected` salía de `active`. Consecuencia práctica: un
-- admin podía APROBAR un anuncio en revisión pero NO rechazarlo — para
-- rechazarlo tendría que activarlo primero, publicando durante un instante
-- exactamente el contenido que quiere rechazar.
--
-- No es una regla deliberada que se esté revirtiendo: es un hueco. La suite
-- 48_ads_state_machine_test.sql enumera las transiciones inválidas que SÍ se
-- decidieron (draft→active directo, draft→paused, pending_review→paused,
-- rejected→pending_review) y `pending_review → rejected` NO está entre ellas.
-- Nada la especificaba; simplemente no se escribió. Y todo el diseño alrededor
-- la da por hecha: `ads.rejection_reason` existe, el CHECK
-- ads_rejection_reason_matches_status la contempla, y el enum trae `rejected`.
--
-- 🔴 Producción viva (§0.5): PERMISIVA, no restrictiva. Habilita una
-- transición que antes lanzaba P0001; no bloquea ninguna que antes pasara, no
-- toca datos y no cambia el resultado de ningún camino existente. Ningún
-- cliente instalado puede romperse porque ninguno podía llegar aquí.
--
-- El resto del cuerpo se copia VERBATIM de 20260818000001_ads_description.sql
-- (la versión vigente): la democión de sistema active→pending_review por
-- edición de descripción, el guard ORGANIZATION_SUSPENDED, D2 "pausar el
-- reloj" y la auditoría obligatoria sobreviven intactos. Un create-or-replace
-- reescribe el cuerpo entero, así que omitir cualquiera de esos bloques sería
-- una regresión silenciosa.
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
  if not (
    (old.status = 'draft' and new.status = 'pending_review')
    -- 208.1: `rejected` se suma aquí. Rechazar en revisión es el acto normal
    -- de moderación; antes era inalcanzable.
    or (old.status = 'pending_review' and new.status in ('active', 'rejected'))
    or (old.status = 'active' and new.status in ('paused', 'expired', 'rejected', 'pending_review'))
    or (old.status = 'paused' and new.status = 'active')
  ) then
    raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  -- Democión de SISTEMA (tarea #192): editar la descripción de un ad activo lo
  -- regresa a revisión. Sin admin y sin auditoría, a propósito.
  if old.status = 'active' and new.status = 'pending_review' then
    if old.description is distinct from new.description then
      return new;
    else
      raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
    end if;
  end if;

  v_admin_id := private.resolve_admin_actor();

  if old.status = 'pending_review' and new.status = 'active' then
    if exists (
      select 1 from public.agencies where id = new.agency_id and status = 'suspended'
    ) then
      raise exception 'ORGANIZATION_SUSPENDED' using errcode = 'P0001';
    end if;
  end if;

  if old.status = 'active' and new.status = 'paused' then
    new.paused_at := now();
  elsif old.status = 'paused' and new.status = 'active' then
    new.ends_at := old.ends_at + (now() - old.paused_at);
    new.paused_at := null;
    new.paused_by_suspension := false;
  end if;

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
  'Trigger BEFORE UPDATE en ads (169.2 + #192 + 208.1): ÚNICA autoridad de la '
  'máquina de estados {draft→pending_review, pending_review→{active,rejected}, '
  'active→{paused,expired,rejected}, paused→active}, más active→pending_review '
  'SOLO como democión de SISTEMA (la descripción cambió en el mismo UPDATE — '
  'sin admin, sin auditoría). 208.1 agregó pending_review→rejected: rechazar '
  'en revisión es el acto normal de moderación y antes era INALCANZABLE (había '
  'que activar el anuncio primero, publicando lo que se quería rechazar). '
  'Para las demás transiciones exige un admin identificado '
  '(private.resolve_admin_actor), bloquea activar bajo una organización '
  'suspendida (ORGANIZATION_SUSPENDED), aplica D2 "pausar el reloj" y registra '
  'SIEMPRE en admin_actions en la misma transacción.';
