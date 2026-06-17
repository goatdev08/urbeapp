-- seed.sql — datos de arranque para DESARROLLO LOCAL (`supabase db reset` lo ejecuta tras las migraciones).
-- Las versiones legales (terms/privacy) ya las siembra la migración 0009; aquí solo datos demo
-- para poder ver el feed/CRM localmente. NO usar en producción.
-- Idempotente: solo siembra si la BD está vacía de usuarios.

do $$
declare
  ag_owner uuid := '10000000-0000-0000-0000-000000000001';
  ag_agent uuid := '10000000-0000-0000-0000-000000000002';
  buscador uuid := '10000000-0000-0000-0000-000000000003';
  agency   uuid := '20000000-0000-0000-0000-000000000001';
  prop     uuid := '30000000-0000-0000-0000-000000000001';
  geo extensions.geography := extensions.ST_SetSRID(extensions.ST_MakePoint(-103.3496, 20.6597), 4326)::extensions.geography;
begin
  if exists (select 1 from public.users limit 1) then
    raise notice 'seed.sql: ya hay usuarios, se omite el seed demo.';
    return;
  end if;

  -- Usuarios (el trigger handle_new_user crea el perfil en public.users)
  insert into auth.users (id, email) values
    (ag_owner, 'owner@urbea.demo'),
    (ag_agent, 'agente@urbea.demo'),
    (buscador, 'buscador@urbea.demo');

  update public.users set role='agent', is_verified_agent=true, first_name='Demo', last_name='Owner',
         city='Guadalajara', state='Jalisco' where id = ag_owner;
  update public.users set role='agent', is_verified_agent=true, first_name='Demo', last_name='Agente',
         city='Guadalajara', state='Jalisco' where id = ag_agent;
  update public.users set first_name='Demo', last_name='Buscador',
         city='Guadalajara', state='Jalisco' where id = buscador;

  -- Inmobiliaria activa con su owner y un agente
  insert into public.agencies (id, name, slug, status, created_by_user_id)
    values (agency, 'Inmobiliaria Demo', 'inmobiliaria-demo', 'active', ag_owner);
  insert into public.agency_members (agency_id, user_id, member_role, status) values
    (agency, ag_owner, 'owner', 'active'),
    (agency, ag_agent, 'agent', 'active');
  update public.users set agency_id = agency where id in (ag_owner, ag_agent);

  -- Onboarding del buscador
  insert into public.user_preferences (user_id, location, search_operation_type, budget_max)
    values (buscador, geo, 'rent', 18000);

  -- Una publicación activa con video listo
  insert into public.properties
    (id, owner_user_id, agency_id, property_type, operation_type, address, location, state, city, zone,
     price, bedrooms, bathrooms, square_meters, description, pet_friendly, status, published_at)
  values
    (prop, ag_agent, agency, 'departamento', 'rent', 'Av. Chapultepec 480, Col. Americana',
     geo, 'Jalisco', 'Guadalajara', 'Americana', 15000, 2, 2, 85,
     'Departamento luminoso a pasos de Chapultepec.', true, 'active', now());
  insert into public.property_videos (property_id, status, position, duration_seconds, ready_at)
    values (prop, 'ready', 1, 75, now());

  raise notice 'seed.sql: datos demo creados (1 inmobiliaria, 1 propiedad activa).';
end $$;
