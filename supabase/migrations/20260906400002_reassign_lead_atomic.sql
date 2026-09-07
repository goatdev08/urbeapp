-- Migración 20260906400002 — reassign_lead_atomic: el owner/admin de la agencia reasigna un
-- lead existente a otro miembro ACTIVO, con auditoría en admin_actions y aviso SOLO al agente
-- destino (subtarea 269.2, exploración 045 §6.6/§14 T-E, fila D10-bis de §18).
--
-- Contrato completo (edge cases, decisiones D-ACTION/D-NOTIF/D-CLOSED/D-ADMIN-PLATFORM/D-ORDER):
-- cabecera de supabase/tests/108_reassign_lead_atomic_test.sql (RED, 2026-09-06).
-- Rollback: supabase/migrations/rollbacks/20260906400002_reassign_lead_atomic.sql
--
-- Molde: public.reassign_member_properties_atomic (20260904200001) — mismo criterio
-- anti-enumeración (LEAD_NOT_FOUND cubre "no existe" y "no autorizado") y mismo patrón de
-- ancla parcial de idempotencia en notifications (notifications_lead_unmanaged_anchor_idx).
-- ADAPTADO: la agencia se deriva de leads.agency_id, sin parámetro p_agency_id -- el molde
-- reasigna PROPIEDADES de una agencia dada; esta RPC reasigna UN lead, y su agencia es un
-- dato del lead, no una entrada del caller (evita que alguien pase una agencia distinta a la
-- del lead y confunda la autorización).
--
-- ADITIVA: 0 columnas nuevas, 0 tablas nuevas, 0 policies tocadas. Un índice parcial nuevo y
-- una función nueva.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Ancla de idempotencia del aviso lead_reassigned. Patrón EXACTO de
--    notifications_lead_unmanaged_anchor_idx (20260904200001): parcial SOLO por type.
--    D-NOTIF (test-author, 108): cada destino recibe UNA sola notificación por lead aunque
--    la cadena de reasignaciones vuelva a él (A→B→C→B mantiene 1 fila para B).
-- ════════════════════════════════════════════════════════════════════════════

create unique index if not exists notifications_lead_reassigned_anchor_idx
  on public.notifications (user_id, related_entity_id, type)
  where type = 'lead_reassigned';

