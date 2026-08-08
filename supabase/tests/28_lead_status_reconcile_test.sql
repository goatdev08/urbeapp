-- Tests pgTAP — Reconciliación del embudo de estados del lead (subtarea 75.1)
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Impersonamos con pg_temp.act_as(uid, role) (mismo patrón que 02/18/21/25/27_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO — bug reportado por el usuario ("los estados no se cambian ni se
-- muestran correctamente"): LeadExpandedView.tsx pinta los 7 estados como
-- tappables, pero lead_status_updater.ts tiene una máquina ESTRICTA
-- (VALID_TRANSITIONS) con estados terminales — cada toque "inválido" truena
-- con INVALID_TRANSITION → 400. Este archivo cubre el lado DB del fix.
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED):
-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.lead_status enum gana 4 valores nuevos: whatsapp_opened,
--    interested, closed_won_rent, closed_won_sale. Los 7 valores viejos
--    ('new','contacted','in_progress','visit_scheduled','closed_won',
--    'closed_lost','discarded') NO se tocan — Postgres no puede vaciar un
--    enum; 'new'/'in_progress'/'closed_won' quedan legacy (el picker de la
--    app solo ofrece los nuevos — fuera de alcance de este archivo).
-- 2) public.leads.is_follow_up boolean not null default false — bandera
--    ORTOGONAL al estado (puede convivir con cualquiera).
-- 3) public.lead_status_history (mismo patrón append-only que
--    public.admin_actions, migración 20260604000007:78-95) poblada por un
--    TRIGGER `AFTER INSERT OR UPDATE OF status ON public.leads` (no por cada
--    EF a mano). RLS: SELECT vía private.can_view_lead(lead_id); SIN
--    INSERT/UPDATE/DELETE para `authenticated` — solo el trigger
--    SECURITY DEFINER escribe.
-- 4) UPDATE leads SET status='whatsapp_opened' WHERE status='new' (data-fix
--    de una sola vez, dentro de la migración GREEN).
--
-- ── DECISIÓN DE SEAM — shape asumido de lead_status_history ──────────────────
-- No especificado por el orquestador más allá de "guarda estado anterior y
-- nuevo, quién y cuándo" (mismo patrón que admin_actions). Se fija aquí (y el
-- GREEN debe cumplirlo) el shape mínimo que los asserts de abajo ejercitan:
--   id uuid pk, lead_id uuid not null references leads(id),
--   old_status lead_status (NULL en la fila de creación — no hay "anterior"),
--   new_status lead_status not null, changed_by uuid, changed_at timestamptz.
-- Columnas exactas de auditoría (changed_by/changed_at) NO se aseveran aquí
-- (no fueron pedidas explícitamente) — los throws_ok de la sección 4 solo
-- necesitan (lead_id, old_status, new_status) para intentar un INSERT/UPDATE
-- directo creíble; si GREEN nombra distinto alguna columna de auditoría, esos
-- 3 asserts siguen siendo válidos (el INSERT fallaría igual, por RLS/grants).
--
-- 🔒 GOTCHA heredado de 21_agency_member_role_matrix_test.sql: `ALTER TYPE
-- ... ADD VALUE` no puede convivir en la misma transacción con código que use
-- los valores nuevos → GREEN probablemente sean 2 migraciones (enum primero,
-- resto después) más una 3ª para el data-fix (que SÍ usa 'whatsapp_opened').
-- Estos tests no asumen cuántas migraciones son — corren igual siempre que al
-- final el enum tenga los 4 valores y el resto del SUT esté activo.
--
-- ── Estrategia RED sin abortar la transacción (heredada de 18_legal_gate y
--    21_agency_member_role_matrix) ─────────────────────────────────────────
-- Referenciar hoy una columna/tabla/valor de enum que NO existe (is_follow_up,
-- lead_status_history, 'interested'::lead_status) en un statement CRUDO
-- (is()/ok() con subquery directa, o un UPDATE/INSERT top-level) ABORTARÍA
-- toda la transacción — matando el archivo entero, no solo ese assert. Por
-- eso TODA lectura/escritura que dependa de schema nuevo va envuelta en
-- `lives_ok($$ do $do$ ... raise exception ... $do$; $$, msg)`: si el objeto
-- no existe, el DO muere "not ok" sin tumbar el resto de la suite; una vez
-- creado, el DO corre y compara contra un literal fijo (fuente independiente,
-- no recomputado del propio query). Cada bloque es AUTÓNOMO (crea su propio
-- fixture de lead dentro del mismo DO) porque un `lives_ok` que falla hace
-- ROLLBACK a su propio savepoint interno — un fixture creado dentro de un DO
-- que luego falla NO persiste para el siguiente `lives_ok`.
-- Los checks de catálogo puro (pg_enum/pg_type, has_column, col_type_is,
-- col_not_null, col_default_is) SÍ son seguros en crudo — "jamás lanzan,
-- reportan not ok" (17_registro_constraints_test.sql).
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/27_*) ──────────────────
-- DELTA      = falla hoy, pasa tras GREEN completo (discrimina la implementación).
-- INVARIANTE = ya se cumple hoy (ancla de no-regresión) — marcado explícito.
--
-- ── Dependencia de seed.sql para el caso de no-regresión de datos (§7) ───────
-- `supabase test db` corre: reset (migraciones, EN ORDEN, luego seed.sql) →
-- archivos de supabase/tests/*.sql. seed.sql (líneas 353-356) YA siembra 2
-- leads con status='new' (lead1, lead3) — el análogo local de los "2 leads
-- remotos" que menciona el orquestador. Como las migraciones corren ANTES que
-- seed.sql, el UPDATE de data-fix (que vive en una migración) NO puede tocar
-- estas 2 filas (se insertan DESPUÉS). Por eso el assert de §7 solo puede ir
-- en GREEN si seed.sql también se actualiza (los 2 leads sembrados pasan a
-- 'whatsapp_opened') — se deja como bloqueante explícito para el GREEN, NO
-- se toca seed.sql desde esta fase RED (fuera del alcance de tests+stubs).

begin;
select plan(23);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — usuarios (el trigger handle_new_user, migración 0002, crea
-- public.users al insertar en auth.users)
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000075101', 'agente.a1.7501@test.local'),   -- A1: agente dueño de los leads bajo prueba
  ('00000000-0000-0000-0000-000000075102', 'agente.a2.7501@test.local'),   -- A2: otro agente (negativo de RLS)
  ('00000000-0000-0000-0000-000000075111', 'buscador.ortho1.7501@test.local'),
  ('00000000-0000-0000-0000-000000075112', 'buscador.ortho2.7501@test.local'),
  ('00000000-0000-0000-0000-000000075113', 'buscador.ortho3.7501@test.local'),
  ('00000000-0000-0000-0000-000000075121', 'buscador.hista.7501@test.local'),
  ('00000000-0000-0000-0000-000000075122', 'buscador.histb.7501@test.local'),
  ('00000000-0000-0000-0000-000000075123', 'buscador.noop.7501@test.local'),
  ('00000000-0000-0000-0000-000000075124', 'buscador.reopen.7501@test.local'),
  ('00000000-0000-0000-0000-000000075125', 'buscador.rls.7501@test.local'),
  ('00000000-0000-0000-0000-000000075126', 'buscador.mismovalor.7501@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000075101',
    '00000000-0000-0000-0000-000000075102'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Enum lead_status — gana los 4 valores nuevos del PRD §19.8 [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select ok(
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'lead_status' and e.enumlabel = 'whatsapp_opened'),
  'lead_status_incluye_whatsapp_opened'
);
select ok(
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'lead_status' and e.enumlabel = 'interested'),
  'lead_status_incluye_interested'
);
select ok(
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'lead_status' and e.enumlabel = 'closed_won_rent'),
  'lead_status_incluye_closed_won_rent'
);
select ok(
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'lead_status' and e.enumlabel = 'closed_won_sale'),
  'lead_status_incluye_closed_won_sale'
);

-- ── 2) [INVARIANTE] Los 7 valores viejos SIGUEN existiendo — Postgres nunca
--       vacía un enum; new/in_progress/closed_won quedan legacy a propósito.
select ok(
  (select array_agg(e.enumlabel::text) from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'lead_status')
  @> array['new','contacted','in_progress','visit_scheduled','closed_won','closed_lost','discarded'],
  'lead_status_conserva_los_7_valores_legacy'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) leads.is_follow_up — boolean not null default false [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select has_column('public', 'leads', 'is_follow_up', 'leads.is_follow_up existe');
select col_type_is('public', 'leads', 'is_follow_up', 'boolean', 'leads.is_follow_up es boolean');
select col_not_null('public', 'leads', 'is_follow_up', 'leads.is_follow_up es NOT NULL');
select col_default_is('public', 'leads', 'is_follow_up', 'false', 'leads.is_follow_up default false');

-- ════════════════════════════════════════════════════════════════════════════
-- 4) is_follow_up es ORTOGONAL al estado — convive con contacted/interested/
--    visit_scheduled y el estado NO cambia al togglearla [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_status text; declare v_follow boolean;
  begin
    insert into public.leads (id, agent_id, user_id, status)
      values ('00000000-0000-0000-0000-000000075201',
              '00000000-0000-0000-0000-000000075101',
              '00000000-0000-0000-0000-000000075111', 'contacted');
    update public.leads set is_follow_up = true
      where id = '00000000-0000-0000-0000-000000075201';
    select status::text, is_follow_up into v_status, v_follow
      from public.leads where id = '00000000-0000-0000-0000-000000075201';
    if v_status is distinct from 'contacted' or v_follow is distinct from true then
      raise exception 'esperado status=contacted,is_follow_up=true; fue status=%,is_follow_up=%', v_status, v_follow;
    end if;
  end
  $do$;
  $$,
  'is_follow_up_convive_con_contacted_sin_cambiar_el_estado'
);

select lives_ok(
  $$
  do $do$
  declare v_status text; declare v_follow boolean;
  begin
    insert into public.leads (id, agent_id, user_id, status)
      values ('00000000-0000-0000-0000-000000075202',
              '00000000-0000-0000-0000-000000075101',
              '00000000-0000-0000-0000-000000075112', 'interested');
    update public.leads set is_follow_up = true
      where id = '00000000-0000-0000-0000-000000075202';
    select status::text, is_follow_up into v_status, v_follow
      from public.leads where id = '00000000-0000-0000-0000-000000075202';
    if v_status is distinct from 'interested' or v_follow is distinct from true then
      raise exception 'esperado status=interested,is_follow_up=true; fue status=%,is_follow_up=%', v_status, v_follow;
    end if;
  end
  $do$;
  $$,
  'is_follow_up_convive_con_interested_sin_cambiar_el_estado'
);

select lives_ok(
  $$
  do $do$
  declare v_status text; declare v_follow boolean;
  begin
    insert into public.leads (id, agent_id, user_id, status)
      values ('00000000-0000-0000-0000-000000075203',
              '00000000-0000-0000-0000-000000075101',
              '00000000-0000-0000-0000-000000075113', 'visit_scheduled');
    update public.leads set is_follow_up = true
      where id = '00000000-0000-0000-0000-000000075203';
    select status::text, is_follow_up into v_status, v_follow
      from public.leads where id = '00000000-0000-0000-0000-000000075203';
    if v_status is distinct from 'visit_scheduled' or v_follow is distinct from true then
      raise exception 'esperado status=visit_scheduled,is_follow_up=true; fue status=%,is_follow_up=%', v_status, v_follow;
    end if;
  end
  $do$;
  $$,
  'is_follow_up_convive_con_visit_scheduled_sin_cambiar_el_estado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) lead_status_history — trigger AFTER INSERT OR UPDATE OF status [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

-- 5a) Crear un lead (INSERT) genera exactamente 1 fila de historial.
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    insert into public.leads (id, agent_id, user_id, status)
      values ('00000000-0000-0000-0000-000000075204',
              '00000000-0000-0000-0000-000000075101',
              '00000000-0000-0000-0000-000000075121', 'contacted');
    select count(*) into v_count from public.lead_status_history
      where lead_id = '00000000-0000-0000-0000-000000075204';
    if v_count is distinct from 1 then
      raise exception 'esperada 1 fila de historial tras crear el lead, fueron %', coalesce(v_count::text, 'NULL');
    end if;
  end
  $do$;
  $$,
  'crear_un_lead_genera_una_fila_de_historial'
);

-- 5b) Cada cambio de estado agrega una fila más, con old_status/new_status
--     correctos (2 cambios seguidos → 3 filas totales: creación + 2 cambios).
select lives_ok(
  $$
  do $do$
  declare v_count int; declare v_old lead_status; declare v_new lead_status;
  begin
    insert into public.leads (id, agent_id, user_id, status)
      values ('00000000-0000-0000-0000-000000075205',
              '00000000-0000-0000-0000-000000075101',
              '00000000-0000-0000-0000-000000075122', 'contacted');
    update public.leads set status = 'interested'
      where id = '00000000-0000-0000-0000-000000075205';
    update public.leads set status = 'visit_scheduled'
      where id = '00000000-0000-0000-0000-000000075205';

    select count(*) into v_count from public.lead_status_history
      where lead_id = '00000000-0000-0000-0000-000000075205';
    if v_count is distinct from 3 then
      raise exception 'esperadas 3 filas (1 creación + 2 cambios), fueron %', coalesce(v_count::text, 'NULL');
    end if;

    select old_status, new_status into v_old, v_new from public.lead_status_history
      where lead_id = '00000000-0000-0000-0000-000000075205' and new_status = 'visit_scheduled';
    if v_old is distinct from 'interested'::lead_status or v_new is distinct from 'visit_scheduled'::lead_status then
      raise exception 'esperado old_status=interested,new_status=visit_scheduled; fue old_status=%,new_status=%', v_old, v_new;
    end if;
  end
  $do$;
  $$,
  'cada_cambio_de_estado_agrega_fila_con_old_new_correctos'
);

-- 5c) [DELTA] Un UPDATE que NO toca `status` (solo internal_notes) NO genera
--     fila de historial nueva — sigue habiendo solo la fila de creación.
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    insert into public.leads (id, agent_id, user_id, status, internal_notes)
      values ('00000000-0000-0000-0000-000000075206',
              '00000000-0000-0000-0000-000000075101',
              '00000000-0000-0000-0000-000000075123', 'contacted', 'nota original');
    update public.leads set internal_notes = 'nota actualizada'
      where id = '00000000-0000-0000-0000-000000075206';

    select count(*) into v_count from public.lead_status_history
      where lead_id = '00000000-0000-0000-0000-000000075206';
    if v_count is distinct from 1 then
      raise exception 'un UPDATE que no toca status no debe generar fila nueva; esperada 1 (la de creación), fueron %', coalesce(v_count::text, 'NULL');
    end if;
  end
  $do$;
  $$,
  'update_sin_tocar_status_no_genera_fila_de_historial'
);

-- 5c2) [DELTA] UPDATE que SÍ toca `status` en el SET pero con el MISMO valor
--      (`set status = 'contacted'` sobre un lead ya en 'contacted') es un no-op
--      para el historial. Distinto de 5c: aquí el trigger `AFTER UPDATE OF
--      status` SÍ dispara (status está en el SET) — es el guard interno
--      `TG_OP='UPDATE' and OLD.status is not distinct from NEW.status`
--      (migración 20260807000003:82-84) el que debe filtrarlo, no el "OF
--      status" del CREATE TRIGGER. Esto es justo lo que produce update-lead-
--      status/handler.ts si el agente toca en la UI el estado en el que el
--      lead YA está (acción trivial) — sin el guard, cada re-tap mete una fila
--      espuria old=new=contacted en el timeline.
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    insert into public.leads (id, agent_id, user_id, status)
      values ('00000000-0000-0000-0000-000000075209',
              '00000000-0000-0000-0000-000000075101',
              '00000000-0000-0000-0000-000000075126', 'contacted');
    update public.leads set status = 'contacted'
      where id = '00000000-0000-0000-0000-000000075209';

    select count(*) into v_count from public.lead_status_history
      where lead_id = '00000000-0000-0000-0000-000000075209';
    if v_count is distinct from 1 then
      raise exception 'un UPDATE al mismo status no debe generar fila nueva; esperada 1 (la de creacion), fueron %', coalesce(v_count::text, 'NULL');
    end if;
  end
  $do$;
  $$,
  'update_al_mismo_status_no_genera_fila_de_historial_espuria'
);

-- 5d) [DELTA] Reabrir un lead CERRADO (closed_lost -> contacted) queda
--     registrado en el historial — la DB no lo impide (transiciones libres).
select lives_ok(
  $$
  do $do$
  declare v_count int; declare v_status lead_status;
  begin
    insert into public.leads (id, agent_id, user_id, status)
      values ('00000000-0000-0000-0000-000000075207',
              '00000000-0000-0000-0000-000000075101',
              '00000000-0000-0000-0000-000000075124', 'closed_lost');
    update public.leads set status = 'contacted'
      where id = '00000000-0000-0000-0000-000000075207';

    select status into v_status from public.leads
      where id = '00000000-0000-0000-0000-000000075207';
    if v_status is distinct from 'contacted'::lead_status then
      raise exception 'reabrir closed_lost->contacted debe permitirse a nivel DB; status final fue %', v_status;
    end if;

    select count(*) into v_count from public.lead_status_history
      where lead_id = '00000000-0000-0000-0000-000000075207';
    if v_count is distinct from 2 then
      raise exception 'reabrir un lead cerrado debe quedar registrado (2 filas: creación+reapertura), fueron %', coalesce(v_count::text, 'NULL');
    end if;
  end
  $do$;
  $$,
  'reabrir_lead_cerrado_closed_lost_a_contacted_queda_registrado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) RLS de lead_status_history — SELECT por private.can_view_lead; SIN
--    INSERT/UPDATE/DELETE directo para `authenticated` [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

-- Fixture fuera de cualquier DO (solo usa schema pre-existente: status='contacted'
-- ya es válido hoy) — así persiste sin depender de que lead_status_history exista.
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000075208',
   '00000000-0000-0000-0000-000000075101',
   '00000000-0000-0000-0000-000000075125', 'contacted');

-- 6a) El agente dueño (A1) VE el historial de su propio lead.
select pg_temp.act_as('00000000-0000-0000-0000-000000075101');
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.lead_status_history
      where lead_id = '00000000-0000-0000-0000-000000075208';
    if v_count < 1 then
      raise exception 'el agente dueno del lead debe ver al menos 1 fila de su historial, vio %', coalesce(v_count::text, 'NULL');
    end if;
  end
  $do$;
  $$,
  'agente_dueno_ve_el_historial_de_su_lead'
);
reset role;

-- 6b) Otro agente (A2, sin relación con el lead) NO ve ninguna fila.
select pg_temp.act_as('00000000-0000-0000-0000-000000075102');
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.lead_status_history
      where lead_id = '00000000-0000-0000-0000-000000075208';
    if v_count is distinct from 0 then
      raise exception 'otro agente sin relacion con el lead NO debe ver su historial, vio %', v_count;
    end if;
  end
  $do$;
  $$,
  'otro_agente_no_ve_historial_ajeno'
);
reset role;

-- 6c/6d/6e) Fail-closed con dientes: NI SIQUIERA el agente dueño del lead
-- puede escribir directo en lead_status_history — solo el trigger
-- SECURITY DEFINER lo hace. throws_ok es seguro hoy (la tabla ni existe:
-- 42P01 también hace throw, el mismo mecanismo interno de captura aplica).
select pg_temp.act_as('00000000-0000-0000-0000-000000075101');
select throws_ok(
  $$ insert into public.lead_status_history (lead_id, old_status, new_status)
     values ('00000000-0000-0000-0000-000000075208', 'contacted', 'interested') $$,
  null,
  'agente_dueno_no_puede_insertar_directo_en_lead_status_history'
);
select throws_ok(
  $$ update public.lead_status_history set new_status = 'closed_lost'
     where lead_id = '00000000-0000-0000-0000-000000075208' $$,
  null,
  'agente_dueno_no_puede_actualizar_directo_lead_status_history'
);
select throws_ok(
  $$ delete from public.lead_status_history
     where lead_id = '00000000-0000-0000-0000-000000075208' $$,
  null,
  'agente_dueno_no_puede_borrar_directo_lead_status_history'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) [DELTA] No-regresión de datos: no quedan leads en estado 'new' tras la
--    migración (data-fix). Usa las 2 filas legacy de seed.sql (lead1, lead3,
--    líneas 353-356) — ver nota de dependencia de seed.sql en la cabecera.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.leads where status = 'new'),
  0,
  'no_quedan_leads_en_estado_new_tras_el_data_fix'
);

select * from finish();
rollback;
