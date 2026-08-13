-- Rollback de 20260813000001_mx_neighborhoods.sql (tarea #157.1)
-- Orden importa: la tabla y las columnas generadas dependen de la función —
-- la función se dropea AL FINAL.

-- 1) Tabla de colonias (sus índices y policy caen con ella).
drop table if exists public.mx_neighborhoods;

-- 2) Índice trgm de municipios (caería con la columna, pero explícito documenta).
drop index if exists public.mx_municipalities_name_trgm_idx;

-- 3) Columnas aditivas de mx_municipalities.
alter table public.mx_municipalities
  drop column if exists name_normalized,
  drop column if exists bbox_min_lat,
  drop column if exists bbox_min_lng,
  drop column if exists bbox_max_lat,
  drop column if exists bbox_max_lng;

-- 4) La función de normalización (ya sin dependientes).
drop function if exists private.normalize_search_text(text);
