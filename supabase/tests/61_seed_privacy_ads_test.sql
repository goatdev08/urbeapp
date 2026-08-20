-- Tests pgTAP — seed del aviso de privacidad con publicidad (subtarea #170.9).
-- Ejecutar con:
--   supabase test db supabase/tests/61_seed_privacy_ads_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- DECISIÓN DE ABRAHAM (D3, /tm-plan 2026-08-15): la migración SIEMBRA la
-- versión nueva con is_current = FALSE. Publicarla es un UPDATE aparte que él
-- dispara cuando elija el momento.
--
-- POR QUÉ: publicar una versión vigente FUERZA re-consentimiento a TODOS los
-- usuarios vivos (la maquinaria de #72.6 —pending_legal_consents() +
-- legal-wall inline— ya está montada y probada), y eso no puede caer por
-- sorpresa en medio de una demo con inversores. Así el PR de 170 se mergea sin
-- disparar el muro legal.
--
-- 🔴 MECÁNICA DEL ÍNDICE, que es lo que hace esto delicado:
-- `terms_versions_one_current_per_doctype` (20260604000004:50-51) es UNIQUE
-- sobre (doc_type) WHERE is_current is true. Insertar con is_current=false NO
-- colisiona. Pero el FLIP posterior tiene que APAGAR el anterior y ENCENDER el
-- nuevo EN LA MISMA TRANSACCIÓN, o el índice lo rechaza. Por eso el flip no se
-- improvisa el día que toque: está escrito en
-- supabase/migrations/rollbacks/20260820000006_seed_privacy_ads.sql y ENSAYADO
-- aquí abajo (sección 3), incluido el orden EQUIVOCADO, que debe fallar.
--
-- ── Edge cases ──────────────────────────────────────────────────────────────
--  EC-1 La versión nueva de privacy existe.
--  EC-2 🔴 NO es la vigente — el muro legal no se dispara con el merge.
--  EC-3 La vigente sigue siendo la anterior, y sigue habiendo EXACTAMENTE una.
--  EC-4 El contenido nuevo cubre la publicidad de verdad (no es otro
--       placeholder de 113 caracteres como el vigente) y, en su caso pareado,
--       NO arrastra el anexo técnico ni las notas internas del borrador.
--  EC-5 El flip en el orden CORRECTO (apagar + encender en una transacción)
--       funciona y deja exactamente una vigente.
--  EC-7/8 🔴 La CONSECUENCIA del flip, verificada contra
--       pending_legal_consents() (la misma función que consume legal-wall):
--       quien ya aceptó la 1.0 vuelve a tener privacy pendiente. Es lo que
--       motiva que publicar sea una decisión aparte y no un efecto del merge.
--  EC-6 🔴 El flip en el orden EQUIVOCADO (encender antes de apagar) lo
--       RECHAZA el índice. Sin este assert, el orden correcto parecería una
--       preferencia de estilo en vez de un requisito.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(11);

-- ── 1) La fila sembrada ─────────────────────────────────────────────────────

select is(
  (select count(*)::int from public.terms_versions
    where doc_type = 'privacy' and version = '2.0'),
  1,
  'EC-1 existe la version 2.0 de privacy'
);

select is(
  (select is_current from public.terms_versions
    where doc_type = 'privacy' and version = '2.0'),
  false,
  'EC-2 la version nueva NO es la vigente: el merge no dispara el muro legal'
);

select is(
  (select version from public.terms_versions
    where doc_type = 'privacy' and is_current),
  '1.0',
  'EC-3a la vigente sigue siendo la 1.0'
);

select is(
  (select count(*)::int from public.terms_versions
    where doc_type = 'privacy' and is_current),
  1,
  'EC-3b sigue habiendo EXACTAMENTE una vigente de privacy'
);

-- ── 2) El contenido dice algo ───────────────────────────────────────────────

select cmp_ok(
  (select length(content) from public.terms_versions
    where doc_type = 'privacy' and version = '2.0'),
  '>', 3000,
  'EC-4a el aviso nuevo no es otro placeholder (el vigente mide 113 caracteres)'
);

select is(
  (select content like '%Patrocinado%'
      and content like '%90 d%'
      and content like '%anunciante%'
      and content like '%3 segundos%'
     from public.terms_versions where doc_type = 'privacy' and version = '2.0'),
  true,
  'EC-4b el texto cubre el badge, la retencion de 90 dias, al anunciante y el umbral de 3 s'
);

