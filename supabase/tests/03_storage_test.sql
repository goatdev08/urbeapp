-- Tests pgTAP — Storage buckets y RLS de Storage (Urbea MVP)
-- Ejecutar con: supabase test db
-- Patrón: igual que 01_constraints_test.sql y 02_rls_test.sql.
--   begin / plan(N) / asserts / finish() / rollback
-- Secciones organizadas por subtarea; 3.2 y 3.3 extenderán este archivo.

begin;
select plan(6);

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

-- 3) El límite de tamaño es exactamente 100 MB (104857600 bytes).
select is(
  (select file_size_limit from storage.buckets where id = 'property-videos'),
  104857600::bigint,
  'bucket property-videos: file_size_limit = 104857600 (100 MB exactos)'
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

-- ══ 3.2 ══ (reservado — RLS de Storage: políticas de lectura/escritura)

-- ══ 3.3 ══ (reservado — RLS de Storage: restricciones de path {user_id}/{property_id}/{video_id}.mp4)

select * from finish();
rollback;
