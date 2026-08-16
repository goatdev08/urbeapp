-- Tests pgTAP — RPC publish_property_atomic (migración 0017 + 20260721000001 +
-- 20260809000005)
-- Subtarea 68.12: upload-first — publicar ENLAZA (UPDATE) el video ya subido a
-- Cloudflare Stream en vez de INSERTAR una fila nueva. Nueva referencia del
-- video en el contrato: p_cloudflare_uid (reemplaza p_video_id + p_storage_path).
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida.
--
-- RED (68.12): todas las llamadas usan parámetros NOMBRADOS (p_cloudflare_uid
-- incluido). La firma vieja del RPC no tiene ese parámetro → Postgres no
-- encuentra un overload que matchee (42883 function does not exist) →
-- toda invocación falla ahora mismo, incluida la del "happy path". El GREEN
-- crea la migración 20260721000001 con la nueva firma y el enlace (UPDATE)
-- en vez del INSERT.
--
-- 🔴 ACTUALIZADO (73.4, fix crítico detectado por el coordinador antes de
-- guardian): el RPC ya NO hardcodea status='active' en el INSERT. Recibe
-- `p_property_status text default 'active'` y lo usa TAL CUAL. La sección
-- "Enlace feliz" de abajo ahora pasa `p_property_status => 'pending_review'`
-- explícitamente (el valor real que handler.ts manda en producción, PRD
-- §14.2) y la asserción #12 verifica ESE status en la fila real -- ya no
-- 'active'. Se agregó una sección nueva (asserts 34-36) que prueba
-- explícitamente que el RPC respeta CUALQUIER p_property_status válido
-- recibido (no que simplemente cambió el hardcode de un valor fijo a otro) y
-- que el default se preserva si se omite el parámetro.

begin;
select plan(41);

-- ── Fixtures: agentes (uno por escenario, aislados) ───────────────────────────
-- El trigger handle_new_user (migración 0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000c01', 'agente_happy@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c02', 'agente_cross_caller@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c03', 'agente_cross_video@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c04', 'agente_linked@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c05', 'agente_uploading@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c06', 'agente_notfound@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c07', 'agente_guards@urbea.mx');

update public.users set role = 'agent'
 where id in (
   '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000c02',
   '00000000-0000-0000-0000-000000000c03',
   '00000000-0000-0000-0000-000000000c04',
   '00000000-0000-0000-0000-000000000c05',
   '00000000-0000-0000-0000-000000000c06',
   '00000000-0000-0000-0000-000000000c07'
 );

-- ── 1) La función publish_property_atomic existe en public ────────────────────
select has_function(
  'public',
  'publish_property_atomic',
  'función publish_property_atomic debe existir en el schema public'
);

-- ── 2) Es SECURITY DEFINER ────────────────────────────────────────────────────
select is(
  (select prosecdef
     from pg_proc
     join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public'
      and pg_proc.proname = 'publish_property_atomic'
    limit 1),
  true,
  'publish_property_atomic debe ser SECURITY DEFINER'
);

