---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §9-12, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0005_properties_and_videos.sql, mobile/src/features/search/lib/filterQuery.ts, mobile/src/features/search/lib/zones.ts, mobile/src/features/search/lib/filterStorage.ts, mobile/src/features/search/filterStore.tsx, mobile/src/features/search/components/FilterSheet.tsx, mobile/src/features/search/components/RadiusSelector.tsx, mobile/src/features/search/types.ts]
actualizado: 2026-07-10
---

# Búsqueda y filtros

> Encontrar propiedades por criterios; en la demo, filtros básicos sobre el feed/mapa.

## Implementado (tarea #12 — feed + mapa)
`FilterSheet` (RN Modal) con estado en `FilterProvider` (Context, key AsyncStorage `urbea_filters`), compartido por feed y mapa. Filtros:
- **operación** (rent/sale) · **tipo** (5 enums) · **zona** (colonia exacta) · **rango de precio** (min/max) · **recámaras** (mínimo) · toggles **`pet_friendly`/`allows_no_guarantor`/`student_friendly`**.
- El builder puro `build_filter_query(query, filters)` traduce el `FilterState` a `.in/.gte/.lte/.eq` de supabase-js, **además de** los filtros base (no en su lugar).
- ⚠️ **Sutileza `operation_type='both'`**: seleccionar {rent} filtra `operation_type IN ('rent','both')` — una propiedad 'both' matchea cualquier modalidad. Booleanos `false` = "no filtrar" (nunca `.eq(col,false)`).
- **Zona sin ILIKE a DB**: `fetch_distinct_zones` trae las colonias distintas y el filtrado por texto es client-side (`filter_zones`, normaliza acentos) → honra el gotcha 🔒 y el match final es exacto (`.eq('zone', ...)`).
- Badge de conteo (`get_active_filter_count`, precio=1 grupo) en `FeedScreen` y `MapSearchBar`.
- **Radio de búsqueda (#42)**: `radius_m` en `FilterState`/`EMPTY_FILTERS` (default 5000 m) + sección "Radio de búsqueda" en el sheet (`RadiusSelector.tsx`, pills single-select 5/10/20/50 km, patrón `BedroomsSelector`). 🔒 **Invariante A1: `radius_m` NUNCA pasa por `build_filter_query`** — es SOLO parámetro de la RPC `properties_within_radius` (candados de regresión EC-26/EC-F14/EC-M13). Filtros persistidos pre-#42 hidratan con merge `{...EMPTY_FILTERS, ...parsed}`. Base para **#56** (buscar en esta zona). Ver [[mapa-y-ubicacion]].
- Decisión de alcance: se implementaron recámaras + los 3 toggles (antes "diferidos"), a pedido del usuario; las columnas ya existían en `0005` (con índices parciales para los booleanos).

## Diferido (PRD completo)
Baños, m², amueblado, búsqueda fuzzy por texto libre (pg_trgm sobre `zone`/`address`), sliders de precio, autocomplete server-side.

## Reglas / gotchas
- 🔒 Lineamiento: **no `ILIKE '%texto%'` sin índice**; `properties.zone` NO tiene índice → la zona se resuelve por lista distinta + filtrado client-side (ver arriba), no por ILIKE.
- Filtrar siempre sobre `status='active'` + `deleted_at IS NULL` (ya en las queries base del feed/mapa; el builder de filtros no lo reaplica).
- Paginación del feed (#42): **offset sobre los ids de la RPC de proximidad** (ya NO cursor `created_at`); el `nextCursor` se calcula sobre los ids → filtros post-slice pueden dar páginas cortas (aceptado en demo, `// ponytail:`).

## Detalle exhaustivo
- `docs/PRD.md` §9-12 (filtros completos) · migración `0005` (columnas de `properties`) · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[mapa-y-ubicacion]] · [[propiedades-y-video]]
