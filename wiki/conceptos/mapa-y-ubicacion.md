---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §9, docs/PRD-MVP-demo.md]
codigo: [mobile/src/features/map/, mobile/app/(protected)/(tabs)/map.tsx, mobile/src/features/property-detail/utils/parseLocation.ts, supabase/migrations/0005_properties_and_videos.sql, supabase/migrations/20260706000001_properties_within_radius_rpc.sql]
actualizado: 2026-07-06
---

# Mapa y ubicación

> Dirección exacta SIEMPRE visible (decisión de cliente) + mapa interactivo con clustering.

## Cómo funciona
- `properties.location` = PostGIS `Point(4326)`; `address` exacto y público (diferenciador vs competencia, que muestra ubicación aproximada).
- **Mapa global** (tarea #11, pantalla canónica "6·MAPA"): tab "Mapa" → `MapScreen` con pines + **clustering**; tocar un pin → mini-card inferior → tocar la card → detalle (`/property/:id`).

## Código (vivo) — feature `mobile/src/features/map/` (tarea #11)
- **Ruta/tab**: `app/(protected)/(tabs)/map.tsx` (fina → `MapScreen`); tab añadido en `(tabs)/_layout.tsx`.
- **`MapScreen.tsx`**: `MapContent` (hooks) + `MapErrorBoundary` (clase, fallback si el módulo nativo no enlaza). `useMapProperties` → `region` (state, init GDL) → `cluster_properties(filtered, region)` (memo). Selección → `PropertyMiniCard` overlay; cluster tap → `animateToRegion` delta/2.
- **`hooks/useMapProperties.ts`** + **`lib/mapProperties.ts`**: query `properties` active+deleted_at null (select id/price/address/property_type/operation_type/bedrooms/bathrooms/**location**, sin paginar) → convierte `location` con `parse_location` (reusado de property-detail) → **fail-closed**: omite filas con location null/no-parseable. (TDD, 10 tests.)
- **`lib/clusterMarkers.ts`** → `cluster_properties()`: clustering **custom puro, sin dependencia** (decisión grilling). Grid absoluto (0,0): `cellSize = delta/divisions(8)`; 1→point, >1→cluster (id `cluster_<x>_<y>`, centroide media). Guard `delta<=0`. (TDD, 14 tests.)
- **Marcadores** (`components/`): `PropertyMarker` (teardrop + isotipo play + price tag compacto; **rent=salvia/sale|both=arcilla**), `ClusterMarker` (círculo `ink` + count, tono distinto), `PropertyMiniCard` y `MapSearchBar` con **liquid glass** (BlurView) + neomorfismo. `lib/formatPrice.ts` (`format_compact_price`/`format_full_price`).
- **Búsqueda**: filtro **cliente** sobre props cargadas (address/property_type), sin geocoding (decisión grilling). Perf: cadena memoizada `data/query→filtered→clustered`, `tracksViewChanges={false}`.

## Cercanía por radio — backend (tarea #40, vivo · Fase A del épico 40→41→42)
- **RPC PostGIS `properties_within_radius(p_lat, p_lng, p_radius_m float8)`** (`supabase/migrations/20260706000001_...`, **desplegado a urbea-app**): devuelve SOLO `{id, distance_m}` de propiedades `active`+`deleted_at null` dentro del radio (metros), ordenadas por distancia asc. Enfoque **A1 "flaco"** (exploración 027): el RPC solo resuelve la geografía; el feed/mapa (Fase C, #42) traen el resto de columnas con su builder PostgREST + `build_filter_query` **intacto** y re-ordenan por el mapa `id→distance_m`. Cero duplicación de `FilterState` en SQL.
- `SECURITY DEFINER` + `search_path=public,extensions` (PostGIS vive en `extensions`, patrón `publish_property_atomic`); `ST_*` schema-qualificado. Filtra `status='active' AND deleted_at IS NULL` DENTRO del SQL (2ª capa, no expone pausadas/borradas aunque bypasee RLS). Reusa el GiST `properties_location_gix` (0005) — sin índice nuevo. `revoke execute from public,anon` + grant a `authenticated` (defense-in-depth, advisor 0028: sin caso de uso anónimo, todo detrás del auth wall). pgTAP `09` (8 asserts, guardian PASS).
- ⏳ **Pendiente (Fase B #41 + Fase C #42):** `expo-location` + muro de permiso + `useLocation` + feed/mapa por distancia (paginación rediseñada, cursor por distancia) + centrado del mapa en ubicación real + radio en `FilterSheet` (default 5km, expansión progresiva ante 0 resultados). Ver exploración `027-ubicacion-obligatoria-feed-mapa-cercania.md`.

## Reglas / gotchas (técnico)
- ⚠️ `react-native-maps` con **Google Maps nativo** → requiere **development build** (`expo-dev-client`), **no** Expo Go. Esta es la razón principal del dev build ([[0005-demo-cerrada-3-semanas]]). `GOOGLE_MAPS_API_KEY` ya en `app.config.js` (iOS+Android).
- ⚠️ **PostgREST devuelve `geography` como EWKB hex** por defecto (no WKT) — `parse_location` acepta ambos; **orden lng=X/lat=Y** (invertirlos = marker en lugar equivocado).
- **Centrado por defecto en Guadalajara, SIN `expo-location`** (decisión grilling #11) → "centrar en mi ubicación" = trabajo futuro. `GDL_REGION` en `lib/constants.ts`... (en `features/map/constants.ts`).
- Clustering 100% cliente, sin lib (supercluster/react-native-map-clustering descartados por ponytail).
- Mini-card flotante (NO `Callout` nativo de react-native-maps, que tiene bug `onCalloutPress` en Android).
- DEUDA: `cluster_properties` no atrapa `delta=NaN` (NaN<=0 es false); endurecer a `!(delta>0)` si el viewport llegara a emitirlo. Filtros avanzados (sliders) e isotipo SVG real (falta `react-native-svg`) = futuro.

## Detalle exhaustivo
- `docs/PRD.md` §9 (mapa, radio, dirección exacta) · migración `0005` (`properties.location`) · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[propiedades-y-video]] · [[busqueda-y-filtros]]
