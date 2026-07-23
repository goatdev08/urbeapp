-- Tests pgTAP — Storage bucket profile-photos y columnas user_preferences (Urbea MVP)
-- Subtarea: 6.3 — Create profile-photos Storage bucket with RLS policies
-- Ejecutar con: supabase test db
-- Patrón: igual que 03_storage_test.sql (begin / plan(N) / asserts / finish() / rollback).
-- UUIDs terminados en b0u1/b0u2 para no colisionar con 02_rls_test.sql ni 03_storage_test.sql.

begin;
select plan(17);

-- ══ §1 ══ Existencia y configuración del bucket profile-photos
-- RED: todas fallan porque la migración 0015 (stub) no crea el bucket.

-- 1.1 — El bucket 'profile-photos' existe en storage.buckets.
select is(
  (select count(*)::int from storage.buckets where id = 'profile-photos'),
  1,
  'bucket_profile_photos_existe_en_storage_buckets'
);

-- 1.2 — El bucket es público de lectura (public = true).
select is(
  (select public from storage.buckets where id = 'profile-photos'),
  true,
  'bucket_profile_photos_es_publico_de_lectura'
);

-- ══ §2 ══ Columnas en user_preferences
-- RED: fallan porque las columnas no existen (migración 0004 no las incluye).

-- 2.1 — Columna full_name existe y es de tipo text.
select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'user_preferences'
      and column_name  = 'full_name'
  ),
  'text',
  'columna_full_name_existe_en_user_preferences_tipo_text'
);

-- 2.2 — Columna profile_photo_url existe y es de tipo text.
select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'user_preferences'
      and column_name  = 'profile_photo_url'
  ),
  'text',
  'columna_profile_photo_url_existe_en_user_preferences_tipo_text'
);

-- ══ Fixtures §3-§5 ══
-- Usuarios usados en los asserts de Storage RLS y user_preferences RLS.
-- UUIDs propios de este archivo (b0u1=usuario A, b0u2=usuario B) para no colisionar
-- con los de 02_rls_test.sql (a-prefijados) ni 03_storage_test.sql (a0a0-prefijados).

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000b0001', 'usuario-a.photos@test.local'),   -- Usuario A (dueño)
  ('00000000-0000-0000-0000-0000000b0002', 'usuario-b.photos@test.local');   -- Usuario B (otro)

-- Ambos usuarios quedan con role 'user' (default). Cualquier usuario autenticado puede
-- gestionar sus propias fotos de perfil (no se requiere ser agente).

-- Helper de impersonación (mismo patrón que 02_rls_test.sql y 03_storage_test.sql).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ══ §3 ══ RLS INSERT en storage.objects (bucket profile-photos)
-- Política esperada (GREEN): usuario puede INSERT solo si (foldername(name))[1] = auth.uid()::text

-- 3.1 — Happy path: usuario A SÍ puede subir a su propio path.
-- RED: falla porque la política INSERT no existe → cualquier rol autenticado sin policy es rechazado.
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0001');
select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner, metadata)
    values (
      'profile-photos',
      '00000000-0000-0000-0000-0000000b0001/avatar.jpg',
      '00000000-0000-0000-0000-0000000b0001'::uuid,
      '{}'::jsonb
    )
  $$,
  'usuario_a_puede_insert_en_su_propio_path'
);
reset role;

-- 3.2 — Usuario A NO puede subir al path de usuario B.
-- RED y GREEN: siempre lanza porque (foldername(name))[1] ≠ auth.uid()::text.
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0001');
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner, metadata)
    values (
      'profile-photos',
      '00000000-0000-0000-0000-0000000b0002/avatar.jpg',
      '00000000-0000-0000-0000-0000000b0001'::uuid,
      '{}'::jsonb
    )
  $$,
  null,
  'usuario_a_no_puede_insert_en_path_de_usuario_b'
);
reset role;

-- 3.3 — anon NO puede INSERT (sin JWT).
-- RED y GREEN: sin autenticación no existe política que lo permita.
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner, metadata)
    values (
      'profile-photos',
      '00000000-0000-0000-0000-0000000b0001/avatar.jpg',
      null,
      '{}'::jsonb
    )
  $$,
  null,
  'anon_no_puede_insert_en_profile_photos'
);
reset role;

