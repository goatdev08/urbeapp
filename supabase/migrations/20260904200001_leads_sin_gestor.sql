-- Migración 20260904200001 — el lead de un agente suspendido nace bajo su
-- inmobiliaria, avisa al owner/admin, y el inventario se puede reasignar
-- (tarea #203, subtarea 203.1). ADITIVA: 0 columnas nuevas, 0 tablas, 0
-- policies tocadas. Un índice parcial nuevo, dos funciones nuevas, un trigger
-- nuevo, y private.set_lead_agency_id extendida por CREATE OR REPLACE con la
-- MISMA firma y los MISMOS atributos.
--
-- Contrato completo (edge cases, invariantes 🔒, convención DELTA/INVARIANTE/
-- GUARD): cabecera de supabase/tests/91_leads_sin_gestor_test.sql (RED,
-- 2026-09-04).
-- Rollback: supabase/migrations/rollbacks/20260904200001_leads_sin_gestor.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL PROBLEMA — el lead no llega a una cuenta congelada, no llega A NADIE
--
-- private.set_lead_agency_id (20260807000006:84-100) resolvía la agencia del
-- lead SOLO desde la membresía `active`. Con el agente suspendido ninguna fila
-- matchea y leads.agency_id nace NULL; y como leads_select (20260901000001) es
--     agent_id = auth.uid() OR private.agency_role_of(agency_id) in ('owner','admin')
-- un agency_id NULL deja al owner y al admin de la inmobiliaria SIN VER el
-- lead. Una persona real escribió pidiendo ver una casa y ese mensaje quedó en
-- un buzón que nadie abre. El daño es al buscador y a la inmobiliaria — no al
-- agente, que es a quien se quiso sancionar.
--
-- 🔴 Regla 3 de la definición de suspensión (#202, Abraham 2026-08-21): «lo que
-- quedó vivo pasa al control de la agencia». La suspensión es del AGENTE, NO de
-- su inventario: las propiedades NO se pausan automáticamente. Pausarlas
-- castigaría a la inmobiliaria, que no hizo nada, y destruiría inventario vivo.
--
-- ── Por qué esta forma y no otra ────────────────────────────────────────────
-- La alternativa (reapuntar el lead al owner) cambiaría el interlocutor del
-- buscador en silencio y reescribiría leads_select, el CRM y contact-agent. Con
-- el fallback de agency_id, el lead se queda con SU agente (agent_id intacto) y
-- la visibilidad del owner/admin sale GRATIS de la policy que ya existe: cero
-- policies tocadas. Lo que faltaba no era el acceso, era que el owner SUPIERA
-- que el lead está ahí — de ahí el aviso.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Ancla de idempotencia del aviso lead_unmanaged.
--    Patrón EXACTO de notifications_admin_agency_pending_anchor_idx
--    (20260825000001): parcial SOLO por type, nunca por deleted_at (un aviso
--    BORRADO por el owner sigue ocupando la llave). Un lead nace una sola vez,
--    así que el conflicto es teórico -- el índice es el invariante de ESQUEMA
--    que hace del doble disparo un no-op silencioso en vez de un error que
--    aborte el INSERT del lead (y con él, el contacto del buscador).
-- ════════════════════════════════════════════════════════════════════════════

create unique index if not exists notifications_lead_unmanaged_anchor_idx
  on public.notifications (user_id, related_entity_id, type)
  where type = 'lead_unmanaged';

comment on index public.notifications_lead_unmanaged_anchor_idx is
  'Ancla de idempotencia de lead_unmanaged (#203.1). Parcial SOLO por type '
  '-- ver comment de notifications_admin_ad_pending_anchor_idx (20260825000001).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) private.set_lead_agency_id — fallback a la membresía SUSPENDIDA.
--    CREATE OR REPLACE con la MISMA firma, MISMO lenguaje, MISMOS atributos
--    (security definer, search_path='') y el MISMO trigger BEFORE INSERT: no
--    hay contrato publicado que cambie, ningún build instalado lo nota.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function private.set_lead_agency_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agency_id is null then
    select am.agency_id into new.agency_id
      from public.agency_members am
     where am.user_id = new.agent_id
       and am.status = 'active'
     limit 1;  -- agency_members_one_active_per_user (0003) garantiza a lo más 1 fila

    -- Sin membresía activa: la SUSPENDIDA más reciente (#203.1). El agente
    -- congelado sigue perteneciendo a su inmobiliaria -- suspender es congelar
    -- la cuenta, no disolver la relación laboral.
    --
    -- `order by created_at desc limit 1` porque agency_members_one_active_per_user
    -- SOLO restringe las filas 'active': un mismo usuario puede acumular varias
    -- filas 'suspended' históricas (una por inmobiliaria por la que pasó), y la
    -- vigente es la última. No se usa updated_at a propósito: lo toca cualquier
    -- edición de la fila (set_updated_at, 0003), no solo la suspensión, así que
    -- reordenaría el histórico por un cambio de member_role.
    --
    -- 🔒 'removed' NO entra: el que SALIÓ de la inmobiliaria se llevó su
    -- cartera, y darle sus leads nuevos a la ex-agencia sería una fuga de PII
    -- del buscador (mismo criterio que la separación agente independiente /
    -- agencia de 75.5-bis). Sin membresía tampoco: el agente independiente no
    -- le pertenece a nadie. Ambos siguen dando NULL, exactamente como hoy.
    if new.agency_id is null then
      select am.agency_id into new.agency_id
        from public.agency_members am
       where am.user_id = new.agent_id
         and am.status = 'suspended'
       order by am.created_at desc
       limit 1;
    end if;
  end if;
  return new;
end;
$$;

comment on function private.set_lead_agency_id() is
  'BEFORE INSERT en public.leads: fija agency_id = la agencia donde el agente '
  '(agent_id) está ACTIVO al momento de crear el lead; si no está activo en '
  'ninguna, la agencia donde está SUSPENDIDO más recientemente por created_at '
  '(#203.1 -- si no, el lead nacía sin agencia y ni el owner ni el admin lo '
  'veían por leads_select: no llegaba a NADIE). removed / sin membresía siguen '
  'dando NULL (agente independiente o que ya salió). Nunca se reevalúa después '
  '-- un switch_agency_atomic posterior no reescribe leads ya creados (fix '
  '75.5-bis).';

-- El trigger no cambia (misma función, mismo BEFORE INSERT). Se redeclara solo
-- por idempotencia de la migración.
drop trigger if exists trg_set_lead_agency_id on public.leads;
create trigger trg_set_lead_agency_id
  before insert on public.leads
  for each row execute function private.set_lead_agency_id();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) public.notify_lead_unmanaged — AFTER INSERT en leads.
--    Que el lead sea VISIBLE no basta: el owner tiene que ENTERARSE. Patrón de
--    fan-out a owner/admin ACTIVOS de 20260825000001 / notify_ads_expiring_soon
--    (20260822000001).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.notify_lead_unmanaged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_name text;
begin
  -- Solo cuando el agente del lead está SUSPENDIDO en la agencia del lead. El
  -- caso sano (agente activo) sale por aquí sin tocar notifications: si no, cada
  -- lead normal de la plataforma spamearía a su owner (assert N8 del RED).
  if not exists (
    select 1
      from public.agency_members am
     where am.agency_id = new.agency_id
       and am.user_id = new.agent_id
       and am.status = 'suspended'
  ) then
    return new;
  end if;

  -- El owner tiene que saber DE QUIÉN es el lead sin abrir la app. Sin nombre
  -- de perfil el aviso sigue siendo una frase en español, no
  -- 'contactó a , cuya cuenta...'.
  select nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')
    into v_agent_name
    from public.users u
   where u.id = new.agent_id;
  v_agent_name := coalesce(v_agent_name, 'un agente suspendido');

  -- 🔒 Ni el nombre ni el teléfono del BUSCADOR viajan en el aviso: el aviso
  -- dice que hay un lead y a dónde ir, el dato personal se ve en el CRM, que
  -- ya tiene su propia capa de identidad (can_view_user_as_lead_searcher).
  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  )
  select
    am.user_id,
    'lead_unmanaged',
    'Nuevo lead sin gestor',
    'Un buscador contactó a ' || v_agent_name ||
      ', cuya cuenta está suspendida. Atiéndelo desde el CRM.',
    '/crm',
    'lead',
    new.id,
    jsonb_build_object('agent_user_id', new.agent_id, 'agent_name', v_agent_name)
  from public.agency_members am
  where am.agency_id = new.agency_id
    and am.status = 'active'                       -- una cuenta congelada tampoco abre ese buzón
    and am.member_role in ('owner', 'admin')       -- el viewer no entra al pipeline comercial
    and am.user_id <> new.agent_id                 -- avisarle al suspendido es el bug original con otro nombre
  on conflict (user_id, related_entity_id, type) where type = 'lead_unmanaged'
    do nothing;

  return new;
end;
$$;

comment on function public.notify_lead_unmanaged() is
  'AFTER INSERT en public.leads (#203.1): cuando el agente del lead está '
  'SUSPENDIDO en la agencia del lead, avisa type=lead_unmanaged a cada '
  'owner/admin ACTIVO de esa agencia (nunca al viewer, nunca a un owner '
  'suspendido, nunca al propio agente). Agente activo -> cero filas. Sin '
  'bloque EXCEPTION a propósito (mismo criterio que 20260825000001): el ON '
  'CONFLICT DO NOTHING cubre el doble disparo y cualquier OTRO fallo debe '
  'abortar el INSERT del lead entero en vez de dejar un lead que nadie sabe '
  'que existe.';

drop trigger if exists leads_notify_unmanaged on public.leads;
create trigger leads_notify_unmanaged
  after insert on public.leads
  for each row
  when (new.agency_id is not null)
  execute function public.notify_lead_unmanaged();

-- ════════════════════════════════════════════════════════════════════════════
-- 4) public.reassign_member_properties_atomic — el owner/admin pasa el
--    inventario de un miembro a otro, en una sola transacción y auditado.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.reassign_member_properties_atomic(
  p_agency_id    uuid,
  p_from_user_id uuid,
  p_to_user_id   uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_id    uuid;
  v_role         public.agency_member_role;
  v_property_ids uuid[];
  v_count        integer;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  -- 🔒 UN SOLO código para 4 causas (no es miembro · es agente raso · es
  -- viewer · la agencia no existe): distinguirlas convertiría la RPC en un
  -- oráculo de qué inmobiliarias existen y de quién es miembro de cuál (mismo
  -- criterio anti-enumeración que PROPERTY_NOT_FOUND en promote_property_atomic,
  -- 20260903300002). agency_role_of ya filtra por status='active', así que un
  -- owner SUSPENDIDO tampoco reasigna.
  v_role := private.agency_role_of(p_agency_id);
  if coalesce(v_role::text, '') not in ('owner', 'admin') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_from_user_id = p_to_user_id then
    raise exception 'SAME_USER' using errcode = 'P0001';
  end if;

  -- El destino tiene que poder ATENDER lo que recibe: mover el inventario a
  -- otra cuenta congelada (o a quien ya se fue) sería el mismo bug otra vez.
  -- Cualquier member_role sirve -- el owner puede quedarse el inventario él
  -- mismo, que es el caso normal cuando no hay a quién más pasárselo.
  if not exists (
    select 1 from public.agency_members am
     where am.agency_id = p_agency_id
       and am.user_id   = p_to_user_id
       and am.status    = 'active'
  ) then
    raise exception 'TARGET_NOT_ACTIVE_MEMBER' using errcode = 'P0001';
  end if;

  -- p_from_user_id NO necesita estar suspendido: reasignar es una herramienta
  -- de gestión de la inmobiliaria (es SU inventario), no un castigo atado a la
  -- suspensión. Se mueve la propiedad en CUALQUIER estado no borrado -- una
  -- pausada o cerrada sigue siendo inventario de la agencia; filtrar por
  -- status='active' dejaría medio catálogo sin gestor.
  --
  -- El UPDATE ... RETURNING dentro de un CTE en vez de `get diagnostics`: hace
  -- falta la LISTA de ids para la auditoría, y leerla en un SELECT aparte
  -- después del UPDATE ya no encontraría nada (las filas cambiaron de dueño).
  -- El `order by` hace la auditoría determinista.
  with moved as (
    update public.properties p
       set owner_user_id = p_to_user_id
     where p.agency_id     = p_agency_id
       and p.owner_user_id = p_from_user_id
       and p.deleted_at is null
    returning p.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[]), count(*)::integer
    into v_property_ids, v_count
  from moved;

  -- 0 NO es error: es el caso normal de un miembro sin inventario y el del
  -- doble tap en el botón. Sin filas movidas no hay hecho que auditar ni nada
  -- que avisarle al destino.
  if v_count = 0 then
    return 0;
  end if;

  -- 🔒 §0.5: reasignar toca datos de personas reales -> queda auditado con los
  -- ids EXACTOS que se movieron, no solo el conteo (sin ellos la fila no
  -- permite revertir nada). La policy admin_actions_insert exige is_admin(),
  -- que el caller no es: por eso security definer (precedente
  -- set_org_advertising_atomic, 20260823000002).
  insert into public.admin_actions (
    admin_id, action_type, entity_type, entity_id, old_values, new_values
  ) values (
    v_caller_id,
    'reassign_member_properties',
    'agency',
    p_agency_id,
    jsonb_build_object('from_user_id', p_from_user_id, 'property_ids', to_jsonb(v_property_ids)),
    jsonb_build_object('to_user_id', p_to_user_id, 'count', v_count)
  );

  -- Sin ancla de idempotencia a propósito (a diferencia de lead_unmanaged):
  -- cada reasignación es un HECHO distinto con su propio conteo, y un índice
  -- sobre (user_id, related_entity_id, type) tragaría en silencio la segunda
  -- reasignación de la misma agencia al mismo miembro (mismo criterio que
  -- admin_revision_pending, 20260825000001).
  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  ) values (
    p_to_user_id,
    'properties_reassigned',
    'Te asignaron publicaciones',
    v_count::text || ' publicación(es) de tu inmobiliaria ahora están a tu cargo.',
    '/profile/my-listings',
    'agency',
    p_agency_id,
    jsonb_build_object('count', v_count, 'from_user_id', p_from_user_id)
  );

  return v_count;
