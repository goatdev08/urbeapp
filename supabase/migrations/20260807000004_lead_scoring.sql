-- Migración 20260807000004 — Scoring denormalizado + nivel automático del CRM (subtarea 75.2)
-- Objetivo de producto: clasificar cada lead en frío/tibio/caliente según la actividad del
-- usuario con las publicaciones de ESE agente (pedido explícito del usuario).
--
-- REORIENTACIÓN (2026-08-07, ver bitácora de 75.2): el diseño original sumaba desde
-- public.events_raw, pero esa tabla NO TIENE ESCRITORES (0 referencias en código, 0 filas
-- en el remoto) — era un pipeline inexistente. El score se deriva de las señales que YA
-- EXISTEN:
--   contacto (existe el lead)                              = 10 puntos
--   guardado (public.saves del usuario sobre props        =  4 puntos c/u
--             del agente)
--   like     (public.likes del usuario sobre videos        =  1 punto c/u
--             de props del agente)
-- Las señales que faltan del PRD §19.6 (compartido 5, comentario 3, video completo 2)
-- llegan con el pipeline de eventos de otra ola — la fórmula vive en un solo lugar
-- (private.compute_lead_level para el nivel; el score se acumula por trigger) y puede
-- crecer sin rehacerse.
--
-- El guard "una acción cuenta una sola vez" YA LO DAN los unique index
-- likes_user_video_unique y saves_user_property_unique (migración 0006) — NO se reinventa
-- aquí.
--
-- Patrón seguido (precedente vivo): supabase/migrations/20260701000001_
-- engagement_count_triggers.sql — triggers AFTER INSERT OR DELETE sobre likes/saves,
-- SECURITY DEFINER, search_path = '' + referencias public. calificadas, con backfill final.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DECISIÓN — recálculo de `level` cuando cambian los umbrales de app_config
-- ════════════════════════════════════════════════════════════════════════════
-- `level` es una columna DENORMALIZADA (no una vista ni una columna generada) porque el
-- resto del CRM (índices, RLS, el propio 75.1) ya asume leer leads.level como una columna
-- plana igual que leads.status — una vista habría significado reescribir esos consumidores
-- sin necesidad. Consecuencia: alguien tiene que recalcularla cuando cambian los umbrales.
-- Se resuelve con un trigger AFTER UPDATE en public.app_config (WHEN key es uno de los 2
-- umbrales) que hace UPDATE masivo de leads.level (nunca de leads.score) — es el mecanismo
-- más simple que hace el caso 10 del RED verdad para leads YA EXISTENTES sin depender de
-- que alguien recuerde correr un backfill manual tras recalibrar. Alternativa descartada:
-- una vista/columna generada habría exigido tocar leads_select y los índices de
-- leads_agent_crm_idx (que ordenan por status, no por una expresión) — más cambio del
-- necesario para lo que pide el RED.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DECISIÓN — "sane defaults" de los umbrales SIN sembrar filas en app_config
-- ════════════════════════════════════════════════════════════════════════════
-- El caso 10 del RED (29_lead_scoring_test.sql:191-193) hace un INSERT CRUDO (sin ON
-- CONFLICT) de las claves lead_score_threshold_tibio/caliente — si esta migración ya
-- sembrara esas mismas claves, ese INSERT violaría la PK (23505) y abortaría TODA la
-- transacción del archivo (mata las 22 aserciones, no solo una). Además
-- 12_stream_schema_test.sql:37-40,67 fija en duro `count(*) = 3` filas en app_config
-- (video_slot_free, archived_retention_days, signed_url_ttl_seconds) — sembrar 2 claves
-- más aquí también rompería ESE test ya verde. Por eso los defaults sanos ("un lead nunca
-- se queda sin nivel derivable si el admin borra las claves") viven como fallback
-- COALESCE(…, 15/30) dentro de private.compute_lead_level, NO como filas de app_config: es
-- fail-closed igual (nunca hay un score sin nivel) sin tocar el conteo de filas de la tabla.
--
-- Idempotente: DO block con pg_type para el enum (patrón 0001), ADD COLUMN IF NOT EXISTS,
-- DROP TRIGGER/FUNCTION IF EXISTS + CREATE OR REPLACE.
-- Rollback: supabase/migrations/rollbacks/20260807000004_lead_scoring.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Enum lead_temperature + columnas leads.score / leads.level
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_temperature') then
    create type lead_temperature as enum ('frio', 'tibio', 'caliente');
  end if;
end$$;

alter table public.leads
  add column if not exists score integer not null default 0,
  add column if not exists level lead_temperature not null default 'frio';

comment on column public.leads.score is
  'Score denormalizado (subtarea 75.2): 10 (contacto) + 4×saves + 1×likes del usuario '
  'sobre publicaciones de ESTE agente. Mantenido por triggers, nunca escrito a mano.';
comment on column public.leads.level is
  'Nivel frío/tibio/caliente derivado de score vía umbrales calibrables en app_config '
  '(private.compute_lead_level). Mantenido por triggers, nunca escrito a mano.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) private.compute_lead_level — único lugar que traduce score -> nivel
-- ════════════════════════════════════════════════════════════════════════════
-- Cortes INCLUSIVOS: caliente si score >= umbral_caliente; tibio si score >= umbral_tibio
-- (y < umbral_caliente); frío en otro caso. Fallback 15/30 si las claves no existen en
-- app_config (admin las borró, o BD recién creada) — ver DECISIÓN arriba.
create or replace function private.compute_lead_level(p_score integer)
returns lead_temperature
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tibio    numeric;
  v_caliente numeric;
begin
  select (value::text)::numeric into v_tibio
    from public.app_config where key = 'lead_score_threshold_tibio';
  select (value::text)::numeric into v_caliente
    from public.app_config where key = 'lead_score_threshold_caliente';

  v_tibio    := coalesce(v_tibio, 15);
  v_caliente := coalesce(v_caliente, 30);

  if p_score >= v_caliente then
    return 'caliente';
  elsif p_score >= v_tibio then
    return 'tibio';
  else
    return 'frio';
  end if;
end;
$$;

comment on function private.compute_lead_level(integer) is
  'Traduce un score a lead_temperature vía los umbrales calibrables app_config.'
  'lead_score_threshold_tibio/lead_score_threshold_caliente (cortes inclusivos, '
  'fallback 15/30 si no existen las claves). Único lugar con la fórmula del nivel — '
  'lo usan el trigger de creación de lead, los triggers de likes/saves y el recálculo '
  'por cambio de umbrales.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3) private.init_lead_score — BEFORE INSERT en leads: score retroactivo
-- ════════════════════════════════════════════════════════════════════════════
-- Cubre al usuario que ya había dado like/guardado ANTES de contactar (caso más fácil de
-- olvidar): cuenta la actividad histórica del par (agent_id, user_id) sobre propiedades
-- del agente y arranca el score ya con ese acumulado + los 10 puntos del contacto.
-- BEFORE INSERT (no AFTER + UPDATE) evita un roundtrip extra: muta NEW directo.
create or replace function private.init_lead_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saves int;
  v_likes int;
begin
  select count(*) into v_saves
    from public.saves s
    join public.properties p on p.id = s.property_id
   where s.user_id = new.user_id
     and p.owner_user_id = new.agent_id;

  select count(*) into v_likes
    from public.likes l
    join public.properties p on p.id = l.property_id
   where l.user_id = new.user_id
     and p.owner_user_id = new.agent_id;

  new.score := 10 + (4 * v_saves) + (1 * v_likes);
  new.level := private.compute_lead_level(new.score);
  return new;
end;
$$;

comment on function private.init_lead_score() is
  'BEFORE INSERT en public.leads: inicializa score=10+4×saves_previos+1×likes_previos '
  'sobre propiedades de agent_id, y level derivado. Cubre la retroactividad (subtarea 75.2).';

drop trigger if exists trg_init_lead_score on public.leads;
create trigger trg_init_lead_score
  before insert on public.leads
  for each row execute function private.init_lead_score();

-- ════════════════════════════════════════════════════════════════════════════
-- 4) private.adjust_lead_score — AFTER INSERT OR DELETE en likes/saves
-- ════════════════════════════════════════════════════════════════════════════
-- Ajusta el lead que matchea (agent_id = dueño REAL de la propiedad, user_id = quien
-- da like/guarda) SOLO SI ese lead ya existe (§19.1: las interacciones no son leads — no
-- se auto-vivifica nada aquí). Compartida entre likes y saves (TG_TABLE_NAME decide el
-- peso) para no repetir la misma expresión de UPDATE dos veces.
-- 🔴 Aislamiento: el JOIN contra properties.owner_user_id (el dueño REAL) es lo que impide
-- que actividad sobre publicaciones de OTRO agente toque este lead — el WHERE agent_id =
-- v_owner filtra por ese dueño, nunca por el agente "de moda" en otra fila.
create or replace function private.adjust_lead_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner       uuid;
  v_user        uuid;
  v_property_id uuid;
  v_weight      int;
  v_delta       int;
