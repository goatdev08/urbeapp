-- Migración — Denormalización de agency_id + suspensión efectiva en el publish
-- real (tarea derivada #100, origen subtareas 71.2/71.6). 2 hallazgos ALTO +
-- 1 MEDIO del review del PR #41 (lente SQL):
--
--   FIX 1 (ALTO, suspensión no efectiva): publish_property_atomic es
--   SECURITY DEFINER -- bypasea RLS por diseño. La cláusula de suspensión de
--   20260805000009 (properties_insert: agency_id is null or agency_role_of(
--   agency_id) is not null) solo protege el INSERT directo por PostgREST; el
--   flujo real (EF publish-property -> este RPC) nunca la evalúa. Un agente
--   SUSPENDIDO publicaba normal. Fix: el RPC ahora resuelve la membresía del
--   publicante (active|suspended) y aborta con AGENCY_MEMBERSHIP_SUSPENDED si
--   está suspendida. Desempate explícito (ORDER BY status='active' DESC): el
--   único índice único parcial es sobre status='active' (0003) -- nada impide
--   que un usuario tenga una fila 'suspended' vieja en la agencia Y Y una
--   'active' nueva en X (redeem_invitation_atomic/upgrade_to_agent_atomic solo
--   chequean unique_violation sobre el índice active, no bloquean el redeem si
--   hay una fila suspended en OTRA agencia). Sin el desempate, LIMIT 1 sin
--   ORDER BY sería no determinista y podría bloquear con falso positivo a un
--   agente realmente activo. Con el desempate, la fila ACTIVE siempre gana --
--   la suspensión solo bloquea si es la ÚNICA relación vigente del usuario.
--
--   FIX 2 (ALTO, agency_id letra muerta): properties.agency_id (comment
--   "denorm al publicar" desde 0005) NUNCA se escribía -- ninguna RPC de
--   publish la incluía. Las cláusulas por agency_role_of(agency_id) de 71.2
--   (properties_update admin, properties_select_agency_role) nunca tenían
--   filas reales que matchear. Fix: el mismo lookup de FIX 1 alimenta
--   properties.agency_id en el INSERT (NULL si independiente -- comportamiento
--   preservado, la agencia activa si tiene membresía).
--
--   FIX 3 (MEDIO, asimetría owner/admin cross-agencia): tanto properties_select
--   como properties_update le daban al owner private.is_agency_owner_of(
--   owner_user_id) (chequea SOLO membresía compartida ACTIVA HOY entre caller y
--   dueño de la fila, ignora la agency_id real de la property) mientras que al
--   admin private.agency_role_of(agency_id) (SÍ escapado a la property). Tras
--   un switch_agency_atomic esto (a) dejaba al owner de la agencia NUEVA
--   ver/editar properties VIEJAS de la agencia anterior del agente (leak), y
--   (b) simultáneamente le quitaba al owner REAL de la agencia vieja hasta la
--   VISIBILIDAD de esa property (is_agency_owner_of ya no matchea -- el agente
--   se fue) -- rompía el acceso legítimo, no solo abría uno ilegítimo. Se
--   confirmó empíricamente con UPDATE...RETURNING: Postgres aplica las
--   políticas de SELECT *y* UPDATE cuando hay RETURNING, así que el hueco de
--   properties_select bastaba para tumbar el UPDATE aunque properties_update ya
--   estuviera arreglada.
--   Fix: en AMBAS reemplazar el owner-por-membresía-compartida por
--   agency_role_of(agency_id), siempre escapado a la agencia REAL de la
--   property. properties_select (scoped anon+authenticated, NO se toca por el
--   hueco de #96 documentado en 000003) pierde la cláusula is_agency_owner_of;
--   properties_select_agency_role (policy adicional, SOLO authenticated, ya
--   existía para admin/viewer) gana 'owner'. private.is_agency_owner_of NO se
--   toca (sigue usándose en RLS de leads -- 20260604000008/20260702000001 --
--   fuera de alcance de esta tarea).
--
-- Tests: supabase/tests/06_publish_property_rpc_test.sql (denorm + suspensión +
-- atomicidad) y supabase/tests/21_agency_member_role_matrix_test.sql (§35-36,
-- asimetría cross-agencia tras switch). Deno:
-- supabase/functions/publish-property/handler.test.ts (403, no 500) +
-- supabase/functions/publish-property/index.ts (extracción del error_code,
-- mismo patrón que extract_agency_error_code en _shared/clients.ts).
--
-- Fuera de alcance a propósito (tarea #101): properties_update/insert WITH
-- CHECK vs membresía completa, agent_applications INSERT bypass, TOCTOU
-- member_manager, remove no limpia users.agency_id, orden de rollback,
-- sanitización de errores 500.
--
-- Idempotente: create or replace + drop/create policy.
-- Rollback: supabase/migrations/rollbacks/20260805000011_publish_agency_denorm_and_suspension.sql

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
  p_cloudflare_uid      text     default null
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

  -- FIX 1+2: resolver la membresía de agencia del publicante ANTES de insertar.
  -- Puede haber más de 1 fila (active|suspended) -- ver header: el desempate
  -- ORDER BY prioriza la fila ACTIVE si existe (nunca bloquea a un agente
  -- realmente activo por una fila suspended vieja de otra agencia).
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
  -- status='active' + published_at=now(): la EF publica directamente (auto-aprobación, PRD §12).
  -- agency_id: NULL si independiente (v_agency_id sin fila match), la agencia
  -- activa del publicante si tiene membresía (FIX 2 -- antes siempre NULL).
  -- location: geography(Point,4326) — ST_Point(lng, lat) sigue la convención (x=lng, y=lat).
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
    p_description,
    'active',
    now()
  )
  returning id into v_property_id;

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

  if v_video_id is null then
    raise exception 'video en vuelo no encontrado, no pertenece al usuario o no está listo para enlazar' using errcode='P0001';
  end if;

  return query select v_property_id;
end;
$$;

comment on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text
) is
  'Publica una property y enlaza su video en vuelo (68.12) en una transacción. '
  'Fix 100: resuelve la membresía de agencia del publicante (active|suspended) -- '
  'bloquea con AGENCY_MEMBERSHIP_SUSPENDED si está suspendido (el RPC es SECURITY '
  'DEFINER y bypasea la RLS de properties_insert) y denormaliza properties.agency_id '
  '(NULL si independiente, la agencia activa si tiene membresía).';

-- Grant para service_role (la EF llama con service_role key) — sin cambios de firma.
grant execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text
) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Backfill: properties YA publicadas antes de este fix nunca tuvieron agency_id
-- (FIX 2 -- letra muerta desde 0005). Sin esto, en cuanto FIX 3 quite
-- is_agency_owner_of de properties_select, el owner/admin de agencia pierde
-- visibilidad/escritura sobre las properties que sus agentes publicaron ANTES
-- de esta migración (no vuelven a publicarse -- quedarían huérfanas de agencia
-- para siempre). Determinístico e idempotente (solo toca filas agency_id IS
-- NULL cuyo owner tiene HOY una membresía activa; una property de un agente
-- que ya no tiene membresía activa se queda NULL -- independiente, correcto).
-- No se revierte en el rollback: bajo el código viejo (is_agency_owner_of,
-- ignora agency_id) un agency_id ya poblado es inofensivo.
update public.properties p
   set agency_id = am.agency_id
  from public.agency_members am
 where p.agency_id is null
   and am.user_id = p.owner_user_id
   and am.status = 'active';

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 3: properties_select + properties_update -- una sola fuente de verdad
-- (agency_role_of, siempre escapada a la agency_id REAL de la property) para
-- owner Y admin de agencia, en visibilidad Y escritura.
-- ════════════════════════════════════════════════════════════════════════════