-- ── Guards de parámetros obligatorios (migrados al nuevo shape) ───────────────
-- Parámetros NOMBRADOS: la firma nueva agrega p_cloudflare_uid (reemplaza
-- p_video_id + p_storage_path). Todas usan al mismo agente (AGENT_GUARDS);
-- ninguna debe dejar una propiedad huérfana (atomicidad), verificado al final.

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => null::uuid,   -- p_user_id nulo → excepción
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 5000.00,
      p_address             => 'Calle Falsa 123',
      p_lat                 => 19.0,
      p_lng                 => -99.0,
      p_cloudflare_uid      => 'cfuid-guard-01'
    )
  $$,
  'P0001',
  'user_id es requerido',
  '3) p_user_id nulo debe lanzar P0001 (guard migrado, sin inserción parcial)'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c07'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 5000.00,
      p_address             => null,          -- p_address nulo
      p_lat                 => 19.0,
      p_lng                 => -99.0,
      p_cloudflare_uid      => 'cfuid-guard-02'
    )
  $$,
  'P0001',
  null,
  '4) p_address nulo debe lanzar P0001'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c07'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 5000.00,
      p_address             => '   ',         -- p_address solo espacios
      p_lat                 => 19.0,
      p_lng                 => -99.0,
      p_cloudflare_uid      => 'cfuid-guard-03'
    )
  $$,
  'P0001',
  null,
  '5) p_address solo espacios debe lanzar P0001'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c07'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 5000.00,
      p_address             => 'Calle Falsa 123',
      p_lat                 => null,           -- p_lat nulo
      p_lng                 => -99.0,
      p_cloudflare_uid      => 'cfuid-guard-04'
    )
  $$,
  'P0001',
  null,
  '6) p_lat nulo debe lanzar P0001 (no se puede construir ST_Point)'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c07'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 5000.00,
      p_address             => 'Calle Falsa 123',
      p_lat                 => 19.0,
      p_lng                 => null,           -- p_lng nulo
      p_cloudflare_uid      => 'cfuid-guard-05'
    )
  $$,
  'P0001',
  null,
  '7) p_lng nulo debe lanzar P0001 (no se puede construir ST_Point)'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c07'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 5000.00,
      p_address             => 'Calle Falsa 123',
      p_lat                 => 19.0,
      p_lng                 => -99.0,
      p_cloudflare_uid      => null             -- p_cloudflare_uid nulo
    )
  $$,
  'P0001',
  null,
  '8) p_cloudflare_uid nulo debe lanzar P0001 (nueva referencia del video, reemplaza video_id/storage_path)'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c07'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 5000.00,
      p_address             => 'Calle Falsa 123',
      p_lat                 => 19.0,
      p_lng                 => -99.0,
      p_cloudflare_uid      => ''                -- p_cloudflare_uid vacío
    )
  $$,
  'P0001',
  null,
  '9) p_cloudflare_uid vacío debe lanzar P0001'
);

select is(
  (select count(*)::int from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c07'),
  0,
  '10) atomicidad: ninguno de los guards anteriores dejó una propiedad creada'
);

-- ── Enlace feliz: el video en vuelo del agente se ENLAZA (UPDATE), no se INSERTA ──

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c10',
  null,
  '00000000-0000-0000-0000-000000000c01',
  'processing',
  1,
  'cfuid-happy-01',
  'https://upload.example/happy'
);

create temp table result_happy (
  ok           boolean,
  property_id  uuid,
  err_sqlstate text,
  err_message  text
);

do $$
declare
  v_property_id uuid;
begin
  select property_id into v_property_id
    from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c01'::uuid,  -- AGENT_HAPPY
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 12500.00,
      p_bedrooms            => 2,
      p_bathrooms           => 1,
      p_square_meters       => 65.0,
      p_address             => 'Av. Insurgentes Sur 1602, CDMX',
      p_lat                 => 19.3836,
      p_lng                 => -99.1748,
      p_pet_friendly        => false,
      p_allows_no_guarantor => true,
      p_student_friendly    => false,
      p_description         => 'Depto luminoso con balcón.',
      p_cloudflare_uid      => 'cfuid-happy-01',  -- NUEVO: reemplaza p_video_id + p_storage_path
      p_property_status     => 'pending_review'   -- 73.4: el valor real que manda handler.ts en producción (PRD §14.2)
    );
  insert into result_happy values (true, v_property_id, null, null);
exception when others then
  insert into result_happy values (false, null, sqlstate, sqlerrm);
end $$;

select is(
  (select ok from result_happy),
  true,
  '11) enlace feliz: publish_property_atomic no lanza excepción con el contrato nuevo'
);

