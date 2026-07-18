-- Tests pgTAP — RPC publish_property_atomic (migración 0017)
-- Subtarea 8.9: atomicidad de publicación (properties + property_videos en 1 tx).
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida.

begin;
select plan(8);

-- ── Fixtures ──────────────────────────────────────────────────────────────────
-- El trigger handle_new_user (migración 0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000b01', 'agente_pub@urbea.mx');

-- update role to 'agent' (el trigger crea con role='user' por defecto)
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000000b01';

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

-- ── 3) Inserción atómica: propiedad + video en una sola llamada ───────────────
do $$
declare
  v_property_id uuid;
begin
  select property_id into v_property_id
    from public.publish_property_atomic(
      '00000000-0000-0000-0000-000000000b01'::uuid,  -- p_user_id
      'rent',                                         -- p_operation_type
      'departamento',                                 -- p_property_type
      12500.00,                                       -- p_price
      2,                                              -- p_bedrooms
      1,                                              -- p_bathrooms
      65.0,                                           -- p_square_meters
      'Av. Insurgentes Sur 1602, CDMX',               -- p_address
      19.3836,                                        -- p_lat
      -99.1748,                                       -- p_lng
      false,                                          -- p_pet_friendly
      true,                                           -- p_allows_no_guarantor
      false,                                          -- p_student_friendly
      'Depto luminoso con balcón.',                   -- p_description
      '00000000-0000-0000-0000-000000000b10'::uuid,  -- p_video_id
      '00000000-0000-0000-0000-000000000b01/prop1/vid1.mp4' -- p_storage_path
    );

  -- La función devuelve un property_id
  if v_property_id is null then
    raise exception 'property_id es nulo después de la llamada a publish_property_atomic';
  end if;
end $$;

select ok(true, 'publish_property_atomic INSERT sin excepción');

-- ── 4) properties.status = active ────────────────────────────────────────────
select is(
  (select p.status::text
     from public.properties p
     join public.property_videos v on v.property_id = p.id
    where v.id = '00000000-0000-0000-0000-000000000b10'
    limit 1),
  'active',
  'properties.status debe ser active tras publicación'
);

-- ── 5) properties.published_at no es nulo ────────────────────────────────────
select isnt(
  (select published_at
     from public.properties p
     join public.property_videos v on v.property_id = p.id
    where v.id = '00000000-0000-0000-0000-000000000b10'
    limit 1),
  null,
  'properties.published_at no debe ser nulo tras publicación'
);

-- ── 6) property_videos.status = ready ────────────────────────────────────────
select is(
  (select status::text
     from public.property_videos
    where id = '00000000-0000-0000-0000-000000000b10'),
  'ready',
  'property_videos.status debe ser ready tras publicación'
);

-- ── 7) property_videos.storage_path igual al enviado ─────────────────────────
select is(
  (select storage_path
     from public.property_videos
    where id = '00000000-0000-0000-0000-000000000b10'),
  '00000000-0000-0000-0000-000000000b01/prop1/vid1.mp4',
  'property_videos.storage_path debe coincidir con el p_storage_path enviado'
);

-- ── 8) Atomicidad: p_user_id nulo lanza excepción (no inserción parcial) ─────
select throws_ok(
  $$
    select * from public.publish_property_atomic(
      null::uuid,           -- p_user_id nulo → excepción
      'rent',
      'departamento',
      5000.00,
      null, null, null,
      'Calle Falsa 123',
      19.0, -99.0,
      false, false, false,
      null,
      '00000000-0000-0000-0000-000000000b99'::uuid,
      'path/video.mp4'
    )
  $$,
  'P0001',
  'user_id es requerido',
  'p_user_id nulo debe lanzar P0001 (atomicidad: sin inserción parcial)'
);

select * from finish();
rollback;
