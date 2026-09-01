-- Migración 20260902100003 — public.resolve_agency_registration (subtarea
-- #221.2 ampliada, tarea 221, exploración 041-M4).
-- ADITIVA PURA: 1 función nueva. NO se toca el trigger
-- handle_agency_status_change, ni la RPC set_agency_status_atomic, ni la EF
-- suspend-agency, ni ningún grant/policy/columna existente — todo lo que hoy
-- funciona sigue funcionando igual (§0.5, compatibilidad hacia atrás).
-- Rollback: supabase/migrations/rollbacks/20260902100003_resolve_agency_registration.sql
-- Tests: supabase/tests/84_resolve_agency_registration_test.sql
--
-- 🔴 EL HUECO QUE CIERRA (hallazgo de la investigación 221.2, verificado con
-- sonda contra el stack local): el carril de REGISTROS DE INMOBILIARIA de la
-- cola M4 no tenía NINGUNA puerta para el admin desde el panel:
--   (a) `update agencies set status = …` con JWT de admin -> 42501 "permission
--       denied for table agencies": agencies.status quedó FUERA del grant de
--       columna de 0008 a `authenticated` (decisión D3 de 71.5: "la aprobación
--       de agencias solo por Studio").
--   (b) La EF suspend-agency (#211.1) solo expone suspend|reactivate, y su RPC
--       set_agency_status_atomic rechaza cualquier next_status que no sea
--       active|suspended (INVALID_NEXT_STATUS). Aprobar solo se colaría como
--       "reactivate" —semántica equivocada para un registro que nunca estuvo
--       activo— y RECHAZAR (pending_approval->rejected) no tenía camino alguno.
-- El trigger de 71.5 ya implementaba TODA la resolución. Faltaba la puerta.
--
-- 🔴 WRAPPER DELGADO (misma forma que resolve_agent_application, 20260902100002,
-- y que el overload de set_org_advertising_atomic de 20260823000001): valida al
-- actor, aplica 3 guards de puerta y hace UN update. La membresía owner, la
-- promoción de role, la denormalización de users.agency_id,
-- approved_by_admin_id, la cascada, la auditoría y el espejo a notifications
-- los sigue haciendo ENTERO el trigger — aquí no se repite ni una línea de eso.
--
-- 📋 D-REASON — DÓNDE QUEDA EL MOTIVO DEL RECHAZO (decisión, no olvido).
-- public.agencies NO tiene columna de motivo (a diferencia de
-- agent_applications.rejection_reason) y esta migración NO cambia el esquema
-- (instrucción del orquestador 2026-09-01). El motivo viaja en la AUDITORÍA:
-- una fila EXTRA en admin_actions con action_type 'reject_agency_registration'
-- y reason = p_reason, ADEMÁS de la fila 'reject_agency' que escribe el trigger
-- (esa es la del cambio de estado y su INSERT no lleva reason). No se "corrige"
-- la fila del trigger: admin_actions es append-only por diseño (D9 de 71.5) y
-- reescribir auditoría desde un SECURITY DEFINER sería justo lo que ese diseño
-- prohíbe. Solo en la rama de rechazo: aprobar no tiene motivo que guardar, así
-- que no se escribe fila extra (verificado por el assert APP7).
-- ⚠️ LIMITACIÓN CONOCIDA que esto NO cierra: el espejo 'agency_rejected' de
-- #219.2 (dentro del trigger) NO lleva el motivo — el solicitante ve "tu
-- inmobiliaria fue rechazada" sin el porqué. Cerrarlo exige agencies.
-- rejection_reason (cambio de esquema) o tocar el trigger; queda REPORTADO
-- como derivada y anclado por el assert REJ5 de la suite 84.
--
-- 🔒 SECURITY DEFINER con search_path fijo. Corre como el dueño (postgres), que
-- es justo lo que le permite escribir agencies.status pese al grant de columna
-- de 0008 — por eso la autorización REAL (private.resolve_admin_actor) es la
-- primera línea del cuerpo y no una consideración secundaria.

create or replace function public.resolve_agency_registration(
  p_agency_id uuid,
  p_approve   boolean,
  p_reason    text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
  v_status   public.agency_status;
begin
  -- Primero QUIÉN: JWT de admin real o GUC urbea.admin_actor_id (71.5/D4).
  -- Antes de leer la fila: un no-admin no descubre ni si la agencia existe.
  v_admin_id := private.resolve_admin_actor();

  -- El trigger vuelve a resolver el actor dentro del UPDATE; el GUC local
  -- garantiza el MISMO admin incluso si el caller es service_role (auth.uid()
  -- NULL) — mismo mecanismo que set_agency_status_atomic (20260823000003).
  perform set_config('urbea.admin_actor_id', v_admin_id::text, true);

  -- deleted_at compuesto en el MISMO código que "no existe": para la cola, una
  -- organización borrada no está ahí (criterio de set_org_advertising_atomic).
  select status into v_status
    from public.agencies
   where id = p_agency_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'AGENCY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Verbo UNIFORME con los otros dos carriles de la cola. Cubre active,
  -- rejected y suspended: cualquiera de los tres significa "esto ya no es un
  -- registro pendiente". El trigger diría INVALID_STATUS_TRANSITION.
  if v_status <> 'pending_approval' then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;

  -- Motivo con contenido real: `~ '\S'`, NUNCA trim() (trim() solo recorta el
  -- espacio ASCII y deja pasar tabuladores/saltos de línea — hallazgo 220.1).
  if not p_approve and (p_reason is null or p_reason !~ '\S') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- EL update. Todo el efecto de negocio lo aplica el trigger, en esta misma
  -- transacción (si algo de eso revienta —p.ej. MEMBER_OF_OTHER_AGENCY—, este
  -- update y la fila de auditoría de abajo se revierten con él).
  update public.agencies
     set status = case when p_approve then 'active' else 'rejected' end::public.agency_status
   where id = p_agency_id;

  -- D-REASON: única razón de ser de esta fila — dar casa al motivo, que el
  -- esquema de agencies no tiene. Ver la cabecera.
  if not p_approve then
    insert into public.admin_actions (
      admin_id, action_type, entity_type, entity_id, old_values, new_values, reason
    )
    values (
      v_admin_id, 'reject_agency_registration', 'agency', p_agency_id,
      jsonb_build_object('status', v_status::text),
      jsonb_build_object('status', 'rejected'),
      p_reason
    );
  end if;
end;
$$;

comment on function public.resolve_agency_registration(uuid, boolean, text) is
  'Puerta ÚNICA para que el admin de plataforma resuelva un REGISTRO de '
  'inmobiliaria (pending_approval -> active|rejected) desde el panel (#221.2). '
  'Cierra el hueco de 71.5/D3: agencies.status está fuera del grant de columna '
  'a authenticated y la EF suspend-agency solo expone suspend|reactivate. '
  'WRAPPER DELGADO: valida al actor (private.resolve_admin_actor), 3 guards de '
  'puerta y UN update — la membresía owner, la promoción de role, '
  'approved_by_admin_id, la auditoría del cambio de estado y el espejo a '
  'notifications los aplica ENTERO el trigger handle_agency_status_change. '
  'Errores P0001: STATUS_CHANGE_REQUIRES_ADMIN, AGENCY_NOT_FOUND (inexistente '
  'o soft-deleted), ALREADY_RESOLVED, REASON_REQUIRED. El motivo del rechazo '
  'se guarda en admin_actions (action_type reject_agency_registration) porque '
  'agencies no tiene columna para él; el espejo agency_rejected NO lo lleva '
  '(limitación conocida, ver cabecera de la migración).';

revoke execute on function public.resolve_agency_registration(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_agency_registration(uuid, boolean, text)
  to authenticated, service_role;
