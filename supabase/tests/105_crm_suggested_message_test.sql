-- Tests pgTAP — public.crm_suggested_message (subtarea 267.4, tarea #267 "CRM UI agente").
-- Ejecutar con:
--   supabase test db supabase/tests/105_crm_suggested_message_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de una transacción
-- revertida (no persiste). El rol `postgres` de este proyecto NO es superuser real
-- (20260904300001) pero SÍ es dueño de las funciones/tablas — bypassa RLS por ownership y
-- retiene EXECUTE implícito pese al REVOKE FROM public/anon/authenticated, así que las
-- llamadas "autorizadas" solo necesitan fijar el claim JWT (pg_temp.act_as, patrón
-- 02/35/62/100/.../103).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAMS bajo prueba (contrato PÚBLICO, comportamiento observable, NUNCA internals):
--   public.crm_suggested_message(p_lead_id uuid) returns text
--   firma exacta, stable, security definer, search_path='', ACL (revoke public/anon, grant
--   authenticated), autorización fail-closed vía private.can_view_lead + deleted_at explícito
--   (patrón EXACTO de public.crm_lead_detail, 20260906100004) y el TEXTO devuelto (plantilla
--   determinista en español por estado proyectado 8→4, la MISMA proyección que
--   crm_lead_detail/crm_leads_page).
-- SUT (AÚN NO EXISTE — RED 2026-09-06): supabase/migrations/20260906200001_
-- crm_suggested_message.sql debe crear la función.
--
-- ── Estrategia RED sin depender de "function does not exist" (mismo patrón que 100/.../103,
--    adaptado a una función ESCALAR en vez de SETOF) ────────────────────────────────────────
-- (a) Los asserts de catálogo puro (has_function/pg_get_function_*/pg_proc/
--     function_privs_are) son seguros aunque la función no exista: resuelven "not ok" sin
--     lanzar.
-- (b) Las invocaciones reales en contexto "autorizado" pasan por el wrapper
--     pg_temp.suggested_msg(...), que atrapa CUALQUIER excepción (incluida "function does not
--     exist", 42883, mientras el SUT no exista) y devuelve el sentinel
--     '__WRAPPER_ERROR_SENTINEL__' — un texto que NUNCA puede ser una plantilla real (todas
--     empiezan con 'Hola') ni NULL, así que `is(wrapper(...), <esperado>)` siempre reporta
--     "not ok" en vez de abortar el archivo.
-- (c) Gotcha 203.1 (el EXECUTE se comprueba al planificar y el plan se cachea): el caso ACL
--     real de `anon` va SIN wrapper, con `throws_ok` directo, y es la PRIMERA invocación real
--     de la función en el archivo (antes de cualquier llamada bajo `authenticated`).
-- (d) El caso "lead ajeno → NULL sin excepción" (#226 anti-IDOR) usa DOS asserts
--     independientes: `lives_ok` sobre la llamada CRUDA (sin wrapper) para probar que NO hay
--     excepción, y `is(wrapper(...), null)` para el valor — el wrapper por sí solo no
--     distinguiría "no implementado" (sentinel) de "implementado pero lanza" (también
--     sentinel), así que la ausencia de excepción se prueba aparte.
--
-- ── Decisiones de diseño del test-author (el contrato no las fijaba; se deciden aquí y el
--    GREEN debe cumplirlas exactamente) ──────────────────────────────────────────────────────
-- D-PLANTILLA: 4 plantillas fijas por estado proyectado (8→4, idéntica a crm_lead_detail):
--   nuevo (whatsapp_opened/new), contactado (contacted/interested/in_progress), visita
--   (visit_scheduled), cerrado (closed_*/discarded/closed_won) → NULL.
-- D-NOMBRE: `users.first_name` del lead. Sin nombre, el patrón "Hola <Nombre>, " colapsa a
--   "Hola, " (sin espacio extra antes de la coma) — NO es un simple coalesce a cadena vacía
--   concatenada ingenuamente (eso dejaría "Hola , ").
-- D-ORIGEN: dirección = `properties.address` de la propiedad con MENOR `contacted_at` en
--   `lead_origin_properties` (mismo criterio D-ORIGIN-KEYS que crm_lead_detail); sin fila de
--   origen, la plantilla omite la cláusula de propiedad ("una de mis propiedades").
-- D-PRIVACIDAD: la plantilla NUNCA expone `properties.price` (crudo ni con separadores de
--   miles) ni `users.phone` — son campos operativos internos del CRM, no insumo del mensaje
--   dirigido al prospecto (precedente de fuga inversa: PRD §19.3).
-- D-AUTZ-SHARED: reusa `private.can_view_lead` + `deleted_at is null` explícito — CERO lógica
--   de autorización nueva (mismo patrón que crm_lead_detail/lead_activity, 266.5).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────────────────────
-- SEAMS: firma+ACL+catálogo de crm_suggested_message(uuid) (SIG1-6, ACL1-2, ACLREAL1).
-- Happy path: lead propio con origen (whatsapp_opened) → plantilla "nuevo" con nombre y
--   dirección reales, SIN precio ni teléfono (HAPPY1, PRIV1-3); owner de la misma agencia ve
--   el MISMO texto que el agente dueño (SHARED1).
-- Edge cases del PRD/exploración (§7.4 proyección 8→4, mismo mapeo que crm_lead_detail):
--   sin origen → plantilla sin propiedad (NOORIGIN1); contactado/visita/legacy 'new' →
--   plantillas correspondientes (STATUS1-3); cerrado (closed_lost) → NULL (STATUS4).
-- Ramas de reglas no obvias: `deleted_at` no null → NULL aunque sea propio y no cerrado
--   (DELETED1, D-AUTZ-SHARED extiende 35_lead_privacy_test.sql a este seam); `first_name`
--   NULL → arranca "Hola, " sin espacio extra (NONAME1).
-- Boundary/error: lead ajeno (#226 anti-IDOR) → NULL sin excepción (AJENO1-2); anon denegado
--   con 42501 real en su primera invocación (ACLREAL1).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(25);

-- ── Helper de impersonación (mismo patrón que 02/.../35/62/100/.../103) ──────────────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Wrapper RED: atrapa CUALQUIER excepción → sentinel (ver cabecera (b)) ────────────────────
create or replace function pg_temp.suggested_msg(p_lead_id uuid)
returns text language plpgsql as $$
declare v text;
begin
  select public.crm_suggested_message(p_lead_id) into v;
  return v;
exception when others then
  return '__WRAPPER_ERROR_SENTINEL__';
end $$;

-- 🟡 Guardia anti-vacuo (mismo criterio que pg_temp.detail_field en 103): `position(needle in
-- v)` de una aguja AUSENTE da 0 tanto si el SUT protege la privacidad correctamente COMO si el
-- wrapper cayó al sentinel de error (que tampoco contiene la aguja) — un `is(0, 0)` pasaría en
-- verde SIN que la función exista. Este helper detecta el sentinel PRIMERO y devuelve un
-- centinela de texto que NUNCA es igual a '0' en ese caso.
create or replace function pg_temp.position_no_sentinel(p_lead_id uuid, p_needle text)
returns text language plpgsql as $$
declare v_msg text;
begin
  v_msg := pg_temp.suggested_msg(p_lead_id);
  if v_msg = '__WRAPPER_ERROR_SENTINEL__' then
    return '__WRAPPER_ERROR_SENTINEL__';
  end if;
  return position(p_needle in coalesce(v_msg, ''))::text;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000267XXX' (subtarea 267.4, rango
-- propio para no confundir la lectura con 266.5/103 aunque cada archivo corre en su propia
-- transacción revertida).
--   USERS 700-720 · AGENCIES 730 · AGENCY_MEMBERS 740-741
--   PROPERTIES 750-754 · LEADS 770-780 · LEAD_ORIGIN_PROPERTIES 784-788
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000267700', 'ag1.2674@test.local'),      -- AG1 (dueño)
  ('00000000-0000-0000-0000-000000267702', 'ag2.2674@test.local'),      -- AG2 (ajeno, independiente)
  ('00000000-0000-0000-0000-000000267703', 'own.2674@test.local'),      -- OWN (misma agencia que AG1)
  ('00000000-0000-0000-0000-000000267710', 'u.origin.2674@test.local'), -- U_ORIGIN (Karla)
  ('00000000-0000-0000-0000-000000267711', 'u.noorig.2674@test.local'),-- U_NOORIGIN (Diego)
  ('00000000-0000-0000-0000-000000267712', 'u.closed.2674@test.local'),-- U_CLOSED
  ('00000000-0000-0000-0000-000000267713', 'u.contac.2674@test.local'),-- U_CONTACTED (Sofía)
  ('00000000-0000-0000-0000-000000267714', 'u.visit.2674@test.local'), -- U_VISIT (Mauricio)
  ('00000000-0000-0000-0000-000000267715', 'u.legacy.2674@test.local'),-- U_LEGACY (Renata)
  ('00000000-0000-0000-0000-000000267716', 'u.del.2674@test.local'),   -- U_DELETED (Borrado)
  ('00000000-0000-0000-0000-000000267717', 'u.noname.2674@test.local'),-- U_NONAME (sin nombre)
  ('00000000-0000-0000-0000-000000267718', 'u.ajeno.2674@test.local'), -- U_AJENO
  ('00000000-0000-0000-0000-000000267719', 'u.contac.noorig.2674@test.local'), -- U_CONTACTED_NOORIGIN (Iván)
  ('00000000-0000-0000-0000-000000267720', 'u.visit.noorig.2674@test.local');   -- U_VISIT_NOORIGIN (Lucía)

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000267700',  -- AG1
               '00000000-0000-0000-0000-000000267702'); -- AG2

update public.users set first_name = 'Karla',    phone = '+528199990000'
  where id = '00000000-0000-0000-0000-000000267710'; -- U_ORIGIN
update public.users set first_name = 'Diego'     where id = '00000000-0000-0000-0000-000000267711'; -- U_NOORIGIN
update public.users set first_name = 'Cerrado'   where id = '00000000-0000-0000-0000-000000267712'; -- U_CLOSED
update public.users set first_name = 'Sofía'     where id = '00000000-0000-0000-0000-000000267713'; -- U_CONTACTED
update public.users set first_name = 'Mauricio'  where id = '00000000-0000-0000-0000-000000267714'; -- U_VISIT
update public.users set first_name = 'Renata'    where id = '00000000-0000-0000-0000-000000267715'; -- U_LEGACY
update public.users set first_name = 'Borrado'   where id = '00000000-0000-0000-0000-000000267716'; -- U_DELETED
-- U_NONAME (267717) se deja SIN first_name a propósito (NULL).
update public.users set first_name = 'Ajeno'     where id = '00000000-0000-0000-0000-000000267718'; -- U_AJENO
update public.users set first_name = 'Iván'      where id = '00000000-0000-0000-0000-000000267719'; -- U_CONTACTED_NOORIGIN
update public.users set first_name = 'Lucía'     where id = '00000000-0000-0000-0000-000000267720'; -- U_VISIT_NOORIGIN

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000267730', 'Inmobiliaria CRM Suggested 267.4', 'inmo-crm-suggested-2674',
   'active', '00000000-0000-0000-0000-000000267703');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000267740', '00000000-0000-0000-0000-000000267730', '00000000-0000-0000-0000-000000267703', 'owner', 'active'), -- OWN
  ('00000000-0000-0000-0000-000000267741', '00000000-0000-0000-0000-000000267730', '00000000-0000-0000-0000-000000267700', 'agent', 'active'); -- AG1
-- AG2 NO pertenece a ninguna agencia — agente ajeno independiente (mismo patrón que 102/103).

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, price_visible, status) values
  ('00000000-0000-0000-0000-000000267750', '00000000-0000-0000-0000-000000267700',
   '00000000-0000-0000-0000-000000267730', 'departamento', 'rent',
   'Av. Independencia 450, Guadalajara',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography,
   10000000, true, 'active'),
  ('00000000-0000-0000-0000-000000267751', '00000000-0000-0000-0000-000000267700',
   '00000000-0000-0000-0000-000000267730', 'casa', 'sale',
   'Calle Reforma 12, CDMX',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-99.15, 19.43), 4326)::extensions.geography,
   4500000, true, 'active'),
  ('00000000-0000-0000-0000-000000267752', '00000000-0000-0000-0000-000000267700',
   '00000000-0000-0000-0000-000000267730', 'casa', 'sale',
   'Blvd. Las Torres 88, Monterrey',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-100.31, 25.68), 4326)::extensions.geography,
   3800000, true, 'active'),
  ('00000000-0000-0000-0000-000000267753', '00000000-0000-0000-0000-000000267700',
   '00000000-0000-0000-0000-000000267730', 'departamento', 'rent',
   'Calz. del Valle 5, Puebla',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-98.20, 19.04), 4326)::extensions.geography,
   12000, true, 'active'),
  ('00000000-0000-0000-0000-000000267754', '00000000-0000-0000-0000-000000267700',
   '00000000-0000-0000-0000-000000267730', 'departamento', 'rent',
   'Priv. del Bosque 9, Querétaro',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-100.39, 20.59), 4326)::extensions.geography,
   9500, true, 'active');

