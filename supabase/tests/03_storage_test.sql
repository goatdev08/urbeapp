-- Tests pgTAP — Storage buckets y RLS de Storage (Urbea MVP)
-- Ejecutar con: supabase test db
-- Patrón: igual que 01_constraints_test.sql y 02_rls_test.sql.
--   begin / plan(N) / asserts / finish() / rollback
-- Secciones organizadas por subtarea; 3.2 y 3.3 extenderán este archivo.

begin;
select plan(16);  -- 3.1: 6 asserts · 3.2: 5 asserts · 3.3: 5 asserts

-- ══ 3.1 ══ bucket property-videos: existencia, privacidad, límites de tamaño y MIME
-- El bucket y la columna storage_path son creados por la migración GREEN.
-- Aquí DEBEN fallar porque esa migración aún no existe.

-- 1) El bucket 'property-videos' existe en storage.buckets.
select is(
  (select count(*)::int from storage.buckets where id = 'property-videos'),
  1,
  'bucket property-videos: existe en storage.buckets'
);

-- 2) El bucket es privado (public = false).
select is(
  (select public from storage.buckets where id = 'property-videos'),
  false,
  'bucket property-videos: es privado (public = false)'
);

-- 3) El límite de tamaño es exactamente 500 MB (524288000 bytes).
select is(
  (select file_size_limit from storage.buckets where id = 'property-videos'),
  524288000::bigint,
  'bucket property-videos: file_size_limit = 524288000 (500 MB exactos)'
);

-- 4a) allowed_mime_types contiene los 3 tipos esperados.
select ok(
  (
    select allowed_mime_types @> array['video/mp4', 'video/quicktime', 'video/webm']::text[]
    from storage.buckets
    where id = 'property-videos'
  ),
  'bucket property-videos: allowed_mime_types contiene video/mp4, video/quicktime y video/webm'
);

-- 4b) allowed_mime_types tiene exactamente 3 entradas (no más, no menos).
select is(
  (
    select array_length(allowed_mime_types, 1)
    from storage.buckets
    where id = 'property-videos'
  ),
  3,
  'bucket property-videos: allowed_mime_types tiene exactamente 3 tipos MIME'
);

-- Nota: los casos 4a y 4b juntos validan que los 3 tipos estén presentes
-- y que no haya tipos extra no especificados en el PRD.

-- 5) La columna public.property_videos.storage_path existe y es de tipo text.
select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'property_videos'
      and column_name  = 'storage_path'
  ),
  'text',
  'property_videos: columna storage_path existe y es de tipo text'
);

-- ══ 3.2 ══ RLS INSERT en storage.objects: política de subida por agente dueño
-- UUIDs propios de este archivo (terminados en a0a1 / a0a2 / a0u1 / a0d1) para no
-- colisionar con los de 02_rls_test.sql (que corre en otra transacción independiente).

-- ── Fixtures 3.2 ─────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0a01', 'agente1.storage@test.local'),   -- Agente A1
  ('00000000-0000-0000-0000-0000000a0a02', 'agente2.storage@test.local'),   -- Agente A2 (otro dueño)
  ('00000000-0000-0000-0000-0000000a0c01', 'usuario.storage@test.local'),   -- Usuario común U1
  ('00000000-0000-0000-0000-0000000a0d01', 'admin.storage@test.local');     -- Admin D1

-- Asignar roles: A1 y A2 → agent; D1 → admin; U1 queda como 'user' (default)
update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-0000000a0a01',
    '00000000-0000-0000-0000-0000000a0a02'
  );
update public.users set role = 'admin'
  where id = '00000000-0000-0000-0000-0000000a0d01';

-- Helper de impersonación (mismo patrón que 02_rls_test.sql)
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Asserts 3.2 ──────────────────────────────────────────────────────────────
-- Keyword única en cada mensaje para que el guardian pueda hacer match.

