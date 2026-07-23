-- Tests pgTAP — RPC publish_property_atomic (migración 0017 + 20260721000001)
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

begin;
select plan(26);

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
      p_cloudflare_uid      => 'cfuid-happy-01'  -- NUEVO: reemplaza p_video_id + p_storage_path
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
    where owner_user_id = '00000000-0000-0000-0000-000000000c01' and status = 'active'),
  1,
  '12) enlace feliz: se creó exactamente 1 propiedad active para el agente'
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

select * from finish();
rollback;
