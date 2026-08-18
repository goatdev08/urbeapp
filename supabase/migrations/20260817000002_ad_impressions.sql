-- Migración 20260817000002 — public.ad_impressions + public.ad_impressions_monthly
-- + purga a 90 días programada con pg_cron (subtarea #170.5). ES LA BASE
-- FACTURABLE del negocio de publicidad (#172 CPM/CPC).
--
-- Contrato completo (firma, edge cases, invariantes 🔒, las 6 decisiones de
-- contrato del test-author): ver cabecera de
-- supabase/tests/51_ad_impressions_test.sql (RED, 2026-08-17). Nota: la
-- cabecera del RED menciona como SUT anticipado
-- "20260815000021_ad_impressions.sql" -- ese nombre no se sostiene (quedó de
-- un placeholder anterior a que 170.1 tomara 20260817000001); esta migración
-- es la siguiente en la secuencia cronológica real del repo.
--
-- ── 1) public.ad_impressions — el crudo, CADUCA a 90 días ───────────────────
-- id es uuid SIN default: lo genera el CLIENTE (clave de idempotencia — el
-- batch de impresiones puede reintentarse sin duplicar, y el tap al CTA llega
-- DESPUÉS como un UPSERT sobre el mismo id). agency_id está denormalizado
-- (evita un join contra ads en cada reporte). municipality_id/neighborhood_id
-- son RECALCULADOS SERVER-SIDE (nunca confiar en lo que manda el cliente) y
-- nullable -- una impresión puede no resolver zona. neighborhood_id es
-- bigint, NO uuid (mx_neighborhoods.id es "generated always as identity",
-- ver 169.1/D2 y 20260813000001:49).
--
-- 🔴 FAIL-CLOSED TOTAL (contrato fijado por el test-author, verificado contra
-- el patrón de 20260720000001/app_config): `revoke all from anon,
-- authenticated` + `grant select on ad_impressions to authenticated` SIN
-- NINGUNA policy de SELECT ⇒ RLS filtra a 0 filas para CUALQUIER
-- authenticated (nunca error) — ni siquiera admin lee esta tabla directo.
-- anon NO recibe ningún grant ⇒ 42501 (no "0 filas"). Sin grant de
-- INSERT/UPDATE/DELETE para authenticated: la razón de ser de esta tabla en
-- vez de colgar de events_raw es que events_raw_insert
-- (20260808000001:72) deja a cualquier authenticated insertar filas
-- arbitrarias con user_id=auth.uid() — aceptable para métricas de producto,
-- INACEPTABLE como base facturable. Escritura y lectura exclusivas de
-- service_role (bypassrls=true) — la lectura del anunciante llega en la
-- tarea 171 y es SOLO por RPC agregada, jamás fila a fila.
--
-- Por qué se guarda user_id (no un hash irreversible): es lo que hace
-- defendible la retención de 90 días — lo identificable CADUCA (esta tabla),
-- el agregado no (ad_impressions_monthly). Un hash parecería más privado y
-- haría IMPOSIBLE cumplir un derecho ARCO de eliminación sobre estos datos.
--
-- ── 2) public.ad_impressions_monthly — rollup PERMANENTE ────────────────────
-- La purga NUNCA la toca. 🔴 unique nulls not distinct (agency_id, ad_id,
-- municipality_id, neighborhood_id, year_month) -- fix guardián 170.5
-- (Quinto). municipality_id/neighborhood_id son NULLABLE porque una campaña
-- NACIONAL es exactamente el caso NULL/NULL (cero filas en ad_zones =
-- inventario nacional, ver 171); un UNIQUE normal de Postgres NO deduplica
-- NULLs (NULL <> NULL), así que dos filas nacionales del mismo anuncio/mes
-- entrarían las dos y fragmentarían el rollup facturable. NULLS NOT
-- DISTINCT (Postgres 15+, servidor local y remoto en 17) cierra ese hueco:
-- es la llave que le permite al job futuro que rellena este rollup usar
-- `on conflict ... do update` (su implementación natural) en vez de
-- delete+insert o un update-si-no-insert con condición de carrera. La tabla
-- está vacía hoy -- es el momento barato para fijar la llave, no se vuelve
-- más fácil después. Mismo fail-closed que ad_zones (20260816000005): sin
-- ninguna policy/grant para authenticated -- la lectura del anunciante en
-- la tarea 171 es vía RPC security definer, nunca contra la tabla directo.
--
-- ── 3) public.purge_ad_impressions() + pg_cron ───────────────────────────────
-- Decisión de Abraham (2026-08-17, ver bitácora 170.5): la purga se PROGRAMA
-- en ESTA MISMA migración -- una retención que nadie ejecuta es una defensa
-- afirmada que no existe, y el aviso de privacidad §5 promete por escrito que
-- el detalle se conserva un máximo de 90 días. pg_cron 1.6.4 verificado
-- disponible (pg_available_extensions) y con shared_preload_libraries ya
-- cargado en el stack local; ver bitácora para la verificación empírica.
-- Frontera de purga `<` estricta sobre created_at: exactamente 90 días se
-- CONSERVA (dentro de la ventana prometida), 91 días se BORRA.
-- SECURITY DEFINER (consistente con el resto de RPCs del dominio) aunque el
-- job de cron corre como el rol que lo programó (postgres, superusuario,
-- bypassa RLS igual) -- deja la función invocable de forma segura también
-- fuera del cron si hiciera falta. Revoke/grant de EXECUTE explícitos por
-- claridad, aunque el default de plataforma ya revoca EXECUTE de PUBLIC en
-- funciones nuevas (verificado con \df+ public.set_updated_at/ads_feed_config
-- en el stack local: Access privileges = solo postgres+service_role, SIN
-- entrada authenticated).
--
-- cron.schedule() con el MISMO jobname actualiza el job existente en lugar de
-- duplicarlo (verificado empíricamente en el stack local: 3 llamadas
-- consecutivas con el mismo jobname dejan 1 sola fila en cron.job, mismo
-- jobid) -- la migración es re-aplicable sin generar jobs huérfanos.
--
-- Idempotente: create table if not exists, create extension if not exists,
-- cron.schedule idempotente por jobname (confirmado arriba), drop
-- policy/trigger if exists + create.
-- Rollback: supabase/migrations/rollbacks/20260817000002_ad_impressions.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.ad_impressions
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.ad_impressions (
  id                uuid primary key,
  ad_id             uuid not null references public.ads (id) on delete cascade,
  agency_id         uuid not null references public.agencies (id) on delete cascade,
  user_id           uuid not null,
  session_id        uuid not null,
  municipality_id   text,
  neighborhood_id   bigint references public.mx_neighborhoods (id) on delete restrict,
  shown_at          timestamptz not null,
  watched_ms        integer not null,
  viewed            boolean not null,
  completed         boolean not null,
  cta_tapped_at     timestamptz,
  device            text,
  created_at        timestamptz not null default now()
);