begin
  if TG_OP = 'INSERT' then
    v_property_id := new.property_id;
    v_user        := new.user_id;
  else
    v_property_id := old.property_id;
    v_user        := old.user_id;
  end if;

  select owner_user_id into v_owner from public.properties where id = v_property_id;
  if v_owner is null then
    return null;  -- defensivo; la FK de properties garantiza que siempre existe
  end if;

  v_weight := case when TG_TABLE_NAME = 'likes' then 1 else 4 end;
  v_delta  := case when TG_OP = 'DELETE' then -v_weight else v_weight end;

  update public.leads
     set score = score + v_delta,
         level = private.compute_lead_level(score + v_delta)
   where agent_id = v_owner
     and user_id = v_user
     and deleted_at is null;

  return null;
end;
$$;

comment on function private.adjust_lead_score() is
  'AFTER INSERT OR DELETE en public.likes/public.saves: ajusta score/level del lead '
  '(agent_id=dueño real de la propiedad, user_id) SI ya existe. +1/-1 por like, +4/-4 por '
  'save. No toca leads.status (trg_lead_status_history de 75.1 solo dispara con UPDATE OF '
  'status). Compartida por likes y saves (peso vía TG_TABLE_NAME).';

drop trigger if exists trg_lead_score_likes on public.likes;
create trigger trg_lead_score_likes
  after insert or delete on public.likes
  for each row execute function private.adjust_lead_score();

