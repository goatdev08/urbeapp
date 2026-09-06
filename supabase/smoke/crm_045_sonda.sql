-- SONDA post-deploy — subtarea 266.8 (épica 266 "Rediseño CRM", exploración 045).
-- Patrón prod_smoke_do_block_rollback: UN solo DO block que impersona por JWT claims (nunca
-- service_role para las 5 RPC nuevas), acumula el reporte en una variable text, y SIEMPRE
-- termina en RAISE EXCEPTION -- la excepción aborta la transacción -> rollback total de
-- cualquier side-effect (incluidas las escrituras reales de snapshot_lead_temperature/
-- check_rollup_health/purge_events_raw) y el reporte viaja en el mensaje del error.
--
-- Ejecutar contra el remoto vía mcp__supabase__execute_sql (cada llamada = 1 transacción;
-- NUNCA expone begin/rollback explícitos entre llamadas -- por eso el DO+RAISE, no un
-- `begin; ...; rollback;` de psql). NUNCA aplicar db push/apply_migration desde este archivo.
-- Local: `docker exec -i supabase_db_urbea-app psql -U postgres < supabase/smoke/crm_045_sonda.sql`
-- (o `-c "$(cat ...)"`), verificando después que lead_temperature_daily/notifications/
-- events_raw quedaron en el mismo conteo que antes.
--
-- Cubre las 5 RPC nuevas de 266.4/266.5/266.6 (crm_leads_page, crm_funnel, crm_lead_detail,
-- lead_activity, crm_radar_anon) + snapshot_lead_temperature/check_rollup_health/
-- purge_events_raw (266.2/266.3) + el contrato publicado get_lead_stats (20260808000002,
-- builds 1.0.3 instalados -- intacto, solo se lee para comparar contra la captura previa
-- al deploy).

do $$
declare
  ----------------------------------------------------------------------------
  -- IDs de PRODUCCIÓN (urbea-app), verificados por el orquestador antes del deploy
  -- (2026-09-06). DEJAR ESTOS VALORES al ejecutar contra el remoto. En LOCAL (stack
  -- `supabase start`) se sustituyen TEMPORALMENTE por ids del seed 266.1
  -- (seed-crm-volume.sql + supabase/seed.sql) solo para probar este archivo, y se
  -- restauran estos antes de cerrar la subtarea (ver bitácora 266.8).
  ----------------------------------------------------------------------------
  v_agent            uuid := '0cf89d14-eef5-4349-9df9-2b73ac0621d0';
    -- swacg08+agente@ (agent, agencia "Tu Casa con Vlad" 2a000000-0000-0000-0000-0000000000a1,
    -- 0 leads propios, 1 propiedad)
  v_agent_with_leads uuid := '1a000000-0000-0000-0000-0000000000a2';
    -- vladimiryeh@ (owner ACTIVO de 2a000000-0000-0000-0000-0000000000a1, 3 leads activos
    -- COMO AGENTE, 17 propiedades) -- (a) agente con pipeline propio y (b) owner que
    -- administra el pipeline de v_agent
  v_platform_admin   uuid := '10000000-0000-0000-0000-00000000000c';
    -- admin@urbea.demo (users.role=admin, SIN membresía en ninguna agencia) -> 0 filas en
    -- las 5 RPC
  v_other_agent      uuid := 'ce8c866f-fa71-425b-8193-f0d7cbb60f50';
    -- swacg08@ (owner de OTRA agencia, ea9b418e-...) -> 0 filas en las 5 RPC, sobre v_agent
    -- Y sobre v_agent_with_leads

  v_targets        uuid[]  := array[v_agent, v_agent_with_leads];
  v_target_labels  text[]  := array['v_agent', 'v_agent_with_leads'];
  v_personas       uuid[]  := array[v_agent, v_agent_with_leads, v_platform_admin, v_other_agent];
  v_persona_labels text[]  := array['v_agent (agente)', 'v_agent_with_leads (owner)',
                                     'v_platform_admin (admin ajeno)', 'v_other_agent (agente ajeno)'];

  v_lead_id  uuid;
  v_report   text := '';
  v_ok       boolean := true;
  v_n        int;
  v_keys     text[];
  v_extra    text[];
  v_bad      text[] := '{}';
  r          record;
  i          int;
  j          int;
  v_notif_before  int;
  v_notif_after   int;
  v_temp_before   int;
  v_temp_after    int;
  v_events_before int;
  v_events_after  int;
