-- Revierte el fixture de smoke-oom-fixture.sql: devuelve los 10 placeholders a
-- `processing` sin uid y restaura el índice único parcial tal como lo crea la
-- migración de #68.

update property_videos
set status           = 'processing',
    cloudflare_uid   = null,
    thumbnail_url    = null,
    duration_seconds = null,
    thumbnail_pct    = null,
    ready_at         = null
where id::text like '40000000%';

create unique index if not exists property_videos_cf_uid_unique
  on public.property_videos using btree (cloudflare_uid)
  where (cloudflare_uid is not null);

select count(*) filter (where status = 'ready') as ready, count(*) as total
from property_videos;
