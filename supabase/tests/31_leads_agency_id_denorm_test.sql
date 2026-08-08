-- Tests pgTAP — leads.agency_id denormalizado + visibilidad de owner/admin escapada a la
-- agencia REAL del lead (tarea derivada fix(75.5), origen: review del PR de la rama
-- tarea/75-crm-estados-scoring — hallazgo ALTO #2).
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- ⚠️ GOTCHA operativo: `supabase test db` NO reaplica migraciones nuevas por sí solo — si
-- agregas una migración GREEN nueva, corre `supabase db reset` antes.
-- Corre como superusuario dentro de una transacción revertida (no persiste). Los fixtures
-- se insertan directo (bypass RLS); las aserciones impersonan con pg_temp.act_as(uid,role)
-- (mismo patrón que 02/08/18/21/25/27/28/29/30_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO — 20260807000005 (subtarea 75.5) agregó private.is_agency_admin_of como un
-- COPY-PASTE de private.is_agency_owner_of: ambos filtran por membresía COMPARTIDA HOY
-- entre el caller (owner/admin) y el agente dueño del lead (leads.agent_id), NUNCA por la
-- agencia a la que pertenecía leads cuando NACIÓ. Es el MISMO defecto que ya se corrigió
-- para public.properties en la tarea derivada #100 (20260805000011) — aquí se repitió
-- porque public.leads nunca tuvo su propio agency_id denormalizado.
--
-- Escenario reproducido EXACTAMENTE (verificado por el revisor): el agente G tiene un lead
-- nacido mientras estaba activo en la agencia X. Luego G cambia de agencia: su membresía en
-- X pasa a 'removed' y gana una fila 'active' en Y (mismo efecto neto que
-- switch_agency_atomic, aplicado aquí directo sobre agency_members — no se prueba la RPC,
-- solo el estado resultante). Con el helper viejo (membresía compartida HOY):
--   admin de X (donde NACIÓ el lead) ve el lead?  -> 0   (el legítimo pierde acceso)
--   admin de Y (agencia NUEVA) ve el lead viejo?  -> 1   (el ajeno lo gana, incluye PII)
-- Ambos son DELTA: deben invertirse tras el GREEN.
--
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED):
--   1) public.leads.agency_id uuid (FK agencies, nullable) — poblado por trigger BEFORE
--      INSERT desde la membresía ACTIVA del agente AL MOMENTO de crear el lead (nunca se
--      actualiza después — igual que properties.agency_id, fix #100).
--   2) leads_select / private.can_view_lead / private.can_view_user_as_lead_searcher pasan
--      de is_agency_owner_of(agent_id) OR is_agency_admin_of(agent_id) (membresía hoy) a
--      private.agency_role_of(leads.agency_id) in ('owner','admin') (agencia REAL del lead,
--      mismo patrón que properties_update tras el fix #100).
--   3) private.is_agency_admin_of se elimina (sin consumidores tras este fix).
--
-- ── Estrategia RED sin abortar la transacción ────────────────────────────────
-- El schema de leads/agency_members/lead_status_history YA EXISTE por completo — solo falta
-- la columna agency_id y la lógica de las policies. Los SELECT/UPDATE bajo impersonación
-- (D1-D8, invariantes) NUNCA lanzan por esto — simplemente devuelven menos/más filas de las
-- esperadas, así que van directos con `is()` (mismo patrón que 30_*). Únicamente el check de
-- shape que LEE leads.agency_id por su nombre (aún no existe hoy) va envuelto en
-- `lives_ok($$ do $do$ ... raise exception ... $do$; $$, msg)` (mismo patrón que 28/29_*).
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/27/28/29/30) ───────────
-- DELTA      = falla hoy, pasa tras GREEN completo (discrimina la implementación).
-- INVARIANTE = ya se cumple hoy (ancla de no-regresión) — marcado explícito.

