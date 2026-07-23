-- Migración 20260720000001 — Schema aditivo para el ciclo Cloudflare Stream (Épica B, tarea 68.2)
-- Propósito: extender property_videos con las columnas que el pipeline de Stream necesita
--   (URL de subida TUS, progreso de thumbnail, archivado a R2) y crear public.app_config
--   para flags de negocio y ventana de retención. 100% aditivo: no altera columnas ni
--   constraints existentes; property_videos ya tiene ready_at y failure_reason (NO se duplican).
--
-- Enum: se AGREGA el valor 'archived' (video movido a R2 tras liberar el slot de Stream).
--   Los valores previos (uploading/processing/ready/failed) se conservan intactos.
--
-- app_config: fail-closed. RLS ON con una sola policy SELECT para admin; el resto de la
--   lógica (Edge Functions) usa service_role, que bypassa RLS. anon/authenticated normales
--   no leen nada (0 filas). El único canal de escritura es service_role.
--
-- Idempotente: ADD VALUE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, create table if not exists,
--   drop policy if exists + create, upsert de seed con on conflict do nothing.
-- Rollback: supabase/migrations/rollbacks/20260720000001_stream_schema.sql
--   (nota: un valor de enum NO se puede quitar en Postgres; el rollback lo documenta).

-- ── 1) Enum: nuevo estado 'archived' ─────────────────────────────────────────
alter type property_video_status add value if not exists 'archived';

-- ── 2) property_videos: columnas nuevas (todas nullable = aditivo) ────────────
alter table public.property_videos
  add column if not exists tus_upload_url text,
  add column if not exists thumbnail_pct  numeric,
  add column if not exists archived_at    timestamptz,
  add column if not exists r2_archive_key text;

-- thumbnail_pct es un porcentaje de progreso (0–100). Constraint separado e idempotente.
alter table public.property_videos
  drop constraint if exists property_videos_thumbnail_pct_range;
alter table public.property_videos
  add constraint property_videos_thumbnail_pct_range
    check (thumbnail_pct is null or (thumbnail_pct >= 0 and thumbnail_pct <= 100));

comment on column public.property_videos.tus_upload_url is
  'URL de subida resumible (TUS) emitida por Cloudflare Stream para el upload directo desde el cliente.';
comment on column public.property_videos.thumbnail_pct is
  'Timestamp del thumbnail como porcentaje de la duración (0–100). NULL = default de Stream.';
comment on column public.property_videos.archived_at is
  'Momento en que el video se archivó a R2 y se liberó el slot de Cloudflare Stream.';
comment on column public.property_videos.r2_archive_key is
  'Object key del original archivado en Cloudflare R2 (bucket de originales).';

-- ── 3) public.app_config: flags de negocio + ventana de retención ─────────────
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.app_config is
  'Config de negocio (flags, ventanas de retención). Fail-closed: solo admin (RLS) / service_role (bypass) leen.';

drop trigger if exists set_updated_at on public.app_config;
create trigger set_updated_at before update on public.app_config
  for each row execute function public.set_updated_at();

-- Grants fail-closed: anon sin acceso; authenticated con SELECT gateado por RLS a admin.
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to authenticated;
grant select, insert, update, delete on public.app_config to service_role;

alter table public.app_config enable row level security;

-- Única policy: solo el admin lee. service_role bypassa RLS (canal de las Edge Functions).
drop policy if exists app_config_admin_select on public.app_config;
create policy app_config_admin_select on public.app_config
  for select to authenticated
  using (private.is_admin());

-- ── 4) Seed inicial (idempotente) ─────────────────────────────────────────────
insert into public.app_config (key, value) values
  ('video_slot_free',         'true'::jsonb),
  ('archived_retention_days', '7'::jsonb),
  ('signed_url_ttl_seconds',  '14400'::jsonb)
on conflict (key) do nothing;
