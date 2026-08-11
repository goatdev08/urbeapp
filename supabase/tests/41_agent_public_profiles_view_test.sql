-- Tests pgTAP — vista agent_public_profiles (#145.1)
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SUT: vista public.agent_public_profiles (migración 20260810000001).
-- El hueco: user_prefs_select es "solo tu fila o admin", así que TODA lectura
-- ajena de full_name/profile_photo_url devolvía 0 filas EN SILENCIO — el feed
-- mostraba iniciales placeholder, y el perfil ajeno (/profile/[id]) y la
-- AgentCard del detalle caían al fallback sin que nadie lo notara.
-- La vista expone SOLO la identidad pública (user_id, full_name,
-- profile_photo_url) de usuarios con role agent|admin, con derechos del owner
-- (security_invoker=false) para brincar la RLS de user_preferences EN ESAS
-- COLUMNAS y nada más: el comportamiento del buscador (presupuesto, ubicación,
-- filtros de búsqueda) sigue siendo privado, igual que su identidad.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(6);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0009-000000000001', 'agente_vista@urbea.mx'),
  ('00000000-0000-0000-0009-000000000002', 'buscador_vista@urbea.mx');
update public.users set role = 'agent'
 where id = '00000000-0000-0000-0009-000000000001';
-- el buscador conserva el default role='user'

insert into public.user_preferences (user_id, full_name, profile_photo_url, budget_min)
values
  ('00000000-0000-0000-0009-000000000001', 'Agente Vista', 'avatars/agente-vista.jpg', 15000),
  ('00000000-0000-0000-0009-000000000002', 'Buscador Privado', null, 8000);

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/37/40_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- SELECT protegido: atrapa el error de privilegios y regresa boolean.
create or replace function pg_temp.try_select_view()
returns boolean language plpgsql as $$
begin
  perform * from public.agent_public_profiles limit 1;
  return true;
exception when others then
  return false;
end $$;

-- ── 1) Un buscador cualquiera SÍ lee la identidad pública del agente ─────────
select pg_temp.act_as('00000000-0000-0000-0009-000000000002');
select results_eq(
  $$ select full_name, profile_photo_url from public.agent_public_profiles
      where user_id = '00000000-0000-0000-0009-000000000001' $$,
  $$ values ('Agente Vista'::text, 'avatars/agente-vista.jpg'::text) $$,
  '1) buscador autenticado lee full_name y profile_photo_url del agente vía la vista'
);

-- ── 2) La vista NO expone columnas de comportamiento (solo identidad) ────────
reset role;
select columns_are(
  'public', 'agent_public_profiles',
  array['user_id', 'full_name', 'profile_photo_url'],
  '2) la vista expone EXACTAMENTE user_id/full_name/profile_photo_url — sin presupuesto, ubicación ni filtros'
);

-- ── 3) user_preferences directo sigue bloqueado por RLS (fila ajena) ─────────
select pg_temp.act_as('00000000-0000-0000-0009-000000000002');
select is(
  (select count(*) from public.user_preferences
    where user_id = '00000000-0000-0000-0009-000000000001')::int,
  0,
  '3) la tabla user_preferences ajena sigue devolviendo 0 filas — la vista no abre la tabla'
);

-- ── 4) La fila del buscador (role=user) NO aparece en la vista ───────────────
select is(
  (select count(*) from public.agent_public_profiles
    where user_id = '00000000-0000-0000-0009-000000000002')::int,
  0,
  '4) la identidad de un buscador (role=user) NO se expone en la vista'
);

-- ── 5) El propio agente también la lee (sin regresión para el perfil propio) ─
select pg_temp.act_as('00000000-0000-0000-0009-000000000001');
select is(
  (select full_name from public.agent_public_profiles
    where user_id = '00000000-0000-0000-0009-000000000001'),
  'Agente Vista',
  '5) el agente lee su propia fila vía la vista'
);

-- ── 6) anon NO tiene privilegios sobre la vista ──────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0009-000000000002', 'anon');
select is(
  pg_temp.try_select_view(),
  false,
  '6) el rol anon no puede consultar la vista (grant solo a authenticated)'
);

reset role;
select * from finish();
rollback;
