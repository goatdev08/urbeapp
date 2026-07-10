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
- **Radio de búsqueda (#42 → #58 → corregido en #62)**: `radius_m: number | null` en `FilterState` — **default `null` = "Sin límite"**. ⭐ Contrato #62 (feedback de producto sobre #58.3): null quita el **TOPE** de distancia pero la **carga contextual (orden por cercanía) SIEMPRE aplica en el feed** — con null el feed llama la RPC con `UNLIMITED_RADIUS_M` (21,000 km > media circunferencia → cubre el planeta, orden por distancia intacto, **sin** expansión ×2: vacío con radio infinito = no hay propiedades); numérico (0–50000) → path #42 intacto (expansión ×2 incluida). El **mapa** con null sí conserva la query plana (los pins no tienen orden; mismo conjunto). Candados: EC-NULL-RPC-1..7 (feed) / EC-MAP-NULL-1..3 (mapa). ⚠️ Gotcha vivo: `?? DEFAULT_RADIUS_M` trataba `null` como ausente — el chequeo `=== null` va ANTES; `undefined` (sin filtros) SÍ cae al default 5 km. UI (#58): `RadiusSelector.tsx` = **slider continuo custom con PanResponder** (core RN, sin deps nuevas, OTA-safe; descartados @react-native-community/slider [módulo nativo] y gesture-handler/reanimated [worklets no mockeables en jest]) + toggle "Sin límite" (`onChange(null)`; reactivar → 5 km), step 1 km, clamp 0–50, a11y `adjustable` + increment/decrement (el contrato testeable; el drag comparte el mismo helper clamp/step). Primera sección del FilterSheet. 🔒 **Invariante A1: `radius_m` NUNCA pasa por `build_filter_query`** — es SOLO parámetro de la RPC `properties_within_radius` o señal de saltarla (candados EC-26/EC-F14/EC-M13/EC-30). El badge (`get_active_filter_count`) NO cuenta `radius_m` (parámetro de alcance, no filtro de contenido, `// ponytail:`). Filtros persistidos (pre-#42 o pre-#58) hidratan con merge `{...EMPTY_FILTERS, ...parsed}` — probado sin cambio de código (EC-STORAGE-1..7; hueco string-persistido diferido por YAGNI). Base para **#56** (buscar en esta zona; usa campo `area` separado y jamás produce null). Ver [[mapa-y-ubicacion]].
- Decisión de alcance: se implementaron recámaras + los 3 toggles (antes "diferidos"), a pedido del usuario; las columnas ya existían en `0005` (con índices parciales para los booleanos).

## Diferido (PRD completo)
Baños, m², amueblado, búsqueda fuzzy por texto libre (pg_trgm sobre `zone`/`address`), sliders de precio, autocomplete server-side.

## Reglas / gotchas
- 🔒 Lineamiento: **no `ILIKE '%texto%'` sin índice**; `properties.zone` NO tiene índice → la zona se resuelve por lista distinta + filtrado client-side (ver arriba), no por ILIKE.
- Filtrar siempre sobre `status='active'` + `deleted_at IS NULL` (ya en las queries base del feed/mapa; el builder de filtros no lo reaplica).
- Paginación del feed (#42): **offset sobre los ids de la RPC de proximidad** (ya NO cursor `created_at`); el `nextCursor` se calcula sobre los ids → filtros post-slice pueden dar páginas cortas (aceptado en demo, `// ponytail:`). Aplica con TODO radio, incluido `radius_m=null` (#62 eliminó el path plano `.range()` del feed; el mapa no pagina).

## Detalle exhaustivo
- `docs/PRD.md` §9-12 (filtros completos) · migración `0005` (columnas de `properties`) · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[mapa-y-ubicacion]] · [[propiedades-y-video]]