begin
  ----------------------------------------------------------------------------
  -- 0) Resolver el lead de v_agent_with_leads DENTRO del bloque (nunca hardcodeado),
  --    como postgres (bypass RLS por ownership) antes de tocar ningún JWT.
  ----------------------------------------------------------------------------
  select id into v_lead_id from public.leads
   where agent_id = v_agent_with_leads and deleted_at is null
   order by created_at limit 1;

  if v_lead_id is null then
    v_report := v_report || 'ADVERTENCIA: v_agent_with_leads no tiene leads propios en este '
      || 'ambiente -- se omite la matriz de crm_lead_detail/lead_activity (en producción '
      || 'vladimiryeh@ tiene 3).' || E'\n';
  else
    v_report := v_report || format('lead resuelto para crm_lead_detail/lead_activity: %s', v_lead_id) || E'\n';
  end if;

  ----------------------------------------------------------------------------
  -- 1) Matriz de autorización: 3 RPC (p_agent_id) x 2 pipelines objetivo x 4 personas.
  --    Invariantes: v_platform_admin y v_other_agent SIEMPRE 0 filas, sobre CUALQUIER
  --    objetivo (personas 3 y 4 del arreglo).
  ----------------------------------------------------------------------------
  for i in 1..array_length(v_targets, 1) loop
    for j in 1..array_length(v_personas, 1) loop
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', v_personas[j])::text, true);

      execute format('select count(*) from public.crm_leads_page(%L::uuid, null, null, 20, null)', v_targets[i]) into v_n;
      v_report := v_report || format('crm_leads_page(target=%s) caller=%s -> %s filas',
        v_target_labels[i], v_persona_labels[j], v_n) || E'\n';
      if j in (3, 4) and v_n <> 0 then
        v_ok := false;
        v_report := v_report || 'INVARIANTE ROTO: esperaba 0 filas' || E'\n';
      end if;

      execute format('select count(*) from public.crm_funnel(%L::uuid, 30)', v_targets[i]) into v_n;
      v_report := v_report || format('crm_funnel(target=%s) caller=%s -> %s filas',
        v_target_labels[i], v_persona_labels[j], v_n) || E'\n';
      if j in (3, 4) and v_n <> 0 then
        v_ok := false;
        v_report := v_report || 'INVARIANTE ROTO: esperaba 0 filas' || E'\n';
      end if;

      execute format('select count(*) from public.crm_radar_anon(%L::uuid, 20)', v_targets[i]) into v_n;
      v_report := v_report || format('crm_radar_anon(target=%s) caller=%s -> %s filas',
        v_target_labels[i], v_persona_labels[j], v_n) || E'\n';
      if j in (3, 4) and v_n <> 0 then
        v_ok := false;
        v_report := v_report || 'INVARIANTE ROTO: esperaba 0 filas' || E'\n';
      end if;
    end loop;
  end loop;

  ----------------------------------------------------------------------------
  -- 2) crm_lead_detail / lead_activity: reciben p_lead_id, no p_agent_id -- se prueban
  --    sobre el lead ya resuelto en (0), con las mismas 4 personas.
  ----------------------------------------------------------------------------
  if v_lead_id is not null then
    for j in 1..array_length(v_personas, 1) loop
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', v_personas[j])::text, true);

      execute format('select count(*) from public.crm_lead_detail(%L::uuid)', v_lead_id) into v_n;
      v_report := v_report || format('crm_lead_detail(lead de v_agent_with_leads) caller=%s -> %s filas',
        v_persona_labels[j], v_n) || E'\n';
      if j in (3, 4) and v_n <> 0 then
        v_ok := false;
        v_report := v_report || 'INVARIANTE ROTO: esperaba 0 filas' || E'\n';
      end if;

      execute format('select count(*) from public.lead_activity(%L::uuid, 20, null)', v_lead_id) into v_n;
      v_report := v_report || format('lead_activity(lead de v_agent_with_leads) caller=%s -> %s filas',
        v_persona_labels[j], v_n) || E'\n';
      if j in (3, 4) and v_n <> 0 then
        v_ok := false;
        v_report := v_report || 'INVARIANTE ROTO: esperaba 0 filas' || E'\n';
      end if;
    end loop;
  end if;

  ----------------------------------------------------------------------------
  -- 3) crm_radar_anon: NUNCA una clave fuera de las 7 del contrato (row_n, property_label,
  --    temperature, delta, sparkline, signals, last_activity_at), verificado por FILA con
  --    to_jsonb + jsonb_object_keys (no basta con confiar en el tipo de retorno).
  ----------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_agent_with_leads)::text, true);
  for r in execute format('select * from public.crm_radar_anon(%L::uuid, 20)', v_agent_with_leads) loop
    select array_agg(k) into v_keys from jsonb_object_keys(to_jsonb(r)) k;
    select array_agg(k) into v_extra from unnest(v_keys) k
      where k not in ('row_n', 'property_label', 'temperature', 'delta', 'sparkline', 'signals', 'last_activity_at');
    if coalesce(array_length(v_extra, 1), 0) > 0 then
      v_bad := v_bad || v_extra;
    end if;
  end loop;
  if coalesce(array_length(v_bad, 1), 0) > 0 then
    v_ok := false;
    v_report := v_report || format('INVARIANTE ROTO: crm_radar_anon devolvió claves fuera de las 7: %s', v_bad) || E'\n';
  else
    v_report := v_report || 'crm_radar_anon: claves OK (ninguna fuera de las 7 del contrato)' || E'\n';
  end if;

  ----------------------------------------------------------------------------
  -- 4) crm_funnel: EXACTAMENTE 5 enteros (ancho de fila vía to_jsonb, sobre una llamada
  --    autorizada -- p_agent_id = auth.uid()).
  ----------------------------------------------------------------------------
  select * into r from public.crm_funnel(v_agent_with_leads, 30);
  select array_agg(k) into v_keys from jsonb_object_keys(to_jsonb(r)) k;
  if coalesce(array_length(v_keys, 1), 0) <> 5 then
    v_ok := false;
    v_report := v_report || format('INVARIANTE ROTO: crm_funnel no devolvió 5 columnas (%s)', v_keys) || E'\n';
  else
    v_report := v_report || format(
      'crm_funnel(v_agent_with_leads,30) = vieron=%s volvieron=%s guardaron=%s contactaron=%s agendaron=%s',
      r.vieron, r.volvieron, r.guardaron, r.contactaron, r.agendaron) || E'\n';
  end if;

  ----------------------------------------------------------------------------
  -- 5) Reporte detallado del pipeline PROPIO de v_agent_with_leads (pedido explícito del
  --    orquestador): count + status_projected de cada fila.
  ----------------------------------------------------------------------------
  v_report := v_report || '--- crm_leads_page(v_agent_with_leads) como él mismo ---' || E'\n';
  v_n := 0;
  for r in execute format(
    'select lead_id, status_projected, band, temperature from public.crm_leads_page(%L::uuid, null, null, 20, null)',
    v_agent_with_leads
  ) loop
    v_n := v_n + 1;
    v_report := v_report || format('  lead_id=%s status_projected=%s band=%s temperature=%s',
      r.lead_id, r.status_projected, r.band, r.temperature) || E'\n';
  end loop;
  v_report := v_report || format('crm_leads_page(v_agent_with_leads) total filas=%s', v_n) || E'\n';

  reset role;

  ----------------------------------------------------------------------------
  -- 6) snapshot_lead_temperature + check_rollup_health + purge_events_raw, como
  --    postgres/service_role (solo estas 3 escriben; TODO se revierte con el RAISE final).
  ----------------------------------------------------------------------------
  select count(*) into v_temp_before from public.lead_temperature_daily where day = current_date;
  perform public.snapshot_lead_temperature(current_date);
  select count(*) into v_temp_after from public.lead_temperature_daily where day = current_date;
  v_report := v_report || format('lead_temperature_daily hoy: antes=%s despues=%s', v_temp_before, v_temp_after) || E'\n';

  select count(*) into v_notif_before from public.notifications where type = 'admin_rollup_unhealthy';
  perform public.check_rollup_health();
  select count(*) into v_notif_after from public.notifications where type = 'admin_rollup_unhealthy';
  v_report := v_report || format('notifications admin_rollup_unhealthy: antes=%s despues=%s (nuevas=%s)',
    v_notif_before, v_notif_after, v_notif_after - v_notif_before) || E'\n';

  select count(*) into v_events_before from public.events_raw;
  perform public.purge_events_raw();
  select count(*) into v_events_after from public.events_raw;
  v_report := v_report || format('events_raw: antes=%s despues=%s (purgadas=%s)',
    v_events_before, v_events_after, v_events_before - v_events_after) || E'\n';

  ----------------------------------------------------------------------------
  -- 7) Contrato publicado get_lead_stats (20260808000002, builds 1.0.3 instalados) --
  --    solo se lee, para comparar contra la captura previa al deploy.
  ----------------------------------------------------------------------------
  if v_lead_id is not null then
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_agent_with_leads)::text, true);
    for r in execute format('select * from public.get_lead_stats(array[%L::uuid])', v_lead_id) loop
      v_report := v_report || format(
        'get_lead_stats(lead de v_agent_with_leads) = vio_completo=%s veces_visto=%s guardo=%s ultima_actividad=%s',
        r.vio_completo, r.veces_visto, r.guardo, r.ultima_actividad) || E'\n';
    end loop;
    reset role;
  end if;

  ----------------------------------------------------------------------------
  -- Cierre: SIEMPRE aborta (rollback total) -- el reporte viaja en el mensaje del error.
  ----------------------------------------------------------------------------
  if v_ok then
    raise exception 'SONDA_OK %', v_report;
  else
    raise exception 'SONDA_FAIL %', v_report;
  end if;
end $$;