-- ══ §4 ══ RLS SELECT en storage.objects (lectura pública)
-- Política esperada (GREEN): for select to anon, authenticated using (bucket_id = 'profile-photos')
-- Prerequisito: insertar un objeto como superusuario (bypass RLS) para que haya algo que leer.
-- El insert se protege con EXCEPTION para no abortar la tx si el bucket aún no existe (RED).
-- En RED: el insert falla silenciosamente → count=0 en §4.1/4.2 en vez de 1 → falla por aserción.
do $$
begin
  insert into storage.objects (bucket_id, name, owner, metadata)
  values (
    'profile-photos',
    '00000000-0000-0000-0000-0000000b0001/avatar-seed.jpg',
    '00000000-0000-0000-0000-0000000b0001'::uuid,
    '{}'::jsonb
  );
exception when others then null;  -- bucket no existe en RED: falla silenciosamente
end $$;

-- 4.1 — anon VE cualquier foto de perfil (lectura pública, count=1).
-- RED: falla porque no existe política SELECT → count=0 en vez de 1.
select pg_temp.act_as(null, 'anon');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000b0001/avatar-seed.jpg'
     and bucket_id = 'profile-photos'),
  1,
  'anon_puede_select_foto_de_perfil_publica'
);
reset role;

-- 4.2 — Usuario B (no dueño) VE la foto de usuario A (lectura pública, count=1).
-- RED: falla porque no existe política SELECT → count=0 en vez de 1.
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0002');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000b0001/avatar-seed.jpg'
     and bucket_id = 'profile-photos'),
  1,
  'usuario_b_puede_select_foto_de_usuario_a_lectura_publica'
);
reset role;

-- ══ §5 ══ RLS UPDATE y DELETE en storage.objects
-- Política esperada (GREEN): UPDATE/DELETE solo si (foldername(name))[1] = auth.uid()::text
-- Prerequisito: objeto ya insertado en §4 (avatar-seed.jpg de usuario A).

-- 5.1 — Usuario A SÍ puede UPDATE su propio objeto (exactamente 1 fila afectada).
-- RED: falla porque no existe política UPDATE ni objeto seed (bucket no existe) → count=0 ≠ 1.
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0001');
-- El DML va en un CTE de nivel superior: Postgres no admite UPDATE/DELETE dentro de un FROM.
with u as (
  update storage.objects
  set metadata = '{"updated": true}'::jsonb
  where bucket_id = 'profile-photos'
    and name = '00000000-0000-0000-0000-0000000b0001/avatar-seed.jpg'
  returning 1
)
select is(count(*)::int, 1, 'usuario_a_puede_update_su_propio_objeto') from u;
reset role;

-- 5.2 — Usuario B NO puede UPDATE el objeto de usuario A.
-- RED y GREEN: la política UPDATE exige que (foldername(name))[1] = auth.uid()::text.
-- RLS filtra silenciosamente: UPDATE afecta 0 filas (no lanza).
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0002');
with u as (
  update storage.objects
  set metadata = '{"hack": true}'::jsonb
  where bucket_id = 'profile-photos'
    and name = '00000000-0000-0000-0000-0000000b0001/avatar-seed.jpg'
  returning 1
)
select is(count(*)::int, 0, 'usuario_b_no_puede_update_objeto_de_usuario_a') from u;
reset role;

-- 5.3 — anon NO puede UPDATE (sin JWT).
-- RLS filtra silenciosamente: UPDATE afecta 0 filas.
select pg_temp.act_as(null, 'anon');
with u as (
  update storage.objects
  set metadata = '{"hack": true}'::jsonb
  where bucket_id = 'profile-photos'
    and name = '00000000-0000-0000-0000-0000000b0001/avatar-seed.jpg'
  returning 1
)
select is(count(*)::int, 0, 'anon_no_puede_update_en_profile_photos') from u;
reset role;