-- 🔒 Lo que NO debe viajar: el andamio interno del borrador. Sembrar el anexo
-- técnico o las notas del equipo sería mostrarle a una persona los apuntes en
-- vez del documento. Este assert es el pareado del de arriba — sin él, un
-- seed que metiera el archivo entero pasaría EC-4a y EC-4b sin problema.
select is(
  (select content not like '%BORRADOR TÉCNICO%'
      and content not like '%Anexo técnico%'
      and content not like '%Contradicciones vivas%'
     from public.terms_versions where doc_type = 'privacy' and version = '2.0'),
  true,
  'EC-4c el texto sembrado NO trae el anexo tecnico ni las notas internas del borrador'
);

-- ── 3) 🔴 ENSAYO DEL FLIP ───────────────────────────────────────────────────
-- Se prueban los DOS órdenes. El correcto debe dejar exactamente una vigente;
-- el incorrecto debe ser RECHAZADO por el índice único parcial.

create temp table flip_result_61 (correct_ok boolean, wrong_rejected boolean);

do $$
declare
  v_correct boolean := false;
  v_wrong_rejected boolean := false;
begin
  -- Orden EQUIVOCADO: encender el nuevo antes de apagar el viejo.
  begin
    update public.terms_versions set is_current = true
     where doc_type = 'privacy' and version = '2.0';
    -- Si llegamos aquí sin excepción, el índice NO protegió.
    v_wrong_rejected := false;
  exception when unique_violation then
    v_wrong_rejected := true;
  end;

  -- Orden CORRECTO: apagar y encender en la misma transacción.
  begin
    update public.terms_versions set is_current = false
     where doc_type = 'privacy' and is_current;
    update public.terms_versions set is_current = true
     where doc_type = 'privacy' and version = '2.0';
    v_correct := (select count(*) from public.terms_versions
                   where doc_type = 'privacy' and is_current) = 1;
  exception when others then
    v_correct := false;
  end;

  -- 🔴 El ensayo DESHACE su propio flip: la sección 4 mide el "antes", y sin
  -- esto mediría un mundo ya volteado. Un ensayo que deja el escenario movido
  -- contamina lo que venga después.
  update public.terms_versions set is_current = false where doc_type = 'privacy' and is_current;
  update public.terms_versions set is_current = true  where doc_type = 'privacy' and version = '1.0';

  insert into flip_result_61 (correct_ok, wrong_rejected) values (v_correct, v_wrong_rejected);
end $$;

select is(
  (select wrong_rejected from flip_result_61), true,
  'EC-6 el orden EQUIVOCADO (encender antes de apagar) lo rechaza el indice unico'
);

select is(
  (select correct_ok from flip_result_61), true,
  'EC-5 el orden CORRECTO deja exactamente una vigente'
);

-- ── 4) 🔴 ¿EL FLIP REALMENTE DISPARARÍA EL MURO? ────────────────────────────
-- El ensayo de arriba prueba que el índice acepta el flip. Esto prueba la
-- consecuencia que MOTIVA la decisión de no publicarlo con el merge: que una
-- persona que ya aceptó la 1.0 volvería a ver el muro legal.
--
-- Se verifica contra public.pending_legal_consents() —la misma función que
-- consume legal-wall (#72.6)— en vez de afirmarlo de memoria.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000610001', 'ya_acepto_61@urbea.mx');

insert into public.user_consents (user_id, consent_type, terms_version_id)
select '00000000-0000-0000-0000-000000610001', 'privacy', id
  from public.terms_versions where doc_type = 'privacy' and version = '1.0';

-- ⚠️ El conteo se hace con SQL PLANO impersonado (patrón pg_temp.act_as del
-- resto del repo), NO dentro de un bloque DO: ahí `set local role` no llega a
-- surtir efecto sobre la llamada a la función y pending_legal_consents()
-- devolvía como si no hubiera sesión.
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000610001');
create temp table wall_before_61 as
  select count(*)::int as n from public.pending_legal_consents() where doc_type = 'privacy';
reset role;

-- El flip, en el orden correcto (superusuario).
update public.terms_versions set is_current = false where doc_type = 'privacy' and is_current;
update public.terms_versions set is_current = true  where doc_type = 'privacy' and version = '2.0';

select pg_temp.act_as('00000000-0000-0000-0000-000000610001');
create temp table wall_after_61 as
  select count(*)::int as n from public.pending_legal_consents() where doc_type = 'privacy';
reset role;

select is(
  (select n from wall_before_61), 0,
  'EC-7 antes del flip, quien ya acepto la 1.0 NO tiene nada pendiente'
);

select is(
  (select n from wall_after_61), 1,
  'EC-8 🔴 despues del flip SI vuelve a tener privacy pendiente — el muro se dispara, que es exactamente por lo que la publicacion es una decision de Abraham y no un efecto del merge'
);

select * from finish();
rollback;