-- ── Leads ────────────────────────────────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000267770', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267710', 'whatsapp_opened'), -- L_ORIGIN
  ('00000000-0000-0000-0000-000000267771', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267711', 'whatsapp_opened'), -- L_NOORIGIN
  ('00000000-0000-0000-0000-000000267772', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267712', 'closed_lost'),      -- L_CLOSED
  ('00000000-0000-0000-0000-000000267773', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267713', 'contacted'),        -- L_CONTACTED
  ('00000000-0000-0000-0000-000000267774', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267714', 'visit_scheduled'),  -- L_VISIT
  ('00000000-0000-0000-0000-000000267775', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267715', 'new'),               -- L_LEGACY (estado legacy)
  ('00000000-0000-0000-0000-000000267776', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267716', 'whatsapp_opened'),  -- L_DELETED
  ('00000000-0000-0000-0000-000000267777', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267717', 'whatsapp_opened'),  -- L_NONAME
  ('00000000-0000-0000-0000-000000267778', '00000000-0000-0000-0000-000000267702', '00000000-0000-0000-0000-000000267718', 'whatsapp_opened'),  -- L_AJENO (de AG2)
  ('00000000-0000-0000-0000-000000267779', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267719', 'contacted'),        -- L_CONTACTED_NOORIGIN
  ('00000000-0000-0000-0000-000000267780', '00000000-0000-0000-0000-000000267700', '00000000-0000-0000-0000-000000267720', 'visit_scheduled');  -- L_VISIT_NOORIGIN

insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000267784', '00000000-0000-0000-0000-000000267770', '00000000-0000-0000-0000-000000267750', now() - interval '3 days'), -- L_ORIGIN -> P_ORIGIN
  ('00000000-0000-0000-0000-000000267785', '00000000-0000-0000-0000-000000267773', '00000000-0000-0000-0000-000000267751', now() - interval '2 days'), -- L_CONTACTED -> P_CONTACTED
  ('00000000-0000-0000-0000-000000267786', '00000000-0000-0000-0000-000000267774', '00000000-0000-0000-0000-000000267752', now() - interval '2 days'), -- L_VISIT -> P_VISIT
  ('00000000-0000-0000-0000-000000267787', '00000000-0000-0000-0000-000000267775', '00000000-0000-0000-0000-000000267753', now() - interval '2 days'), -- L_LEGACY -> P_LEGACY
  ('00000000-0000-0000-0000-000000267788', '00000000-0000-0000-0000-000000267777', '00000000-0000-0000-0000-000000267754', now() - interval '2 days'); -- L_NONAME -> P_NONAME
-- L_NOORIGIN, L_CLOSED, L_DELETED, L_AJENO NO tienen fila de origen a propósito.

-- L_DELETED se borra YA (nada más la referencia mientras está activa).
update public.leads set deleted_at = now() where id = '00000000-0000-0000-0000-000000267776';

-- ════════════════════════════════════════════════════════════════════════════
-- 1) CATÁLOGO — public.crm_suggested_message. Seguro aunque no exista: has_function/
--    pg_get_function_*/pg_proc/function_privs_are resuelven "not ok" sin lanzar.
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'crm_suggested_message', array['uuid'],
  'SIG1_crm_suggested_message_existe_con_la_firma_p_lead_id');

select is(
  (select pg_get_function_result(to_regprocedure('public.crm_suggested_message(uuid)'))),
  'text', 'SIG2_crm_suggested_message_returns_text'
);

select is(
  (select pg_get_function_arguments(to_regprocedure('public.crm_suggested_message(uuid)'))),
  'p_lead_id uuid', 'SIG3_crm_suggested_message_argumentos_EXACTOS'
);

select is(
  (select prosecdef from pg_proc where proname = 'crm_suggested_message' and pronamespace = 'public'::regnamespace),
  true, 'SIG4_crm_suggested_message_es_security_definer'
);

select is(
  (select provolatile from pg_proc where proname = 'crm_suggested_message' and pronamespace = 'public'::regnamespace),
  's', 'SIG5_crm_suggested_message_es_stable'
);

select is(
  (select proconfig from pg_proc where proname = 'crm_suggested_message' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG6_crm_suggested_message_search_path_vacio'
);

select function_privs_are('public', 'crm_suggested_message', array['uuid'], 'anon', array[]::name[],
  'ACL1_crm_suggested_message_anon_SIN_execute');
select function_privs_are('public', 'crm_suggested_message', array['uuid'], 'authenticated', array['EXECUTE']::name[],
  'ACL2_crm_suggested_message_authenticated_CON_execute');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) ACL REAL — anon denegado en su PRIMERA invocación real (gotcha 203.1). SIN wrapper:
--    throws_ok directo, necesita el 42501 real, no el sentinel.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.crm_suggested_message('00000000-0000-0000-0000-000000267770'::uuid) $$,
  '42501', null, 'ACLREAL1_anon_no_puede_ejecutar_crm_suggested_message'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) LEAD AJENO (#226 anti-IDOR) — NULL sin excepción.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000267700'); -- AG1 intenta ver el lead de AG2
select lives_ok(
  $$ select public.crm_suggested_message('00000000-0000-0000-0000-000000267778'::uuid) $$,
  'AJENO1_lead_ajeno_no_lanza_excepcion'
);
select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267778'),
  null, 'AJENO2_lead_ajeno_devuelve_null'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) HAPPY PATH — lead propio, whatsapp_opened, con origen: plantilla "nuevo" completa,
--    sin precio ni teléfono (D-PRIVACIDAD).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000267700'); -- AG1, dueño

select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267770'),
  'Hola Karla, vi que te interesó la propiedad de Av. Independencia 450, Guadalajara. ¿Te gustaría agendar una visita?',
  'HAPPY1_nuevo_con_origen_string_exacto'
);

select is(
  pg_temp.position_no_sentinel('00000000-0000-0000-0000-000000267770', '10000000'),
  '0', 'PRIV1_no_expone_precio_crudo'
);
select is(
  pg_temp.position_no_sentinel('00000000-0000-0000-0000-000000267770', '10,000,000'),
  '0', 'PRIV2_no_expone_precio_con_separadores'
);
select is(
  pg_temp.position_no_sentinel('00000000-0000-0000-0000-000000267770', '+528199990000'),
  '0', 'PRIV3_no_expone_telefono'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) SIN ORIGEN — plantilla "nuevo" sin cláusula de propiedad.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267771'),
  'Hola Diego, vi que te interesó una de mis propiedades. ¿Te gustaría agendar una visita?',
  'NOORIGIN1_nuevo_sin_origen_string_exacto'
);

-- Hallazgo del guardian (267.4): la rama "sin origen" existe también en contactado/visita;
-- sin estos asserts un NULL en v_address colapsaría el texto entero a NULL sin que nadie lo viera.
select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267779'), -- L_CONTACTED_NOORIGIN
  'Hola Iván, ¿pudiste ver alguna de mis propiedades? Cuéntame qué te pareció y si quieres que te comparta más opciones.',
  'NOORIGIN2_contactado_sin_origen_string_exacto'
);

select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267780'), -- L_VISIT_NOORIGIN
  'Hola Lucía, te escribo para confirmar tu visita. ¿Sigue en pie?',
  'NOORIGIN3_visita_sin_origen_string_exacto'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) RAMAS DE ESTADO — proyección 8→4 (misma que crm_lead_detail).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267772'), -- L_CLOSED, closed_lost
  null, 'STATUS1_cerrado_closed_lost_es_null'
);

