-- Tests pgTAP — Gate legal: RPC pending_legal_consents + inmutabilidad real (§5.5), tarea 72.6
-- Ejecutar con: supabase test db
--   Gotcha de este entorno: si la CLI se cuelga pidiendo el Keychain, exportar
--   SUPABASE_ACCESS_TOKEN con un valor dummy (40 ceros tras el prefijo estandar de
--   token de Supabase) antes del comando. NO se escribe el literal aqui: el escaner
--   de secretos de GitHub reconoce ese prefijo y bloquea el push aunque el valor sea
--   obviamente falso.
-- Corre como superusuario dentro de una transacción revertida; impersonamos roles con
-- pg_temp.act_as(uid, role) (mismo patrón que 02_rls_test.sql / 16_mx_catalog_test.sql / 17_registro_constraints_test.sql).
--
-- RED (2026-07-27): public.pending_legal_consents() AÚN NO EXISTE. La migración GREEN (fuera de
-- esta subtarea de tests, ver 72.6 en Taskmaster para el diseño completo) debe crear:
--   1) RPC pending_legal_consents() returns setof (doc_type text, version text, terms_version_id uuid),
--      stable, security invoker (la RLS de user_consents ya restringe a las filas propias),
--      set search_path = public; revoke execute from public, anon; grant execute to authenticated
--      (mismo patrón defensivo que properties_within_radius, migración 20260706000001).
--   2) Defensa en profundidad: revoke update, delete on public.user_consents from authenticated —
--      hoy la inmutabilidad depende SOLO de que no exista policy de UPDATE/DELETE (RLS filtra en
--      silencio, 0 filas afectadas, SIN lanzar); el GREEN debe hacer que además el GRANT no exista,
--      de modo que el intento lance 42501 real.
--
-- ⚠️ Nota metodológica (heredada de 17_registro_constraints_test.sql, re-verificada empíricamente
--    para este archivo): is()/ok() con una subquery CRUDA que invoca una función inexistente
--    (42883 undefined_function) MATA el archivo entero — Postgres evalúa el argumento ANTES de
--    entrar a la función is()/ok(), fuera de cualquier manejo de excepciones. throws_ok/lives_ok
--    SÍ son seguros porque reciben el SQL como TEXT y lo ejecutan con su propio EXCEPTION WHEN
--    OTHERS interno (confirmado con un archivo de sondeo: 3/3 asserts "murieron" limpio sin
--    tumbar el resto de la suite). Por eso TODA lectura del resultado de pending_legal_consents()
--    aquí va envuelta en `lives_ok($$ do $do$ ... raise exception ... $do$; $$, msg)`: si la
--    función no existe, el DO muere "not ok" sin matar el archivo; una vez creada, el DO corre y
--    compara el valor real contra un literal fijo (fuente independiente, no recomputado del propio
--    query), y solo pasa si coincide EXACTO.
--    Las lecturas directas de user_consents/terms_versions (tablas que YA EXISTEN) sí usan is()/ok()
--    en crudo sin problema — no hay objeto inexistente de por medio.
--
-- Convención de comparación del set pendiente: string_agg('doc_type:version', ',' order by doc_type)
-- → 'privacy:1.0,terms:1.0' (ambos), 'privacy:1.0' (solo privacy pendiente), NULL (cero pendientes).
-- doc_type sale como TEXT desde la RPC (NO el enum doc_type) — el enum consent_type tiene member
-- 'privacy'/'terms' con el mismo label pero es un tipo DISTINTO; compararlos requiere texto.

begin;
select plan(23);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — usuarios (el trigger handle_new_user, migración 0002, crea public.users)
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000007601', 'gate_none@test.local'),        -- sin ningún consentimiento
  ('00000000-0000-0000-0000-000000007602', 'gate_both@test.local'),        -- al día en terms + privacy
  ('00000000-0000-0000-0000-000000007603', 'gate_terms_only@test.local'),  -- solo terms aceptado
  ('00000000-0000-0000-0000-000000007604', 'gate_reaccept@test.local'),    -- caso central §5.5
  ('00000000-0000-0000-0000-000000007605', 'gate_iso_a@test.local'),       -- aislamiento: acepta
  ('00000000-0000-0000-0000-000000007606', 'gate_iso_b@test.local'),       -- aislamiento: no toca nada
  ('00000000-0000-0000-0000-000000007607', 'gate_old_version@test.local'), -- aceptó versión ya no vigente
  ('00000000-0000-0000-0000-000000007608', 'gate_immutable@test.local'),   -- inmutabilidad UPDATE/DELETE
  ('00000000-0000-0000-0000-000000007609', 'gate_attacker@test.local'),    -- intenta insertar por otro
  ('00000000-0000-0000-0000-000000007610', 'gate_victim@test.local'),      -- víctima de suplantación
  ('00000000-0000-0000-0000-000000007611', 'gate_constraint@test.local'); -- consent_version_presence