-- 5.4 — Usuario B NO puede DELETE el objeto de usuario A.
-- RED y GREEN: la política DELETE exige que (foldername(name))[1] = auth.uid()::text.
-- RLS filtra silenciosamente: DELETE afecta 0 filas.
-- Nota: el trigger storage.protect_delete() bloquea DELETE directo en storage.objects a menos
-- que storage.allow_delete_query='true'. El set local lo habilita solo para esta tx (tests de pgTAP
-- corren en una transacción que hace rollback; el trigger no protege RLS, solo evita borrados
-- accidentales fuera de la API). RLS sigue aplicando encima de esta configuración.
set local storage.allow_delete_query = 'true';
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0002');
with d as (
  delete from storage.objects
  where bucket_id = 'profile-photos'
    and name = '00000000-0000-0000-0000-0000000b0001/avatar-seed.jpg'
  returning 1
)
select is(count(*)::int, 0, 'usuario_b_no_puede_delete_objeto_de_usuario_a') from d;
reset role;

-- 5.5 — Usuario A SÍ puede DELETE su propio objeto (exactamente 1 fila afectada).
-- RED: falla porque no existe política DELETE ni objeto (bucket no existe) → count=0 ≠ 1.
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0001');
with d as (
  delete from storage.objects
  where bucket_id = 'profile-photos'
    and name = '00000000-0000-0000-0000-0000000b0001/avatar-seed.jpg'
  returning 1
)
select is(count(*)::int, 1, 'usuario_a_puede_delete_su_propio_objeto') from d;
reset role;

-- ══ §6 ══ RLS no-regresión de user_preferences (post-migración 0015)
-- Valida que las políticas de 0008 siguen funcionando con las nuevas columnas.
-- RED: §6.1 y §6.2 fallan porque full_name/profile_photo_url no existen aún.

-- 6.1 — El propio usuario puede hacer INSERT en user_preferences con las nuevas columnas.
-- RED: falla con "column full_name does not exist" hasta que exista la migración GREEN.
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0001');
select lives_ok(
  $$
    insert into public.user_preferences (user_id, full_name, profile_photo_url)
    values (
      '00000000-0000-0000-0000-0000000b0001',
      'Ana García',
      'https://example.com/00000000-0000-0000-0000-0000000b0001/avatar.jpg'
    )
    on conflict (user_id) do update
      set full_name         = excluded.full_name,
          profile_photo_url = excluded.profile_photo_url
  $$,
  'usuario_puede_upsert_user_preferences_con_nuevas_columnas'
);
reset role;

-- 6.2 — El propio usuario puede UPDATE user_preferences incluyendo las nuevas columnas.
-- Prerequisito: la fila existe (insertada en 6.1).
-- RED: falla con "column full_name does not exist".
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0001');
select lives_ok(
  $$
    update public.user_preferences
    set full_name         = 'Ana García Revisado',
        profile_photo_url = 'https://example.com/00000000-0000-0000-0000-0000000b0001/avatar2.jpg'
    where user_id = '00000000-0000-0000-0000-0000000b0001'
  $$,
  'usuario_puede_update_user_preferences_con_full_name_y_profile_photo_url'
);
reset role;

-- 6.3 — El propio usuario A SÍ puede leer sus propias prefs después de insertarlas (no-regresión RLS 0008).
-- Para que exista una fila, se inserta como superusuario (sin columnas nuevas: solo user_id).
-- RED: si §6.1 falló (columnas no existen), el upsert anterior no creó la fila;
--      este insert de superusuario SÍ la crea. Usuario A debe verla (count=1).
--      Falla si la política user_prefs_select está rota o si el RLS bloquea al propio dueño.
-- En el flujo normal RED este assert pasa correctamente (las políticas 0008 no están rotas).
-- Nota: este assert es un guarda de no-regresión; no falla en RED por diseño.
insert into public.user_preferences (user_id) values ('00000000-0000-0000-0000-0000000b0001')
  on conflict (user_id) do nothing;

select pg_temp.act_as('00000000-0000-0000-0000-0000000b0001');
select is(
  (select count(*)::int from public.user_preferences
   where user_id = '00000000-0000-0000-0000-0000000b0001'),
  1,
  'usuario_a_puede_leer_sus_propias_user_preferences_rls_no_regresion'
);
reset role;

select * from finish();
rollback;
