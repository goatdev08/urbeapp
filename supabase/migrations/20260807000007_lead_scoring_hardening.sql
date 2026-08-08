-- Migración 20260807000007 — Hardening del scoring de leads (tarea derivada fix(75.2),
-- origen: review del PR de la rama tarea/75-crm-estados-scoring, 4 hallazgos sobre
-- 20260807000004_lead_scoring.sql — ya desplegada, NO se edita).
--
-- FIX1 (ALTA, un valor mal tipado en app_config tumba media plataforma) —
--   private.compute_lead_level hacía (value::text)::numeric SIN GUARDA. Como esa función
--   corre dentro de init_lead_score (BEFORE INSERT en leads) y adjust_lead_score (AFTER
--   INSERT/DELETE en likes/saves), UN SOLO valor no numérico en cualquiera de las 2 claves
--   de umbral (string, jsonb null, objeto) rompía las 3 escrituras -- contactar, dar like,
--   guardar -- con 22P02 invalid input syntax, para TODA la plataforma. Las claves hoy no
--   existen (0 filas en el remoto), así que la primera calibración de un admin es la
--   primera exposición a este bug.
--   Fix: filtrar jsonb_typeof(value) = 'number' en el WHERE de cada SELECT -- un valor no
--   numérico simplemente no matchea (0 filas), la variable queda NULL y el COALESCE al
--   fallback (ya existente) hace el resto. Fail-safe, no fail-closed: nunca truena.
--
-- FIX3 (MEDIA, "calibrable sin deploy" es falso en la primera calibración) —
--   el trigger de recálculo era "after update" SOLAMENTE. Con las claves inexistentes
--   (estado real de producción hoy), un INSERT de umbrales no recalculaba nada -- un lead
--   ya creado se quedaba con el nivel viejo hasta que alguien hiciera un UPDATE posterior.
--   Fix: "after insert or update or delete". El WHEN de un trigger multi-evento NO puede
--   mezclar NEW y OLD (Postgres lo rechaza en DDL: "DELETE trigger's WHEN condition cannot
--   reference NEW values" -- verificado empíricamente), así que el filtro de qué clave
--   cambió se movió al CUERPO de la función (lee new.key o old.key según TG_OP).
--
-- FIX4 (MEDIA, el scoring reescribe leads.updated_at y hace un UPDATE masivo sin cota) —
--   el trigger compartido public.set_updated_at (BEFORE UPDATE, sin lista de columnas) se
--   disparaba con CUALQUIER UPDATE de una fila leads, incluidas las que solo tocan
--   score/level. Dos efectos: (a) un buscador que da/quita un like reordena el CRM de las
--   apps v1.0.3 (ordenan por updated_at DESC); (b) una recalibración de umbral hacía un
--   UPDATE sin cota sobre TODOS los leads activos de la plataforma.
--   Fix (a): el trigger set_updated_at de public.leads pasa a "before update OF <columnas
--   humanas>" (agent_id, user_id, status, internal_notes, first_contact_at, last_contact_at,
--   closed_at, deleted_at) -- excluye score/level explícitamente, así NINGUNA escritura de
--   scoring (ni el ajuste por like/save ni el recompute por recalibración) toca
--   leads.updated_at, sin tocar public.set_updated_at (compartida por ~10 tablas más).
--   Fix (b): el UPDATE del recompute queda acotado a
--   "where deleted_at is null and level is distinct from private.compute_lead_level(score)".
--
-- FIX5 (producto, con los umbrales por defecto casi todo lead se ve "Frío") —
--   contacto=10, save=4, like=1, pero los defaults eran tibio=15/caliente=30: alguien que
--   ve el video, da like y contacta por WhatsApp (11 pts) se etiquetaba "Frío". Fix: el
--   FALLBACK de private.compute_lead_level pasa de 15/30 a 10/20 -- contacto solo YA es
--   tibio; contacto + 2 guardados + 2 likes (20 pts) es caliente. Se hace en el fallback,
--   NO sembrando filas en app_config (rompería el INSERT crudo del caso 10 de
--   29_lead_scoring_test.sql y el count(*)=3 de 12_stream_schema_test.sql -- documentado
--   en la cabecera de 20260807000004).
--
-- Tests: supabase/tests/32_lead_scoring_hardening_test.sql (plan 7, un lives_ok por fix
-- salvo FIX1 que tiene 3 bloques -- string/jsonb-null/objeto, cada clave por separado y
-- ambas a la vez).
-- Idempotente: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS antes de CREATE.
-- Rollback: supabase/migrations/rollbacks/20260807000007_lead_scoring_hardening.sql