-- Consentimientos previos al bump de versión (todos apuntan a la 1.0 vigente al día de hoy).
insert into public.user_consents (user_id, consent_type, terms_version_id) values
  ('00000000-0000-0000-0000-000000007602', 'terms',   (select id from public.terms_versions where doc_type = 'terms'   and is_current)),
  ('00000000-0000-0000-0000-000000007602', 'privacy', (select id from public.terms_versions where doc_type = 'privacy' and is_current)),
  ('00000000-0000-0000-0000-000000007603', 'terms',   (select id from public.terms_versions where doc_type = 'terms'   and is_current)),
  ('00000000-0000-0000-0000-000000007604', 'terms',   (select id from public.terms_versions where doc_type = 'terms'   and is_current)),
  ('00000000-0000-0000-0000-000000007604', 'privacy', (select id from public.terms_versions where doc_type = 'privacy' and is_current)),
  ('00000000-0000-0000-0000-000000007605', 'terms',   (select id from public.terms_versions where doc_type = 'terms'   and is_current)),
  ('00000000-0000-0000-0000-000000007605', 'privacy', (select id from public.terms_versions where doc_type = 'privacy' and is_current)),
  ('00000000-0000-0000-0000-000000007607', 'privacy', (select id from public.terms_versions where doc_type = 'privacy' and is_current)),
  ('00000000-0000-0000-0000-000000007608', 'terms',   (select id from public.terms_versions where doc_type = 'terms'   and is_current));

