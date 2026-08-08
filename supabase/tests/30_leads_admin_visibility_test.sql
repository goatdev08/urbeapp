-- Tests pgTAP — El admin de inmobiliaria ve el pipeline del equipo (subtarea 75.5)
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida (no persiste). Los
-- fixtures se insertan directo (el superusuario de pgTAP bypassa RLS); las
-- aserciones impersonan con pg_temp.act_as(uid, role) (mismo patrón que
-- 02/08/18/21/25/27/28_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO — el usuario pidió que el CRM "se muestre correctamente": hoy un
-- ADMIN de inmobiliaria (rol nuevo de la Ola 1, #71) queda como agente raso y
-- NO ve los leads de su equipo, porque el único helper que amplía la
-- visibilidad de "gestor de agencia" es private.is_agency_owner_of
-- (20260604000010:38-50), que SOLO matchea member_role='owner'.
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable vía impersonación JWT, NO
-- internals): las policies/helpers RLS de 3 tablas + el helper de identidad
-- del buscador, ejercitados con SELECT/UPDATE reales bajo `act_as`:
--   1) leads_select                              (20260604000010:324-326)
--   2) private.can_view_lead                      (usada por lead_status_history_select
--      [20260807000003:114-117] y lead_origin_select [20260604000010:339-341])
--   3) private.can_view_user_as_lead_searcher      (usada por users_select,
--      20260702000001:53-61)
--   4) leads_update                                (20260604000010, SIN TOCAR —
--      invariante de escritura, sección 7)
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED): helper nuevo
-- private.is_agency_admin_of(uuid), calco EXACTO de private.is_agency_owner_of
-- pero con member_role='admin', agregado como cláusula OR adicional en los 3
-- puntos de arriba (1,2,3) — NUNCA en leads_update (§31, deliberadamente
-- diferida). Este archivo NO referencia private.is_agency_admin_of directo (es
-- un internal, no el seam) — solo observa el efecto vía SELECT/UPDATE reales.
--
-- ── Estrategia RED sin abortar la transacción ────────────────────────────────
-- A diferencia de 28/29 (que agregaban columnas/enum), aquí el schema YA EXISTE
-- por completo (leads, lead_status_history, lead_origin_properties, users,
-- agency_members con el enum de 4 roles ya committeado por 20260805000002/3).
-- Solo falta lógica dentro de una policy — un SELECT/UPDATE bajo impersonación
-- NUNCA lanza por esto, simplemente devuelve menos filas de las esperadas. Por
-- eso los asserts van directos con `is()` (mismo patrón que 08_rls_lead_
-- searcher_test.sql), sin necesidad de envolver en lives_ok/DO.
--
-- ── Convención DELTA vs INVARIANTE (heredada de 08/21/25/27/28/29) ───────────
-- DELTA      = falla hoy, pasa tras GREEN completo (discrimina la implementación).
-- INVARIANTE = ya se cumple hoy (ancla de no-regresión) — marcado explícito.
-- La sección 3 (aislamiento cross-agencia) y la 7 (invariante de escritura) son
-- INVARIANTE hoy (0 filas / 0 actualizadas, porque el helper nuevo ni existe),
-- pero son las más importantes de las tres: son la red de seguridad contra el
-- mutante clásico ya visto en #100 (un helper de "membresía compartida" que
-- filtraba filas de OTRA agencia) — is_agency_admin_of debe exigir que AMBOS
-- (admin y agente dueño del lead) estén `active` en la MISMA agencia. El
-- guardian debe re-verificar tras GREEN que estas siguen en verde por la razón
-- correcta (comparación de agencia), no por casualidad.

