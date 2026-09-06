-- Migración 20260906100001 — private.crm_temperature + private.crm_band (subtarea 266.2,
-- exploración 045 "Rediseño CRM" §7.1/§7.2/§7.3). Aditiva pura: 2 funciones nuevas en el
-- schema `private` (no expuesto por PostgREST), ninguna tabla tocada, ningún contrato
-- publicado roto (§0.5 producción viva) — impacto-prod: sin riesgo.
-- Rollback: supabase/migrations/rollbacks/20260906100001_crm_temperature.sql
-- Tests: supabase/tests/100_crm_temperature_test.sql (plan 51)
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: dos funciones puras que consumen las RPC de 266.4–266.6 (crm_leads_page, etc.):
--
--   private.crm_temperature(p_agent_id, p_user_id, p_at) → int
--     T1 = min(100, round(greatest(piso_activo, Σ w_i·(1−decay)^días_desde(ts_i, p_at))))
--     Señales (§7.1): events_raw.video_completed (tope crm_max_video_completed, cuentan
--     los MÁS RECIENTES), likes, saves (todas unidas a la propiedad DUEÑA = p_agent_id),
--     lead_origin_properties del lead ACTIVO (agent_id, user_id, deleted_at is null): la
--     1ª fila por contacted_at = piso de entrada (crm_weight_contact_first), las
--     siguientes = re-contacto (crm_weight_contact_repeat); events_raw.zone_search y
--     .contact_repeat suman aditivamente (fase C — hoy nadie los escribe, la fórmula ya
--     los soporta). Señales con ts > p_at NUNCA cuentan (piso de "no ver el futuro").
--
--   private.crm_band(p_is_lead, p_temp, p_temp_prev, p_max14, p_strong_signal_at,
--                     p_last_status_change_at, p_at) → text
--     Evaluación ORDENADA (§7.3), primera que casa gana:
--       1. hot     — es lead ∧ señal fuerte dentro de crm_band_strong_signal_hours ∧
--                    NINGÚN cambio de estado posterior a esa señal.
--       2. cooling — es lead ∧ max(14d) ≥ crm_band_hot_threshold ∧ temp < temp_prev.
--       3. warming — temp > temp_prev ∧ sin cambio de estado dentro de la ventana de
--                    señal fuerte (admite anónimos).
--       4. silent  — el resto.
--     🔒 hot/cooling son EXCLUSIVOS de leads (p_is_lead=false cae a warming/silent,
--     nunca a hot/cooling — no hay a quién contactar).
--
-- ── Decisión clave: el reloj SIEMPRE entra por p_at, NUNCA now() dentro del núcleo ─────────
-- Precedente NUEVO en el repo (ningún pgTAP anterior fija el reloj de una función así):
-- permite que el pgTAP ancle literales exactos y que crm_leads_page (266.4+) congele un
-- único `as_of` entre páginas del cursor sin que el número de un lead cambie a media
-- paginación. La aritmética timestamptz−timestamptz vía extract(epoch)/86400 es
-- TZ-agnóstica por construcción (verificado bajo 4 zonas en el RED); el corte a DÍA
-- calendario (donde sí muerde la TZ) es responsabilidad de 266.3, no de esta función.
--
-- ── Claves de app_config — por COALESCE, NUNCA sembradas ──────────────────────────────────
-- Mismo patrón que private.compute_lead_level (20260807000004): sembrar aquí rompería
-- 12_stream_schema_test.sql (count(*)=3 en duro) y el RED de 29_lead_scoring_test.sql
-- (INSERT crudo de sus propias claves). Los defaults viven como fallback COALESCE — fail
-- closed, un valor razonable incluso si el admin borra las filas. Todas las claves y sus
-- defaults están documentadas en la exploración 045 §7.1/§7.3; no se repiten aquí para no
-- duplicar la fuente de verdad.
--
-- ── Señales por join a properties.owner_user_id, no por events_raw.agent_id ────────────────
-- events_raw.agent_id existe pero ningún escritor lo llena hoy (verificado en el RED); el
-- dueño real de la señal es properties.owner_user_id, mismo patrón que
-- private.adjust_lead_score (20260807000004) para likes/saves.
--
-- ── security definer + search_path='' + SIN grant a ningún rol de cliente ──────────────────
-- Son helpers internos (los llaman las RPC de 266.4–266.6, no PostgREST directo): se
-- revoca EXECUTE de public/anon/authenticated — a diferencia de public.ad_metrics_for_agency
-- (20260821000001) que sí concede a authenticated por ser el contrato público, aquí NINGÚN
-- rol de cliente tiene razón para llamarlas directo.
--
-- Idempotente: CREATE OR REPLACE + REVOKE (repetible sin error).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function private.crm_temperature(
  p_agent_id uuid,
  p_user_id uuid,
  p_at timestamptz
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_video_completed'), 10) as w_video,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_max_video_completed'), 5)::int as max_video,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_like'), 5) as w_like,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_save'), 18) as w_save,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_contact_first'), 30) as w_contact_first,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_contact_repeat'), 30) as w_contact_repeat,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_zone_search'), 8) as w_zone_search,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_decay_daily'), 0.08) as decay,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_temp_floor_active_lead'), 0) as floor_active
  ),
  active_lead as (
    select l.id
    from public.leads l
    where l.agent_id = p_agent_id
      and l.user_id = p_user_id
      and l.deleted_at is null
  ),
  contacts as (
    -- 1ª fila por contacted_at = piso de entrada; el resto = re-contacto (§7.2). Solo del
    -- lead ACTIVO (join a active_lead: un lead borrado no aporta nada).
    select
      lop.contacted_at as ts,
      case when row_number() over (order by lop.contacted_at asc) = 1
           then cfg.w_contact_first
           else cfg.w_contact_repeat
      end as weight
    from public.lead_origin_properties lop
    join active_lead al on al.id = lop.lead_id
    cross join cfg
    where lop.contacted_at <= p_at
  ),
  video_events as (
    -- Tope crm_max_video_completed: cuentan los MÁS RECIENTES (order by desc + limit).
    select er.created_at as ts, cfg.w_video as weight
    from public.events_raw er
    join public.properties p on p.id = er.property_id
    cross join cfg
    where er.event_type = 'video_completed'
      and p.owner_user_id = p_agent_id
      and er.user_id = p_user_id
      and er.created_at <= p_at
    order by er.created_at desc
    limit (select max_video from cfg)
  ),
  other_events as (
    -- Fase C, aditivo: nadie escribe estos event_type hoy, pero la fórmula ya los suma.
    select
      er.created_at as ts,
      case er.event_type
        when 'zone_search' then cfg.w_zone_search
        when 'contact_repeat' then cfg.w_contact_repeat
      end as weight
    from public.events_raw er
    join public.properties p on p.id = er.property_id
    cross join cfg
    where er.event_type in ('zone_search', 'contact_repeat')
      and p.owner_user_id = p_agent_id
      and er.user_id = p_user_id
      and er.created_at <= p_at
  ),
  likes_signal as (
    select l.created_at as ts, cfg.w_like as weight
    from public.likes l
    join public.properties p on p.id = l.property_id
    cross join cfg
    where p.owner_user_id = p_agent_id
      and l.user_id = p_user_id
      and l.created_at <= p_at
  ),
  saves_signal as (
    select s.created_at as ts, cfg.w_save as weight
    from public.saves s
    join public.properties p on p.id = s.property_id
    cross join cfg
    where p.owner_user_id = p_agent_id
      and s.user_id = p_user_id
      and s.created_at <= p_at
  ),
  all_signals as (
    select ts, weight from contacts
    union all select ts, weight from video_events
    union all select ts, weight from other_events
    union all select ts, weight from likes_signal
    union all select ts, weight from saves_signal
  ),
  totals as (
    select coalesce(sum(
      all_signals.weight * power(1 - cfg.decay, (extract(epoch from (p_at - all_signals.ts)))::numeric / 86400)
    ), 0) as raw_sum
    from all_signals
    cross join cfg
  )
  select least(100, round(greatest(
    case when exists (select 1 from active_lead) then (select floor_active from cfg) else 0 end,
    (select raw_sum from totals)
  )))::int;