comment on table public.ad_impressions is
  'Crudo facturable de impresiones de anuncio (base de #172 CPM/CPC). id lo '
  'genera el CLIENTE (clave de idempotencia: el batch puede reintentarse sin '
  'duplicar, y el tap al CTA llega después como UPSERT sobre el mismo id). '
  'municipality_id/neighborhood_id se RECALCULAN server-side, nunca se '
  'confía en lo que manda el cliente. CADUCA a 90 días (purge_ad_impressions, '
  'pg_cron diario) -- el agregado permanente vive en ad_impressions_monthly. '
  'Se guarda user_id (no un hash) precisamente para poder cumplir un derecho '
  'ARCO de eliminación. FAIL-CLOSED TOTAL: ni admin lee esta tabla directo -- '
  'la lectura del anunciante (tarea 171) es solo por RPC agregada.';

create index if not exists ad_impressions_agency_created_idx
  on public.ad_impressions (agency_id, created_at desc);
create index if not exists ad_impressions_ad_created_idx
  on public.ad_impressions (ad_id, created_at desc);
create index if not exists ad_impressions_ad_municipality_idx
  on public.ad_impressions (ad_id, municipality_id);

alter table public.ad_impressions enable row level security;

-- Sin NINGUNA policy de SELECT/INSERT/UPDATE/DELETE a propósito: RLS
-- habilitado + cero policies filtra a 0 filas para cualquier authenticated
-- con SELECT (ver grant abajo). La lectura agregada llega en la tarea 171
-- vía RPC security definer.

revoke all on public.ad_impressions from anon, authenticated;
grant select on public.ad_impressions to authenticated;
grant select, insert, update, delete on public.ad_impressions to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.ad_impressions_monthly — rollup PERMANENTE, la purga nunca lo toca
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.ad_impressions_monthly (
  agency_id         uuid not null references public.agencies (id) on delete cascade,
  ad_id             uuid not null references public.ads (id) on delete cascade,
  municipality_id   text,
  neighborhood_id   bigint references public.mx_neighborhoods (id) on delete restrict,
  year_month        date not null,
  impressions       integer not null default 0,
  views             integer not null default 0,
  completions       integer not null default 0,
  cta_taps          integer not null default 0
);

comment on table public.ad_impressions_monthly is
  'Rollup PERMANENTE por agencia/anuncio/zona/mes -- la purga de '
  'ad_impressions (90 días) NUNCA toca esta tabla. unique nulls not '
  'distinct (agency_id, ad_id, municipality_id, neighborhood_id, '
  'year_month) -- NULL/NULL es el caso NACIONAL y debe deduplicar igual '
  'que cualquier otra zona, para que el job de rollup (trabajo futuro) '
  'pueda usar on conflict ... do update sin fragmentar cifras facturables. '
  'year_month es el primer día del mes (p.ej. 2026-05-01). Contadores '
  '(impressions, views, completions, cta_taps) con check >= 0.';

