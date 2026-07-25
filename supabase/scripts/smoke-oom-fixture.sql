-- Fixture LOCAL para el smoke de memoria de la subtarea 68.10 (OOM #57).
--
-- Por qué: el OOM #57 aparecía con ~4 players vivos a la vez (drawDistance).
-- La cuenta de Cloudflare Stream tiene UN solo video, así que el feed real solo
-- monta 1 player y no ejercita el escenario. Este fixture marca los 10 videos
-- placeholder del seed como `ready` apuntando al MISMO cloudflare_uid, para que
-- el feed tenga 11 items reproducibles. El contenido idéntico da igual: lo que se
-- mide es el ciclo de vida de N players (mount/replaceAsync/unmount) y el techo
-- de buffer, no la variedad del asset.
--
-- Requiere bajar `property_videos_cf_uid_unique` (índice parcial) porque el
-- fixture repite el uid a propósito. SOLO LOCAL — se restaura con
-- smoke-oom-restore.sql. Nada de esto va a migraciones ni al remoto.

drop index if exists public.property_videos_cf_uid_unique;

update property_videos
set status           = 'ready',
    cloudflare_uid   = '53bf402d05587117bce6963bbd33b697',
    thumbnail_url    = 'https://videodelivery.net/53bf402d05587117bce6963bbd33b697/thumbnails/thumbnail.jpg',
    duration_seconds = 52.2,
    thumbnail_pct    = 25,
    ready_at         = now()
where status = 'processing'
  and id::text like '40000000%';

select count(*) filter (where status = 'ready') as ready, count(*) as total
from property_videos;