select is(
  (select count(*)::int from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c01' and status = 'pending_review'),
  1,
  '12) enlace feliz: se creó exactamente 1 propiedad pending_review para el agente (73.4 -- ya NO active hardcodeado; PRD §14.2)'
);

select isnt(
  (select published_at from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c01'),
  null,
  '13) enlace feliz: properties.published_at no debe ser nulo'
);

select isnt(
  (select property_id from result_happy),
  null,
  '14) enlace feliz: el RPC debe devolver un property_id no nulo'
);

select isnt(
  (select property_id from public.property_videos
    where id = '00000000-0000-0000-0000-000000000c10'),
  null,
  '15) enlace feliz: la fila de video en vuelo queda con property_id NO nulo tras el enlace'
);

select is(
  (select property_id from public.property_videos
    where id = '00000000-0000-0000-0000-000000000c10'),
  (select id from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c01'),
  '16) enlace feliz: la MISMA fila de video en vuelo queda enlazada (UPDATE) a la nueva propiedad'
);

select is(
  (select count(*)::int from public.property_videos
    where agent_id = '00000000-0000-0000-0000-000000000c01'),
  1,
  '17) enlace feliz: NO se creó una fila de video duplicada (sigue habiendo 1 sola del agente)'
);

select is(
  (select property_id from result_happy),
  (select id from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c01'),
  '18) enlace feliz: el property_id devuelto por el RPC coincide con la propiedad realmente creada'
);

select is(
  (select agency_id from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c01'),
  null,
  '18-bis) (fix 100) AGENT_HAPPY es independiente (sin agency_members) -- agency_id queda NULL, no letra muerta por default erróneo'
);

-- ── Rechazo cross-agent: el video en vuelo pertenece a OTRO agente (seguridad) ──

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c20',
  null,
  '00000000-0000-0000-0000-000000000c03',  -- AGENT_CROSS_VIDEO_OWNER
  'processing',
  1,
  'cfuid-cross-01',
  'https://upload.example/cross'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c02'::uuid,  -- AGENT_CROSS_CALLER (≠ dueño del video)
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 8000.00,
      p_address             => 'Calle Cross 1',
      p_lat                 => 19.1,
      p_lng                 => -99.1,
      p_cloudflare_uid      => 'cfuid-cross-01'
    )
  $$,
  'P0001',
  null,
  '19) rechazo cross-agent: el caller no es dueño del video en vuelo → excepción'
);

select is(
  (select count(*)::int from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c02'),
  0,
  '20) rechazo cross-agent: atomicidad — no se creó propiedad huérfana para el caller'
);

-- ── Rechazo: fila ya enlazada (property_id no nulo) ───────────────────────────

insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status, published_at)
values (
  '00000000-0000-0000-0000-000000000c99',
  '00000000-0000-0000-0000-000000000c04',  -- AGENT_LINKED
  'rent', 'departamento', 9000.00, 'Calle Ya Publicada 1',
  extensions.ST_SetSRID(extensions.ST_Point(-99.0, 19.0), 4326)::extensions.geography,
  'active', now()
);

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid)
values (
  '00000000-0000-0000-0000-000000000c21',
  '00000000-0000-0000-0000-000000000c99',  -- ya enlazado a una propiedad existente
  '00000000-0000-0000-0000-000000000c04',
  'ready',
  1,
  'cfuid-linked-01'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c04'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 7000.00,
      p_address             => 'Calle Linked 2',
      p_lat                 => 19.2,
      p_lng                 => -99.2,
      p_cloudflare_uid      => 'cfuid-linked-01'
    )
  $$,
  'P0001',
  null,
  '21) rechazo fila ya enlazada: property_id ya seteado → no es enlazable, excepción'
);

select is(
  (select count(*)::int from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c04'),
  1,
  '22) rechazo fila ya enlazada: sigue habiendo solo la propiedad preexistente (no se creó una nueva)'
);

-- ── Rechazo: status='uploading' (el upload aún no terminó, no enlazable) ─────

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c22',
  null,
  '00000000-0000-0000-0000-000000000c05',  -- AGENT_UPLOADING
  'uploading',
  1,
  'cfuid-uploading-01',
  'https://upload.example/uploading'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c05'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 6000.00,
      p_address             => 'Calle Uploading 3',
      p_lat                 => 19.3,
      p_lng                 => -99.3,
      p_cloudflare_uid      => 'cfuid-uploading-01'
    )
  $$,
  'P0001',
  null,
  '23) rechazo status=uploading: el upload aún no terminó → no enlazable, excepción'
);