select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267773'), -- L_CONTACTED, contacted
  'Hola Sofía, ¿pudiste ver la propiedad de Calle Reforma 12, CDMX? Cuéntame qué te pareció y si quieres que te comparta más opciones.',
  'STATUS2_contactado_string_exacto'
);

select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267774'), -- L_VISIT, visit_scheduled
  'Hola Mauricio, te escribo para confirmar la visita a Blvd. Las Torres 88, Monterrey. ¿Sigue en pie?',
  'STATUS3_visita_string_exacto'
);

select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267775'), -- L_LEGACY, status legacy 'new'
  'Hola Renata, vi que te interesó la propiedad de Calz. del Valle 5, Puebla. ¿Te gustaría agendar una visita?',
  'STATUS4_legacy_new_mapea_a_nuevo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) DELETED_AT — private.can_view_lead NO lo filtra por sí solo (D-DELETED, extensión
--    conceptual de 35_lead_privacy_test.sql a este seam nuevo).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267776'), -- L_DELETED, propio, no cerrado
  null, 'DELETED1_lead_borrado_es_null_aunque_sea_propio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) SIN NOMBRE — "Hola <Nombre>, " colapsa a "Hola, " (D-NOMBRE).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267777'),
  'Hola, vi que te interesó la propiedad de Priv. del Bosque 9, Querétaro. ¿Te gustaría agendar una visita?',
  'NONAME1_sin_first_name_arranca_Hola_coma_sin_espacio_extra'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) OWNER DE LA MISMA AGENCIA — mismo texto que el agente dueño (D-AUTZ-SHARED).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000267703'); -- OWN, owner de la misma agencia que AG1
select is(
  pg_temp.suggested_msg('00000000-0000-0000-0000-000000267770'),
  'Hola Karla, vi que te interesó la propiedad de Av. Independencia 450, Guadalajara. ¿Te gustaría agendar una visita?',
  'SHARED1_owner_misma_agencia_ve_el_mismo_texto_que_el_agente'
);
reset role;

select * from finish();
rollback;