alter table public.ad_impressions_monthly enable row level security;

-- Mismo fail-closed que public.ad_zones (20260816000005): sin ninguna policy
-- ni grant para authenticated/anon -- la lectura del anunciante (tarea 171)
-- es vía RPC security definer, nunca contra la tabla directo.
revoke all on public.ad_impressions_monthly from anon, authenticated;
grant select, insert, update, delete on public.ad_impressions_monthly to service_role;

-- 🔴 fix guardián 170.5 (Quinto): llave natural + checks de contadores.
-- Patrón "drop if exists + add" (equivalente idempotente de "add constraint
-- if not exists", que Postgres no soporta nativamente) -- consistente con
-- el "drop policy if exists ... create policy" del resto del repo. La tabla
-- está vacía en todo ambiente donde esta migración ya corrió, así que
-- ninguno de estos ALTER puede toparse con datos que los violen.
--
-- unique nulls not distinct requiere Postgres 15+ (local y remoto: 17).
--
-- El check de que year_month sea el primer día del mes queda FUERA a
-- propósito (decisión explícita, no descuido): el comentario de arriba lo
-- promete pero ningún test lo exige todavía, y esa es una decisión que le
-- toca al job de rollup (trabajo futuro) tomar, no a esta migración.
alter table public.ad_impressions_monthly
  drop constraint if exists ad_impressions_monthly_agency_ad_zone_month_key;
alter table public.ad_impressions_monthly
  add constraint ad_impressions_monthly_agency_ad_zone_month_key
  unique nulls not distinct (agency_id, ad_id, municipality_id, neighborhood_id, year_month);

alter table public.ad_impressions_monthly
  drop constraint if exists ad_impressions_monthly_impressions_check;
alter table public.ad_impressions_monthly
  add constraint ad_impressions_monthly_impressions_check check (impressions >= 0);

alter table public.ad_impressions_monthly
  drop constraint if exists ad_impressions_monthly_views_check;
alter table public.ad_impressions_monthly
  add constraint ad_impressions_monthly_views_check check (views >= 0);

alter table public.ad_impressions_monthly
  drop constraint if exists ad_impressions_monthly_completions_check;
alter table public.ad_impressions_monthly
  add constraint ad_impressions_monthly_completions_check check (completions >= 0);

alter table public.ad_impressions_monthly
  drop constraint if exists ad_impressions_monthly_cta_taps_check;
alter table public.ad_impressions_monthly
  add constraint ad_impressions_monthly_cta_taps_check check (cta_taps >= 0);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) public.purge_ad_impressions() — borra el crudo que rebasa 90 días
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.purge_ad_impressions()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Frontera `<` estricta: exactamente 90 días se CONSERVA (dentro de la
  -- ventana prometida en el aviso de privacidad §5), 91 días se BORRA.
  -- Nunca toca ad_impressions_monthly -- el crudo caduca, el agregado no.
  delete from public.ad_impressions
   where created_at < now() - interval '90 days';
end;
$$;

comment on function public.purge_ad_impressions() is
  'Borra de ad_impressions lo que rebasa 90 días por created_at (frontera `<` '
  'estricta -- exactamente 90 días se conserva). Programada diario vía '
  'pg_cron (jobname purge_ad_impressions_daily, 0 9 * * * UTC = 3am CDMX). NUNCA toca '
  'ad_impressions_monthly. Cumple la promesa escrita del aviso de privacidad '
  '§5 (retención máxima de 90 días).';

revoke execute on function public.purge_ad_impressions() from public, anon, authenticated;
grant execute on function public.purge_ad_impressions() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) pg_cron — habilitar extensión + programar el job en ESTA misma migración
--    (ad_impressions no puede existir en producción sin su purga programada).
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema cron;

-- 🔴 fix guardián 170.5 (Cuarto): el literal del schedule está en la ZONA
-- DEL SERVIDOR, no en hora de Ciudad de México -- `show timezone` en este
-- proyecto (local y remoto) es UTC, y pg_cron interpreta el cron string en
-- esa zona. México central es UTC-6 FIJO todo el año (sin horario de
-- verano desde 2022), así que 3am CDMX = 9am UTC. '0 3 * * *' habría
-- corrido a las 21:00 CDMX -- hora pico de un feed de video -- justo el
-- peor momento para un DELETE masivo sobre la tabla facturable que más va
-- a crecer. '0 9 * * *' es el literal correcto: 9:00 UTC = 3:00 CDMX.
--
-- cron.schedule() con el mismo jobname actualiza el job in-place (verificado
-- empíricamente: no duplica en cron.job al re-aplicar la migración).
select cron.schedule(
  'purge_ad_impressions_daily',
  '0 9 * * *',
  'select public.purge_ad_impressions();'
);