drop trigger if exists trg_lead_score_saves on public.saves;
create trigger trg_lead_score_saves
  after insert or delete on public.saves
  for each row execute function private.adjust_lead_score();

-- ════════════════════════════════════════════════════════════════════════════
-- 5) private.recompute_lead_levels — AFTER UPDATE en app_config: recalibrar sin deploy
-- ════════════════════════════════════════════════════════════════════════════
-- Cuando cambia uno de los 2 umbrales, recalcula leads.level de TODOS los leads activos a
-- partir de su score ACTUAL (nunca lo toca) — así "calibrable sin publicar app" es cierto
-- también para leads que ya existían antes de la recalibración, no solo para escrituras
-- futuras. El WHEN filtra en el propio trigger (no corre por cualquier fila de app_config,
-- p.ej. video_slot_free); el guard interno de valor evita un UPDATE masivo en un no-op.
create or replace function private.recompute_lead_levels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.value is not distinct from old.value then
    return new;
  end if;

  update public.leads
     set level = private.compute_lead_level(score)
   where deleted_at is null;

  return new;
end;
$$;

comment on function private.recompute_lead_levels() is
  'AFTER UPDATE en public.app_config (solo lead_score_threshold_tibio/caliente, vía WHEN): '
  'recalcula leads.level de todos los leads activos a partir de su score actual. Nunca '
  'toca leads.score ni leads.status.';

drop trigger if exists trg_recompute_lead_levels on public.app_config;
create trigger trg_recompute_lead_levels
  after update on public.app_config
  for each row
  when (new.key in ('lead_score_threshold_tibio', 'lead_score_threshold_caliente'))
  execute function private.recompute_lead_levels();

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Backfill — leads existentes antes de esta migración
-- ════════════════════════════════════════════════════════════════════════════
-- Recalcula score/level de todos los leads ya en la base con la misma fórmula del trigger
-- de creación (10 + 4×saves + 1×likes del par agent_id/user_id sobre props del agente).
with computed as (
  select
    l.id,
    (
      10
        + 4 * (
            select count(*) from public.saves s
              join public.properties p on p.id = s.property_id
             where s.user_id = l.user_id and p.owner_user_id = l.agent_id
          )
        + 1 * (
            select count(*) from public.likes k
              join public.properties p on p.id = k.property_id
             where k.user_id = l.user_id and p.owner_user_id = l.agent_id
          )
    )::integer as new_score
  from public.leads l
)
update public.leads l
   set score = computed.new_score,
       level = private.compute_lead_level(computed.new_score)
  from computed
 where computed.id = l.id;
