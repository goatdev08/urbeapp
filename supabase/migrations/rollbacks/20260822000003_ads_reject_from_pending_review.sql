-- Rollback de 20260822000003_ads_reject_from_pending_review.sql (subtarea #208.1).
--
-- Restaura el grafo EXACTO de 20260818000001_ads_description.sql, quitando
-- únicamente `pending_review → rejected`.
--
-- ⚠️ Efecto: rechazar un anuncio en revisión vuelve a ser IMPOSIBLE (P0001
-- INVALID_AD_STATUS_TRANSITION), y la Edge Function moderate-ad empezará a
-- devolver 409 en cada rechazo. Los anuncios ya rechazados NO se revierten:
-- `rejected` es terminal y sus filas quedan como están. No se pierde ningún
-- dato ni ninguna auditoría.

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
    or (old.status = 'pending_review' and new.status = 'active')
    or (old.status = 'active' and new.status in ('paused', 'expired', 'rejected', 'pending_review'))
    or (old.status = 'paused' and new.status = 'active')
  ) then
    raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

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