end;
$$;

comment on function public.reassign_member_properties_atomic(uuid, uuid, uuid) is
  'Pasa TODAS las publicaciones no borradas de un miembro a otro dentro de la '
  'MISMA inmobiliaria (#203.1): el inventario de un agente suspendido no se '
  'queda sin gestor. Solo owner/admin ACTIVO de esa agencia; el destino debe '
  'ser miembro ACTIVO (cualquier member_role -- el owner puede quedárselo). El '
  'origen NO necesita estar suspendido: es una herramienta de gestión, no un '
  'castigo. Mueve cualquier estado no borrado (una pausada sigue siendo '
  'inventario). Devuelve cuántas movió; 0 NO es error. Atómica: propiedades + '
  'auditoría (admin_actions con los property_ids) + aviso al destino, o nada. '
  'Códigos P0001: NOT_AUTHENTICATED, NOT_AUTHORIZED (un solo código para 4 '
  'causas, anti-enumeración), SAME_USER, TARGET_NOT_ACTIVE_MEMBER. '
  '🔒 Los LEADS existentes NO se tocan: el buscador no cambia de interlocutor '
  'en silencio. Los leads NUEVOS de esas propiedades ya llegan al dueño nuevo '
  'porque contact-agent resuelve el agente por properties.owner_user_id. '
  '-- ponytail: reasignar leads con aviso al buscador es fase 2.';

revoke execute on function public.reassign_member_properties_atomic(uuid, uuid, uuid) from public, anon;
grant  execute on function public.reassign_member_properties_atomic(uuid, uuid, uuid) to authenticated;