begin;
select plan(16);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '...0000000758XX' (fix 75.5-bis, sin colisión con 075101-075299
-- de 28/29 ni 075501-075542 de 30 — cada archivo pgTAP corre en su propia transacción).
--   OX  owner ACTIVO de agencia X (agencia de NACIMIENTO del lead) : ...075801
--   AX  admin ACTIVO de agencia X                                  : ...075802
--   GG  agente: nace el lead activo en X, LUEGO se cambia a Y      : ...075803
--   OY  owner ACTIVO de agencia Y (agencia NUEVA de GG)            : ...075811
--   AY  admin ACTIVO de agencia Y                                  : ...075812
--   TZ  tercero, sin relación con ninguna agencia                  : ...075830
--   BB  buscador del lead de GG                                    : ...075841
--   HH  agente INDEPENDIENTE (nunca tuvo agencia)                  : ...075850
--   BH  buscador del lead de HH                                    : ...075851
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000075801', 'ox.7505b@test.local'),
  ('00000000-0000-0000-0000-000000075802', 'ax.7505b@test.local'),
  ('00000000-0000-0000-0000-000000075803', 'gg.7505b@test.local'),
  ('00000000-0000-0000-0000-000000075811', 'oy.7505b@test.local'),
  ('00000000-0000-0000-0000-000000075812', 'ay.7505b@test.local'),
  ('00000000-0000-0000-0000-000000075830', 'tz.7505b@test.local'),
  ('00000000-0000-0000-0000-000000075841', 'bb.7505b@test.local'),
  ('00000000-0000-0000-0000-000000075850', 'hh.7505b@test.local'),
  ('00000000-0000-0000-0000-000000075851', 'bh.7505b@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000075803', -- GG
    '00000000-0000-0000-0000-000000075850'  -- HH
  );

update public.users set first_name = 'Busca', last_name = 'DorGG', phone = '+525587650011'
  where id = '00000000-0000-0000-0000-000000075841';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000075810', 'Inmobiliaria Denorm X 7505b', 'inmo-denorm-x-7505b', 'active', '00000000-0000-0000-0000-000000075801'),
  ('00000000-0000-0000-0000-000000075820', 'Inmobiliaria Denorm Y 7505b', 'inmo-denorm-y-7505b', 'active', '00000000-0000-0000-0000-000000075811');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000075861', '00000000-0000-0000-0000-000000075810', '00000000-0000-0000-0000-000000075801', 'owner', 'active'), -- OX
  ('00000000-0000-0000-0000-000000075862', '00000000-0000-0000-0000-000000075810', '00000000-0000-0000-0000-000000075802', 'admin', 'active'), -- AX
  ('00000000-0000-0000-0000-000000075863', '00000000-0000-0000-0000-000000075810', '00000000-0000-0000-0000-000000075803', 'agent', 'active'), -- GG, activo en X
  ('00000000-0000-0000-0000-000000075871', '00000000-0000-0000-0000-000000075820', '00000000-0000-0000-0000-000000075811', 'owner', 'active'), -- OY
  ('00000000-0000-0000-0000-000000075872', '00000000-0000-0000-0000-000000075820', '00000000-0000-0000-0000-000000075812', 'admin', 'active'); -- AY

-- El lead NACE mientras GG está activo en X (trigger BEFORE INSERT del GREEN debe fijar
-- agency_id = X en este momento).
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000075881', '00000000-0000-0000-0000-000000075803', '00000000-0000-0000-0000-000000075841', 'contacted');

-- Lead de HH, agente INDEPENDIENTE (nunca perteneció a una agencia) — agency_id debe quedar
-- NULL (decisión de diseño: independiente -> solo lo ve su dueño).
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000075882', '00000000-0000-0000-0000-000000075850', '00000000-0000-0000-0000-000000075851', 'contacted');

-- AHORA GG cambia de agencia: X -> 'removed', Y -> 'active' nueva fila (mismo efecto neto
-- que switch_agency_atomic; no se prueba la RPC, solo el estado resultante).
update public.agency_members set status = 'removed'
  where agency_id = '00000000-0000-0000-0000-000000075810'
    and user_id = '00000000-0000-0000-0000-000000075803';
insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000075864', '00000000-0000-0000-0000-000000075820', '00000000-0000-0000-0000-000000075803', 'agent', 'active'); -- GG, ahora activo en Y

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/29/30_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) SHAPE — leads.agency_id existe y quedó fijado a la agencia de NACIMIENTO (X), NO a la
--    agencia actual de GG (Y) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select has_column('public', 'leads', 'agency_id', 'leads.agency_id existe');

select lives_ok(
  $$
  do $do$
  declare v_agency_id uuid;
  begin
    select agency_id into v_agency_id from public.leads
      where id = '00000000-0000-0000-0000-000000075881';
    if v_agency_id is distinct from '00000000-0000-0000-0000-000000075810' then
      raise exception 'esperado agency_id=X (agencia DONDE NACIO el lead, no la actual de GG); fue %', v_agency_id;
    end if;
  end
  $do$;
  $$,
  'leads_agency_id_se_fija_a_la_agencia_del_agente_al_momento_de_crear_el_lead_no_a_la_actual'
);

