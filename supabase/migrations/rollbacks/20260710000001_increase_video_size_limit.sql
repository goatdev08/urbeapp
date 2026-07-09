-- Rollback 20260710000001 — Storage: revertir file_size_limit de property-videos a 100 MB

update storage.buckets
set file_size_limit = 104857600  -- revertir a 100 MB
where id = 'property-videos'
  and file_size_limit = 524288000;
