#!/usr/bin/env bash
# import-neighborhoods.sh — pipeline completo DCAH (INEGI) → public.mx_neighborhoods.
# Tarea #157.3/157.4. Idempotente (upsert por source_key) y reanudable por estado.
#
# Uso (LOCAL, psql directo — la URL es la INTERNA del contenedor, puerto 5432):
#   SUPABASE_DB_URL='postgresql://postgres:postgres@127.0.0.1:5432/postgres' ./import-neighborhoods.sh state 14
#   SUPABASE_DB_URL='…' ./import-neighborhoods.sh all       # los 32 estados
#   SUPABASE_DB_URL='…' ./import-neighborhoods.sh bboxes    # D4: bbox municipal
#   SUPABASE_DB_URL='…' ./import-neighborhoods.sh verify    # sondas post-import
#
# Uso (REMOTO, sin contraseña de DB — vía la EF import-neighborhoods + RPC
# import_neighborhoods_batch; ver migración 20260813000003):
#   ./import-neighborhoods.sh remote state 14
#   ./import-neighborhoods.sh remote all
#   Lee SUPABASE_URL/ANON de mobile/.env.local y el secret de .data/import-secret.
#   bboxes/verify remotos: correr el SQL de los modos bboxes/verify vía MCP
#   execute_sql o el SQL editor del dashboard (no hay psql al remoto).
#
# Fuente: "Delimitación de Colonias y otros Asentamientos Humanos 2024" (INEGI),
#   75,516 polígonos nacionales, corte cartográfico dic-2023, SHAPE por entidad.
#   URLs descubiertas vía el API de la biblioteca digital (ficha upc=794551132180).
#   ⚠️ Cobertura NO completa: solo localidades cuyas autoridades municipales entregaron
#   delimitación (Jalisco: 125/125 municipios ✓). CP viene '00000' en varios estados.
#
# Cadena por estado: descarga ZIP (cache) → unzip → mapshaper (reproyección LCC/ITRF2008
#   → WGS84 + simplify 15 m + clean) → prepare-neighborhoods.mjs (CSV) → psql:
#   COPY a staging temp → upsert con ST_MakeValid/ST_Multi (join contra mx_municipalities:
#   cvegeo desconocido se salta y se loguea, nunca truena la FK).
#
# psql: la Mac no tiene cliente; se usa el del contenedor de la DB local
#   (supabase_db_urbea-app, corriendo con `supabase start`). Override: PSQL_CMD.
#
# Producción viva: SOLO INSERT/UPDATE sobre catálogos nuevos (mx_neighborhoods,
#   columnas bbox de mx_municipalities). properties jamás se toca.

set -euo pipefail
cd "$(dirname "$0")"

DATA_DIR="${DCAH_DATA_DIR:-.data/dcah}"
PSQL_CMD="${PSQL_CMD:-docker exec -i supabase_db_urbea-app psql}"
BASE_URL="https://www.inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/geografia/delimitaciones/794551132180"

# Slugs oficiales de los ZIP por entidad (del API de la ficha INEGI).
STATE_SLUGS=(
  "" "01_aguascalientes" "02_bajacalifornia" "03_bajacaliforniasur" "04_campeche"
  "05_coahuiladezaragoza" "06_colima" "07_chiapas" "08_chihuahua" "09_ciudaddemexico"
  "10_durango" "11_guanajuato" "12_guerrero" "13_hidalgo" "14_jalisco" "15_mexico"
  "16_michoacandeocampo" "17_morelos" "18_nayarit" "19_nuevoleon" "20_oaxaca"
  "21_puebla" "22_queretaro" "23_quintanaroo" "24_sanluispotosi" "25_sinaloa"
  "26_sonora" "27_tabasco" "28_tamaulipas" "29_tlaxcala" "30_veracruzignaciodelallave"
  "31_yucatan" "32_zacatecas"
)

die() { echo "ERROR: $*" >&2; exit 1; }

run_sql() { $PSQL_CMD "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"; }

