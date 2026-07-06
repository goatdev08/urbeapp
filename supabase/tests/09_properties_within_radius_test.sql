-- Tests pgTAP — RPC properties_within_radius (subtarea 40.1, PostGIS)
-- Enfoque A1 "flaco": el RPC devuelve SOLO {id, distance_m} ordenado por distancia asc.
-- Ejecutar con: supabase test db (o pnpm supabase test db)
-- Corre como superusuario dentro de una transacción revertida.

begin;
select plan(8);

-- ── Fixtures ──────────────────────────────────────────────────────────────────
-- El trigger handle_new_user (migración 0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000c40', 'owner_radius@urbea.mx');

-- Centro de referencia: Guadalajara (mobile/src/features/map/constants.ts GDL_REGION).
-- lat = 20.6736, lng = -103.344. location = geography(Point,4326); ST_Point(lng, lat) es la
-- convención correcta (x=lng, y=lat) — mismo gotcha que parse_location / publish_property_atomic.
-- Usamos ST_Project(centro, distancia_m, azimut_rad) para generar puntos a distancias EXACTAS
-- (según el esferoide), de modo que ST_Distance del RPC deba coincidir con esas distancias.

-- p_within: ~2km del centro (azimut 45°) — debe aparecer con radio 5000m.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-0000000c4001', '00000000-0000-0000-0000-000000000c40',
   'departamento', 'rent', 'Fixture radius — 2km NE del centro GDL',
   extensions.ST_Project(
     extensions.ST_SetSRID(extensions.ST_MakePoint(-103.344, 20.6736), 4326)::extensions.geography,
     2000, radians(45)
   ), 10000, 'active');

-- p_outside: ~7km del centro (azimut 90°) — NO debe aparecer con radio 5000m.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-0000000c4002', '00000000-0000-0000-0000-000000000c40',
   'departamento', 'rent', 'Fixture radius — 7km E del centro GDL',
   extensions.ST_Project(
     extensions.ST_SetSRID(extensions.ST_MakePoint(-103.344, 20.6736), 4326)::extensions.geography,
     7000, radians(90)
   ), 10000, 'active');

-- Tres propiedades a distancias crecientes conocidas (1km, 3km, 5km) para el test de orden.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-0000000c4003', '00000000-0000-0000-0000-000000000c40',
   'departamento', 'rent', 'Fixture radius — 1km N del centro GDL',
   extensions.ST_Project(
     extensions.ST_SetSRID(extensions.ST_MakePoint(-103.344, 20.6736), 4326)::extensions.geography,
     1000, radians(0)
   ), 10000, 'active'),
  ('00000000-0000-0000-0000-0000000c4004', '00000000-0000-0000-0000-000000000c40',
   'departamento', 'rent', 'Fixture radius — 3km SE del centro GDL',
   extensions.ST_Project(
     extensions.ST_SetSRID(extensions.ST_MakePoint(-103.344, 20.6736), 4326)::extensions.geography,
     3000, radians(135)
   ), 10000, 'active'),
  ('00000000-0000-0000-0000-0000000c4005', '00000000-0000-0000-0000-000000000c40',
   'departamento', 'rent', 'Fixture radius — 5km S del centro GDL',
   extensions.ST_Project(
     extensions.ST_SetSRID(extensions.ST_MakePoint(-103.344, 20.6736), 4326)::extensions.geography,
     5000, radians(180)
   ), 10000, 'active');

-- p_paused: ~1km del centro pero status <> 'active' — NO debe aparecer aunque esté dentro del radio.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-0000000c4006', '00000000-0000-0000-0000-000000000c40',
   'departamento', 'rent', 'Fixture radius — 1km, status paused',
   extensions.ST_Project(
     extensions.ST_SetSRID(extensions.ST_MakePoint(-103.344, 20.6736), 4326)::extensions.geography,
     1000, radians(225)
   ), 10000, 'paused');