-- ════════════════════════════════════════════════════════════════════════════
-- FIX1 + FIX5 — private.compute_lead_level: guarda jsonb_typeof + fallback 10/20.
-- ════════════════════════════════════════════════════════════════════════════
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
  -- FIX1: jsonb_typeof(value) = 'number' filtra cualquier valor mal tipado (string, jsonb
  -- null, objeto, array, boolean) -- la fila simplemente no matchea, la variable queda
  -- NULL y el COALESCE de abajo cae al fallback. Nunca truena con 22P02.
  select (value::text)::numeric into v_tibio
    from public.app_config
   where key = 'lead_score_threshold_tibio'
     and jsonb_typeof(value) = 'number';
  select (value::text)::numeric into v_caliente
    from public.app_config
   where key = 'lead_score_threshold_caliente'
     and jsonb_typeof(value) = 'number';

  -- FIX5: fallback 10/20 (antes 15/30) -- contacto solo (10) ya es tibio; contacto + 2
  -- guardados + 2 likes (20) es caliente. Ver DECISIÓN en 20260807000004 sobre por qué
  -- vive en el fallback y no como filas sembradas en app_config.
  v_tibio    := coalesce(v_tibio, 10);
  v_caliente := coalesce(v_caliente, 20);

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
  'lead_score_threshold_tibio/lead_score_threshold_caliente (cortes inclusivos). Fix '
  '75.2-bis FIX1: solo lee valores con jsonb_typeof=''number'' -- un valor mal tipado no '
  'matchea y cae al fallback, nunca truena. Fix FIX5: fallback 10/20 (antes 15/30). Único '
  'lugar con la fórmula del nivel -- lo usan el trigger de creación de lead, los triggers '
  'de likes/saves y el recálculo por cambio de umbrales.';

-- ════════════════════════════════════════════════════════════════════════════
-- FIX3 + FIX4(b) — private.recompute_lead_levels: dispara en INSERT/UPDATE/DELETE (no
-- solo UPDATE) y el UPDATE queda acotado a las filas cuyo nivel de verdad cambia.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.recompute_lead_levels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  -- FIX3: un trigger "insert or update or delete" no puede tener un WHEN que mezcle
  -- NEW/OLD (Postgres lo rechaza en DDL) -- el filtro de clave vive aquí, leyendo new.key
  -- u old.key según corresponda (NEW no existe en DELETE, OLD no existe en INSERT).
  if TG_OP = 'DELETE' then
    v_key := old.key;
  else
    v_key := new.key;
  end if;

  if v_key not in ('lead_score_threshold_tibio', 'lead_score_threshold_caliente') then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Un UPDATE que no cambia el valor (p.ej. otro campo de la fila, o un no-op) no amerita
  -- recalcular nada -- evita trabajo cuando ni siquiera hay un cambio real de umbral.
  if TG_OP = 'UPDATE' and new.value is not distinct from old.value then
    return new;
  end if;

  -- FIX4(b): acotado a las filas cuyo nivel de verdad cambia -- antes era un UPDATE sin
  -- cota sobre TODOS los leads activos de la plataforma por cada recalibración.
  update public.leads
     set level = private.compute_lead_level(score)
   where deleted_at is null
     and level is distinct from private.compute_lead_level(score);

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function private.recompute_lead_levels() is
  'AFTER INSERT OR UPDATE OR DELETE en public.app_config (filtro de clave en el cuerpo, no '
  'en WHEN -- ver FIX3): recalcula leads.level de los leads activos CUYO NIVEL CAMBIA '
  '(FIX4b, acotado) a partir de su score actual. Nunca toca leads.score ni leads.status.';

drop trigger if exists trg_recompute_lead_levels on public.app_config;
create trigger trg_recompute_lead_levels
  after insert or update or delete on public.app_config
  for each row
  execute function private.recompute_lead_levels();

-- ════════════════════════════════════════════════════════════════════════════
-- FIX4(a) — el trigger set_updated_at de public.leads deja de dispararse por escrituras
-- de scoring (score/level): pasa a "before update OF <columnas humanas>".
-- ════════════════════════════════════════════════════════════════════════════
drop trigger if exists set_updated_at on public.leads;
create trigger set_updated_at
  before update of
    agent_id, user_id, status, internal_notes,
    first_contact_at, last_contact_at, closed_at, deleted_at
  on public.leads
  for each row execute function public.set_updated_at();

comment on trigger set_updated_at on public.leads is
  'Fix 75.2-bis FIX4(a): restringido a columnas "humanas" (excluye score/level, mantenidas '
  'por private.init_lead_score/adjust_lead_score/recompute_lead_levels) -- así dar/quitar '
  'un like o recalibrar un umbral NUNCA toca leads.updated_at (evita reordenar el CRM de '
  'las apps v1.0.3, que ordenan por updated_at DESC). agency_id tampoco está en la lista: '
  'private.set_lead_agency_id solo la fija en el INSERT, nunca se actualiza después.';