$$;

comment on function private.crm_temperature(uuid, uuid, timestamptz) is
  'T1 (subtarea 266.2, exploración 045 §7.1): min(100, round(greatest(piso_activo, '
  'Σ w_i·(1−decay)^días))) sobre video_completed/likes/saves/contacto (lead activo) + '
  'zone_search/contact_repeat aditivos de fase C. Reloj SIEMPRE por p_at, nunca now(). '
  'Claves de app_config por COALESCE, NO sembradas. Helper interno de las RPC de '
  '266.4–266.6 — sin EXECUTE para anon/authenticated.';

create or replace function private.crm_band(
  p_is_lead boolean,
  p_temp int,
  p_temp_prev int,
  p_max14 int,
  p_strong_signal_at timestamptz,
  p_last_status_change_at timestamptz,
  p_at timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_band_strong_signal_hours'), 24) as hours,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_band_hot_threshold'), 80) as hot_threshold
  ),
  flags as (
    select
      (p_strong_signal_at is not null
        and p_strong_signal_at > p_at - (cfg.hours * interval '1 hour')) as signal_recent,
      (p_last_status_change_at is not null
        and p_strong_signal_at is not null
        and p_last_status_change_at > p_strong_signal_at) as status_after_signal,
      (p_last_status_change_at is not null
        and p_last_status_change_at > p_at - (cfg.hours * interval '1 hour')) as status_recent,
      cfg.hot_threshold as hot_threshold
    from cfg
  )
  select case
    when p_is_lead and flags.signal_recent and not flags.status_after_signal then 'hot'
    when p_is_lead and p_max14 >= flags.hot_threshold and p_temp < p_temp_prev then 'cooling'
    when p_temp > p_temp_prev and not flags.status_recent then 'warming'
    else 'silent'
  end
  from flags;
$$;

comment on function private.crm_band(boolean, int, int, int, timestamptz, timestamptz, timestamptz) is
  'Banda por tendencia (subtarea 266.2, exploración 045 §7.3), evaluación ORDENADA '
  'hot > cooling > warming > silent. hot: es lead ∧ señal fuerte dentro de '
  'crm_band_strong_signal_hours ∧ ningún cambio de estado posterior a la señal. cooling: '
  'es lead ∧ max14d ≥ crm_band_hot_threshold ∧ temp < temp_prev. warming: temp > temp_prev '
  'sin cambio de estado reciente (admite anónimos). 🔒 hot/cooling exigen p_is_lead=true. '
  'Helper interno de las RPC de 266.4–266.6 — sin EXECUTE para anon/authenticated.';

-- Defense-in-depth: ninguna de las 2 funciones tiene caso de uso legítimo desde un rol de
-- cliente (helpers internos, consumidos SOLO por las RPC de 266.4–266.6 vía SECURITY
-- DEFINER de esas RPC) — a diferencia de public.ad_metrics_for_agency, aquí ni siquiera
-- authenticated recibe EXECUTE.
revoke execute on function private.crm_temperature(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.crm_band(boolean, int, int, int, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
