-- Tests pgTAP — properties_insert restringido a status='draft' (#127, hallazgo 7)
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SUT: policy properties_insert (migración 20260809000008).
-- El hueco: la policy exigía owner = auth.uid() + rol agent|admin (+ membresía
-- de agencia) pero NO restringía la columna status — el literal 'draft' del
-- cliente era lo ÚNICO que hacía que la fila naciera como borrador; cualquier
-- caller con la anon key y un JWT de agente podía crear propiedades 'active'
-- públicas sin pasar por moderación (PRD §14.2: TODA publicación pasa por
-- revisión). El único INSERT legítimo de cliente es el autosave de borradores
-- (useDraftAutosave); el flujo de publicación entra por la RPC
-- publish_property_atomic (SECURITY DEFINER, no evalúa esta policy).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(4);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0008-000000000001', 'agente_draft_only@urbea.mx');
update public.users set role = 'agent'
 where id = '00000000-0000-0000-0008-000000000001';

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/37_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- INSERT protegido: atrapa el error de RLS y regresa boolean sin abortar la tx.
create or replace function pg_temp.try_insert_property(p_status text, p_addr text)
returns boolean language plpgsql as $$
begin
  insert into public.properties
    (owner_user_id, operation_type, property_type, price, address, location, status)
  values (
    '00000000-0000-0000-0008-000000000001',
    'rent', 'departamento', 9000, p_addr,
    extensions.ST_SetSRID(extensions.ST_Point(-99.2, 19.5), 4326)::extensions.geography,
    p_status::property_status
  );
  return true;
exception when others then
  return false;
end $$;

-- ── 1) El agente SÍ puede crear su borrador (autosave, §14.1) ────────────────
select pg_temp.act_as('00000000-0000-0000-0008-000000000001');
select is(
  pg_temp.try_insert_property('draft', 'Calle Draft Permitido 1'),
  true,
  '1) agente autenticado inserta su propio draft — el autosave sigue funcionando'
);

-- ── 2) 'active' directo por PostgREST → rechazado ────────────────────────────
select is(
  pg_temp.try_insert_property('active', 'Calle Active Prohibido 1'),
  false,
  '2) INSERT con status=active se rechaza — publicar solo vía RPC + moderación (PRD §14.2)'
);

-- ── 3) 'pending_review' directo → rechazado (el flujo real entra por la RPC) ─
select is(
  pg_temp.try_insert_property('pending_review', 'Calle PendingReview Prohibido 1'),
  false,
  '3) INSERT con status=pending_review también se rechaza — el camino es la EF/RPC'
);

-- ── 4) La fila del caso 1 existe y es draft (verificación de la fila real) ───
reset role;
select is(
  (select status::text from public.properties
    where owner_user_id = '00000000-0000-0000-0008-000000000001'
      and address = 'Calle Draft Permitido 1'),
  'draft',
  '4) la fila creada por el agente quedó realmente en draft'
);

select * from finish();
rollback;
