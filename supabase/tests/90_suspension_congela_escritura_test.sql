-- Tests pgTAP — #202: la suspensión congela la ACTUACIÓN (2ª capa, RLS)
-- Ejecutar con: supabase test db --local (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- DEFINICIÓN DE PRODUCTO (Abraham, 2026-08-21, tarea #202)
--   «Suspender congela la capacidad de ACTUAR en nombre de la agencia.
--    Conserva la lectura de lo propio. Y lo que quedó vivo pasa al control
--    de la agencia.»
-- Alcance de ESTA subtarea (202.1) = reglas 1 y 2 en la CAPA RLS.
--
-- HUECO QUE CIERRA (verificado en el código, 2026-08-21):
--   properties_update (20260805000011:255-265) empieza con
--   `owner_user_id = auth.uid()` — esa cláusula CORTOCIRCUITA sin mirar la
--   membresía. Resultado: un agente suspendido no puede PUBLICAR
--   (AGENCY_MEMBERSHIP_SUSPENDED, 20260805000011:122) pero SÍ puede editar
--   precio/dirección/descripción de lo ya publicado — que sigue en el
--   escaparate bajo la marca de la agencia (properties.agency_id denormalizado
--   por esa misma migración) — y puede PAUSAR o CERRAR todo su inventario.
--   private.can_view_user_as_lead_searcher (20260807000006:153-161) tiene el
--   mismo atajo `l.agent_id = auth.uid()`: el suspendido sigue viendo el
--   teléfono/WhatsApp del buscador. [[privacidad-registrar-no-es-exponer]]:
--   la condición para exponer a una persona es RELACIÓN VIGENTE, no «soy
--   dueño del objeto» — y una membresía en pausa no es relación vigente.
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable por IMPERSONACIÓN JWT, jamás
-- leyendo el texto de la policy):
--   1) policy properties_update  → filas afectadas por UPDATE (price, status)
--   2) users_select vía private.can_view_user_as_lead_searcher → filas de
--      public.users del buscador visibles (teléfono)
-- SUT del GREEN: supabase/migrations/20260904100001_suspension_congela_escritura.sql
--
-- ── Convención DELTA vs INVARIANTE (heredada de 08/21/25/27/28/29/30/77) ─────
-- DELTA      = falla HOY, pasa tras el GREEN (discrimina la implementación).
-- INVARIANTE = ya se cumple hoy (ancla de no-regresión de #100/#142/#75.5-bis).
--
-- 🔴 FIXTURE EXPLÍCITO (lección de 171.4): el miembro suspendido ES el
--    owner_user_id de la propiedad y el agent_id del lead, con agency_id
--    denormalizado en AMBAS filas. Si no, el filtro de rol lo excluye antes y
--    la defensa nueva nunca se ejercita — el mutante sobrevive con la suite en
--    verde.
-- 🔴 CONTROL QUE NO PUEDE ROMPERSE: el agente INDEPENDIENTE (agency_id NULL)
--    sigue escribiendo y sigue viendo el contacto de su buscador. No se puede
--    castigar al que nunca tuvo inmobiliaria (su eje es #204).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(31);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '...0000000202XX' (#202, sin colisión con 0226XX).
--   OA   owner ACTIVO de la agencia A                                : ...020201
--   AA   admin (member_role) ACTIVO de la agencia A                  : ...020202
--   SUS  agente SUSPENDIDO en A — DUEÑO de P_SUS y agente de L_SUS   : ...020203
--   ACT  agente ACTIVO en A — dueño de P_ACT y agente de L_ACT       : ...020204
--   IND  agente INDEPENDIENTE (sin membresía) — P_IND / L_IND        : ...020205
--   REM  agente REMOVED en A — dueño de P_REM (bajo agency_id A)     : ...020206
--   VIE  viewer ACTIVO en A, NO dueño de nada                        : ...020207
--   PAD  admin de PLATAFORMA (users.role = 'admin')                  : ...020208
--   B1   buscador del lead de SUS                                    : ...020209
--   B2   buscador del lead de ACT                                    : ...02020a
--   B3   buscador del lead de IND                                    : ...02020b
--   Agencia A (la de todos)                                          : ...0202e1
--   Agencia B — existe, NADIE del fixture es miembro (ancla WITH CHECK): ...0202e2
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000020201', 'oa.202@test.local'),
  ('00000000-0000-0000-0000-000000020202', 'aa.202@test.local'),
  ('00000000-0000-0000-0000-000000020203', 'sus.202@test.local'),
  ('00000000-0000-0000-0000-000000020204', 'act.202@test.local'),
  ('00000000-0000-0000-0000-000000020205', 'ind.202@test.local'),
  ('00000000-0000-0000-0000-000000020206', 'rem.202@test.local'),
  ('00000000-0000-0000-0000-000000020207', 'vie.202@test.local'),
  ('00000000-0000-0000-0000-000000020208', 'pad.202@test.local'),
  ('00000000-0000-0000-0000-000000020209', 'b1.202@test.local'),
  ('00000000-0000-0000-0000-00000002020a', 'b2.202@test.local'),
  ('00000000-0000-0000-0000-00000002020b', 'b3.202@test.local');

-- Los agentes (dos ejes de permisos: users.role vs agency_members.member_role).
update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000020203',
               '00000000-0000-0000-0000-000000020204',
               '00000000-0000-0000-0000-000000020205',
               '00000000-0000-0000-0000-000000020206');
update public.users set role = 'admin'
  where id = '00000000-0000-0000-0000-000000020208';

-- Buscadores: role 'user' por defecto y is_verified_agent false — así la única
-- rama de users_select que los puede exponer es can_view_user_as_lead_searcher
-- (si fueran agentes verificados, la rama pública los mostraría y el test no
-- discriminaría nada). Teléfonos E.164 MX distintos (users_phone_unique_active).
update public.users set first_name = 'Bea',  last_name = 'Uno',  phone = '+523312020201'
  where id = '00000000-0000-0000-0000-000000020209';
update public.users set first_name = 'Bea',  last_name = 'Dos',  phone = '+523312020202'
  where id = '00000000-0000-0000-0000-00000002020a';
update public.users set first_name = 'Bea',  last_name = 'Tres', phone = '+523312020203'
  where id = '00000000-0000-0000-0000-00000002020b';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-0000000202e1', 'Inmobiliaria Suspension 202', 'inmo-suspension-202',
   'active', '00000000-0000-0000-0000-000000020201'),
  -- Agencia B sin NINGUNA membresía del fixture: destino ajeno para el ancla
  -- del WITH CHECK. created_by_user_id no crea membresía (no hay trigger).
  ('00000000-0000-0000-0000-0000000202e2', 'Inmobiliaria Ajena 202', 'inmo-ajena-202',
   'active', '00000000-0000-0000-0000-000000020201');

