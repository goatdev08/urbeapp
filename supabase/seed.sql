-- seed.sql — datos de arranque para DESARROLLO LOCAL (`supabase db reset` lo ejecuta tras las migraciones).
-- Las versiones legales (terms/privacy) ya las siembra la migración 0009; aquí solo datos demo
-- para poder ver el feed/CRM localmente. NO usar en producción.
-- Idempotente: solo siembra si la BD está vacía de usuarios.
-- Demo: 3 inmobiliarias, 10 propiedades, 11 usuarios. Password de todas las cuentas: urbea2026.

do $$
declare
  -- ── Agencias ─────────────────────────────────────────────────────────────────
  agency1  uuid := '20000000-0000-0000-0000-000000000001';  -- Inmobiliaria GDL Premium
  agency2  uuid := '20000000-0000-0000-0000-000000000002';  -- Casas y Terrenos del Oeste
  agency3  uuid := '20000000-0000-0000-0000-000000000003';  -- Grupo Inmobiliario Providencia

  -- ── Usuarios: owners ─────────────────────────────────────────────────────────
  owner1   uuid := '10000000-0000-0000-0000-000000000001';  -- Carlos Mendoza Ruiz (GDL Premium)
  owner2   uuid := '10000000-0000-0000-0000-000000000003';  -- Roberto Pérez Torres (Del Oeste)
  owner3   uuid := '10000000-0000-0000-0000-000000000006';  -- Patricia Gutiérrez Morales (Providencia)

  -- ── Usuarios: agentes ────────────────────────────────────────────────────────
  agent1   uuid := '10000000-0000-0000-0000-000000000002';  -- Ana Flores García (GDL Premium)
  agent2   uuid := '10000000-0000-0000-0000-000000000004';  -- Valentina López Sánchez (Del Oeste)
  agent3   uuid := '10000000-0000-0000-0000-000000000005';  -- Miguel Herrera Jiménez (Del Oeste)
  agent4   uuid := '10000000-0000-0000-0000-000000000007';  -- Diego Ramírez Castro (Providencia)

  -- ── Usuarios: buscadores ─────────────────────────────────────────────────────
  bus1     uuid := '10000000-0000-0000-0000-000000000008';  -- Sofía Vargas León
  bus2     uuid := '10000000-0000-0000-0000-000000000009';  -- Andrés Morales Díaz
  bus3     uuid := '10000000-0000-0000-0000-00000000000a';  -- Laura Jiménez Reyes
  bus4     uuid := '10000000-0000-0000-0000-00000000000b';  -- Fernando Castillo Núñez

  -- ── Propiedades ──────────────────────────────────────────────────────────────
  prop01   uuid := '30000000-0000-0000-0000-000000000001';
  prop02   uuid := '30000000-0000-0000-0000-000000000002';
  prop03   uuid := '30000000-0000-0000-0000-000000000003';
  prop04   uuid := '30000000-0000-0000-0000-000000000004';
  prop05   uuid := '30000000-0000-0000-0000-000000000005';
  prop06   uuid := '30000000-0000-0000-0000-000000000006';
  prop07   uuid := '30000000-0000-0000-0000-000000000007';
  prop08   uuid := '30000000-0000-0000-0000-000000000008';
  prop09   uuid := '30000000-0000-0000-0000-000000000009';
  prop0A   uuid := '30000000-0000-0000-0000-00000000000a';

  -- ── Videos de propiedad ──────────────────────────────────────────────────────
  vid01    uuid := '40000000-0000-0000-0000-000000000001';
  vid02    uuid := '40000000-0000-0000-0000-000000000002';
  vid03    uuid := '40000000-0000-0000-0000-000000000003';
  vid04    uuid := '40000000-0000-0000-0000-000000000004';
  vid05    uuid := '40000000-0000-0000-0000-000000000005';
  vid06    uuid := '40000000-0000-0000-0000-000000000006';
  vid07    uuid := '40000000-0000-0000-0000-000000000007';
  vid08    uuid := '40000000-0000-0000-0000-000000000008';
  vid09    uuid := '40000000-0000-0000-0000-000000000009';
  vid0A    uuid := '40000000-0000-0000-0000-00000000000a';

  -- ── Leads ────────────────────────────────────────────────────────────────────
  lead1    uuid := '50000000-0000-0000-0000-000000000001';
  lead2    uuid := '50000000-0000-0000-0000-000000000002';
  lead3    uuid := '50000000-0000-0000-0000-000000000003';

  -- ── Ubicaciones PostGIS ───────────────────────────────────────────────────────
  geo_prov extensions.geography := extensions.ST_SetSRID(extensions.ST_MakePoint(-103.3761, 20.6884), 4326)::extensions.geography;
  geo_amer extensions.geography := extensions.ST_SetSRID(extensions.ST_MakePoint(-103.3789, 20.6731), 4326)::extensions.geography;
  geo_zap  extensions.geography := extensions.ST_SetSRID(extensions.ST_MakePoint(-103.4119, 20.7208), 4326)::extensions.geography;
  geo_tlaq extensions.geography := extensions.ST_SetSRID(extensions.ST_MakePoint(-103.3119, 20.6404), 4326)::extensions.geography;

  -- Compartidos
  pw       text;
  inst     uuid := '00000000-0000-0000-0000-000000000000';