select is(
  (select count(*)::int from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c05'),
  0,
  '24) rechazo status=uploading: atomicidad — no se creó propiedad huérfana'
);

-- ── Rechazo: cloudflare_uid inexistente (no matchea ninguna fila) ────────────

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c06'::uuid,  -- AGENT_NOTFOUND
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 5500.00,
      p_address             => 'Calle Notfound 4',
      p_lat                 => 19.4,
      p_lng                 => -99.4,
      p_cloudflare_uid      => 'cfuid-does-not-exist'
    )
  $$,
  'P0001',
  null,
  '25) rechazo cloudflare_uid inexistente: no matchea ninguna fila en vuelo → excepción'
);

select is(
  (select count(*)::int from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c06'),
  0,
  '26) rechazo cloudflare_uid inexistente: atomicidad — no se creó propiedad huérfana'
);

-- ════════════════════════════════════════════════════════════════════════════
-- Fix #100 — denormalización de agency_id + suspensión efectiva en el publish
-- real (RPC SECURITY DEFINER, bypasea RLS -- por eso el guard vive AQUÍ, no solo
-- en la policy properties_insert de 20260805000009 que solo cubre el INSERT
-- directo por PostgREST). Origen: review PR #41, hallazgos ALTO.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000c30', 'agente_miembro_activo@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c31', 'agente_suspendido@urbea.mx');
update public.users set role = 'agent'
 where id in (
   '00000000-0000-0000-0000-000000000c30',
   '00000000-0000-0000-0000-000000000c31'
 );

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000000c40', 'Inmobiliaria RPC Denorm', 'inmo-rpc-denorm', 'active', '00000000-0000-0000-0000-000000000c30');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000000c41', '00000000-0000-0000-0000-000000000c40', '00000000-0000-0000-0000-000000000c30', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000000c42', '00000000-0000-0000-0000-000000000c40', '00000000-0000-0000-0000-000000000c31', 'agent', 'suspended');

-- ── 27-28) Miembro ACTIVO: agency_id se denormaliza a su agencia ──────────────

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c50',
  null,
  '00000000-0000-0000-0000-000000000c30',
  'ready',
  1,
  'cfuid-miembro-activo-01',
  'https://upload.example/miembro-activo'
);

create temp table result_miembro_activo (
  ok           boolean,
  property_id  uuid,
  err_sqlstate text,
  err_message  text
);

do $$
declare
  v_property_id uuid;
begin
  select property_id into v_property_id
    from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c30'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 9500.00,
      p_address             => 'Calle Miembro Activo 1',
      p_lat                 => 19.5,
      p_lng                 => -99.5,
      p_cloudflare_uid      => 'cfuid-miembro-activo-01',
      p_property_status     => 'pending_review'  -- 73.4: consistente con lo que manda producción
    );
  insert into result_miembro_activo values (true, v_property_id, null, null);
exception when others then
  insert into result_miembro_activo values (false, null, sqlstate, sqlerrm);
end $$;

select is(
  (select ok from result_miembro_activo),
  true,
  '27) (fix 100) un agente con membresía ACTIVA sí puede publicar sin excepción'
);

select is(
  (select agency_id from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c30'),
  '00000000-0000-0000-0000-000000000c40'::uuid,
  '28) (fix 100) properties.agency_id se denormaliza a la agencia de la membresía ACTIVA del publicante'
);

-- ── 29-31) Miembro SUSPENDIDO: bloqueado, con atomicidad total ────────────────

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c51',
  null,
  '00000000-0000-0000-0000-000000000c31',
  'ready',
  1,
  'cfuid-suspendido-01',
  'https://upload.example/suspendido'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c31'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 8500.00,
      p_address             => 'Calle Suspendido 1',
      p_lat                 => 19.6,
      p_lng                 => -99.6,
      p_cloudflare_uid      => 'cfuid-suspendido-01'
    )
  $$,
  'P0001', 'AGENCY_MEMBERSHIP_SUSPENDED',
  '29) (fix 100) agente SUSPENDIDO en su agencia no puede publicar vía el RPC real (antes: bypaseaba la RLS de properties_insert por ser SECURITY DEFINER)'
);

