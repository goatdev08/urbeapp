-- Rollback de 20260815000001_org_advertising_capability.sql (tarea #168.1)
-- Orden importa: el helper depende de las columnas -- se dropea primero;
-- el CHECK y las columnas dependen del enum -- se dropean antes que el tipo.

-- 1) Comentario de tabla: vuelve al texto previo (20260604000003).
comment on table public.agencies is
  'Inmobiliaria: entidad organizacional (no es un rol de usuario).';

-- 2) Helper (sin dependientes -- 169-171 aún no lo usan).
drop function if exists private.org_can_advertise(uuid);

-- 3) CHECK nombrado.
alter table public.agencies
  drop constraint if exists agencies_al_menos_una_capacidad;

-- 4) Columnas de capacidad.
alter table public.agencies
  drop column if exists advertiser_category,
  drop column if exists can_advertise,
  drop column if exists can_publish_properties;

-- 5) El enum (ya sin columnas que lo referencien).
drop type if exists public.advertiser_category;
