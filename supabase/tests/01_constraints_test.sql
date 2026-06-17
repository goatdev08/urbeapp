-- Tests pgTAP — Constraints e invariantes clave (Urbea MVP)
-- Ejecutar con: supabase test db   (instala pgtap y corre los archivos de supabase/tests/)
-- Corre como superusuario (RLS no aplica aquí); validamos constraints, índices únicos parciales y triggers.

begin;
select plan(13);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local'),   -- buscador A
  ('00000000-0000-0000-0000-0000000000a2', 'b@test.local'),   -- buscador B
  ('00000000-0000-0000-0000-0000000000b1', 'g1@test.local'),  -- agente G1 (agency X)
  ('00000000-0000-0000-0000-0000000000b2', 'g2@test.local'),  -- agente G2 (agency X)
  ('00000000-0000-0000-0000-0000000000b3', 'g3@test.local'),  -- agente G3 (independiente)
  ('00000000-0000-0000-0000-0000000000c1', 'o@test.local'),   -- owner O (agency X)
  ('00000000-0000-0000-0000-0000000000d1', 'ad@test.local');  -- admin

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2',
               '00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c1');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d1';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-0000000000e1', 'Inmobiliaria X', 'inmo-x', 'active', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000e2', 'Inmobiliaria Y', 'inmo-y', 'active', '00000000-0000-0000-0000-0000000000c1');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'owner', 'active'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'agent', 'active'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'agent', 'active');

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'departamento', 'rent', 'Av. Chapultepec 100', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'casa', 'sale', 'Calle Falsa 123', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 2500000, 'draft'),
  ('00000000-0000-0000-0000-00000000cabe', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'local', 'rent', 'Para cascada', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.34, 20.66), 4326)::extensions.geography, 8000, 'active');

insert into public.property_videos (id, property_id, status, position) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000f1', 'ready', 1),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000000f1', 'processing', 2),
  ('00000000-0000-0000-0000-00000000a009', '00000000-0000-0000-0000-00000000cabe', 'ready', 1);  -- para test de cascada

insert into public.likes (user_id, property_video_id, property_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000f1');
insert into public.saves (user_id, property_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1');
insert into public.leads (agent_id, user_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2');
insert into public.property_reports (property_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'misleading');

-- ── Asserts ─────────────────────────────────────────────────────────────────

-- 1) Un agente no puede tener 2 membresías activas (máx 1 inmobiliaria activa).
select throws_ok(
  $$ insert into public.agency_members (agency_id, user_id, member_role, status)
     values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b1', 'agent', 'active') $$,
  null, 'agency_members: un agente no puede estar activo en 2 inmobiliarias');

-- 2) Lead único por par (agent, user) entre no borrados.
select throws_ok(
  $$ insert into public.leads (agent_id, user_id)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1') $$,
  null, 'leads: un lead por par (agent, user)');

-- 3) Tras soft-delete del lead, el par (agent, user) se puede volver a crear.
update public.leads set deleted_at = now()
  where agent_id = '00000000-0000-0000-0000-0000000000b1' and user_id = '00000000-0000-0000-0000-0000000000a1';
select lives_ok(
  $$ insert into public.leads (agent_id, user_id)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1') $$,
  'leads: el par se reutiliza tras soft-delete');

-- 4) Like único por (user, video).
select throws_ok(
  $$ insert into public.likes (user_id, property_video_id, property_id)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000f1') $$,
  null, 'likes: like único por (user, video)');

-- 5) Save único por (user, property).
select throws_ok(
  $$ insert into public.saves (user_id, property_id)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1') $$,
  null, 'saves: save único por (user, property)');

-- 6) No más de 5 videos por propiedad (trigger). Llenamos a 5 y el 6º falla.
insert into public.property_videos (property_id, status, position) values
  ('00000000-0000-0000-0000-0000000000f1', 'uploading', 3),
  ('00000000-0000-0000-0000-0000000000f1', 'uploading', 4),
  ('00000000-0000-0000-0000-0000000000f1', 'uploading', 5);
select throws_ok(
  $$ insert into public.property_videos (property_id, status, position)
     values ('00000000-0000-0000-0000-0000000000f1', 'uploading', 5) $$,
  null, 'property_videos: el 6º video es rechazado');

-- 7) Un usuario no puede reportar dos veces la misma propiedad.
select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason)
     values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'false_price') $$,
  null, 'property_reports: un usuario no reporta dos veces la misma propiedad');

-- 8) status='closed' exige closed_reason.
select throws_ok(
  $$ update public.properties set status = 'closed', closed_reason = null
     where id = '00000000-0000-0000-0000-0000000000f2' $$,
  null, 'properties: cerrar exige closed_reason');

-- 9) Un lead no puede tener agent_id = user_id.
select throws_ok(
  $$ insert into public.leads (agent_id, user_id)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1') $$,
  null, 'leads: agent_id <> user_id');

-- 10) Token no puede tener current_uses > max_uses.
select throws_ok(
  $$ insert into public.agency_invitation_tokens (agency_id, token, max_uses, current_uses, created_by_user_id)
     values ('00000000-0000-0000-0000-0000000000e1', 'hash_invalido', 1, 2, '00000000-0000-0000-0000-0000000000c1') $$,
  null, 'tokens: current_uses <= max_uses');

-- 11) El consumo atómico de un token agotado afecta 0 filas.
insert into public.agency_invitation_tokens (id, agency_id, token, max_uses, current_uses, created_by_user_id)
  values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000e1', 'hash_agotado', 1, 1, '00000000-0000-0000-0000-0000000000c1');
select is(
  (with u as (
     update public.agency_invitation_tokens set current_uses = current_uses + 1
     where id = '00000000-0000-0000-0000-00000000aa01' and (max_uses is null or current_uses < max_uses)
     returning 1)
   select count(*)::int from u),
  0, 'tokens: consumo atómico de token agotado afecta 0 filas');

-- 12) Insertar un token válido (ilimitado) funciona.
select lives_ok(
  $$ insert into public.agency_invitation_tokens (agency_id, token, max_uses, created_by_user_id)
     values ('00000000-0000-0000-0000-0000000000e1', 'hash_valido', null, '00000000-0000-0000-0000-0000000000c1') $$,
  'tokens: token ilimitado válido se inserta');

-- 13) Cascada soft-delete: borrar la propiedad propaga deleted_at a sus videos.
update public.properties set deleted_at = now() where id = '00000000-0000-0000-0000-00000000cabe';
select ok(
  (select deleted_at from public.property_videos where id = '00000000-0000-0000-0000-00000000a009') is not null,
  'cascade: soft-delete de propiedad propaga a sus videos');

select * from finish();
rollback;