select is(
  (select count(*)::int from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c31'),
  0,
  '30) suspendido bloqueado: atomicidad -- no se creó ninguna propiedad'
);

select is(
  (select property_id from public.property_videos
    where id = '00000000-0000-0000-0000-000000000c51'),
  null,
  '31) suspendido bloqueado: atomicidad -- el video en vuelo sigue SIN enlazar (property_id NULL)'
);

-- ── 32) Doble membresía (active en X + suspended vieja en Y): el desempate
--        prioriza la fila ACTIVE -- NO bloquea a un agente realmente activo ──
-- Alcanzable: redeem_invitation_atomic/upgrade_to_agent_atomic solo chequean
-- unique_violation sobre el índice de status='active' (0003), nunca bloquean
-- el redeem por una fila 'suspended' preexistente en OTRA agencia.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000c33', 'agente_doble_membresia@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000000c33';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000000c43', 'Inmobiliaria RPC Vieja Suspendida', 'inmo-rpc-vieja-suspendida', 'active', '00000000-0000-0000-0000-000000000c30');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000000c44', '00000000-0000-0000-0000-000000000c43', '00000000-0000-0000-0000-000000000c33', 'agent', 'suspended'),
  ('00000000-0000-0000-0000-000000000c45', '00000000-0000-0000-0000-000000000c40', '00000000-0000-0000-0000-000000000c33', 'agent', 'active');

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c52',
  null,
  '00000000-0000-0000-0000-000000000c33',
  'ready',
  1,
  'cfuid-doble-membresia-01',
  'https://upload.example/doble-membresia'
);

create temp table result_doble_membresia (
  ok           boolean,
  property_id  uuid,
  err_sqlstate text,
  err_message  text
);

do $$
declare
  v_property_id uuid;
begin
  select property_id into v_property_id
    from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000000c33'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 7500.00,
      p_address             => 'Calle Doble Membresia 1',
      p_lat                 => 19.7,
      p_lng                 => -99.7,
      p_cloudflare_uid      => 'cfuid-doble-membresia-01',
      p_property_status     => 'pending_review'  -- 73.4: consistente con lo que manda producción
    );
  insert into result_doble_membresia values (true, v_property_id, null, null);
exception when others then
  insert into result_doble_membresia values (false, null, sqlstate, sqlerrm);
end $$;

select is(
  (select ok from result_doble_membresia),
  true,
  '32) (fix 100) doble membresía: el desempate ACTIVE-primero no bloquea a un agente realmente activo por una fila suspended vieja de otra agencia -- ' ||
  coalesce((select err_message from result_doble_membresia), '')
);

select is(
  (select agency_id from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c33'),
  '00000000-0000-0000-0000-000000000c40'::uuid,
  '33) (fix 100) doble membresía: agency_id denormalizado es el de la fila ACTIVE (c40), NO el de la suspended (c43)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- Fix derivado 73.4 — p_property_status YA NO hardcodeado a 'active'. Origen:
-- el coordinador detectó, revisando index.ts directamente (no el reporte del
-- GREEN), que la primera versión de esta RPC seguía insertando 'active' fijo
-- pese a que handler.ts ya mandaba 'pending_review' a
-- propertyPublisher.publish() -- el adapter real en index.ts nunca reenviaba
-- ese campo, así que en producción NINGUNA propiedad iría jamás a
-- pending_review. Estos 3 asserts prueban el comportamiento REAL end-to-end
-- (RPC -> fila en `properties`), no un mock del handler:
--   34) el valor real que manda producción (pending_review) se persiste.
--   35) un valor distinto explícito (active) también se persiste TAL CUAL --
--       prueba que el RPC de verdad RESPETA el parámetro recibido, no que
--       solo se cambió el hardcode de un literal fijo por otro.
--   36) si se omite el parámetro, el default de columna ('active') se
--       preserva -- backward-compat para cualquier caller que no lo pase.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000c60', 'agente_status_pending_review@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c61', 'agente_status_active_explicito@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c62', 'agente_status_default@urbea.mx');
update public.users set role = 'agent'
 where id in (
   '00000000-0000-0000-0000-000000000c60',
   '00000000-0000-0000-0000-000000000c61',
   '00000000-0000-0000-0000-000000000c62'
 );

-- 34) p_property_status => 'pending_review' (el valor real de producción)

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c60',
  null,
  '00000000-0000-0000-0000-000000000c60',
  'processing',
  1,
  'cfuid-status-pending-review-01',
  'https://upload.example/status-pending-review'
);