-- p_deleted: ~1km del centro pero deleted_at seteado (soft-delete) — NO debe aparecer.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-0000000c4007', '00000000-0000-0000-0000-000000000c40',
   'departamento', 'rent', 'Fixture radius — 1km, soft-deleted',
   extensions.ST_Project(
     extensions.ST_SetSRID(extensions.ST_MakePoint(-103.344, 20.6736), 4326)::extensions.geography,
     1000, radians(270)
   ), 10000, 'active');
update public.properties set deleted_at = now() where id = '00000000-0000-0000-0000-0000000c4007';

-- ── 1) La función properties_within_radius existe en public ──────────────────
select has_function(
  'public',
  'properties_within_radius',
  'función properties_within_radius debe existir en el schema public'
);

-- ── 2) Es SECURITY DEFINER ────────────────────────────────────────────────────
select is(
  (select prosecdef
     from pg_proc
     join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public'
      and pg_proc.proname = 'properties_within_radius'
    limit 1),
  true,
  'properties_within_radius debe ser SECURITY DEFINER'
);

-- ── 3) Incluye puntos dentro del radio (2km, radio 5000m) ────────────────────
select ok(
  exists(
    select 1 from public.properties_within_radius(20.6736, -103.344, 5000)
    where id = '00000000-0000-0000-0000-0000000c4001'
  ),
  'properties_within_radius: incluye una propiedad ~2km dentro de un radio de 5000m'
);

-- ── 4) Excluye puntos fuera del radio (7km, radio 5000m) ─────────────────────
select ok(
  not exists(
    select 1 from public.properties_within_radius(20.6736, -103.344, 5000)
    where id = '00000000-0000-0000-0000-0000000c4002'
  ),
  'properties_within_radius: excluye una propiedad ~7km fuera de un radio de 5000m'
);

-- ── 5) distance_m ordenado ascendente (1km, 3km, 5km en ese orden) ───────────
-- El RPC ya filtra/ordena internamente; restringimos por id a las 3 fixtures de este caso
-- para no mezclar con las propiedades de los demás asserts que también caen dentro de 6000m.
select is(
  (select array_agg(id)
     from public.properties_within_radius(20.6736, -103.344, 6000)
    where id in (
      '00000000-0000-0000-0000-0000000c4003',
      '00000000-0000-0000-0000-0000000c4004',
      '00000000-0000-0000-0000-0000000c4005'
    )),
  array[
    '00000000-0000-0000-0000-0000000c4003'::uuid,
    '00000000-0000-0000-0000-0000000c4004'::uuid,
    '00000000-0000-0000-0000-0000000c4005'::uuid
  ],
  'properties_within_radius: distance_m ordenado ascendente (1km, 3km, 5km en ese orden)'
);

-- ── 6) Honra status = 'active' (excluye 'paused' aunque esté dentro del radio) ─
select ok(
  not exists(
    select 1 from public.properties_within_radius(20.6736, -103.344, 5000)
    where id = '00000000-0000-0000-0000-0000000c4006'
  ),
  'properties_within_radius: excluye propiedades con status distinto de active (paused)'
);

-- ── 7) Honra deleted_at IS NULL (excluye soft-deleted aunque esté dentro del radio) ─
select ok(
  not exists(
    select 1 from public.properties_within_radius(20.6736, -103.344, 5000)
    where id = '00000000-0000-0000-0000-0000000c4007'
  ),
  'properties_within_radius: excluye propiedades soft-deleted (deleted_at no nulo)'
);

-- ── 8) Orden de coordenadas lng/lat correcto (distance_m real, tolerancia ±100m) ─
-- La fixture c4003 está a EXACTAMENTE 1000m (ST_Project) del centro. Si alguien invierte
-- ST_Point(lat, lng) en la implementación, distance_m quedará muy lejos de 1000 (miles de km
-- de diferencia, o error de latitud fuera de rango), cazando el gotcha de inversión.
select ok(
  (select distance_m
     from public.properties_within_radius(20.6736, -103.344, 6000)
    where id = '00000000-0000-0000-0000-0000000c4003') between 900 and 1100,
  'properties_within_radius: distance_m coincide con la distancia real (±100m), orden lng/lat correcto'
);

select * from finish();
rollback;
