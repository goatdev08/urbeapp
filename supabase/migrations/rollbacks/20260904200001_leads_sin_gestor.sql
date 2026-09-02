-- Rollback: 20260904200001_leads_sin_gestor.sql (tarea #203, subtarea 203.1)
--
-- No destructivo. Lo que YA ocurrió es un HECHO de negocio y se queda:
--   · Las propiedades ya reasignadas conservan su dueño nuevo (revertirlas
--     dejaría inventario vivo otra vez sin gestor, que es justo el bug).
--   · Los avisos lead_unmanaged / properties_reassigned ya entregados siguen en
--     public.notifications: son filas normales que el cliente renderiza por su
--     deep_link genérico, ningún componente conoce esos `type`.
--   · Los leads que ya nacieron con agency_id de una agencia donde el agente
--     está suspendido lo CONSERVAN (la columna nunca se reevalúa tras el
--     INSERT, comment de leads.agency_id). Es lo correcto: el owner sigue
--     viéndolos. Lo único que se pierde es el ruteo de los leads NUEVOS.
-- Lo que sí desaparece: la capacidad de crear reasignaciones nuevas, el aviso
-- automático, y el fallback de ruteo.
--
-- 🔴 ORDEN respecto al cliente (§0.5): el OTA que quita el botón «Reasignar
-- publicaciones» va PRIMERO. Un build que llame la RPC tras revertirla recibe
-- 42883 y el mapa de errores del hook cae a «No se pudo reasignar».
--
-- Re-ejecutable (if exists / create or replace).

drop function if exists public.reassign_member_properties_atomic(uuid, uuid, uuid);

drop trigger  if exists leads_notify_unmanaged on public.leads;
drop function if exists public.notify_lead_unmanaged();

drop index if exists public.notifications_lead_unmanaged_anchor_idx;

-- private.set_lead_agency_id vuelve LITERALMENTE a la definición de
-- 20260807000006:84-105 (misma firma, mismos atributos, mismo comment): el
-- trigger trg_set_lead_agency_id sigue apuntando a ella, no se toca.
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
  end if;
  return new;
end;
$$;

comment on function private.set_lead_agency_id() is
  'BEFORE INSERT en public.leads: fija agency_id = la agencia donde el agente (agent_id) '
  'está ACTIVO al momento de crear el lead (NULL si es independiente). Nunca se reevalúa '
  'después -- un switch_agency_atomic posterior no reescribe leads ya creados (fix 75.5-bis).';