begin;
select plan(15);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '...0000000755XX' (subtarea 75.5, sin colisión con
-- 075101-075299 de 28/29 — cada archivo pgTAP corre en su propia transacción).
--   OX  owner ACTIVO de agencia X        : ...075501
--   AX  admin ACTIVO de agencia X        : ...075502  (bajo prueba, DELTA)
--   GX  agente de X, DUEÑO del lead      : ...075503
--   VX  viewer ACTIVO de agencia X       : ...075504
--   RX  agente RASO de X (sin el lead)   : ...075505
--   SX  admin SUSPENDIDO de agencia X    : ...075506
--   OY  owner de agencia Y (otra agencia): ...075511
--   AY  admin de agencia Y               : ...075512
--   GY  agente de Y, dueño de su lead    : ...075513
--   TZ  tercero, sin relación con ninguna: ...075530
--   BX  buscador del lead de GX          : ...075541
--   BY  buscador del lead de GY          : ...075542
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000075501', 'ox.7505@test.local'),
  ('00000000-0000-0000-0000-000000075502', 'ax.7505@test.local'),
  ('00000000-0000-0000-0000-000000075503', 'gx.7505@test.local'),
  ('00000000-0000-0000-0000-000000075504', 'vx.7505@test.local'),
  ('00000000-0000-0000-0000-000000075505', 'rx.7505@test.local'),
  ('00000000-0000-0000-0000-000000075506', 'sx.7505@test.local'),
  ('00000000-0000-0000-0000-000000075511', 'oy.7505@test.local'),
  ('00000000-0000-0000-0000-000000075512', 'ay.7505@test.local'),
  ('00000000-0000-0000-0000-000000075513', 'gy.7505@test.local'),
  ('00000000-0000-0000-0000-000000075530', 'tz.7505@test.local'),
  ('00000000-0000-0000-0000-000000075541', 'bx.7505@test.local'),
  ('00000000-0000-0000-0000-000000075542', 'by.7505@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000075503', -- GX
    '00000000-0000-0000-0000-000000075513'  -- GY
  );

-- Identidad de contacto del buscador BX — fuente independiente para la
-- aserción D4 (no recomputada, literal fijo comparado abajo).
-- ⚠️ NO usar el rango '+52331234####' — seed.sql (línea ~398) lo asigna
-- secuencialmente a TODOS los agentes sin teléfono y choca con
-- users_phone_unique_active (17_registro_constraints_test.sql:148).
update public.users set first_name = 'Busca', last_name = 'DorX', phone = '+525587650001'
  where id = '00000000-0000-0000-0000-000000075541';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000075510', 'Inmobiliaria Visibilidad X 7505', 'inmo-visibilidad-x-7505', 'active', '00000000-0000-0000-0000-000000075501'),
  ('00000000-0000-0000-0000-000000075520', 'Inmobiliaria Visibilidad Y 7505', 'inmo-visibilidad-y-7505', 'active', '00000000-0000-0000-0000-000000075511');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000075551', '00000000-0000-0000-0000-000000075510', '00000000-0000-0000-0000-000000075501', 'owner',  'active'),    -- OX
  ('00000000-0000-0000-0000-000000075552', '00000000-0000-0000-0000-000000075510', '00000000-0000-0000-0000-000000075502', 'admin',  'active'),    -- AX
  ('00000000-0000-0000-0000-000000075553', '00000000-0000-0000-0000-000000075510', '00000000-0000-0000-0000-000000075503', 'agent',  'active'),    -- GX
  ('00000000-0000-0000-0000-000000075554', '00000000-0000-0000-0000-000000075510', '00000000-0000-0000-0000-000000075504', 'viewer', 'active'),    -- VX
  ('00000000-0000-0000-0000-000000075555', '00000000-0000-0000-0000-000000075510', '00000000-0000-0000-0000-000000075505', 'agent',  'active'),    -- RX (raso, sin el lead)
  ('00000000-0000-0000-0000-000000075556', '00000000-0000-0000-0000-000000075510', '00000000-0000-0000-0000-000000075506', 'admin',  'suspended'), -- SX
  ('00000000-0000-0000-0000-000000075561', '00000000-0000-0000-0000-000000075520', '00000000-0000-0000-0000-000000075511', 'owner',  'active'),    -- OY
  ('00000000-0000-0000-0000-000000075562', '00000000-0000-0000-0000-000000075520', '00000000-0000-0000-0000-000000075512', 'admin',  'active'),    -- AY
  ('00000000-0000-0000-0000-000000075563', '00000000-0000-0000-0000-000000075520', '00000000-0000-0000-0000-000000075513', 'agent',  'active');    -- GY

-- Lead bajo prueba: GX (agencia X) contactado por BX.
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000075601', '00000000-0000-0000-0000-000000075503', '00000000-0000-0000-0000-000000075541', 'contacted');
-- Lead de la OTRA agencia (Y): GY contactado por BY — usado en el aislamiento cruzado.
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000075602', '00000000-0000-0000-0000-000000075513', '00000000-0000-0000-0000-000000075542', 'contacted');

-- Propiedad de GX + su lead_origin_properties (para la aserción D3).
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075611', '00000000-0000-0000-0000-000000075503', 'departamento', 'rent',
   'Fixture visibilidad admin 7505 — X1', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active');