-- agency_members_one_active_per_user (0003) admite a lo más 1 fila ACTIVA por
-- usuario; SUS ('suspended') y REM ('removed') no cuentan para el índice.
insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000020251', '00000000-0000-0000-0000-0000000202e1', '00000000-0000-0000-0000-000000020201', 'owner',  'active'),
  ('00000000-0000-0000-0000-000000020252', '00000000-0000-0000-0000-0000000202e1', '00000000-0000-0000-0000-000000020202', 'admin',  'active'),
  ('00000000-0000-0000-0000-000000020253', '00000000-0000-0000-0000-0000000202e1', '00000000-0000-0000-0000-000000020203', 'agent',  'suspended'),
  ('00000000-0000-0000-0000-000000020254', '00000000-0000-0000-0000-0000000202e1', '00000000-0000-0000-0000-000000020204', 'agent',  'active'),
  ('00000000-0000-0000-0000-000000020255', '00000000-0000-0000-0000-0000000202e1', '00000000-0000-0000-0000-000000020206', 'agent',  'removed'),
  ('00000000-0000-0000-0000-000000020256', '00000000-0000-0000-0000-0000000202e1', '00000000-0000-0000-0000-000000020207', 'viewer', 'active');

-- Propiedades. P_SUS/P_ACT/P_REM llevan agency_id denormalizado (lo que hace
-- publish_property_atomic desde 20260805000011); P_IND no tiene organización.
insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-0000000202f1', '00000000-0000-0000-0000-000000020203', '00000000-0000-0000-0000-0000000202e1',
   'departamento', 'rent', 'Fixture 202 — P_SUS (dueño suspendido)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 15000, 'active'),
  ('00000000-0000-0000-0000-0000000202f2', '00000000-0000-0000-0000-000000020204', '00000000-0000-0000-0000-0000000202e1',
   'departamento', 'rent', 'Fixture 202 — P_ACT (dueño activo)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 16000, 'active'),
  ('00000000-0000-0000-0000-0000000202f3', '00000000-0000-0000-0000-000000020205', null,
   'casa', 'sale', 'Fixture 202 — P_IND (agente independiente)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography, 2500000, 'active'),
  ('00000000-0000-0000-0000-0000000202f4', '00000000-0000-0000-0000-000000020206', '00000000-0000-0000-0000-0000000202e1',
   'casa', 'sale', 'Fixture 202 — P_REM (dueño removido, fila aún bajo la marca)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.38, 20.70), 4326)::extensions.geography, 2600000, 'active');

-- Leads. agency_id explícito: trg_set_lead_agency_id solo lo deriva de una
-- membresía ACTIVA, y el lead de SUS nació cuando SÍ lo estaba (es justo el
-- caso real: la suspensión llega DESPUÉS del lead).
insert into public.leads (id, agent_id, user_id, agency_id, status) values
  ('00000000-0000-0000-0000-0000000202d1', '00000000-0000-0000-0000-000000020203', '00000000-0000-0000-0000-000000020209', '00000000-0000-0000-0000-0000000202e1', 'contacted'),
  ('00000000-0000-0000-0000-0000000202d2', '00000000-0000-0000-0000-000000020204', '00000000-0000-0000-0000-00000002020a', '00000000-0000-0000-0000-0000000202e1', 'contacted'),
  ('00000000-0000-0000-0000-0000000202d3', '00000000-0000-0000-0000-000000020205', '00000000-0000-0000-0000-00000002020b', null, 'contacted');

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/30/77).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- REGLA 1 — Toda ESCRITURA se bloquea, sin la excepción de «es mío».
-- ════════════════════════════════════════════════════════════════════════════

-- [DELTA] El dueño SUSPENDIDO no cambia el precio de su propia publicación.
--    Editar el precio de algo que sigue en el escaparate bajo la marca de la
--    agencia es el MISMO acto comercial que publicarlo.
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS
with u as (
  update public.properties set price = 1
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 0, 'D1_dueno_suspendido_no_cambia_el_precio_de_su_propiedad') from u;
reset role;

-- [DELTA] Tampoco la PAUSA. Sin esto, un agente molesto por su suspensión
--    vacía el escaparate de la agencia en dos minutos.
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS
with u as (
  update public.properties set status = 'paused'
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 0, 'D2_dueno_suspendido_no_pausa_su_propiedad') from u;
reset role;

-- [DELTA] Ni el CIERRE. La des-escalada la decide el owner, no el suspendido.
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS
with u as (
  update public.properties set status = 'closed', closed_reason = 'withdrawn'
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 0, 'D3_dueno_suspendido_no_cierra_su_propiedad') from u;
reset role;

-- [DELTA] Ni BORRARLA. `authenticated` tiene DELETE sobre la tabla
--    (has_table_privilege = t), así que sin esto el suspendido llamaba
--    `DELETE /rest/v1/properties?id=eq.X` con el anon key y hacía desaparecer
--    la fila — peor que cerrarla, porque no deja ni registro. Endurecer solo
--    properties_update dejaba la puerta de al lado abierta.
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS
with d as (
  delete from public.properties
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 0, 'D7_dueno_suspendido_no_borra_su_propiedad') from d;
reset role;

-- [ANCLA] Ninguno de los 4 intentos anteriores dejó rastro: la fila sigue
--    ahí y sin tocar (si el DELETE hubiera pasado, este assert también muere).
select results_eq(
  $$ select price::numeric, status::text, closed_reason::text
       from public.properties where id = '00000000-0000-0000-0000-0000000202f1' $$,
  $$ values (15000::numeric, 'active'::text, null::text) $$,
  'D4_la_propiedad_del_suspendido_sigue_intacta_tras_los_4_intentos'
);

-- [DELTA] Miembro REMOVED cuya propiedad quedó bajo agency_id: tampoco.
--    DECISIÓN #202: la fila sigue bajo la marca de la agencia → la controla la
--    agencia (regla 3 «lo que quedó vivo pasa al control de la agencia»). Que
--    owner_user_id sea suyo no la saca del escaparate.
select pg_temp.act_as('00000000-0000-0000-0000-000000020206'); -- REM
with u as (
  update public.properties set price = 1
   where id = '00000000-0000-0000-0000-0000000202f4'
   returning id
)
select is(count(*)::int, 0, 'D5_dueno_removido_con_propiedad_bajo_agency_id_no_escribe') from u;
reset role;

-- [INVARIANTE 🔴 CONTROL] El agente INDEPENDIENTE (propiedad con agency_id
--    NULL, sin membresía alguna) sigue editando. No se puede castigar al que
--    nunca tuvo inmobiliaria — su eje es #204, otra tarea.
select pg_temp.act_as('00000000-0000-0000-0000-000000020205'); -- IND
with u as (
  update public.properties set price = 2400000
   where id = '00000000-0000-0000-0000-0000000202f3'
   returning id
)
select is(count(*)::int, 1, 'I1_agente_independiente_sigue_editando_su_propiedad_sin_agencia') from u;
reset role;

-- [INVARIANTE] Agente ACTIVO dueño: camino intacto.
select pg_temp.act_as('00000000-0000-0000-0000-000000020204'); -- ACT
with u as (
  update public.properties set price = 17000
   where id = '00000000-0000-0000-0000-0000000202f2'
   returning id
)
select is(count(*)::int, 1, 'I2_agente_activo_dueno_sigue_editando_su_propiedad') from u;
reset role;

-- [ANCLA DEL WITH CHECK] Un dueño con membresía VIGENTE en A no puede MOVER su
-- publicación a la agencia B, donde no es miembro. USING solo mira la agencia
-- VIEJA: sin WITH CHECK (mutante `with check (true)`) la reasignación pasaría y
-- la propiedad quedaría bajo una marca ajena. La fila nueva viola la policy →
-- 42501 insufficient_privilege, no «0 filas».
select pg_temp.act_as('00000000-0000-0000-0000-000000020204'); -- ACT (activo en A)
select throws_ok(
  $$ update public.properties set agency_id = '00000000-0000-0000-0000-0000000202e2'
      where id = '00000000-0000-0000-0000-0000000202f2' $$,
  '42501',
  null,
  'M4_el_with_check_impide_mover_la_propiedad_a_una_agencia_donde_no_soy_miembro'
);
reset role;

-- [INVARIANTE #142] El owner ACTIVO de la agencia edita la propiedad del
--    suspendido — «lo que quedó vivo pasa al control de la agencia».
select pg_temp.act_as('00000000-0000-0000-0000-000000020201'); -- OA
with u as (
  update public.properties set price = 15500
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 1, 'I3_owner_activo_edita_la_propiedad_del_suspendido') from u;
reset role;

-- [INVARIANTE #142] Y el admin de INMOBILIARIA activo, igual.
select pg_temp.act_as('00000000-0000-0000-0000-000000020202'); -- AA
with u as (
  update public.properties set price = 15600
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 1, 'I4_admin_de_inmobiliaria_activo_edita_la_propiedad_del_suspendido') from u;
reset role;

-- [INVARIANTE] El viewer ACTIVO (lee, no actúa) no escribe: la ampliación
--     de #75.5 fue de SELECT, nunca de escritura.
select pg_temp.act_as('00000000-0000-0000-0000-000000020207'); -- VIE
with u as (
  update public.properties set price = 1
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 0, 'I5_viewer_activo_no_dueno_no_escribe_propiedades') from u;
reset role;

-- [INVARIANTE] El admin de PLATAFORMA conserva la moderación.
select pg_temp.act_as('00000000-0000-0000-0000-000000020208'); -- PAD
with u as (
  update public.properties set price = 15700
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 1, 'I6_admin_de_plataforma_sigue_editando_cualquier_propiedad') from u;
reset role;

-- [INVARIANTE 🔴 CONTROL] El agente INDEPENDIENTE sigue BORRANDO lo suyo: la
-- rama `agency_id is null` de properties_delete lo preserva igual que en update.
select pg_temp.act_as('00000000-0000-0000-0000-000000020205'); -- IND
with d as (
  delete from public.properties
   where id = '00000000-0000-0000-0000-0000000202f3'
   returning id
)
select is(count(*)::int, 1, 'I12_agente_independiente_sigue_borrando_su_propiedad_sin_agencia') from d;
reset role;

-- [INVARIANTE] El admin de PLATAFORMA conserva el borrado (moderación).
select pg_temp.act_as('00000000-0000-0000-0000-000000020208'); -- PAD
with d as (
  delete from public.properties
   where id = '00000000-0000-0000-0000-0000000202f4'
   returning id
)
select is(count(*)::int, 1, 'I13_admin_de_plataforma_sigue_borrando_cualquier_propiedad') from d;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- REGLA 2 — La LECTURA de lo suyo se conserva; el CONTACTO del buscador no.
-- ════════════════════════════════════════════════════════════════════════════

-- [DELTA] El suspendido YA NO lee la fila users del buscador de su lead →
--     sin teléfono, sin WhatsApp. La máscara vive en la BD (RLS), no en la UI:
--     el embed users!leads_user_id_fkey devuelve null y LeadExpandedView ya
--     deshabilita WhatsApp con phone === null (fail-soft ya existente).
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000020209'),
  0,
  'D6_suspendido_no_ve_la_fila_users_del_buscador_de_su_lead'
);
reset role;

-- [INVARIANTE] Pero SÍ sigue viendo el lead. Congelar es una medida
--     cautelar; una cautelar que borra el acceso a tu propio trabajo es una
--     sanción disfrazada (y vuelve traumática la reactivación).
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-0000000202d1'),
  1,
  'I7_suspendido_sigue_viendo_la_fila_de_su_lead'
);
reset role;

-- [INVARIANTE] Y su histórico: lead_status_history_select cuelga de
--     private.can_view_lead, que NO usa can_view_user_as_lead_searcher —
--     tocar el helper de identidad no debe arrastrar el historial.
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS
select is(
  (select count(*)::int from public.lead_status_history where lead_id = '00000000-0000-0000-0000-0000000202d1'),
  1,
  'I8_suspendido_sigue_viendo_el_historico_de_su_lead'
);
reset role;

-- [INVARIANTE] El agente ACTIVO ve el teléfono de su buscador.
select pg_temp.act_as('00000000-0000-0000-0000-000000020204'); -- ACT
select is(
  (select phone from public.users where id = '00000000-0000-0000-0000-00000002020a'),
  '+523312020202',
  'I9_agente_activo_sigue_viendo_el_telefono_de_su_buscador'
);
reset role;

-- [INVARIANTE #75.5-bis] El owner ACTIVO de la agencia donde NACIÓ el lead
--     ve el contacto del buscador del suspendido — el lead no se pierde,
--     cambia de manos.
select pg_temp.act_as('00000000-0000-0000-0000-000000020201'); -- OA
select is(
  (select phone from public.users where id = '00000000-0000-0000-0000-000000020209'),
  '+523312020201',
  'I10_owner_activo_ve_el_telefono_del_buscador_del_lead_del_suspendido'
);
reset role;

-- [INVARIANTE 🔴 CONTROL] El agente INDEPENDIENTE (lead con agency_id NULL)
--     conserva el contacto de su buscador.
select pg_temp.act_as('00000000-0000-0000-0000-000000020205'); -- IND
select is(
  (select phone from public.users where id = '00000000-0000-0000-0000-00000002020b'),
  '+523312020203',
  'I11_agente_independiente_sigue_viendo_el_telefono_de_su_buscador'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- CONTROL POSITIVO — MISMO fixture, cambiando SOLO agency_members.status.
-- Es lo que separa «bloquea al suspendido» de «bloquea al dueño»: si el GREEN
-- se pasa de estricto (p. ej. borrando la rama del dueño), estos dos mueren.
-- ════════════════════════════════════════════════════════════════════════════

update public.agency_members set status = 'active'
  where id = '00000000-0000-0000-0000-000000020253'; -- SUS reactivado

-- [DELTA] Reactivado, el MISMO dueño vuelve a escribir.
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS (ya activo)
with u as (
  update public.properties set price = 18000
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 1, 'C1_el_mismo_dueno_reactivado_vuelve_a_editar_su_propiedad') from u;
reset role;

-- [DELTA] Y vuelve a pausar/cerrar (la operación de estado no queda muerta).
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS (ya activo)
with u as (
  update public.properties set status = 'paused'
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 1, 'C2_el_mismo_dueno_reactivado_vuelve_a_pausar_su_propiedad') from u;
reset role;

-- [DELTA] Y vuelve a ver el teléfono de su buscador.
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS (ya activo)
select is(
  (select phone from public.users where id = '00000000-0000-0000-0000-000000020209'),
  '+523312020201',
  'C3_el_mismo_agente_reactivado_vuelve_a_ver_el_telefono_de_su_buscador'
);
reset role;

-- [DELTA] Y vuelve a poder borrarla: properties_delete no quedó cerrada de más.
-- Va AL FINAL porque destruye P_SUS, que los asserts anteriores necesitan.
select pg_temp.act_as('00000000-0000-0000-0000-000000020203'); -- SUS (ya activo)
with d as (
  delete from public.properties
   where id = '00000000-0000-0000-0000-0000000202f1'
   returning id
)
select is(count(*)::int, 1, 'C4_el_mismo_dueno_reactivado_vuelve_a_borrar_su_propiedad') from d;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- ANCLAS DE CONTRATO — el helper se REEMPLAZA por cuerpo, no por firma.
-- Cambiar tipo de retorno, args, security definer o el grant a authenticated
-- rompería users_select para clientes vivos (§0.5, compatibilidad hacia atrás).
-- ════════════════════════════════════════════════════════════════════════════

-- 21-24) Firma y atributos del helper, idénticos a 20260807000006.
select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'can_view_user_as_lead_searcher'),
  'boolean',
  'A1a_can_view_user_as_lead_searcher_sigue_devolviendo_boolean'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'can_view_user_as_lead_searcher'),
  'p_user_id uuid',
  'A1b_can_view_user_as_lead_searcher_conserva_la_firma_de_parametros'
);
select ok(
  (select p.prosecdef and p.provolatile::text = 's'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'can_view_user_as_lead_searcher'),
  'A1c_can_view_user_as_lead_searcher_sigue_siendo_security_definer_y_stable'
);
select ok(
  (select p.proconfig::text = '{search_path=public}'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'can_view_user_as_lead_searcher'),
  'A1d_can_view_user_as_lead_searcher_conserva_el_search_path_fijado'
);

-- El grant a authenticated sobrevive (sin él, users_select falla en
--     ejecución para TODOS los clientes, no solo para el suspendido).
select ok(
  (select p.proacl::text like '%authenticated=X%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'can_view_user_as_lead_searcher'),
  'A2_can_view_user_as_lead_searcher_conserva_el_execute_a_authenticated'
);

-- El comment de la policy documenta la decisión #202 SIN perder la
--     historia del fix #100 (que explica por qué la rama de agencia usa
--     agency_role_of(agency_id) y no is_agency_owner_of).
select ok(
  (select obj_description(pol.oid, 'pg_policy') like '%#202%'
      and obj_description(pol.oid, 'pg_policy') like '%100%'
     from pg_policy pol
    where pol.polrelid = 'public.properties'::regclass and pol.polname = 'properties_update'),
  'A3_el_comment_de_properties_update_documenta_202_y_conserva_la_historia_de_100'
);

select * from finish();
rollback;