select public.publish_property_atomic(
  p_user_id             => '00000000-0000-0000-0000-000000000c60'::uuid,
  p_operation_type      => 'rent',
  p_property_type       => 'departamento',
  p_price               => 5000.00,
  p_address             => 'Calle Status Pending Review 1',
  p_lat                 => 19.8,
  p_lng                 => -99.8,
  p_cloudflare_uid      => 'cfuid-status-pending-review-01',
  p_property_status     => 'pending_review'
);

select is(
  (select status::text from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c60'),
  'pending_review',
  '34) p_property_status=''pending_review'' (el que manda handler.ts en producción) deja la fila real en pending_review -- ya NO hardcodeado a active (fix derivado 73.4)'
);

-- 35) p_property_status => 'active' explícito -- prueba que el RPC RESPETA
-- cualquier valor válido recibido (no que el hardcode simplemente se movió de
-- 'active' a 'pending_review').

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c61',
  null,
  '00000000-0000-0000-0000-000000000c61',
  'processing',
  1,
  'cfuid-status-active-explicito-01',
  'https://upload.example/status-active-explicito'
);

select public.publish_property_atomic(
  p_user_id             => '00000000-0000-0000-0000-000000000c61'::uuid,
  p_operation_type      => 'rent',
  p_property_type       => 'departamento',
  p_price               => 5000.00,
  p_address             => 'Calle Status Active Explicito 1',
  p_lat                 => 19.9,
  p_lng                 => -99.9,
  p_cloudflare_uid      => 'cfuid-status-active-explicito-01',
  p_property_status     => 'active'
);

select is(
  (select status::text from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c61'),
  'active',
  '35) p_property_status=''active'' explícito deja la fila real en active -- el RPC respeta CUALQUIER status válido recibido, no está fijo a pending_review'
);

-- 36) Sin p_property_status (omitido) -- el default del parámetro sigue
-- siendo 'active', backward-compat para cualquier caller que no lo pase.

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c62',
  null,
  '00000000-0000-0000-0000-000000000c62',
  'processing',
  1,
  'cfuid-status-default-01',
  'https://upload.example/status-default'
);

select public.publish_property_atomic(
  p_user_id             => '00000000-0000-0000-0000-000000000c62'::uuid,
  p_operation_type      => 'rent',
  p_property_type       => 'departamento',
  p_price               => 5000.00,
  p_address             => 'Calle Status Default 1',
  p_lat                 => 20.0,
  p_lng                 => -100.0,
  p_cloudflare_uid      => 'cfuid-status-default-01'
  -- p_property_status omitido a propósito
);

select is(
  (select status::text from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c62'),
  'active',
  '36) p_property_status omitido usa el default ''active'' del parámetro -- backward-compat para cualquier caller que no lo pase'
);

-- ════════════════════════════════════════════════════════════════════════════
-- #129 (fix 73.3) — p_price_visible llega a la fila real. Origen: el wizard
-- mandaba price_visible pero ni la EF ni esta RPC conocían el campo — la fila
-- nacía SIEMPRE con el default de columna (true) aunque el agente apagara
-- "Mostrar precio en el feed". Asserts contra la fila real de `properties`:
--   37) p_price_visible => false se persiste (el caso que antes era imposible).
--   38) omitido → default true del parámetro (mismo default que la columna,
--       backward-compat para callers que no lo pasen).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000c70', 'agente_precio_oculto@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c71', 'agente_precio_default@urbea.mx');
update public.users set role = 'agent'
 where id in (
   '00000000-0000-0000-0000-000000000c70',
   '00000000-0000-0000-0000-000000000c71'
 );

-- 37) p_price_visible => false (el toggle apagado del wizard)

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c70',
  null,
  '00000000-0000-0000-0000-000000000c70',
  'processing',
  1,
  'cfuid-precio-oculto-01',
  'https://upload.example/precio-oculto'
);