-- 3.2.1 — Happy path: agente A1 puede subir a su propio path.
-- RED: falla porque la política INSERT aún no existe (ningún rol no-service puede
--      insertar en storage.objects sin política que lo permita).
-- GREEN: vive cuando la política "agent owner can upload video" esté aplicada.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0a01');
select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner, metadata)
    values (
      'property-videos',
      '00000000-0000-0000-0000-0000000a0a01/00000000-0000-0000-0000-0000000a0f01/video-01.mp4',
      '00000000-0000-0000-0000-0000000a0a01'::uuid,
      '{}'::jsonb
    )
  $$,
  'agente_puede_subir_a_su_propio_path'
);
reset role;

-- 3.2.2 — Agente A1 NO puede subir al path de OTRO agente A2.
-- RED y GREEN: siempre lanza porque (foldername(name))[1] ≠ auth.uid()::text.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0a01');
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner, metadata)
    values (
      'property-videos',
      '00000000-0000-0000-0000-0000000a0a02/00000000-0000-0000-0000-0000000a0f01/video-02.mp4',
      '00000000-0000-0000-0000-0000000a0a01'::uuid,
      '{}'::jsonb
    )
  $$,
  null,
  'agente_no_puede_subir_al_path_de_otro_agente'
);
reset role;

-- 3.2.3 — Usuario común U1 (role='user') NO puede insertar ni en su propio path.
-- La política exige current_user_role() IN ('agent','admin').
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0c01');
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner, metadata)
    values (
      'property-videos',
      '00000000-0000-0000-0000-0000000a0c01/00000000-0000-0000-0000-0000000a0f01/video-03.mp4',
      '00000000-0000-0000-0000-0000000a0c01'::uuid,
      '{}'::jsonb
    )
  $$,
  null,
  'usuario_comun_no_puede_subir'
);
reset role;

-- 3.2.4 — anon NO puede insertar (sin JWT, sin política).
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner, metadata)
    values (
      'property-videos',
      '00000000-0000-0000-0000-0000000a0a01/00000000-0000-0000-0000-0000000a0f01/video-04.mp4',
      null,
      '{}'::jsonb
    )
  $$,
  null,
  'anon_no_puede_subir'
);
reset role;

-- 3.2.5 — Admin D1 puede subir a SU PROPIO path (rol 'admin' pasa el gate de rol).
-- Coherente con properties_insert (0010): el gate es dueño-del-path + rol ∈ {agent,admin};
-- NO existe "admin escribe en cualquier path" en INSERT (eso sería can_manage en UPDATE/DELETE).
-- RED: falla porque la política aún no existe.
-- GREEN: vive cuando la política incluya el rol 'admin' sobre su propio path.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0d01');
select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner, metadata)
    values (
      'property-videos',
      '00000000-0000-0000-0000-0000000a0d01/00000000-0000-0000-0000-0000000a0f01/video-05.mp4',
      '00000000-0000-0000-0000-0000000a0d01'::uuid,
      '{}'::jsonb
    )
  $$,
  'admin_puede_subir_a_su_propio_path'
);
reset role;

-- ══ 3.3 ══ RLS SELECT en storage.objects: lectura pública de videos de propiedades activas
-- Política esperada (GREEN):
--   for select to anon, authenticated
--   using (
--     bucket_id = 'property-videos'
--     AND (
--       private.property_is_public((storage.foldername(name))[2]::uuid)
--       OR (storage.foldername(name))[1] = (select auth.uid())::text
--     )
--   )
--
-- UUIDs de esta sección (terminados en a0f0a / a0f0d para no colisionar):
--   P_active : 00000000-0000-0000-0000-0000000a0f0a  (status='active')
--   P_draft  : 00000000-0000-0000-0000-0000000a0f0d  (status='draft')
--   Dueño A1 : 00000000-0000-0000-0000-0000000a0a01  (ya insertado en 3.2)
--   Agente A2: 00000000-0000-0000-0000-0000000a0a02  (ya insertado en 3.2)
--
-- Todos los dígitos son hex válidos (0-9, a-f).

-- ── Fixtures 3.3 (como superusuario — bypass RLS) ────────────────────────────