-- properties_select (scoped anon+authenticated, NO se toca su alcance de roles
-- por el hueco de #96 -- ver 20260805000003): pierde is_agency_owner_of.
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select to anon, authenticated
  using (
    (status = 'active' and deleted_at is null)
    or owner_user_id = (select auth.uid())
    or private.is_admin()
  );

comment on policy properties_select on public.properties is
  'Fix 100: quita private.is_agency_owner_of(owner_user_id) (membresía '
  'compartida HOY, ignoraba la agency_id real de la property). La visibilidad '
  'del owner/admin de agencia sobre properties draft de sus agentes ahora vive '
  'SOLO en properties_select_agency_role (scoped a authenticated, agency_role_of '
  'escapado a la agencia real -- evita acoplar la lectura anónima a ese helper, '
  'mismo criterio que 20260805000003).';

-- properties_select_agency_role (policy adicional SOLO authenticated, ya
-- existía para admin/viewer): gana 'owner'.
drop policy if exists properties_select_agency_role on public.properties;
create policy properties_select_agency_role on public.properties for select to authenticated
  using (private.agency_role_of(agency_id) in ('owner', 'admin', 'viewer'));

drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (
    owner_user_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  )
  with check (
    owner_user_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  );

comment on policy properties_update on public.properties is
  'Fix 100: reemplaza private.is_agency_owner_of(owner_user_id) (membresía '
  'compartida HOY, ignoraba la agency_id real de la property -- tras un switch '
  'dejaba al owner de la agencia NUEVA editar properties VIEJAS de otra agencia, '
  'y simultáneamente bloqueaba al owner REAL de esas properties) por '
  'agency_role_of(agency_id) in (owner,admin) -- siempre escapada a la agencia '
  'real de la fila. private.is_agency_owner_of sigue vigente para leads (sin tocar).';