# Descarga (con cache) + reproyección + GeoJSON de un estado. Deja la ruta en $GEOJSON.
fetch_and_prepare() {
  local nn="$1"
  local slug="${STATE_SLUGS[$((10#$nn))]:-}"
  [ -n "$slug" ] || die "estado inválido: $nn (usa 01..32)"
  mkdir -p "$DATA_DIR"

  local zip="$DATA_DIR/$slug.zip"
  if [ ! -s "$zip" ]; then
    echo "→ [$nn] descargando $slug.zip"
    # A archivo temporal + validación: un timeout de INEGI a media descarga
    # dejaba un zip truncado CACHEADO que rompía el unzip en el reintento.
    curl -fSL --retry 3 -o "$zip.tmp" "$BASE_URL/$slug.zip"
    unzip -tqq "$zip.tmp" > /dev/null || die "[$nn] zip corrupto tras descargar (reintenta)"
    mv "$zip.tmp" "$zip"
  fi

  local workdir="$DATA_DIR/$slug"
  if [ ! -s "$workdir/state.geojson" ]; then
    rm -rf "$workdir" && mkdir -p "$workdir"
    unzip -oq "$zip" -d "$workdir"
    local shp
    shp=$(find "$workdir" -name "*as.shp" | head -1)
    [ -n "$shp" ] || die "[$nn] no se encontró el .shp de asentamientos en $zip"

    echo "→ [$nn] mapshaper: reproyección WGS84 + simplify 15m"
    pnpm dlx mapshaper -i "$shp" encoding=latin1 \
      -proj wgs84 -simplify interval=15 keep-shapes -clean \
      -o "$workdir/state.geojson" format=geojson precision=0.00001
  fi
  GEOJSON="$workdir/state.geojson"
}

import_state() {
  local nn="$1"
  fetch_and_prepare "$nn"
  local workdir
  workdir=$(dirname "$GEOJSON")

  echo "→ [$nn] prepare: CSV"
  node prepare-neighborhoods.mjs "$GEOJSON" "$workdir/state.csv"

  echo "→ [$nn] import a la DB (staging + upsert)"
  {
    cat << 'SQL'
create temp table staging (
  source_key text, municipality_id text, name text, postal_code text, geojson text
);
copy staging from stdin with (format csv, header true);
SQL
    cat "$workdir/state.csv"
    printf '\\.\n'
    cat << 'SQL'
select count(*) as "staging (filas del CSV)" from staging;
select count(*) as "SALTADAS: municipio fuera del catálogo" from staging s
  where not exists (select 1 from public.mx_municipalities m where m.id = s.municipality_id);
insert into public.mx_neighborhoods (source_key, municipality_id, name, postal_code, geom)
select t.source_key, t.municipality_id, t.name, nullif(t.postal_code, ''),
       t.geom_fixed::extensions.geography
from (
  select distinct on (s.source_key)
         s.source_key, s.municipality_id, s.name, s.postal_code,
         extensions.ST_Multi(extensions.ST_CollectionExtract(
           extensions.ST_MakeValid(
             extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(s.geojson), 4326)), 3)
         ) as geom_fixed
  from staging s
  join public.mx_municipalities m on m.id = s.municipality_id
) t
where not extensions.ST_IsEmpty(t.geom_fixed)
on conflict (source_key) do update
  set municipality_id = excluded.municipality_id,
      name            = excluded.name,
      postal_code     = excluded.postal_code,
      geom            = excluded.geom;
SQL
    echo "select count(*) as \"total en mx_neighborhoods del estado\" from public.mx_neighborhoods where municipality_id like '$nn%';"
  } | run_sql
  echo "✓ [$nn] importado (local)"
}