-- ════════════════════════════════════════════════════════════════════════════
-- 1-4) La RPC existe, con la firma esperada (metadata pura sobre pg_proc: segura
--      aunque la función no exista todavía — solo faltará al catálogo, no lanza)
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public',
  'pending_legal_consents',
  'la función pending_legal_consents debe existir en el schema public'
);
select is(
  (select pronargs::int from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'pending_legal_consents' limit 1),
  0,
  'pending_legal_consents no recibe parámetros'
);
select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'pending_legal_consents' limit 1),
  false,
  'pending_legal_consents es SECURITY INVOKER, no DEFINER (la RLS de user_consents ya restringe a las filas propias)'
);
select is(
  (select proretset from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'pending_legal_consents' limit 1),
  true,
  'pending_legal_consents devuelve un conjunto (setof), no un valor escalar'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Happy path: usuario SIN ningún consentimiento -> ambos documentos pendientes
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007601');
select lives_ok(
  $$
  do $do$
  declare v_pending text;
  begin
    select string_agg(doc_type || ':' || version, ',' order by doc_type)
      into v_pending
      from public.pending_legal_consents();
    if v_pending is distinct from 'privacy:1.0,terms:1.0' then
      raise exception 'esperado "privacy:1.0,terms:1.0", fue "%"', coalesce(v_pending, 'NULL');
    end if;
  end
  $do$;
  $$,
  'usuario SIN consentimientos: pending_legal_consents devuelve terms 1.0 y privacy 1.0'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Usuario que aceptó AMBOS en la versión vigente -> cero pendientes
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007602');
select lives_ok(
  $$
  do $do$
  declare v_pending text;
  begin
    select string_agg(doc_type || ':' || version, ',' order by doc_type)
      into v_pending
      from public.pending_legal_consents();
    if v_pending is not null then
      raise exception 'esperado NULL (cero pendientes), fue "%"', v_pending;
    end if;
  end
  $do$;
  $$,
  'usuario al día en terms y privacy vigentes: pending_legal_consents devuelve cero filas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Usuario que aceptó SOLO terms -> devuelve solo privacy
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007603');
select lives_ok(
  $$
  do $do$
  declare v_pending text;
  begin
    select string_agg(doc_type || ':' || version, ',' order by doc_type)
      into v_pending
      from public.pending_legal_consents();
    if v_pending is distinct from 'privacy:1.0' then
      raise exception 'esperado "privacy:1.0", fue "%"', coalesce(v_pending, 'NULL');
    end if;
  end
  $do$;
  $$,
  'usuario que solo aceptó terms: pending_legal_consents devuelve únicamente privacy'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) u_reaccept ANTES del bump de versión: al día (setup del caso central §5.5)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007604');
select lives_ok(
  $$
  do $do$
  declare v_pending text;
  begin
    select string_agg(doc_type || ':' || version, ',' order by doc_type)
      into v_pending
      from public.pending_legal_consents();
    if v_pending is not null then
      raise exception 'esperado NULL (al día antes del bump), fue "%"', v_pending;
    end if;
  end
  $do$;
  $$,
  'u_reaccept antes de publicar una versión nueva: al día (cero pendientes)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9-10) Aislamiento entre usuarios: lo que acepta A no afecta lo que la RPC
--       le exige a B (misma llamada, distinto auth.uid())
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007605'); -- A: ya aceptó ambos
select lives_ok(
  $$
  do $do$
  declare v_pending text;
  begin
    select string_agg(doc_type || ':' || version, ',' order by doc_type)
      into v_pending
      from public.pending_legal_consents();
    if v_pending is not null then
      raise exception 'A esperaba NULL (al día), fue "%"', v_pending;
    end if;
  end
  $do$;
  $$,
  'aislamiento (1/2): A queda sin pendientes tras aceptar'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000007606'); -- B: nunca aceptó nada
select lives_ok(
  $$
  do $do$
  declare v_pending text;
  begin
    select string_agg(doc_type || ':' || version, ',' order by doc_type)
      into v_pending
      from public.pending_legal_consents();
    if v_pending is distinct from 'privacy:1.0,terms:1.0' then
      raise exception 'B esperaba "privacy:1.0,terms:1.0" (sin tocar), fue "%"', coalesce(v_pending, 'NULL');
    end if;
  end
  $do$;
  $$,
  'aislamiento (2/2): lo que aceptó A no afecta lo que la RPC exige a B'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 11) anon NO puede ejecutar la RPC (EXECUTE revocado, mismo patrón defensivo
--     que properties_within_radius)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.pending_legal_consents() $$,
  '42501', null,
  'anon no puede ejecutar pending_legal_consents'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 12-13) Inmutabilidad real: authenticated no puede UPDATE ni DELETE su propio
--        consentimiento (hoy hay GRANT y ninguna policy -> filtra en silencio SIN
--        lanzar; el GREEN revoca el GRANT para que lance 42501 de verdad)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007608');
select throws_ok(
  $$ update public.user_consents set ip_address = '9.9.9.9'
     where user_id = '00000000-0000-0000-0000-000000007608' $$,
  '42501', null,
  'authenticated no puede UPDATE su propio consentimiento (inmutabilidad real, no solo ausencia de policy)'
);
select throws_ok(
  $$ delete from public.user_consents
     where user_id = '00000000-0000-0000-0000-000000007608' $$,
  '42501', null,
  'authenticated no puede DELETE su propio consentimiento'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 14) Un usuario NO puede insertar un consentimiento a nombre de otro (with_check
--     user_id = auth.uid(), policy ya existente en 0008/0010)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007609');
select throws_ok(
  $$ insert into public.user_consents (user_id, consent_type)
     values ('00000000-0000-0000-0000-000000007610', 'age') $$,
  '42501', null,
  'un usuario no puede insertar un consentimiento a nombre de otro usuario'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 15-16) Constraint consent_version_presence (migración 0004, ya existente)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007611');
select throws_ok(
  $$ insert into public.user_consents (user_id, consent_type, terms_version_id)
     values ('00000000-0000-0000-0000-000000007611', 'terms', null) $$,
  '23514', null,
  'consent_version_presence: terms SIN terms_version_id es rechazado'
);
select throws_ok(
  $$ insert into public.user_consents (user_id, consent_type, terms_version_id)
     select '00000000-0000-0000-0000-000000007611', 'whatsapp', id
       from public.terms_versions where doc_type = 'terms' and is_current $$,
  '23514', null,
  'consent_version_presence: whatsapp CON terms_version_id es rechazado'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- Publicación de una versión NUEVA de terms (§5.5): 1.0 deja de ser vigente,
-- 2.0 la reemplaza. Debe actualizarse la vieja ANTES/misma sentencia que el
-- insert de la nueva -- el índice único parcial exige a lo más UNA vigente
-- por doc_type en todo momento.
-- ════════════════════════════════════════════════════════════════════════════

update public.terms_versions set is_current = false
  where doc_type = 'terms' and is_current = true;
insert into public.terms_versions (doc_type, version, content, is_current, effective_from)
values ('terms', '2.0', 'Términos y Condiciones de Urbea — versión 2.0 (fixture de test).', true, now());

-- u_old_version acepta EXPLÍCITAMENTE la versión 1.0 de terms DESPUÉS del bump
-- (ya no es vigente) -- simula una fila de historial que apunta a una versión vieja.
insert into public.user_consents (user_id, consent_type, terms_version_id) values
  ('00000000-0000-0000-0000-000000007607', 'terms',
   (select id from public.terms_versions where doc_type = 'terms' and version = '1.0'));

-- ════════════════════════════════════════════════════════════════════════════
-- 17) Aceptar una versión que NO es la vigente no satisface el gate
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007607');
select lives_ok(
  $$
  do $do$
  declare v_pending text;
  begin
    select string_agg(doc_type || ':' || version, ',' order by doc_type)
      into v_pending
      from public.pending_legal_consents();
    if v_pending is distinct from 'terms:2.0' then
      raise exception 'esperado "terms:2.0" (aceptó 1.0, que ya no es vigente), fue "%"', coalesce(v_pending, 'NULL');
    end if;
  end
  $do$;
  $$,
  'usuario que aceptó terms 1.0 (ya no vigente) sigue con terms 2.0 pendiente -- aceptar una versión vieja no satisface el gate'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 18) CASO CENTRAL §5.5: usuario al día antes del bump vuelve a tener terms
--     pendiente tras la nueva versión (privacy no se toca)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007604');
select lives_ok(
  $$
  do $do$
  declare v_pending text;
  begin
    select string_agg(doc_type || ':' || version, ',' order by doc_type)
      into v_pending
      from public.pending_legal_consents();
    if v_pending is distinct from 'terms:2.0' then
      raise exception 'esperado "terms:2.0" (al día antes del bump, ahora debe re-aceptar terms), fue "%"', coalesce(v_pending, 'NULL');
    end if;
  end
  $do$;
  $$,
  'CASO CENTRAL §5.5: al publicarse terms 2.0, u_reaccept (antes al día) vuelve a tener terms pendiente'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 19) La aceptación vieja (terms 1.0) de u_reaccept SIGUE existiendo en el
--     historial -- append-only, no se pisa (lectura directa de la tabla, segura)
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.user_consents
     where user_id = '00000000-0000-0000-0000-000000007604'
       and consent_type = 'terms'
       and terms_version_id = (select id from public.terms_versions where doc_type = 'terms' and version = '1.0')),
  1,
  'la aceptación vieja de terms 1.0 de u_reaccept sigue existiendo intacta en el historial (append-only)'
);

-- u_reaccept re-acepta la versión 2.0 vigente.
insert into public.user_consents (user_id, consent_type, terms_version_id) values
  ('00000000-0000-0000-0000-000000007604', 'terms',
   (select id from public.terms_versions where doc_type = 'terms' and version = '2.0'));

-- ════════════════════════════════════════════════════════════════════════════
-- 20) Tras re-aceptar la versión vigente, el gate vuelve a quedar satisfecho
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000007604');
select lives_ok(
  $$
  do $do$
  declare v_pending text;
  begin
    select string_agg(doc_type || ':' || version, ',' order by doc_type)
      into v_pending
      from public.pending_legal_consents();
    if v_pending is not null then
      raise exception 'esperado NULL tras re-aceptar terms 2.0, fue "%"', v_pending;
    end if;
  end
  $do$;
  $$,
  'tras re-aceptar terms 2.0, u_reaccept vuelve a quedar sin pendientes'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 21) El historial acumula: tras aceptar 1.0 y luego 2.0, hay 2 filas de terms
--     (lectura directa de la tabla, segura)
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.user_consents
     where user_id = '00000000-0000-0000-0000-000000007604' and consent_type = 'terms'),
  2,
  'el historial acumula: tras aceptar terms 1.0 y luego 2.0, u_reaccept tiene 2 filas de consentimiento de terms'
);

-- ── 22-23) TRUNCATE tampoco: el tercer candado del historial ────────────────
-- Añadidos tras la auditoría del guardián. Ni la ausencia de política RLS ni el
-- revoke de UPDATE/DELETE tapan TRUNCATE: no pasa por RLS y Supabase lo concede
-- de fábrica. Sin el revoke, la anon key vacía el historial completo de
-- consentimientos de TODOS los usuarios — el registro que esta migración blinda.
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ truncate public.user_consents $$,
  '42501', null,
  'anon no puede TRUNCATE user_consents (TRUNCATE no lo filtra la RLS)'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000007601');
select throws_ok(
  $$ truncate public.user_consents $$,
  '42501', null,
  'authenticated no puede TRUNCATE user_consents'
);
reset role;

select * from finish();
rollback;
