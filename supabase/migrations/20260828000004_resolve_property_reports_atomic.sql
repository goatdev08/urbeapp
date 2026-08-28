-- Migración 20260828000004 — GREEN de resolve_property_reports_atomic
-- (subtarea #220.3, tarea 220 "reportes de propiedad y auto-moderación",
-- exploración 041-M2/M3). ÚNICA migración que crea esta función: el stub no-op
-- que usó el RED (20260828000003) se eliminó del árbol antes de integrar —era
-- andamio de test, no un artefacto que deba viajar a producción—, así que este
-- archivo la crea desde cero y su rollback la DROPEA (un rollback a un cuerpo
-- vacío fallaría en SILENCIO: la EF recibiría éxito sin resolver nada).
-- NO toca moderate_property_atomic
-- (función hermana, #218 — verificado con la sección REGRESION de la suite
-- pgTAP 75).
--
-- Contrato completo (edge cases, D-STATUS/D-DEDUPE/D-SCOPE/D-RESOLUTION/
-- D-TYPE/D-LINK/D-RECIPIENT/D-ADMIN-ACTIONS/D-ATOMICIDAD): ver cabecera de
-- supabase/tests/75_moderate_property_report_resolution_test.sql y la
-- bitácora de la subtarea 220.3 en Taskmaster — todas esas decisiones ya
-- estaban FIJADAS por el test-author; este archivo solo las implementa.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ hace, resumen ejecutivo:
--   1. Valida la firma (admin_id/property_id NOT NULL, action_type en el
--      catálogo de 4) → P0001 si no.
--   2. Bloquea la fila de la propiedad (`for update`) y lee su estado
--      ANTERIOR (status/owner_user_id/address/deleted_at). Si no existe →
--      P0001.
--   3. Guard de origen COMÚN a las 4 acciones: si status ANTERIOR no es
--      'suspended', NO-OP TOTAL silencioso (sin excepción) — cubre el
--      retry-dedup de restore/request_changes (una 2ª llamada ya transicionó
--      el status) y el caso ORIGIN (propiedad que nunca estuvo suspendida).
--   4. Guards ADICIONALES por acción (D-DEDUPE):
--        keep_suspended → exige >=1 reporte 'new' pendiente (si no, no-op:
--          el propósito único de la acción es cerrar reportes).
--        delete         → exige deleted_at IS NULL (ancla real de columna;
--          un 2º delete es no-op).
--   5. Transición de public.properties: restore→status='active',
--      request_changes→status='needs_changes', keep_suspended→sin cambio,
--      delete→deleted_at=now() (status NUNCA cambia en delete — soft-delete
--      puro, jamás los valores vestigiales deleted_soft/deleted_hard del
--      enum; la cascada a property_videos.deleted_at sale gratis del
--      trigger AFTER UPDATE OF deleted_at ya existente, 20260604000005).
--   6. Cierra los reportes de ESA propiedad: `update property_reports set
--      status='resolved', reviewed_by_admin_id=p_admin_id, reviewed_at=now(),
--      resolution=p_reason where property_id=p_property_id and status='new'`
--      — SIEMPRE filtra por property_id + status='new' (D-SCOPE), nunca
--      toca otra propiedad ni reportes ya resueltos/descartados de la MISMA
--      propiedad (idempotente por construcción, independiente del guard #4).
--   7. admin_actions: 1 fila (entity_type='property', action_type=el
--      literal de la acción, old_values={status:'suspended'},
--      new_values={status:target} (+{deleted:true} en delete),
--      reason=p_reason).
--   8. Espejo a notifications al OWNER (owner_user_id de la propiedad) —
--      NUNCA al admin actor (`is distinct from p_admin_id`, guard SELF) ni a
--      otros admins (esos avisos ya salieron en 220.2 al crearse los
--      reportes). deep_link SIEMPRE '/profile/my-listings' (ruta viva,
--      mobile/app/(protected)/profile/my-listings.tsx — NUNCA
--      '/admin/reports', esa es para los avisos A los admins de 220.2).
--      related_entity_type 'property'. Tipos: restore→
--      'property_report_restored', request_changes→
--      'property_report_needs_changes', keep_suspended→
--      'property_report_kept_suspended', delete→'property_report_deleted'.
--      data: {address} + {resolution} solo si p_reason no es null.
--   9. SIN bloque EXCEPTION (D-ATOMICIDAD, mismo criterio 219.1/219.2/220.2):
--      el fallo del INSERT de notifications revierte TODO el evento — el
--      caller (throws_ok en pgTAP, el 500 DB_ERROR en la EF) ve el error, y
--      el `for update` + los guards de arriba hacen que la llamada sea
--      reintentable sin duplicar nada.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.resolve_property_reports_atomic(
  p_admin_id    uuid,
  p_property_id uuid,
  p_action_type text,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_before public.property_status;
  v_deleted_before timestamptz;
  v_owner          uuid;
  v_address        text;
  v_open_reports   int;
  v_target_status  text;
  v_type           text;
  v_title          text;
  v_body           text;
begin
  -- 1) Validación de la firma.
  if p_admin_id is null or p_property_id is null then
    raise exception 'admin_id y property_id son requeridos' using errcode = 'P0001';
  end if;
  if p_action_type is null
     or p_action_type not in ('restore', 'request_changes', 'keep_suspended', 'delete') then
    raise exception 'action_type inválido: %', coalesce(p_action_type, 'null')
      using errcode = 'P0001';
  end if;

  -- 2) Lock + snapshot del estado ANTERIOR. Ancla en memoria para el
  -- retry-dedup (sin índice único, mismo criterio 219.2/223.1).
  select status, deleted_at, owner_user_id, address
    into v_status_before, v_deleted_before, v_owner, v_address
    from public.properties
   where id = p_property_id
   for update;

  if not found then
    raise exception 'propiedad % no encontrada', p_property_id using errcode = 'P0001';
  end if;

  -- 3) Guard de origen COMÚN a las 4 acciones (D-DEDUPE base + ORIGIN):
  -- propiedad que no está 'suspended' (nunca lo estuvo, o una llamada previa
  -- ya la transicionó) → no-op total, silencioso.
  if v_status_before is distinct from 'suspended' then
    return;
  end if;

  -- 4) Guards ADICIONALES por acción (D-DEDUPE).
  if p_action_type = 'keep_suspended' then
    select count(*) into v_open_reports
      from public.property_reports
     where property_id = p_property_id and status = 'new';
    if v_open_reports = 0 then
      return;
    end if;
  elsif p_action_type = 'delete' then
    if v_deleted_before is not null then
      return;
    end if;
  end if;

  -- 5) Transición de properties.
  if p_action_type = 'restore' then
    v_target_status := 'active';
    update public.properties
       set status = v_target_status::property_status, updated_at = now()
     where id = p_property_id;
  elsif p_action_type = 'request_changes' then
    v_target_status := 'needs_changes';
    update public.properties
       set status = v_target_status::property_status, updated_at = now()
     where id = p_property_id;
  else
    -- keep_suspended: properties no se toca (status ya es 'suspended').
    -- delete: status NUNCA cambia (soft-delete puro, sin deleted_soft/hard).
    v_target_status := v_status_before::text;
    if p_action_type = 'delete' then
      update public.properties
         set deleted_at = now(), updated_at = now()
       where id = p_property_id;
    end if;
  end if;

  -- 6) Cierra los reportes 'new' de ESTA propiedad (D-SCOPE/D-STATUS/
  -- D-RESOLUTION). Idempotente por construcción, independiente del guard #4.
  update public.property_reports
     set status = 'resolved',
         reviewed_by_admin_id = p_admin_id,
         reviewed_at = now(),
         resolution = p_reason
   where property_id = p_property_id
     and status = 'new';

  -- 7) Auditoría (D-ADMIN-ACTIONS) — siempre que llegamos aquí hubo trabajo
  -- real (los guards de arriba ya filtraron los no-ops).
  insert into public.admin_actions
    (admin_id, action_type, entity_type, entity_id, old_values, new_values, reason)
  values (
    p_admin_id, p_action_type, 'property', p_property_id,
    jsonb_build_object('status', v_status_before::text),
    case when p_action_type = 'delete'
      then jsonb_build_object('status', v_target_status, 'deleted', true)
      else jsonb_build_object('status', v_target_status)
    end,
    p_reason
  );

  -- 8) Espejo al owner (D-TYPE/D-LINK/D-RECIPIENT) — nunca al admin actor
  -- (guard SELF), nunca a otros admins (esos avisos ya salieron en 220.2).
  if v_owner is not null and v_owner is distinct from p_admin_id then
    v_type := case p_action_type
      when 'restore' then 'property_report_restored'
      when 'request_changes' then 'property_report_needs_changes'
      when 'keep_suspended' then 'property_report_kept_suspended'
      when 'delete' then 'property_report_deleted'
    end;
    v_title := case p_action_type
      when 'restore' then 'Tu propiedad fue restaurada'
      when 'request_changes' then 'Tu propiedad necesita cambios'
      when 'keep_suspended' then 'Tu propiedad sigue suspendida'
      when 'delete' then 'Tu propiedad fue eliminada'
    end;
    v_body := case p_action_type
      when 'restore' then
        'Tu propiedad en "' || v_address || '" fue restaurada tras revisar los reportes.'
      when 'request_changes' then
        'Tu propiedad en "' || v_address || '" necesita cambios tras revisar los reportes.'
      when 'keep_suspended' then
        'Tu propiedad en "' || v_address || '" se mantiene suspendida tras revisar los reportes.'
      when 'delete' then
        'Tu propiedad en "' || v_address || '" fue eliminada tras revisar los reportes.'
    end;

    insert into public.notifications (
      user_id, type, title, body, deep_link,
      related_entity_type, related_entity_id, data
    )
    values (
      v_owner, v_type, v_title, v_body, '/profile/my-listings',
      'property', p_property_id,
      jsonb_build_object('address', v_address)
        || case when p_reason is not null
             then jsonb_build_object('resolution', p_reason)
             else '{}'::jsonb
           end
    );
  end if;
end;
$$;

comment on function public.resolve_property_reports_atomic(uuid, uuid, text, text) is
  'GREEN 220.3: resuelve la cola de reportes de una propiedad SUSPENDIDA '
  '(restore/request_changes/keep_suspended/delete). Guard de origen '
  'status=''suspended'' (no-op total si no) + guards propios de '
  'keep_suspended (>=1 reporte ''new'') y delete (deleted_at is null). '
  'Cierra property_reports ''new''->''resolved'' con auditoría completa '
  '(SIEMPRE de ESA propiedad, D-SCOPE), escribe admin_actions y espeja al '
  'owner (nunca al admin actor, nunca a otros admins) con deep_link '
  '''/profile/my-listings''. delete = soft-delete (deleted_at), NUNCA los '
  'valores vestigiales deleted_soft/deleted_hard; la cascada a '
  'property_videos sale del trigger AFTER UPDATE OF deleted_at ya existente '
  '(20260604000005). Sin bloque EXCEPTION: el fallo del INSERT de '
  'notifications revierte TODO el evento. moderate_property_atomic (#218) '
  'queda 100% intacta.';

grant execute on function public.resolve_property_reports_atomic(uuid, uuid, text, text) to service_role;