# Modo remoto: sin contraseña de DB — lotes HTTP a la EF import-neighborhoods.
remote_state() {
  local nn="$1"
  fetch_and_prepare "$nn"

  local env_file="../../mobile/.env.local"
  [ -f "$env_file" ] || die "no existe $env_file (necesito SUPABASE_URL/ANON_KEY)"
  [ -s ".data/import-secret" ] || die "no existe .data/import-secret (se genera al configurar la EF: supabase secrets set IMPORT_NEIGHBORHOODS_SECRET=…)"

  echo "→ [$nn] upload vía EF import-neighborhoods"
  SUPABASE_URL="$(grep '^EXPO_PUBLIC_SUPABASE_URL=' "$env_file" | cut -d= -f2-)" \
  SUPABASE_ANON_KEY="$(grep '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$env_file" | cut -d= -f2-)" \
  IMPORT_SECRET="$(cat .data/import-secret)" \
    node upload-neighborhoods.mjs "$GEOJSON"
  echo "✓ [$nn] importado (remoto)"
}

case "${1:-}" in
  state)
    [ -n "${SUPABASE_DB_URL:-}" ] || die "define SUPABASE_DB_URL (local interna: postgresql://postgres:postgres@127.0.0.1:5432/postgres)"
    [ -n "${2:-}" ] || die "uso: import-neighborhoods.sh state <01..32>"
    import_state "$(printf '%02d' "$((10#$2))")"
    ;;
  all)
    [ -n "${SUPABASE_DB_URL:-}" ] || die "define SUPABASE_DB_URL (local interna: postgresql://postgres:postgres@127.0.0.1:5432/postgres)"
    for i in $(seq -w 1 32); do import_state "$i"; done
    echo "→ todos los estados importados; corriendo bboxes…"
    "$0" bboxes
    ;;
  remote)
    case "${2:-}" in
      state)
        [ -n "${3:-}" ] || die "uso: import-neighborhoods.sh remote state <01..32>"
        remote_state "$(printf '%02d' "$((10#$3))")"
        ;;
      all)
        for i in $(seq -w 1 32); do remote_state "$i"; done
        echo "→ estados subidos; falta bboxes (correr su SQL vía MCP execute_sql / dashboard)"
        ;;
      *)
        die "uso: import-neighborhoods.sh remote {state <NN>|all}"
        ;;
    esac
    ;;
  bboxes)
    [ -n "${SUPABASE_DB_URL:-}" ] || die "bboxes usa psql — define SUPABASE_DB_URL (para el remoto, corre este SQL vía MCP execute_sql)"
    # D4: bbox municipal precalculado = ST_Extent de sus colonias (NULL si no tiene).
    run_sql << 'SQL'
update public.mx_municipalities m
set bbox_min_lat = extensions.ST_YMin(e.ext::extensions.geometry),
    bbox_min_lng = extensions.ST_XMin(e.ext::extensions.geometry),
    bbox_max_lat = extensions.ST_YMax(e.ext::extensions.geometry),
    bbox_max_lng = extensions.ST_XMax(e.ext::extensions.geometry)
from (
  select municipality_id, extensions.ST_Extent(geom::extensions.geometry) as ext
  from public.mx_neighborhoods
  group by municipality_id
) e
where m.id = e.municipality_id;
select count(*) as "municipios con bbox" from public.mx_municipalities where bbox_min_lat is not null;
SQL
    ;;
  verify)
    [ -n "${SUPABASE_DB_URL:-}" ] || die "verify usa psql — define SUPABASE_DB_URL (para el remoto, corre este SQL vía MCP execute_sql)"
    run_sql << 'SQL'
select count(*) as "colonias totales" from public.mx_neighborhoods;
select left(municipality_id, 2) as estado, count(*) as colonias
  from public.mx_neighborhoods group by 1 order by 1;
select count(*) as "geometrías inválidas (debe ser 0)" from public.mx_neighborhoods
  where not extensions.ST_IsValid(geom::extensions.geometry);
select percentile_disc(0.95) within group (order by extensions.ST_NPoints(geom::extensions.geometry))
  as "p95 vértices (objetivo < 1500)" from public.mx_neighborhoods;
select kind, name, context from public.search_places('providencia', 5);
SQL
    ;;
  *)
    die "uso: import-neighborhoods.sh {state <NN>|all|bboxes|verify|remote state <NN>|remote all}"
    ;;
esac