select lives_ok(
  $$
  do $do$
  declare v_agency_id uuid;
  begin
    select agency_id into v_agency_id from public.leads
      where id = '00000000-0000-0000-0000-000000075882';
    if v_agency_id is not null then
      raise exception 'agente independiente (sin agencia) debe dejar agency_id NULL; fue %', v_agency_id;
    end if;
  end
  $do$;
  $$,
  'leads_agency_id_queda_null_para_un_agente_independiente'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [DELTA] El admin/owner de la agencia de NACIMIENTO (X) recupera la visibilidad que
--    perdía con el helper viejo (membresía compartida HOY).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075802'); -- AX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075881'),
  1,
  'D1_admin_de_la_agencia_donde_nacio_el_lead_lo_ve_aunque_el_agente_ya_cambio_de_agencia'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075801'); -- OX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075881'),
  1,
  'D2_owner_de_la_agencia_donde_nacio_el_lead_lo_ve_aunque_el_agente_ya_cambio_de_agencia'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075802'); -- AX
select is(
  (select count(*)::int from public.lead_status_history where lead_id = '00000000-0000-0000-0000-000000075881'),
  1,
  'D3_admin_de_la_agencia_de_nacimiento_ve_el_historial_de_estado_del_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075802'); -- AX
select is(
  (select first_name || '|' || last_name || '|' || phone from public.users
     where id = '00000000-0000-0000-0000-000000075841'),
  'Busca|DorGG|+525587650011',
  'D4_admin_de_la_agencia_de_nacimiento_ve_los_datos_de_contacto_del_buscador'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) [DELTA — mutante clásico #100, repetido aquí] El admin/owner de la agencia NUEVA (Y,
--    donde el agente está HOY) YA NO ve el lead viejo ni la PII del buscador, aunque
--    comparta membresía activa HOY con el agente.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075812'); -- AY
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075881'),
  0,
  'D5_admin_de_la_agencia_nueva_ya_no_ve_el_lead_nacido_en_la_agencia_vieja'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075811'); -- OY
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075881'),
  0,
  'D6_owner_de_la_agencia_nueva_ya_no_ve_el_lead_nacido_en_la_agencia_vieja'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075812'); -- AY
select is(
  (select count(*)::int from public.lead_status_history where lead_id = '00000000-0000-0000-0000-000000075881'),
  0,
  'D7_admin_de_la_agencia_nueva_ya_no_ve_el_historial_de_estado_del_lead_viejo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075812'); -- AY
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000075841'),
  0,
  'D8_admin_de_la_agencia_nueva_ya_no_ve_la_fila_users_del_buscador_del_lead_viejo_fuga_de_pii'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [INVARIANTE] No-regresión: el agente dueño sigue viendo lo suyo, un tercero sin
--    relación sigue sin ver nada.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075803'); -- GG (agente dueño, ahora en Y)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075881'),
  1,
  'I1_agente_dueno_sigue_viendo_su_propio_lead_sin_importar_su_agencia_actual'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075830'); -- TZ (tercero)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075881'),
  0,
  'I2_tercero_sin_relacion_sigue_sin_ver_nada'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) [INVARIANTE] Agente INDEPENDIENTE (agency_id NULL): solo su dueño ve el lead, ningún
--    admin de agencia (aunque exista) lo ve.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075850'); -- HH (agente independiente)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075882'),
  1,
  'I3_agente_independiente_sigue_viendo_su_propio_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000075802'); -- AX (admin de una agencia real, sin relación con HH)
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000075882'),
  0,
  'I4_ningun_admin_de_agencia_ve_el_lead_de_un_agente_independiente'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) [INVARIANTE de escritura] Ni el admin ni el owner de NINGUNA de las dos agencias
--    pueden hacer UPDATE del lead ajeno — esta tarea es SOLO de lectura (leads_update no
--    se toca, misma línea que separa 75.5 de la #31 diferida).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075802'); -- AX (admin de la agencia de nacimiento)
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    update public.leads set internal_notes = 'intento de escritura del admin de nacimiento'
      where id = '00000000-0000-0000-0000-000000075881';
    get diagnostics v_count = row_count;
    if v_count is distinct from 0 then
      raise exception 'el admin de la agencia (aun la de nacimiento) NO debe poder actualizar un lead ajeno; filas afectadas: %', v_count;
    end if;
  end
  $do$;
  $$,
  'I5_admin_de_la_agencia_de_nacimiento_no_puede_actualizar_el_lead_ajeno_solo_lectura'
);
reset role;

select * from finish();
rollback;