comment on index public.notifications_lead_reassigned_anchor_idx is
  'Ancla de idempotencia de lead_reassigned (#269.2). Parcial SOLO por type -- mismo criterio '
  'que notifications_lead_unmanaged_anchor_idx (20260904200001): un destino repetido en una '
  'cadena de reasignaciones (A->B->C->B) recibe UNA sola notificación, aunque admin_actions '
  'audite las 3 (D-ACTION, sin ancla -- cada reasignación es un hecho distinto).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.reassign_lead_atomic — reasigna un lead existente dentro de SU MISMA agencia.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.reassign_lead_atomic(
  p_lead_id  uuid,
  p_to_agent uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id     uuid;
  v_agency_id     uuid;
  v_from_agent_id uuid;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  -- 🔒 LEAD_NOT_FOUND: UN SOLO código para 8 causas (anti-enumeración, mismo criterio que
  -- NOT_AUTHORIZED en reassign_member_properties_atomic): lead inexistente, borrado,
  -- agency_id NULL (independiente), o caller que no es owner/admin ACTIVO de la agencia del
  -- lead (agente raso, viewer, owner suspendido, owner de otra agencia, admin de PLATAFORMA
  -- sin membresía -- D-ADMIN-PLATFORM, is_admin() no amplía esta RPC). private.agency_role_of
  -- ya filtra por status='active', así que un owner/admin suspendido cae aquí también.
  select l.agency_id, l.agent_id
    into v_agency_id, v_from_agent_id
    from public.leads l
   where l.id = p_lead_id
     and l.deleted_at is null
     and l.agency_id is not null
     and coalesce(private.agency_role_of(l.agency_id)::text, '') in ('owner', 'admin');

  if v_agency_id is null then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_to_agent = v_from_agent_id then
    raise exception 'SAME_USER' using errcode = 'P0001';
  end if;

  -- El destino tiene que poder ATENDER el lead: cualquier member_role sirve salvo viewer
  -- (el owner puede quedárselo él mismo). Difiere A PROPÓSITO del molde
  -- reassign_member_properties_atomic, que acepta viewer: un viewer no gestiona leads
  -- (fijado por TGT1 en 108_reassign_lead_atomic_test.sql).
  if not exists (
    select 1 from public.agency_members am
     where am.agency_id = v_agency_id
       and am.user_id   = p_to_agent
       and am.status    = 'active'
       and am.member_role <> 'viewer'
  ) then
    raise exception 'TARGET_NOT_ACTIVE_MEMBER' using errcode = 'P0001';
  end if;

  -- El origen NO necesita estar suspendido (herramienta de gestión, no castigo atado a la
  -- suspensión -- mismo criterio que el molde) y un lead CERRADO se reasigna igual: no hay
  -- regla que lo prohíba y el status no cambia (D-CLOSED).
  update public.leads
     set agent_id = p_to_agent
   where id = p_lead_id;

  -- D-ACTION: SIEMPRE inserta, sin ancla (cada reasignación es un HECHO auditable distinto,
  -- mismo criterio que reassign_member_properties_atomic). La policy admin_actions_insert
  -- exige is_admin(), que el caller no es: de ahí security definer.
  insert into public.admin_actions (
    admin_id, action_type, entity_type, entity_id, old_values, new_values
  ) values (
    v_caller_id,
    'lead_reassigned',
    'lead',
    p_lead_id,
    jsonb_build_object('from_agent_id', v_from_agent_id),
    jsonb_build_object('to_agent_id', p_to_agent)
  );

  -- D-NOTIF: SOLO al destino, con ancla de idempotencia. 🔒 D10-bis (decisión de Abraham
  -- 2026-09-07, sustituye el "aviso al buscador" de la 045 D10): ni el buscador
  -- (leads.user_id) ni el agente origen reciben nada.
  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  ) values (
    p_to_agent,
    'lead_reassigned',
    'Te reasignaron un lead',
    'Un lead de tu inmobiliaria ahora está a tu cargo. Atiéndelo desde el CRM.',
    '/crm',
    'lead',
    p_lead_id,
    jsonb_build_object('from_agent_id', v_from_agent_id)
  )
  on conflict (user_id, related_entity_id, type) where type = 'lead_reassigned'
    do nothing;
end;
$$;

comment on function public.reassign_lead_atomic(uuid, uuid) is
  'Reasigna UN lead existente a otro miembro ACTIVO de SU MISMA agencia (#269.2, exploración '
  '045 §6.6/§14 T-E). La agencia se deriva de leads.agency_id (sin parámetro). Solo '
  'owner/admin ACTIVO de esa agencia; el destino debe ser miembro ACTIVO no-viewer. '
  'Códigos P0001: NOT_AUTHENTICATED, LEAD_NOT_FOUND (anti-enumeración: 8 causas, incluida '
  'is_admin() de plataforma sin membresía -- D-ADMIN-PLATFORM), SAME_USER, '
  'TARGET_NOT_ACTIVE_MEMBER. Un lead CERRADO se reasigna igual (D-CLOSED, status intacto). '
  'Atómica: agent_id + auditoría (admin_actions, SIEMPRE inserta, sin ancla -- D-ACTION) + '
  'aviso type=lead_reassigned SOLO al destino, idempotente por '
  'notifications_lead_reassigned_anchor_idx (D-NOTIF). 🔒 D10-bis: ni el buscador '
  '(leads.user_id) ni el agente origen reciben notificación -- sustituye el "aviso al '
  'buscador" previsto en la 045 D10.';

revoke execute on function public.reassign_lead_atomic(uuid, uuid) from public, anon;
grant  execute on function public.reassign_lead_atomic(uuid, uuid) to authenticated;
