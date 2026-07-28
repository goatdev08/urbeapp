-- Tests pgTAP — Campos de registro requeridos + constraints (§5.1), tarea 72.2
-- Ejecutar con: supabase test db
--   Gotcha de este entorno: si la CLI se cuelga pidiendo el Keychain, exportar
--   SUPABASE_ACCESS_TOKEN con un valor dummy (40 ceros tras el prefijo estandar de
--   token de Supabase) antes del comando. NO se escribe el literal aqui: el escaner
--   de secretos de GitHub reconoce ese prefijo y bloquea el push aunque el valor sea
--   obviamente falso.
-- Corre como superusuario (RLS no aplica aquí); validamos columnas nuevas, FKs, checks e índice único.
--
-- RED (2026-07-27): public.users AÚN NO TIENE state_id/municipality_id, y el CHECK de mayoría de
-- edad / el índice único de phone tampoco existen. La migración GREEN (fuera de esta subtarea de
-- tests, ver 72.2 en Taskmaster para el diseño completo) debe:
--   1) agregar users.state_id (FK -> mx_states) y users.municipality_id (FK -> mx_municipalities),
--      ambas NULLABLE a propósito (aditivo: no rompe filas legacy ni el trigger existente);
--   2) backfill best-effort de las filas existentes (city/state texto libre -> los ids del catálogo);
--   3) marcar users.city / users.state como DEPRECADOS (comment on column), sin dropearlas aún;
--   4) constraint users_municipio_del_estado: coherencia entre municipality_id y state_id
--      (left(municipality_id,2) = state_id, salvo que cualquiera de las dos sea NULL);
--   5) constraint users_mayoria_de_edad: reemplaza users_dob_not_future, exige 18+ (o NULL);
--   6) de-dup defensivo de phone (conserva el más antiguo) + users_phone_unique_active, índice
--      único parcial sobre phone where deleted_at is null and phone is not null;
--   7) handle_new_user extendida para persistir date_of_birth/state_id/municipality_id desde
--      raw_user_meta_data cuando vienen (sin exigirlos: la invitación de agente no los manda).
--
-- ⚠️ Estructura de este archivo / por qué NO se puede usar is()/ok() "en crudo" sobre las
--    columnas nuevas: a diferencia de una tabla completa faltante (ver 16_mx_catalog_test.sql),
--    aquí solo faltan DOS COLUMNAS de una tabla que sí existe. Se probó empíricamente (2026-07-27,
--    contra este mismo stack) el comportamiento de pgTAP frente a "column does not exist" (42703):
--      · has_column / col_type_is / col_is_null -> catálogo puro, jamás lanzan, reportan "not ok"
--        limpio uno por uno (igual que has_table en 16_mx_catalog_test.sql).
--      · throws_ok  -> atrapa CUALQUIER excepción (incluida 42703) dentro de su propio EXECUTE;
--        reporta "not ok" limpio (SQLSTATE inesperado) y el archivo SIGUE corriendo.
--      · lives_ok   -> NO atrapa la excepción; el test se reporta "died" (fallo legítimo) pero
--        el archivo SIGUE corriendo con los tests siguientes (confirmado con planes que sí
--        completan su conteo total).
--      · is()/ok() con una subquery cruda que referencia la columna inexistente -> esto SÍ mata
--        el archivo entero (el resto de los tests planeados ni siquiera se reportan). Por eso
--        aquí NUNCA se compara un valor de state_id/municipality_id con is()/ok() directo: se
--        envuelve en un bloque `do $do$ ... raise exception ... $do$` pasado a lives_ok (si el
--        valor no es el esperado, el DO block lanza y lives_ok lo reporta "died" sin matar el
--        archivo). date_of_birth y phone SÍ son columnas preexistentes hoy — con esas se usa
--        is()/ok() directo sin problema.
--
-- Datos de referencia (mismo catálogo sembrado por 72.1, ver 16_mx_catalog_test.sql):
--   '14'=Jalisco, '14039'=Guadalajara (Jalisco) · '19'=Nuevo León, '19039'=Monterrey (Nuevo León)
--   '09'=Ciudad de México · '99'/'99999' NO existen en el catálogo (huecos a propósito).
--
-- Dato crítico de fixture: supabase/seed.sql (línea ~369) hoy asigna el MISMO teléfono
-- (+523312345678) a los 7 agentes demo. El assert de la sección 2 lee la tabla real ya sembrada
-- (antes de cualquier fixture propio de este archivo) para probar que, tras el GREEN
-- (seed.sql corregido + de-dup defensivo en la migración), ya no hay phones activos duplicados.

begin;
select plan(32);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Columnas nuevas: existencia, tipo y nullability (metadata pura, nunca lanza)
-- ════════════════════════════════════════════════════════════════════════════

