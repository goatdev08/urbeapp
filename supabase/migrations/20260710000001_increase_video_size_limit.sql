-- Migración 20260710000001 — Storage: subir file_size_limit de property-videos a 500 MB
-- Propósito: el bucket property-videos quedó sembrado en 100 MB (104857600 bytes,
-- migración 0011). El PRD (docs/PRD-MVP-demo.md:627) especifica un tope de 500 MB
-- para video de propiedad, y la constante compartida
-- mobile/src/features/publish/validation.ts:MAX_VIDEO_SIZE_BYTES ya usa 524288000
-- (500 MB) como techo del lado cliente. Esta migración alinea el límite del bucket
-- en Storage con esa constante para evitar divergencia cliente/servidor.
--
-- Alcance: SOLO storage.buckets.file_size_limit del bucket 'property-videos'.
-- Idempotente: el WHERE exige que el límite actual sea 104857600 (100 MB); una
-- segunda ejecución no matchea ninguna fila (no-op).

update storage.buckets
set file_size_limit = 524288000  -- 500 MB (= MAX_VIDEO_SIZE_BYTES)
where id = 'property-videos'
  and file_size_limit = 104857600;  -- solo si sigue en 100 MB
