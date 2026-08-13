-- Migración 0067 — RPC import_neighborhoods_batch (tarea #157.4)
-- Aditiva e idempotente. Rollback: rollbacks/20260813000003_import_neighborhoods_batch_rpc.sql
-- Tests: supabase/tests/45_import_neighborhoods_batch_test.sql
--
-- Propósito: canal de import de colonias SIN conexión directa a Postgres. La Mac
-- de desarrollo no tiene la contraseña de la DB remota (decisión de Abraham
-- 2026-08-13: no compartirla), así que el camino psql \copy de
-- import-neighborhoods.sh solo sirve contra el stack local. Para el remoto, la EF
-- desechable `import-neighborhoods` (service_role inyectado, protegida por
-- secret) recibe lotes HTTP y los pasa aquí — mismo precedente que el seed del
-- catálogo 72.1 ("EF desechable").
--
-- El upsert es EL MISMO SQL validado del script psql (staging→upsert):
--   ST_MakeValid + CollectionExtract(3) + ST_Multi, join anti-huérfanos contra
--   mx_municipalities (un cvegeo desconocido se salta, no truena la FK), guard
--   ST_IsEmpty, ON CONFLICT (source_key) DO UPDATE.
--
-- ⚠️ Un geojson MALFORMADO (no parseable) aborta el lote completo con excepción —
-- a propósito sin tolerancia por fila (sería un bug de prepare-neighborhoods.mjs,
-- mejor verlo explotar que importar silenciosamente menos colonias).
--
-- 🔒 EXECUTE SOLO service_role: es una herramienta de operación (import), no un
-- endpoint de la app. Ni anon ni authenticated tienen caso de uso.

create or replace function public.import_neighborhoods_batch(p_rows jsonb)
returns table (inserted integer, skipped integer)
language plpgsql
security definer
set search_path = public, extensions, private
as $$
declare
  v_total    integer;
  v_inserted integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows debe ser un array JSONB de filas de colonia';
  end if;

  select count(*)::int into v_total from jsonb_array_elements(p_rows);

  with rows as (
    select
      r->>'source_key'              as source_key,
      r->>'municipality_id'         as municipality_id,
      r->>'name'                    as name,
      nullif(r->>'postal_code', '') as postal_code,
      r->>'geojson'                 as geojson
    from jsonb_array_elements(p_rows) as r
  ),
  fixed as (
    select distinct on (s.source_key)
      s.source_key, s.municipality_id, s.name, s.postal_code,
      extensions.ST_Multi(extensions.ST_CollectionExtract(
        extensions.ST_MakeValid(
          extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(s.geojson), 4326)), 3)
      ) as geom_fixed
    from rows s
    where s.source_key is not null
      and s.name is not null
      and s.geojson is not null
      and exists (select 1 from public.mx_municipalities m where m.id = s.municipality_id)
  ),
  ins as (
    insert into public.mx_neighborhoods (source_key, municipality_id, name, postal_code, geom)
    select f.source_key, f.municipality_id, f.name, f.postal_code,
           f.geom_fixed::extensions.geography
    from fixed f
    where not extensions.ST_IsEmpty(f.geom_fixed)
    on conflict (source_key) do update
      set municipality_id = excluded.municipality_id,
          name            = excluded.name,
          postal_code     = excluded.postal_code,
          geom            = excluded.geom
    returning 1
  )
  select count(*)::int into v_inserted from ins;

  return query select v_inserted, v_total - v_inserted;
end;
$$;

comment on function public.import_neighborhoods_batch(jsonb) is
  'Upsert por lotes de colonias (source_key ancla). Municipios fuera del catálogo y geometrías vacías se saltan (skipped). Solo service_role — la llama la EF import-neighborhoods durante el import DCAH.';

revoke execute on function public.import_neighborhoods_batch(jsonb) from public, anon, authenticated;
grant execute on function public.import_neighborhoods_batch(jsonb) to service_role;
