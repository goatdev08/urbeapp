-- Migración 20260809000006 — publish_property_atomic: acepta p_price_visible (#129)
--
-- Origen: subtarea 73.3 · Detectado por: code review PR #56. El wizard (step3)
-- recoge el toggle "Mostrar precio en el feed" y el móvil lo manda en el payload,
-- pero ni la Edge Function publish-property ni esta RPC conocían el campo: la
-- fila nacía SIEMPRE con el default de columna (price_visible=true), aunque el
-- agente lo apagara. Al EDITAR sí se respetaba (edit-property lo pasa) —
-- inconsistencia pura entre crear y editar.
--
-- Extiende publish_property_atomic (última versión: 20260809000005) con
-- `p_price_visible boolean default true` (mismo default que la columna
-- properties.price_visible, 20260604000005) y lo escribe en el INSERT.
--
-- Cambia el shape de argumentos (16 → 17), así que hace falta DROP explícito
-- del overload de 16 args antes del CREATE OR REPLACE de 17 — mismo patrón que
-- 20260809000005 (que hizo lo mismo al agregar p_property_status): sin el DROP,
-- Postgres deja las DOS funciones conviviendo en el catálogo.
--
-- ⚠️ p_property_status conserva su `default 'active'` TAL CUAL — cambiarlo es
-- alcance de #133 (con su pgTAP assert 36, que hoy fija ese default).
--
-- Idempotente: drop function if exists (overload viejo) + create or replace.
-- Rollback: supabase/migrations/rollbacks/20260809000006_publish_property_atomic_price_visible.sql
-- Tests: supabase/tests/06_publish_property_rpc_test.sql (asserts 38-39:
-- p_price_visible=false llega a la fila real; omitido → true).

-- Overload viejo (16 args, sin p_price_visible) — fuera del catálogo primero.
drop function if exists public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text, text
);

create or replace function public.publish_property_atomic(
  p_user_id             uuid,
  p_operation_type      text,
  p_property_type       text,
  p_price               numeric,
  p_bedrooms            integer  default null,
  p_bathrooms           integer  default null,
  p_square_meters       numeric  default null,
  p_address             text     default null,
  p_lat                 double precision default null,
  p_lng                 double precision default null,
  p_pet_friendly        boolean  default false,
  p_allows_no_guarantor boolean  default false,
  p_student_friendly    boolean  default false,
  p_description         text     default null,
  p_cloudflare_uid      text     default null,
  p_property_status     text     default 'active',
  p_price_visible       boolean  default true
)
returns table(property_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_property_id       uuid;
  v_video_id          uuid;
  v_agency_id         uuid;
  v_membership_status text;
begin
  -- Guard: parámetros obligatorios
  if p_user_id is null then
    raise exception 'user_id es requerido' using errcode = 'P0001';
  end if;
  if p_address is null or trim(p_address) = '' then
    raise exception 'address es requerido' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'lat y lng son requeridos para ST_Point' using errcode = 'P0001';
  end if;
  if p_cloudflare_uid is null or trim(p_cloudflare_uid) = '' then
    raise exception 'cloudflare_uid es requerido' using errcode = 'P0001';
  end if;
  if p_property_status is null or trim(p_property_status) = '' then
    raise exception 'property_status es requerido' using errcode = 'P0001';
  end if;

  -- Fix 100: resolver la membresía de agencia del publicante ANTES de insertar
  -- (desempate ORDER BY: la fila ACTIVE siempre gana sobre una suspended vieja
  -- de otra agencia — ver 20260805000011 para el detalle completo).
  select agency_id, status
    into v_agency_id, v_membership_status
    from public.agency_members
   where user_id = p_user_id
     and status in ('active', 'suspended')
   order by (status = 'active') desc
   limit 1;

  if v_membership_status = 'suspended' then
    raise exception 'AGENCY_MEMBERSHIP_SUSPENDED' using errcode = 'P0001';
  end if;

  -- INSERT properties
  -- status = p_property_status (73.4: no hardcodeado; el cast ::property_status
  -- rechaza valores fuera del enum). price_visible = p_price_visible (#129:
  -- antes ni existía el parámetro y la columna caía siempre en su default true).
  -- coalesce: null explícito del caller → default de la columna (true), la
  -- columna es NOT NULL.
  insert into public.properties (
    owner_user_id,
    agency_id,
    operation_type,
    property_type,
    price,
    bedrooms,
    bathrooms,
    square_meters,
    address,
    location,
    pet_friendly,
    allows_no_guarantor,
    student_friendly,
    price_visible,
    description,
    status,
    published_at
  )
  values (
    p_user_id,
    v_agency_id,
    p_operation_type::operation_type,
    p_property_type::property_type,
    p_price,
    p_bedrooms,
    p_bathrooms,
    p_square_meters,
    p_address,
    extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography,
    p_pet_friendly,
    p_allows_no_guarantor,
    p_student_friendly,
    coalesce(p_price_visible, true),
    p_description,
    p_property_status::property_status,
    now()
  )
  returning id into v_property_id;

  -- 73.4: registrar el slot de video (semilla #76/pagos) en la MISMA transacción.
  -- Sin bloque exception alrededor a propósito: si este INSERT falla, la
  -- excepción se propaga sin capturar y hace ROLLBACK de TODO el INSERT de
  -- properties de arriba — no puede quedar una propiedad creada sin su slot.
  insert into public.property_video_slots (property_id) values (v_property_id);

  -- ENLAZAR (UPDATE) el video en vuelo — NO insertar una fila nueva.
  update public.property_videos
     set property_id = v_property_id,
         position = 1
   where public.property_videos.cloudflare_uid = p_cloudflare_uid
     and public.property_videos.agent_id = p_user_id
     and public.property_videos.property_id is null
     and public.property_videos.status in ('processing', 'ready')
     and public.property_videos.deleted_at is null
  returning public.property_videos.id into v_video_id;

  -- Si el UPDATE no afectó ninguna fila, hace ROLLBACK del INSERT de properties
  -- Y del slot de arriba (no hay bloque EXCEPTION que capture el error) —
  -- atomicidad: no puede quedar una propiedad activa sin su video enlazado.
  if v_video_id is null then
    raise exception 'video en vuelo no encontrado, no pertenece al usuario o no está listo para enlazar' using errcode='P0001';
  end if;

  return query select v_property_id;
end;
$$;

comment on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text, text, boolean
) is
  '#129: acepta p_price_visible (default true, igual que la columna) y lo escribe '
  'en el INSERT — antes el toggle del wizard moría en la EF y la fila nacía '
  'siempre visible. 73.4: recibe property_status como parámetro (default '
  '''active'' por compat — #133 lo revisará) y lo usa TAL CUAL en el INSERT. '
  'En la MISMA transacción registra el slot de video (property_video_slots) y '
  'enlaza (UPDATE) su video en vuelo. Fix 100: resuelve la membresía de agencia '
  'del publicante — bloquea con AGENCY_MEMBERSHIP_SUSPENDED si está suspendido '
  'y denormaliza properties.agency_id.';

-- Grant para service_role (la EF llama con service_role key).
grant execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text, text, boolean
) to service_role;
