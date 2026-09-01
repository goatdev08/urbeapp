-- Migración 20260902100002 — public.resolve_agent_application (subtarea #221.2,
-- tarea 221 "cola de solicitudes", exploración 041-M4).
-- ADITIVA PURA: 1 función nueva. NADA existente se toca — ni la policy
-- agent_app_update, ni el trigger handle_agent_application_status_change, ni
-- ninguna columna. El camino viejo (UPDATE directo con JWT de admin) sigue
-- funcionando EXACTAMENTE igual (compatibilidad hacia atrás, §0.5): los builds
-- instalados y Studio no ven ningún cambio.
-- Rollback: supabase/migrations/rollbacks/20260902100002_resolve_agent_application.sql
-- Tests: supabase/tests/83_agent_application_admin_contract_test.sql (sección 5)
--
-- 🔴 POR QUÉ EXISTE, SI EL CONTRATO YA FUNCIONABA. La investigación de 221.2
-- (bitácora + secciones 1-4 de la suite 83) demostró que un admin con su JWT
-- ya resuelve una solicitud con un UPDATE directo: la policy agent_app_update
-- (20260604000010) lo deja escribir y el trigger de 71.5 (cuerpo vigente en
-- 20260826000001 tras #219.2) valida el grafo {pending->approved|rejected},
-- exige rejection_reason al rechazar, estampa reviewed_by_admin_id/reviewed_at,
-- promueve role solo si application_type='independent', audita en
-- admin_actions y escribe el espejo a notifications. Esta RPC NO reemplaza
-- nada de eso: es una PUERTA, pedida por integración (decisión del orquestador
-- 2026-09-01):
--   (a) el cliente móvil de la cola (#221.4) ya está escrito contra
--       client.rpc('resolve_agent_application', …);
--   (b) los tres carriles de la cola M4 (cuenta comercial, agente,
--       inmobiliaria) quedan con el MISMO vocabulario de error
--       (…_NOT_FOUND / ALREADY_RESOLVED / REASON_REQUIRED) en vez de tres
--       formas distintas de fallar — un `switch` en el cliente, no tres.
--
-- 🔴 WRAPPER DELGADO, NO UNA SEGUNDA COPIA. El cuerpo hace 4 validaciones de
-- PUERTA y UN update. La lógica de negocio (grafo de estados, promoción de
-- role, auditoría, espejo) NO se repite aquí ni una línea: sigue viviendo
-- ENTERA en el trigger, que se dispara por ese mismo update. Duplicarla
-- crearía dos copias que se desincronizan (precedente #183, la ventana del
-- reaper; mismo criterio que set_org_advertising_atomic 20260823000001 y la EF
-- suspend-agency, que también delegan en el trigger).
--
-- 🔒 SECURITY DEFINER con search_path fijo (un definer sin search_path fijo es
-- escalada de privilegios). Corre como el dueño (postgres), así que el UPDATE
-- no depende de la policy agent_app_update — la autorización REAL la da
-- private.resolve_admin_actor() en la primera línea del cuerpo.

create or replace function public.resolve_agent_application(
  p_application_id uuid,
  p_approve        boolean,
  p_reason         text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
  v_status   public.agent_application_status;
begin
  -- Primero QUIÉN: JWT de admin real o GUC urbea.admin_actor_id (71.5/D4).
  -- Sin admin -> P0001 STATUS_CHANGE_REQUIRES_ADMIN, ANTES de leer la fila
  -- (no se revela si la solicitud existe).
  v_admin_id := private.resolve_admin_actor();

  -- El trigger vuelve a llamar a resolve_admin_actor() dentro del UPDATE de
  -- abajo. Instalar el GUC aquí (is_local => vive solo en esta transacción)
  -- garantiza que resuelva al MISMO actor incluso cuando el caller es
  -- service_role (auth.uid() NULL) — mismo mecanismo que el overload de 4
  -- argumentos de set_org_advertising_atomic (20260823000001).
  perform set_config('urbea.admin_actor_id', v_admin_id::text, true);

  select status into v_status
    from public.agent_applications
   where id = p_application_id
   for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Verbo UNIFORME con resolve_advertising_request / resolve_agency_registration.
  -- El trigger diría INVALID_STATUS_TRANSITION para el mismo caso; este guard
  -- corre antes justamente para que el cliente reciba siempre el mismo código.
  if v_status <> 'pending' then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;

  -- Motivo con contenido real. `~ '\S'` y NUNCA trim(): trim() en Postgres solo
  -- recorta el espacio ASCII y deja pasar tabuladores/saltos de línea (hallazgo
  -- 220.1). El trigger ya exige rejection_reason NOT NULL, pero su mensaje
  -- (REJECTION_REASON_REQUIRED) no es el verbo uniforme y no caza el string en
  -- blanco.
  if not p_approve and (p_reason is null or p_reason !~ '\S') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- EL update. Todo lo demás lo hace el trigger, en esta misma transacción.
  update public.agent_applications
     set status           = case when p_approve then 'approved' else 'rejected' end::public.agent_application_status,
         rejection_reason = case when p_approve then rejection_reason else p_reason end
   where id = p_application_id;
end;
$$;

comment on function public.resolve_agent_application(uuid, boolean, text) is
  'Puerta ÚNICA para que el admin de plataforma resuelva una solicitud de '
  'agente desde el panel (#221.2). WRAPPER DELGADO: valida al actor con '
  'private.resolve_admin_actor(), aplica 3 guards de puerta y hace UN update '
  'sobre agent_applications. El grafo de estados, la promoción de role, la '
  'auditoría en admin_actions y el espejo a notifications los sigue aplicando '
  'ENTERO el trigger handle_agent_application_status_change (71.5/#219.2) — '
  'esta RPC no los duplica. Errores P0001: STATUS_CHANGE_REQUIRES_ADMIN, '
  'APPLICATION_NOT_FOUND, ALREADY_RESOLVED (verbo uniforme, en vez del '
  'INVALID_STATUS_TRANSITION del trigger), REASON_REQUIRED. El UPDATE directo '
  'con JWT de admin sigue siendo válido: esta función NO lo reemplaza.';

revoke execute on function public.resolve_agent_application(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_agent_application(uuid, boolean, text)
  to authenticated, service_role;