-- 2 propiedades de A1: una activa y una en draft.
insert into public.properties
  (id, owner_user_id, property_type, operation_type, address, location, price, status)
values
  (
    '00000000-0000-0000-0000-0000000a0f0a',
    '00000000-0000-0000-0000-0000000a0a01',
    'departamento', 'rent',
    'Av. Prueba 3.3 Activa 100',
    extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography,
    1650000,
    'active'
  ),
  (
    '00000000-0000-0000-0000-0000000a0f0d',
    '00000000-0000-0000-0000-0000000a0a01',
    'departamento', 'rent',
    'Av. Prueba 3.3 Draft 200',
    extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography,
    1650000,
    'draft'
  );

-- 2 objetos en storage.objects (insert directo como superusuario, bypass RLS).
-- Path sigue la convención: {owner_user_id}/{property_id}/{filename}.
insert into storage.objects (bucket_id, name, owner, metadata)
values
  (
    'property-videos',
    '00000000-0000-0000-0000-0000000a0a01/00000000-0000-0000-0000-0000000a0f0a/vid.mp4',
    '00000000-0000-0000-0000-0000000a0a01'::uuid,
    '{}'::jsonb
  ),
  (
    'property-videos',
    '00000000-0000-0000-0000-0000000a0a01/00000000-0000-0000-0000-0000000a0f0d/vid.mp4',
    '00000000-0000-0000-0000-0000000a0a01'::uuid,
    '{}'::jsonb
  );

-- ── Asserts 3.3 ──────────────────────────────────────────────────────────────

-- 3.3.1 — anon VE el video de propiedad ACTIVA (count=1).
-- RED: falla porque no existe política SELECT en storage.objects → count=0 en vez de 1.
-- GREEN: la política permite lectura pública cuando property_is_public=true.
select pg_temp.act_as(null, 'anon');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000a0a01/00000000-0000-0000-0000-0000000a0f0a/vid.mp4'),
  1,
  'anon_ve_video_de_propiedad_activa'
);
reset role;

-- 3.3.2 — anon NO ve el video de propiedad en DRAFT (count=0).
-- RED: pasa por razón incorrecta (sin policy todo da 0); GREEN: pasa porque property_is_public=false y sin JWT no aplica rama dueño.
select pg_temp.act_as(null, 'anon');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000a0a01/00000000-0000-0000-0000-0000000a0f0d/vid.mp4'),
  0,
  'anon_no_ve_video_de_propiedad_en_draft'
);
reset role;

-- 3.3.3 — El DUEÑO A1 ve su propio video aunque la propiedad esté en DRAFT (count=1).
-- RED: falla porque no existe política SELECT → count=0 en vez de 1.
-- GREEN: (foldername(name))[1] = auth.uid()::text → rama dueño permite lectura.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0a01');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000a0a01/00000000-0000-0000-0000-0000000a0f0d/vid.mp4'),
  1,
  'dueno_ve_su_propio_video_aunque_propiedad_en_draft'
);
reset role;

-- 3.3.4 — Otro agente A2 NO ve el video draft ajeno (count=0).
-- RED: pasa por razón incorrecta (sin policy todo da 0); GREEN: path[1]≠A2 y property_is_public=false → count=0.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0a02');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000a0a01/00000000-0000-0000-0000-0000000a0f0d/vid.mp4'),
  0,
  'otro_agente_no_ve_video_draft_ajeno'
);
reset role;

-- 3.3.5 — Otro agente A2 SÍ ve el video de propiedad activa ajena (lectura pública, count=1).
-- RED: falla porque no existe política SELECT → count=0 en vez de 1.
-- GREEN: property_is_public(P_active)=true → lectura pública para cualquier rol autenticado.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0a02');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000a0a01/00000000-0000-0000-0000-0000000a0f0a/vid.mp4'),
  1,
  'otro_agente_ve_video_de_propiedad_activa_ajena'
);
reset role;

select * from finish();
rollback;