begin
  if exists (select 1 from public.users limit 1) then
    raise notice 'seed.sql: ya hay usuarios, se omite el seed demo.';
    return;
  end if;

  -- Hash único para la demo (bcrypt vía pgcrypto — ver memory auth_user_sql_seed_gotcha)
  pw := extensions.crypt('urbea2026', extensions.gen_salt('bf'));

  -- ────────────────────────────────────────────────────────────────────────────
  -- 1. auth.users — receta completa para login por password (GoTrue)
  --    El trigger handle_new_user crea el perfil espejo en public.users.
  -- ────────────────────────────────────────────────────────────────────────────
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    -- owners
    (owner1, inst, 'authenticated', 'authenticated', 'owner.gdl@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Carlos","last_name":"Mendoza"}'::jsonb, now(), now()),
    (owner2, inst, 'authenticated', 'authenticated', 'owner.oeste@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Roberto","last_name":"Pérez"}'::jsonb, now(), now()),
    (owner3, inst, 'authenticated', 'authenticated', 'owner.providencia@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Patricia","last_name":"Gutiérrez"}'::jsonb, now(), now()),
    -- agentes
    (agent1, inst, 'authenticated', 'authenticated', 'agente1.gdl@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Ana","last_name":"Flores"}'::jsonb, now(), now()),
    (agent2, inst, 'authenticated', 'authenticated', 'agente2.oeste@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Valentina","last_name":"López"}'::jsonb, now(), now()),
    (agent3, inst, 'authenticated', 'authenticated', 'agente3.oeste@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Miguel","last_name":"Herrera"}'::jsonb, now(), now()),
    (agent4, inst, 'authenticated', 'authenticated', 'agente4.providencia@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Diego","last_name":"Ramírez"}'::jsonb, now(), now()),
    -- buscadores
    (bus1, inst, 'authenticated', 'authenticated', 'buscador1@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Sofía","last_name":"Vargas"}'::jsonb, now(), now()),
    (bus2, inst, 'authenticated', 'authenticated', 'buscador2@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Andrés","last_name":"Morales"}'::jsonb, now(), now()),
    (bus3, inst, 'authenticated', 'authenticated', 'buscador3@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Laura","last_name":"Jiménez"}'::jsonb, now(), now()),
    (bus4, inst, 'authenticated', 'authenticated', 'buscador4@urbea.demo',
     pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"first_name":"Fernando","last_name":"Castillo"}'::jsonb, now(), now());

  -- Fija columnas de token a '' para que el password grant de GoTrue no falle (ver memory gotcha)
  update auth.users
     set confirmation_token        = '',
         recovery_token            = '',
         email_change_token_new    = '',
         email_change              = '',
         email_change_token_current= '',
         phone_change              = '',
         phone_change_token        = '',
         reauthentication_token    = ''
   where id in (owner1, owner2, owner3, agent1, agent2, agent3, agent4,
                bus1, bus2, bus3, bus4);

  -- ────────────────────────────────────────────────────────────────────────────
  -- 2. public.users — actualiza los perfiles creados por el trigger handle_new_user
  --    (first_name/last_name ya los puso el trigger desde raw_user_meta_data;
  --     aquí completamos apellidos compuestos y campos de rol)
  -- ────────────────────────────────────────────────────────────────────────────
  update public.users
     set role = 'agent', is_verified_agent = true,
         city = 'Guadalajara', state = 'Jalisco'
   where id in (owner1, owner2, owner3, agent1, agent2, agent3, agent4);

  -- Nombres completos (apellidos compuestos no cabían en raw_user_meta_data)
  update public.users set first_name = 'Carlos',    last_name = 'Mendoza Ruiz'       where id = owner1;
  update public.users set first_name = 'Roberto',   last_name = 'Pérez Torres'       where id = owner2;
  update public.users set first_name = 'Patricia',  last_name = 'Gutiérrez Morales'  where id = owner3;
  update public.users set first_name = 'Ana',       last_name = 'Flores García'      where id = agent1;
  update public.users set first_name = 'Valentina', last_name = 'López Sánchez'      where id = agent2;
  update public.users set first_name = 'Miguel',    last_name = 'Herrera Jiménez'    where id = agent3;
  update public.users set first_name = 'Diego',     last_name = 'Ramírez Castro'     where id = agent4;

  update public.users set first_name = 'Sofía',    last_name = 'Vargas León',
         city = 'Guadalajara', state = 'Jalisco' where id = bus1;
  update public.users set first_name = 'Andrés',   last_name = 'Morales Díaz',
         city = 'Guadalajara', state = 'Jalisco' where id = bus2;
  update public.users set first_name = 'Laura',    last_name = 'Jiménez Reyes',
         city = 'Guadalajara', state = 'Jalisco' where id = bus3;
  update public.users set first_name = 'Fernando', last_name = 'Castillo Núñez',
         city = 'Guadalajara', state = 'Jalisco' where id = bus4;

  -- ────────────────────────────────────────────────────────────────────────────
  -- 3. agencies — creadas por sus owners (created_by_user_id ya existe en public.users)
  --    Constraints: agencies_slug_unique_active, agencies_name_unique_active
  -- ────────────────────────────────────────────────────────────────────────────
  insert into public.agencies (id, name, slug, status, created_by_user_id) values
    (agency1, 'Inmobiliaria GDL Premium',      'inmobiliaria-gdl-premium',       'active', owner1),
    (agency2, 'Casas y Terrenos del Oeste',    'casas-y-terrenos-del-oeste',     'active', owner2),
    (agency3, 'Grupo Inmobiliario Providencia','grupo-inmobiliario-providencia',  'active', owner3);

  -- ────────────────────────────────────────────────────────────────────────────
  -- 4. agency_members
  --    Constraint: agency_members_one_active_per_user (user_id UNIQUE WHERE status='active')
  -- ────────────────────────────────────────────────────────────────────────────
  insert into public.agency_members (agency_id, user_id, member_role, status) values
    (agency1, owner1, 'owner', 'active'),
    (agency1, agent1, 'agent', 'active'),
    (agency2, owner2, 'owner', 'active'),
    (agency2, agent2, 'agent', 'active'),
    (agency2, agent3, 'agent', 'active'),
    (agency3, owner3, 'owner', 'active'),
    (agency3, agent4, 'agent', 'active');

  -- Denormaliza agency_id en public.users
  update public.users set agency_id = agency1 where id in (owner1, agent1);
  update public.users set agency_id = agency2 where id in (owner2, agent2, agent3);
  update public.users set agency_id = agency3 where id in (owner3, agent4);

  -- ────────────────────────────────────────────────────────────────────────────
  -- 5. user_preferences
  --    Columnas full_name / profile_photo_url agregadas en migración 0015.
  --    useAgentProfile lee full_name de aquí.
  -- ────────────────────────────────────────────────────────────────────────────
  -- Agentes y owners: full_name + profile_photo_url=null (no hay foto en demo)
  insert into public.user_preferences (user_id, full_name) values
    (owner1, 'Carlos Mendoza Ruiz'),
    (owner2, 'Roberto Pérez Torres'),
    (owner3, 'Patricia Gutiérrez Morales'),
    (agent1, 'Ana Flores García'),
    (agent2, 'Valentina López Sánchez'),
    (agent3, 'Miguel Herrera Jiménez'),
    (agent4, 'Diego Ramírez Castro');

  -- Buscadores: preferencias de búsqueda + full_name + onboarding completado
  insert into public.user_preferences
    (user_id, location, search_operation_type, budget_max, full_name, onboarding_completed_at)
  values
    (bus1, geo_prov, 'rent',   18000,    'Sofía Vargas León',        now()),
    (bus2, geo_amer, 'rent',   25000,    'Andrés Morales Díaz',      now()),
    (bus3, geo_zap,  'sale',   6000000,  'Laura Jiménez Reyes',      now()),
    (bus4, geo_tlaq, 'sale',   3500000,  'Fernando Castillo Núñez',  now());

  -- ────────────────────────────────────────────────────────────────────────────
  -- 6. properties — 10 publicaciones activas (5 renta, 5 venta)
  --    Zonas: Providencia / Americana / Zapopan / Tlaquepaque
  -- ────────────────────────────────────────────────────────────────────────────
  insert into public.properties
    (id, owner_user_id, agency_id, property_type, operation_type,
     address, location, state, city, zone,
     price, bedrooms, bathrooms, square_meters, description,
     pet_friendly, status, published_at)
  values
    -- ── Agency 1: Inmobiliaria GDL Premium (3 propiedades) ────────────────────
    (prop01, agent1, agency1, 'departamento', 'rent',
     'Av. Patria 2000, Col. Providencia', geo_prov, 'Jalisco', 'Guadalajara', 'Providencia',
     15000, 2, 2, 80,
     'Departamento moderno de 2 recámaras en Providencia, a pasos de los mejores restaurantes de GDL. Luminoso, balcón, vigilancia 24h.',
     true, 'active', now()),

    (prop02, agent1, agency1, 'casa', 'sale',
     'Calle Moctezuma 450, Zapopan Centro', geo_zap, 'Jalisco', 'Zapopan', 'Zapopan Centro',
     4500000, 3, 2, 150,
     'Casa de 3 recámaras en Zapopan Centro. Amplio jardín, cochera doble, cocina equipada. Zona tranquila y residencial.',
     false, 'active', now()),

    (prop03, owner1, agency1, 'oficina', 'rent',
     'Av. Vallarta 1345, Col. Americana', geo_amer, 'Jalisco', 'Guadalajara', 'Americana',
     22000, null, 1, 65,
     'Oficina corporativa en Vallarta, Col. Americana. Piso 3, vista a la avenida, estacionamiento incluido. Ideal para despacho profesional.',
     false, 'active', now()),

    -- ── Agency 2: Casas y Terrenos del Oeste (4 propiedades) ─────────────────
    (prop04, agent2, agency2, 'casa', 'sale',
     'Calle Reforma 88, San Pedro Tlaquepaque', geo_tlaq, 'Jalisco', 'San Pedro Tlaquepaque', 'Centro Tlaquepaque',
     2800000, 3, 2, 130,
     'Casa colonial remodelada en Tlaquepaque, 3 recámaras, patio interior con fuente, a 3 min del centro artesanal.',
     false, 'active', now()),

    (prop05, agent2, agency2, 'departamento', 'rent',
     'Av. Chapultepec 920, Col. Americana', geo_amer, 'Jalisco', 'Guadalajara', 'Americana',
     12000, 1, 1, 52,
     'Departamento de 1 recámara en Chapultepec-Americana. Perfecto para profesionistas. Edificio con vigilancia 24h.',
     false, 'active', now()),

    (prop06, agent3, agency2, 'local', 'sale',
     'Av. México 2300, Col. Ladrón de Guevara', geo_amer, 'Jalisco', 'Guadalajara', 'Ladrón de Guevara',
     5500000, null, 1, 120,
     'Local comercial en esquina, Col. Ladrón de Guevara. 120 m², planta baja, alta afluencia peatonal. Ideal para restaurante o clínica.',
     false, 'active', now()),

    (prop07, agent3, agency2, 'departamento', 'rent',
     'Calle Lerdo de Tejada 2540, Col. Providencia', geo_prov, 'Jalisco', 'Guadalajara', 'Providencia',
     18000, 2, 1, 75,
     'Departamento de 2 recámaras con vista al jardín en Providencia. Edificio boutique con gimnasio y asador comunitario.',
     false, 'active', now()),

    -- ── Agency 3: Grupo Inmobiliario Providencia (3 propiedades) ─────────────
    (prop08, agent4, agency3, 'casa', 'sale',
     'Blvd. Puerta de Hierro 4965, Zapopan', geo_zap, 'Jalisco', 'Zapopan', 'Puerta de Hierro',
     7200000, 4, 3, 280,
     'Residencia de 4 recámaras en Puerta de Hierro. 280 m² de construcción, alberca privada, cuarto de servicio, acabados de lujo.',
     false, 'active', now()),

    (prop09, agent4, agency3, 'terreno', 'sale',
     'Calle Independencia 1200, Tlaquepaque', geo_tlaq, 'Jalisco', 'San Pedro Tlaquepaque', 'Centro Tlaquepaque',
     1800000, null, null, 200,
     'Terreno plano de 200 m² en zona residencial de Tlaquepaque. Sin construcción, escrituras al día, excelente inversión.',
     false, 'active', now()),

    (prop0A, owner3, agency3, 'casa', 'rent',
     'Av. Guadalupe 3380, Col. Providencia', geo_prov, 'Jalisco', 'Guadalajara', 'Providencia',
     45000, 4, 3, 220,
     'Casa de 4 recámaras completamente amueblada en Providencia. Jardín con alberca, cuarto de servicio, estacionamiento para 3 autos.',
     true, 'active', now());

  -- ────────────────────────────────────────────────────────────────────────────
  -- 7. property_videos — 1 por propiedad, status='processing', sin storage_path
  --    CHECK 0012: status <> 'ready' → storage_path/cloudflare_uid pueden ser NULL ✓
  --    18.5 (seed-videos.sh) los pasará a 'ready' al cargar los archivos al bucket.
  -- ────────────────────────────────────────────────────────────────────────────
  insert into public.property_videos (id, property_id, status, position) values
    (vid01, prop01, 'processing', 1),
    (vid02, prop02, 'processing', 1),
    (vid03, prop03, 'processing', 1),
    (vid04, prop04, 'processing', 1),
    (vid05, prop05, 'processing', 1),
    (vid06, prop06, 'processing', 1),
    (vid07, prop07, 'processing', 1),
    (vid08, prop08, 'processing', 1),
    (vid09, prop09, 'processing', 1),
    (vid0A, prop0A, 'processing', 1);

  -- ────────────────────────────────────────────────────────────────────────────
  -- 8. likes — granularidad: video; UNIQUE (user_id, property_video_id)
  -- ────────────────────────────────────────────────────────────────────────────
  insert into public.likes (user_id, property_video_id, property_id) values
    (bus1, vid01, prop01),   -- Sofía → prop01
    (bus2, vid01, prop01),   -- Andrés → prop01
    (bus1, vid05, prop05),   -- Sofía → prop05
    (bus2, vid07, prop07),   -- Andrés → prop07
    (bus3, vid02, prop02),   -- Laura → prop02
    (bus3, vid06, prop06),   -- Laura → prop06
    (bus2, vid0A, prop0A);   -- Andrés → prop0A

  -- ────────────────────────────────────────────────────────────────────────────
  -- 9. saves — granularidad: propiedad; UNIQUE (user_id, property_id)
  -- ────────────────────────────────────────────────────────────────────────────
  insert into public.saves (user_id, property_id) values
    (bus1, prop01),
    (bus2, prop01),
    (bus1, prop05),
    (bus2, prop07),
    (bus3, prop02),
    (bus3, prop06);

  -- ────────────────────────────────────────────────────────────────────────────
  -- 10. leads — un par (agent_id, user_id); CHECK agent_id <> user_id
  --     UNIQUE (agent_id, user_id) WHERE deleted_at IS NULL
  -- ────────────────────────────────────────────────────────────────────────────
  insert into public.leads (id, agent_id, user_id, status) values
    (lead1, agent1, bus1, 'new'),        -- Sofía contactó a Ana Flores (prop01)
    (lead2, agent3, bus2, 'contacted'),  -- Andrés contactó a Miguel Herrera (prop07)
    (lead3, agent4, bus3, 'new');        -- Laura contactó a Diego Ramírez (prop08)

  -- ────────────────────────────────────────────────────────────────────────────
  -- 11. lead_origin_properties
  --     UNIQUE (lead_id, property_id)
  -- ────────────────────────────────────────────────────────────────────────────
  insert into public.lead_origin_properties (lead_id, property_id, property_video_id) values
    (lead1, prop01, vid01),
    (lead2, prop07, vid07),
    (lead3, prop08, vid08);

  -- ────────────────────────────────────────────────────────────────────────────
  -- 12. Contadores denormalizados — coherentes con likes/saves/leads insertados
  --     like_count: prop01=2 prop02=1 prop05=1 prop06=1 prop07=1 prop0A=1
  --     save_count: prop01=2 prop02=1 prop05=1 prop06=1 prop07=1
  --     contact_count: prop01=1 prop07=1 prop08=1
  -- ────────────────────────────────────────────────────────────────────────────
  update public.properties set like_count = 2, save_count = 2, contact_count = 1 where id = prop01;
  update public.properties set like_count = 1, save_count = 1                      where id = prop02;
  update public.properties set like_count = 1, save_count = 1                      where id = prop05;
  update public.properties set like_count = 1, save_count = 1                      where id = prop06;
  update public.properties set like_count = 1, save_count = 1, contact_count = 1   where id = prop07;
  update public.properties set contact_count = 1                                    where id = prop08;
  update public.properties set like_count = 1                                       where id = prop0A;
  -- prop03, prop04, prop09 quedan en like_count=0, save_count=0, contact_count=0 (default) ✓

  raise notice 'seed.sql: datos demo creados (3 inmobiliarias, 10 propiedades, 11 usuarios, 3 leads).';
end $$;