select has_column('public', 'users', 'state_id', 'users.state_id existe');
select has_column('public', 'users', 'municipality_id', 'users.municipality_id existe');
select col_type_is('public', 'users', 'state_id', 'text', 'users.state_id es text (FK a mx_states.id)');
select col_type_is('public', 'users', 'municipality_id', 'text', 'users.municipality_id es text (FK a mx_municipalities.id)');
select col_is_null('public', 'users', 'state_id', 'users.state_id es NULLABLE (aditivo: no rompe las 11 filas legacy)');
select col_is_null('public', 'users', 'municipality_id', 'users.municipality_id es NULLABLE (aditivo)');
select col_is_null('public', 'users', 'date_of_birth', 'users.date_of_birth SIGUE siendo nullable (no se volvió NOT NULL)');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Estado real de la tabla ya sembrada: cero duplicados de phone activos
--    (solo toca columnas preexistentes -> seguro en cualquier estado del schema)
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from (
     select phone from public.users
     where deleted_at is null and phone is not null
     group by phone having count(*) > 1
   ) dup),
  0,
  'ningún phone se repite entre usuarios activos (hoy: 7 agentes demo comparten +523312345678)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Fixture geo + FKs de state_id / municipality_id
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000007201', 'geo72@test.local');

select throws_ok(
  $$ update public.users set state_id = '99' where id = '00000000-0000-0000-0000-000000007201' $$,
  '23503', null,
  'state_id inexistente (99) es rechazado por la FK a mx_states'
);
select throws_ok(
  $$ update public.users set municipality_id = '99999' where id = '00000000-0000-0000-0000-000000007201' $$,
  '23503', null,
  'municipality_id inexistente (99999) es rechazado por la FK a mx_municipalities'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) CHECK users_municipio_del_estado: coherencia municipio ↔ estado
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$ update public.users set state_id = '14', municipality_id = null where id = '00000000-0000-0000-0000-000000007201' $$,
  'boundary: solo state_id (municipality_id NULL) se acepta -- el CHECK permite llenado parcial'
);
select lives_ok(
  $$ update public.users set state_id = null, municipality_id = '14039' where id = '00000000-0000-0000-0000-000000007201' $$,
  'boundary: solo municipality_id (state_id NULL) se acepta -- el CHECK permite llenado parcial'
);
select throws_ok(
  $$ update public.users set state_id = '14', municipality_id = '19039' where id = '00000000-0000-0000-0000-000000007201' $$,
  '23514', null,
  'Monterrey (19039) con estado Jalisco (14) es rechazado por incoherente'
);
select lives_ok(
  $$ update public.users set state_id = '14', municipality_id = '14039' where id = '00000000-0000-0000-0000-000000007201' $$,
  'Guadalajara (14039) con estado Jalisco (14) se acepta'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) CHECK users_mayoria_de_edad (boundary relativo a current_date, sin fechas fijas)
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000007202', 'edad72@test.local');

select throws_ok(
  $$ update public.users set date_of_birth = current_date + 1 where id = '00000000-0000-0000-0000-000000007202' $$,
  '23514', null,
  'fecha de nacimiento futura es rechazada'
);
select throws_ok(
  $$ update public.users set date_of_birth = (current_date - interval '18 years' + interval '1 day')::date
     where id = '00000000-0000-0000-0000-000000007202' $$,
  '23514', null,
  'un día antes de cumplir 18 años (17 años y 364 días) es rechazado'
);
select lives_ok(
  $$ update public.users set date_of_birth = (current_date - interval '18 years')::date
     where id = '00000000-0000-0000-0000-000000007202' $$,
  'exactamente 18 años cumplidos hoy se acepta'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Índice único parcial users_phone_unique_active
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000007203', 'ph1-72@test.local'),
  ('00000000-0000-0000-0000-000000007204', 'ph2-72@test.local'),
  ('00000000-0000-0000-0000-000000007205', 'ph3-72@test.local');

select lives_ok(
  $$ update public.users set phone = '+525511110001' where id = '00000000-0000-0000-0000-000000007203' $$,
  'asignar un phone único a un usuario activo se acepta'
);
select throws_ok(
  $$ update public.users set phone = '+525511110001' where id = '00000000-0000-0000-0000-000000007204' $$,
  '23505', null,
  'un segundo usuario ACTIVO con el mismo phone es rechazado por el índice único parcial'
);

-- Soft-delete del primer titular: solo toca deleted_at (columna preexistente), fixture segura.
update public.users set deleted_at = now() where id = '00000000-0000-0000-0000-000000007203';

select lives_ok(
  $$ update public.users set phone = '+525511110001' where id = '00000000-0000-0000-0000-000000007205' $$,
  'reusar el phone de un usuario con deleted_at NO nulo se acepta -- razón de ser del índice parcial'
);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000007206', 'null1-72@test.local'),
  ('00000000-0000-0000-0000-000000007207', 'null2-72@test.local');

select is(
  (select count(*)::int from public.users
     where id in ('00000000-0000-0000-0000-000000007206', '00000000-0000-0000-0000-000000007207')
       and phone is null),
  2,
  'dos usuarios con phone NULL coexisten sin violar el índice único'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) handle_new_user persiste date_of_birth/state_id/municipality_id desde
--    raw_user_meta_data (registro §5.1)
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email, raw_user_meta_data) values (
  '00000000-0000-0000-0000-000000007208', 'meta-full-72@test.local',
  jsonb_build_object(
    'first_name', 'Ana',
    'last_name', 'Pérez',
    'date_of_birth', '1990-06-15',
    'state_id', '14',
    'municipality_id', '14039'
  )
);

