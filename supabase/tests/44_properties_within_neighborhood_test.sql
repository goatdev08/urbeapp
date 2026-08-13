-- Tests pgTAP — RPC properties_within_neighborhood (tarea #157.2)
-- Ejecutar con: supabase test db
--
-- RED (2026-08-13): la función AÚN NO EXISTE. La migración GREEN
-- (20260813000002_place_search_rpcs.sql) debe crearla con el patrón A1 "flaco"
-- de properties_within_radius (09): devuelve SOLO {id uuid}; el cliente hace
-- .in('id', ids) y aplica el resto de filtros con build_filter_query.
--
--   properties_within_neighborhood(p_neighborhood_id bigint) -> table (id uuid)
--     ST_Intersects(p.location, n.geom) — geography vs geography usa el GiST
--     existente properties_location_gix; Intersects (no Contains) para no
--     excluir puntos exactamente en el borde del polígono.
--     Filtros de visibilidad DENTRO del cuerpo: status='active' AND deleted_at
--     IS NULL (no depende de RLS — misma defensa que la RPC de radio).
--     security definer + search_path = public, extensions, private;
--     revoke public/anon + grant authenticated.
--
-- Fixtures (patrón 09): colonia sintética = cuadrado ST_MakeEnvelope en el
-- OCÉANO (frente a Baja California Sur) — a propósito lejos de GDL: la DB local
-- lleva seed de propiedades reales en el centro de Guadalajara y un cuadrado ahí
-- rompería el conteo exacto del assert 6. La FK municipal no constriñe la
-- geometría, así que la colonia "de Guadalajara" puede vivir en el mar.

begin;
select plan(10);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- El trigger handle_new_user (migración 0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000c44', 'owner_nbhd@urbea.mx');

-- Colonia A: cuadrado [-110.00..-109.96] x [22.00..22.04] (contiene el punto -109.98, 22.02).
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-157-nb-a', '14039', 'Colonia Con Propiedades',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-110.00, 22.00, -109.96, 22.04, 4326))::extensions.geography),
-- Colonia B: otro cuadrado oceánico sin ninguna propiedad dentro.
  ('test-157-nb-b', '14039', 'Colonia Vacía',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-110.10, 22.00, -110.08, 22.02, 4326))::extensions.geography);

-- p_inside: dentro de la colonia A, activa — DEBE aparecer.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-0000000c4401', '00000000-0000-0000-0000-000000000c44',
   'departamento', 'rent', 'Fixture nbhd — dentro, activa',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-109.98, 22.02), 4326)::extensions.geography,
   10000, 'active'),
-- p_outside: fuera de la colonia A (al este), activa — NO debe aparecer.
  ('00000000-0000-0000-0000-0000000c4402', '00000000-0000-0000-0000-000000000c44',
   'departamento', 'rent', 'Fixture nbhd — fuera, activa',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-109.50, 22.02), 4326)::extensions.geography,
   10000, 'active'),
-- p_paused: dentro pero status <> active — NO debe aparecer.
  ('00000000-0000-0000-0000-0000000c4403', '00000000-0000-0000-0000-000000000c44',
   'departamento', 'rent', 'Fixture nbhd — dentro, paused',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-109.99, 22.01), 4326)::extensions.geography,
   10000, 'paused'),
-- p_deleted: dentro pero soft-deleted — NO debe aparecer.
  ('00000000-0000-0000-0000-0000000c4404', '00000000-0000-0000-0000-000000000c44',
   'departamento', 'rent', 'Fixture nbhd — dentro, soft-deleted',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-109.97, 22.03), 4326)::extensions.geography,
   10000, 'active');
update public.properties set deleted_at = now() where id = '00000000-0000-0000-0000-0000000c4404';

-- ── 1) La función existe ────────────────────────────────────────────────────
select has_function('public', 'properties_within_neighborhood', array['bigint'],
  'public.properties_within_neighborhood(bigint) existe');

-- ── 2) La propiedad activa dentro del polígono aparece ─────────────────────
select is(
  (select count(*)::int from public.properties_within_neighborhood(
     (select n.id from public.mx_neighborhoods n where n.source_key = 'test-157-nb-a'))
   where id = '00000000-0000-0000-0000-0000000c4401'),
  1,
  'properties_within_neighborhood: la propiedad activa dentro del polígono aparece');

-- ── 3) La propiedad fuera del polígono NO aparece ──────────────────────────
select is(
  (select count(*)::int from public.properties_within_neighborhood(
     (select n.id from public.mx_neighborhoods n where n.source_key = 'test-157-nb-a'))
   where id = '00000000-0000-0000-0000-0000000c4402'),
  0,
  'properties_within_neighborhood: la propiedad fuera del polígono NO aparece');

-- ── 4) paused dentro del polígono NO aparece ───────────────────────────────
select is(
  (select count(*)::int from public.properties_within_neighborhood(
     (select n.id from public.mx_neighborhoods n where n.source_key = 'test-157-nb-a'))
   where id = '00000000-0000-0000-0000-0000000c4403'),
  0,
  'properties_within_neighborhood: paused dentro del polígono NO aparece (filtro en el cuerpo, no RLS)');

-- ── 5) soft-deleted dentro del polígono NO aparece ─────────────────────────
select is(
  (select count(*)::int from public.properties_within_neighborhood(
     (select n.id from public.mx_neighborhoods n where n.source_key = 'test-157-nb-a'))
   where id = '00000000-0000-0000-0000-0000000c4404'),
  0,
  'properties_within_neighborhood: soft-deleted dentro del polígono NO aparece');

-- ── 6) Conteo exacto: solo la activa-dentro (A1 flaco: solo ids) ───────────
select is(
  (select count(*)::int from public.properties_within_neighborhood(
     (select n.id from public.mx_neighborhoods n where n.source_key = 'test-157-nb-a'))),
  1,
  'properties_within_neighborhood: exactamente 1 resultado (los 3 excluidos quedan fuera)');

-- ── 7) Colonia sin propiedades -> 0 filas ──────────────────────────────────
select is(
  (select count(*)::int from public.properties_within_neighborhood(
     (select n.id from public.mx_neighborhoods n where n.source_key = 'test-157-nb-b'))),
  0,
  'properties_within_neighborhood: colonia sin propiedades -> 0 filas');

-- ── 8) Colonia inexistente -> 0 filas (no error) ───────────────────────────
select is(
  (select count(*)::int from public.properties_within_neighborhood(-1)),
  0,
  'properties_within_neighborhood: id de colonia inexistente -> 0 filas');

-- ════════════════════════════════════════════════════════════════════════════
-- Seguridad (patrón 09): anon sin EXECUTE, authenticated sí
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 9) anon NO puede ejecutar ──────────────────────────────────────────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.properties_within_neighborhood(1) $$,
  '42501', null,
  'anon no puede ejecutar properties_within_neighborhood');
reset role;

-- ── 10) authenticated SÍ puede ─────────────────────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-000000000c44', 'authenticated');
select lives_ok(
  $$ select * from public.properties_within_neighborhood(1) $$,
  'authenticated puede ejecutar properties_within_neighborhood');
reset role;

select * from finish();
rollback;