select public.publish_property_atomic(
  p_user_id             => '00000000-0000-0000-0000-000000000c70'::uuid,
  p_operation_type      => 'rent',
  p_property_type       => 'departamento',
  p_price               => 5000.00,
  p_address             => 'Calle Precio Oculto 1',
  p_lat                 => 20.1,
  p_lng                 => -100.1,
  p_cloudflare_uid      => 'cfuid-precio-oculto-01',
  p_property_status     => 'pending_review',
  p_price_visible       => false
);

select is(
  (select price_visible from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c70'),
  false,
  '37) p_price_visible=false se persiste en la fila real -- el toggle "Mostrar precio" apagado ya NO se descarta (#129)'
);

-- 38) p_price_visible omitido -- default true del parámetro (= default columna)

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c71',
  null,
  '00000000-0000-0000-0000-000000000c71',
  'processing',
  1,
  'cfuid-precio-default-01',
  'https://upload.example/precio-default'
);

select public.publish_property_atomic(
  p_user_id             => '00000000-0000-0000-0000-000000000c71'::uuid,
  p_operation_type      => 'rent',
  p_property_type       => 'departamento',
  p_price               => 5000.00,
  p_address             => 'Calle Precio Default 1',
  p_lat                 => 20.2,
  p_lng                 => -100.2,
  p_cloudflare_uid      => 'cfuid-precio-default-01'
  -- p_price_visible omitido a propósito
);

select is(
  (select price_visible from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c71'),
  true,
  '38) p_price_visible omitido usa el default true del parámetro -- backward-compat, mismo default que la columna'
);

-- ════════════════════════════════════════════════════════════════════════════
-- Quick fixes wizard paso 3 (sesión 2026-08-15, sin tarea de Taskmaster):
-- p_built_square_meters, p_half_bathrooms, p_currency.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000c80', 'agente_wizard_full@urbea.mx'),
  ('00000000-0000-0000-0000-000000000c81', 'agente_wizard_default@urbea.mx');
update public.users set role = 'agent'
 where id in (
   '00000000-0000-0000-0000-000000000c80',
   '00000000-0000-0000-0000-000000000c81'
 );

-- 39) los 3 campos nuevos se persisten en la fila real

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c80',
  null,
  '00000000-0000-0000-0000-000000000c80',
  'processing',
  1,
  'cfuid-wizard-full-01',
  'https://upload.example/wizard-full'
);

select public.publish_property_atomic(
  p_user_id              => '00000000-0000-0000-0000-000000000c80'::uuid,
  p_operation_type       => 'rent',
  p_property_type        => 'casa',
  p_price                => 15000.00,
  p_address              => 'Calle Wizard Full 1',
  p_lat                  => 20.3,
  p_lng                  => -100.3,
  p_cloudflare_uid       => 'cfuid-wizard-full-01',
  p_property_status      => 'pending_review',
  p_built_square_meters  => 180.5,
  p_half_bathrooms       => 1,
  p_currency             => 'USD'
);

select is(
  (select row(built_square_meters, half_bathrooms, currency)::text
     from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c80'),
  '(180.5,1,USD)',
  '39) p_built_square_meters/p_half_bathrooms/p_currency se persisten en la fila real'
);

-- 40) los 3 campos nuevos son opcionales -- omitidos usan sus defaults
-- (built_square_meters/half_bathrooms null, currency default MXN)

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000000c81',
  null,
  '00000000-0000-0000-0000-000000000c81',
  'processing',
  1,
  'cfuid-wizard-default-01',
  'https://upload.example/wizard-default'
);

select public.publish_property_atomic(
  p_user_id         => '00000000-0000-0000-0000-000000000c81'::uuid,
  p_operation_type  => 'rent',
  p_property_type   => 'casa',
  p_price           => 15000.00,
  p_address         => 'Calle Wizard Default 1',
  p_lat             => 20.4,
  p_lng             => -100.4,
  p_cloudflare_uid  => 'cfuid-wizard-default-01',
  p_property_status => 'pending_review'
  -- los 3 params nuevos omitidos a propósito
);

select is(
  (select row(built_square_meters, half_bathrooms, currency)::text
     from public.properties
    where owner_user_id = '00000000-0000-0000-0000-000000000c81'),
  '(,,MXN)',
  '40) p_built_square_meters/p_half_bathrooms omitidos -> null; p_currency omitido -> default MXN'
);

select * from finish();
rollback;