select is(
  (select date_of_birth from public.users where id = '00000000-0000-0000-0000-000000007208'),
  '1990-06-15'::date,
  'handle_new_user persiste date_of_birth desde raw_user_meta_data'
);
select lives_ok(
  $$
  do $do$
  begin
    if (select state_id from public.users where id = '00000000-0000-0000-0000-000000007208') is distinct from '14' then
      raise exception 'state_id no persistido: esperado 14';
    end if;
  end
  $do$;
  $$,
  'handle_new_user persiste state_id desde raw_user_meta_data'
);
select lives_ok(
  $$
  do $do$
  begin
    if (select municipality_id from public.users where id = '00000000-0000-0000-0000-000000007208') is distinct from '14039' then
      raise exception 'municipality_id no persistido: esperado 14039';
    end if;
  end
  $do$;
  $$,
  'handle_new_user persiste municipality_id desde raw_user_meta_data'
);

-- Edge case: metadata SIN esas 3 claves (p.ej. redeem_invitation_atomic / alta de agente) no
-- debe romper el trigger, y el perfil espejo debe quedar en NULL para las tres (aditivo).
insert into auth.users (id, email, raw_user_meta_data) values (
  '00000000-0000-0000-0000-000000007209', 'meta-empty-72@test.local',
  jsonb_build_object('first_name', 'Beto', 'last_name', 'Ruiz')
);

select ok(
  (select date_of_birth from public.users where id = '00000000-0000-0000-0000-000000007209') is null,
  'sin date_of_birth en la metadata, handle_new_user no rompe y deja el campo NULL'
);
select lives_ok(
  $$
  do $do$
  begin
    if (select state_id from public.users where id = '00000000-0000-0000-0000-000000007209') is not null then
      raise exception 'state_id debería quedar NULL sin metadata';
    end if;
  end
  $do$;
  $$,
  'sin state_id en la metadata, handle_new_user no rompe y deja el campo NULL'
);
select lives_ok(
  $$
  do $do$
  begin
    if (select municipality_id from public.users where id = '00000000-0000-0000-0000-000000007209') is not null then
      raise exception 'municipality_id debería quedar NULL sin metadata';
    end if;
  end
  $do$;
  $$,
  'sin municipality_id en la metadata, handle_new_user no rompe y deja el campo NULL'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Forma canónica del teléfono y ruta de remediación del perfil
--    (asserts 28-32, añadidos tras la auditoría del guardián del GREEN)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 28-29) El CHECK de formato rechaza cualquier cosa que no sea E.164 MX ───
-- Por qué importa: `phone` está en el grant por columna a `authenticated` (0008),
-- así que se puede escribir por PostgREST saltándose el formulario. Sin este CHECK
-- un PATCH con '33 1234 5678' persistía literal y convivía en el índice único con
-- '+523312345678' — la misma persona con dos cuentas activas.
select throws_ok(
  $$ update public.users set phone = '33 1234 5678'
     where id = '10000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'un teléfono con espacios es rechazado por users_phone_e164_mx'
);
select throws_ok(
  $$ update public.users set phone = '3312345678'
     where id = '10000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'un teléfono nacional sin lada +52 es rechazado por users_phone_e164_mx'
);

-- ── 30) Ningún teléfono vivo de la tabla viola la forma canónica ────────────
-- Cubre la normalización que corre la migración sobre las filas preexistentes.
select is(
  (select count(*)::int from public.users
    where phone is not null and phone !~ '^\+52[0-9]{10}$'),
  0,
  'no queda ningún teléfono fuera de E.164 MX tras la migración'
);

-- ── 31-32) authenticated puede completar su estado/municipio ────────────────
-- Sin estos grants una cuenta que quedó sin ubicación NO tiene forma de arreglarla
-- desde la app (PostgREST devuelve 42501) y el hueco es permanente.
select ok(
  has_column_privilege('authenticated', 'public.users', 'state_id', 'UPDATE'),
  'authenticated puede actualizar users.state_id (ruta de remediación del perfil)'
);
select ok(
  has_column_privilege('authenticated', 'public.users', 'municipality_id', 'UPDATE'),
  'authenticated puede actualizar users.municipality_id (ruta de remediación del perfil)'
);

select * from finish();
rollback;