insert into public.lead_origin_properties (id, lead_id, property_id) values
  ('00000000-0000-0000-0000-000000075621', '00000000-0000-0000-0000-000000075601', '00000000-0000-0000-0000-000000075611');

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) [DELTA] Un ADMIN activo de la agencia X ve el pipeline del equipo:
--    el lead de un agente activo de su agencia, su historial de estado, sus
--    lead_origin_properties y los datos del buscador (identidad de contacto).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075502'); -- AX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075601'),
  1,
  'D1_admin_activo_ve_el_lead_de_un_agente_activo_de_su_agencia'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075502'); -- AX
select is(
  (select count(*)::int from public.lead_status_history where lead_id = '00000000-0000-0000-0000-000000075601'),
  1,
  'D2_admin_activo_ve_el_historial_de_estado_del_lead_de_su_equipo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075502'); -- AX
select is(
  (select count(*)::int from public.lead_origin_properties where lead_id = '00000000-0000-0000-0000-000000075601'),
  1,
  'D3_admin_activo_ve_lead_origin_properties_del_lead_de_su_equipo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075502'); -- AX
select is(
  (select first_name || '|' || last_name || '|' || phone from public.users
     where id = '00000000-0000-0000-0000-000000075541'),
  'Busca|DorX|+525587650001',
  'D4_admin_activo_ve_los_datos_de_contacto_del_buscador_del_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075502'); -- AX
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000075541'),
  1,
  'D5_admin_activo_ve_la_fila_users_del_buscador_al_menos_una_vez'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [INVARIANTE crítica — mutante clásico #100] Un admin de la agencia X NO ve
--    leads/buscadores de la agencia Y, aunque sea admin ACTIVO en alguna
--    agencia (guarda contra un helper que matchee cualquier membresía
--    compartida sin comparar la agencia del agente dueño del lead).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075502'); -- AX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075602'),
  0,
  'I1_admin_de_agencia_x_no_ve_leads_de_agentes_de_la_agencia_y'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075502'); -- AX
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000075542'),
  0,
  'I2_admin_de_agencia_x_no_ve_al_buscador_de_un_lead_de_la_agencia_y'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) [INVARIANTE] Un admin SUSPENDIDO/inactivo no ve nada del equipo.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075506'); -- SX (admin suspendido)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075601'),
  0,
  'I3_admin_suspendido_no_ve_leads_de_su_propia_agencia'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [INVARIANTE] Un viewer y un agente raso de la MISMA agencia (X) siguen
--    SIN ver leads ajenos — la matriz de roles de #71 no les da esa visibilidad.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075504'); -- VX (viewer)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075601'),
  0,
  'I4_viewer_de_la_agencia_no_ve_leads_ajenos'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075505'); -- RX (agente raso, sin el lead)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075601'),
  0,
  'I5_agente_raso_de_la_agencia_no_ve_leads_de_otro_agente'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) [INVARIANTE] No-regresión: el owner sigue viendo lo mismo que antes, el
--    agente dueño sigue viendo lo suyo, un tercero sin relación sigue sin ver
--    nada.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075501'); -- OX (owner)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075601'),
  1,
  'I6_owner_sigue_viendo_los_leads_de_su_equipo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075503'); -- GX (agente dueño)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075601'),
  1,
  'I7_agente_dueno_sigue_viendo_su_propio_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075530'); -- TZ (tercero)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075601'),
  0,
  'I8_tercero_sin_relacion_sigue_sin_ver_nada'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) [INVARIANTE de escritura — línea que separa esta tarea de la #31, diferida
--    a propósito] Ni el admin ni el owner de la agencia pueden hacer UPDATE de
--    un lead ajeno — la ampliación de esta subtarea es SOLO de lectura
--    (leads_update no se toca). Debe seguir en 0 filas afectadas antes Y
--    después del GREEN.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075502'); -- AX (admin)
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    update public.leads set internal_notes = 'intento de escritura del admin'
      where id = '00000000-0000-0000-0000-000000075601';
    get diagnostics v_count = row_count;
    if v_count is distinct from 0 then
      raise exception 'el admin de la agencia NO debe poder actualizar un lead ajeno (solo lectura); filas afectadas: %', v_count;
    end if;
  end
  $do$;
  $$,
  'I9_admin_no_puede_actualizar_un_lead_ajeno_solo_lectura'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075501'); -- OX (owner)
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    update public.leads set internal_notes = 'intento de escritura del owner'
      where id = '00000000-0000-0000-0000-000000075601';
    get diagnostics v_count = row_count;
    if v_count is distinct from 0 then
      raise exception 'el owner de la agencia NO debe poder actualizar un lead ajeno (solo lectura, precedente ya vigente); filas afectadas: %', v_count;
    end if;
  end
  $do$;
  $$,
  'I10_owner_no_puede_actualizar_un_lead_ajeno_solo_lectura'
);
reset role;

select * from finish();
rollback;
