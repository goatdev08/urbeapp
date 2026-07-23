-- Tests pgTAP — Mini-migración upload-first para el ciclo Cloudflare Stream (tarea 68.3)
-- Ejecutar con: supabase test db
-- El video se sube ANTES de existir la propiedad (Direct Creator Upload a Stream), así que:
--   · property_videos.property_id pasa a NULLABLE (video en vuelo sin propiedad aún)
--   · +columna agent_id (a quién pertenece el upload en vuelo) → invariante de concurrencia por agente
--   · CHECK: todo video debe ser atribuible (property_id o agent_id no nulo)
-- Aditivo: las columnas/reglas no rompen filas existentes.

begin;
select plan(9);

-- ── 1) property_id ahora es NULLABLE (antes NOT NULL) ─────────────────────────
select col_is_null('public', 'property_videos', 'property_id',
  'property_videos.property_id es nullable (video en vuelo sin propiedad)');

-- ── 2) Nueva columna agent_id, nullable (aditivo; filas legacy quedan null) ────
select has_column('public', 'property_videos', 'agent_id', 'property_videos.agent_id existe');
select col_is_null('public', 'property_videos', 'agent_id', 'agent_id es nullable');

-- ── 3) Índice de soporte para la query de concurrencia (agent_id, status) ──────
select has_index('public', 'property_videos', 'property_videos_agent_status_idx',
  'existe índice property_videos_agent_status_idx para la query de concurrencia por agente');

-- ── Fixtures: un agente ───────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'agente_up@test.local');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-0000000000a7';

-- ── 4) Se puede insertar un UPLOAD EN VUELO: property_id NULL + agent_id set ───
select lives_ok($$
  insert into public.property_videos (property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
  values (null, '00000000-0000-0000-0000-0000000000a7', 'uploading', 1, 'cfuid-inflight-1', 'https://upload.example/one')
$$, 'insert de upload en vuelo (property_id null, agent_id set) es válido');

-- ── 5) CHECK de atribución: property_id NULL y agent_id NULL a la vez → rechaza ─
select throws_ok($$
  insert into public.property_videos (property_id, agent_id, status, position)
  values (null, null, 'uploading', 1)
$$, '23514', null,
  'un video sin property_id NI agent_id viola el CHECK de atribución');

-- ── 6) La query de concurrencia por agente encuentra el upload en vuelo ────────
select is(
  (select count(*) from public.property_videos
     where agent_id = '00000000-0000-0000-0000-0000000000a7'
       and status in ('uploading', 'processing') and deleted_at is null)::int,
  1,
  'query de concurrencia: el agente tiene 1 video en vuelo');

-- ── 7) fail-closed: anon NO ve el upload en vuelo (property_id null) ───────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

select pg_temp.act_as(null, 'anon');
select is(
  (select count(*) from public.property_videos where cloudflare_uid = 'cfuid-inflight-1')::int,
  0,
  'anon no ve videos en vuelo (property_id null)');
reset role;

-- ── 8) FK: agent_id inexistente en users → rechaza (integridad) ────────────────
select throws_ok($$
  insert into public.property_videos (property_id, agent_id, status, position)
  values (null, '00000000-0000-0000-0000-0000000000de', 'uploading', 1)
$$, '23503', null,
  'agent_id que no existe en users viola el FK');

select * from finish();
rollback;
