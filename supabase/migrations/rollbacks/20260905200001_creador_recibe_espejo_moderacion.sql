-- ROLLBACK de 20260905200001_creador_recibe_espejo_moderacion (#252).
-- Restaura public.moderate_ad_atomic a su definición VIGENTE ANTERIOR
-- (20260905100001_motivo_en_espejos_de_rechazo, sección 1): los destinatarios
-- del espejo vuelven a ser SOLO los miembros ACTIVOS owner/admin de la
-- agencia; ads.created_by_user_id deja de recibir.
-- No borra datos: las notificaciones ya escritas al creador se conservan (son
-- historia real que esas personas ya vieron). Solo revierte el comportamiento
-- futuro. Idempotente (create or replace). Ningún otro objeto se toca.

create or replace function public.moderate_ad_atomic(
  p_ad_id uuid, p_next_status text, p_rejection_reason text, p_admin_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rows integer;
  v_old_status public.ad_status;
  v_mirror_type text;
  v_ad_title text;
  v_title text;
  v_body text;
  v_reason text;
begin
  if p_next_status is null or p_next_status not in ('active', 'rejected', 'paused') then
    raise exception 'INVALID_NEXT_STATUS' using errcode = 'P0001';
  end if;

  v_reason := case when p_rejection_reason ~ '\S' then p_rejection_reason end;

  perform set_config('urbea.admin_actor_id', p_admin_id::text, true);
  select status into v_old_status from public.ads where id = p_ad_id;
  update public.ads
     set status           = p_next_status::public.ad_status,
         rejection_reason = p_rejection_reason
   where id = p_ad_id;
  get diagnostics v_rows = row_count;
  if v_rows > 0
     and v_old_status is distinct from p_next_status::public.ad_status
     and (p_next_status <> 'active' or v_old_status = 'pending_review')
  then
    v_mirror_type := case p_next_status
      when 'active' then 'ad_approved'
      when 'rejected' then 'ad_rejected'
      when 'paused' then 'ad_paused'
    end;
    select title into v_ad_title from public.ads where id = p_ad_id;
    v_title := case p_next_status
      when 'active' then 'Tu anuncio fue aprobado'
      when 'rejected' then 'Tu anuncio fue rechazado'
      when 'paused' then 'Tu anuncio fue pausado'
    end;
    v_body := case p_next_status
      when 'active' then 'Tu anuncio "' || v_ad_title || '" fue aprobado y ya está activo.'
      when 'rejected' then 'Tu anuncio "' || v_ad_title || '" fue rechazado.'
        || coalesce(' Motivo: ' || v_reason, '')
      when 'paused' then 'Tu anuncio "' || v_ad_title || '" fue retirado (pausado) por un administrador.'
    end;
    insert into public.notifications (
      user_id, type, title, body, deep_link,
      related_entity_type, related_entity_id, data
    )
    select
      am.user_id, v_mirror_type, v_title, v_body, '/ads',
      'ad', p_ad_id,
      jsonb_build_object('ad_title', v_ad_title)
        || case when v_reason is not null
             then jsonb_build_object('rejection_reason', v_reason)
             else '{}'::jsonb
           end
    from public.ads a
    join public.agency_members am
      on am.agency_id = a.agency_id
     and am.status = 'active'
     and am.member_role in ('owner', 'admin')
     and am.user_id is distinct from p_admin_id
    where a.id = p_ad_id;
  end if;
  return v_rows;
end;
$function$;

comment on function public.moderate_ad_atomic(uuid, text, text, uuid) is null;
