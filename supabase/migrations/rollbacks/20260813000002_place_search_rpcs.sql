-- Rollback de 20260813000002_place_search_rpcs.sql (tarea #157.2)
-- Las tres funciones son independientes entre sí; orden indistinto.

drop function if exists public.search_places(text, integer);
drop function if exists public.get_neighborhood_geojson(bigint);
drop function if exists public.properties_within_neighborhood(bigint);
