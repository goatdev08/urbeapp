---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §9, docs/PRD-MVP-demo.md]
codigo: [mobile/src/features/map/, mobile/src/features/map/lib/viewportToArea.ts, mobile/src/features/map/components/AreaSearchPill.tsx, mobile/src/features/search/components/ZoneActiveChip.tsx, mobile/src/features/location/, mobile/app/(protected)/_layout.tsx, mobile/app/(protected)/(tabs)/map.tsx, mobile/src/features/property-detail/utils/parseLocation.ts, supabase/migrations/0005_properties_and_videos.sql, supabase/migrations/20260706000001_properties_within_radius_rpc.sql]
actualizado: 2026-07-11
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
- **Marcadores** (`components/`): `PropertyMarker` (pin canónico `MapPinIcon` — Phosphor `MapPin` fill vía `react-native-svg`, solo el icono, sin price tag ni isotipo desde el flash 2026-07-06; **rent=salvia/sale|both=arcilla**), `ClusterMarker` (círculo `ink` + count, tono distinto), `PropertyMiniCard` y `MapSearchBar` con **liquid glass** (BlurView) + neomorfismo. `lib/formatPrice.ts` (`format_compact_price`/`format_full_price`).
- **Búsqueda**: filtro **cliente** sobre props cargadas (address/property_type), sin geocoding (decisión grilling). Perf: cadena memoizada `data/query→filtered→clustered`; `tracksViewChanges` arranca en `true` y se congela a `false` ~300ms tras el mount (#64, ver abajo) — ya NO fijo en `false` desde el primer render.

## Cercanía por radio — backend (tarea #40, vivo · Fase A del épico 40→41→42)
- **RPC PostGIS `properties_within_radius(p_lat, p_lng, p_radius_m float8)`** (`supabase/migrations/20260706000001_...`, **desplegado a urbea-app**): devuelve SOLO `{id, distance_m}` de propiedades `active`+`deleted_at null` dentro del radio (metros), ordenadas por distancia asc. Enfoque **A1 "flaco"** (exploración 027): el RPC solo resuelve la geografía; el feed/mapa (Fase C, #42) traen el resto de columnas con su builder PostgREST + `build_filter_query` **intacto** y re-ordenan por el mapa `id→distance_m`. Cero duplicación de `FilterState` en SQL.
- `SECURITY DEFINER` + `search_path=public,extensions` (PostGIS vive en `extensions`, patrón `publish_property_atomic`); `ST_*` schema-qualificado. Filtra `status='active' AND deleted_at IS NULL` DENTRO del SQL (2ª capa, no expone pausadas/borradas aunque bypasee RLS). Reusa el GiST `properties_location_gix` (0005) — sin índice nuevo. `revoke execute from public,anon` + grant a `authenticated` (defense-in-depth, advisor 0028: sin caso de uso anónimo, todo detrás del auth wall). pgTAP `09` (8 asserts, guardian PASS).
## Permiso + ubicación cliente — Fase B (tarea #41, vivo · muro bloqueante)
- **Módulo puro `mobile/src/features/location/lib/permissionDecision.ts`** — `decide_permission_action({granted, canAskAgain})` → `'granted' | 'request' | 'open_settings'` (CRÍTICO TDD, 4 EC). El muro/provider solo despachan la acción.
- **`LocationProvider.tsx` + `useLocation()`** (patrón `AuthContext`/`filterStore`): `{ status: 'loading'|'permission_denied'|'gps_off'|'granted', coords, request, refresh }`. `Accuracy.Balanced`, coord **cacheada por sesión**. Los **3 estados** en mount: `getForegroundPermissionsAsync` → si !granted `permission_denied`; si granted → `hasServicesEnabledAsync()` false=`gps_off`, true→`getCurrentPositionAsync`=`granted`. ⚠️ **`getCurrentPositionAsync` puede LANZAR** ("Current location is unavailable" en emulador sin fix / arranque en frío) → try/catch → `gps_off` (no crashear). **Listener `AppState 'active'` → `refresh()`**: al volver de Ajustes (concedió permiso / encendió GPS), el muro se actualiza solo sin re-pedir permiso.
- **`LocationWall.tsx`** — muro bloqueante full-screen **funcional** (tokens `theme.ts` + `PrimaryButton`, NO dispara gate branding #19). 2 variantes: `permission_denied` ("Activar ubicación" → `request()` o `Linking.openSettings()` según `canAskAgain`) y `gps_off` ("Ir a Ajustes"). 
- **Gate en `mobile/app/(protected)/_layout.tsx`**: `LocationProvider` dentro de `FilterProvider` (montado 1 vez para todo el grupo → caché de sesión). `ProtectedLayoutWithLocation` consume `useLocation` y renderiza `LocationWall` (por status) o el contenido. Orden: **auth gate → location gate → contenido**. Uniforme para TODOS los roles. Config nativa: `expo-location@56.0.19` + plugin en `app.config.js` (permiso ES iOS/Android) → requiere **nuevo dev build**.
- **E2E:** el gate rompería las 6 flows Maestro; `helpers/launch.yaml` concede `permissions.location: allow` + `setLocation` GDL → **6/6 verde**. Validado en device (los 3 muros + feed, screenshots).
## Cercanía en feed/mapa — Fase C (tarea #42, vivo · cierra el épico 40→41→42)
- **Patrón A1 en cliente** (`feed/lib/feedProperties.ts` y `map/lib/mapProperties.ts`, ambos CRÍTICA TDD + guardian PASS): RPC `properties_within_radius` con coords por **DI `deps.coords`** (producción las inyectan `useFeedProperties`/`useMapProperties` desde `useLocation()`, con refetch al llegar coords) y `p_radius_m = filters.radius_m` → `{id, distance_m}[]` → PostgREST `.in('id', ids)` + `build_filter_query` **INTACTO** (radius_m JAMÁS entra al builder — candados EC-26/EC-F14/EC-M13). Sin coords aún (el gate deja pasar `loading`) → fallback centro `GDL_REGION` `// ponytail:`.
- **Expansión de radio**: RPC vacía → radio ×2, máx 3 reintentos (5000→10000→20000→40000); agotada → vacío **sin tocar PostgREST**; error de RPC → throw sin reintentar. Loop duplicado feed/mapa a propósito (`// ponytail:` techo: 3er consumidor → extraer a `features/proximity/lib/radiusExpansion.ts`).
- **Feed**: paginación REDISEÑADA de cursor `created_at` a **offset sobre los ids de la RPC** (cursor = offset string; `ids.slice(offset, offset+10)` → `.in`; `nextCursor = offset+10` si quedan ids — se calcula sobre los ids, no las filas → filtros post-slice pueden dar **páginas cortas**, aceptado en demo). Re-sort cliente por `distance_map` tras el merge de video. **Mapa**: todos los ids, sin paginar ni re-ordenar (markers no tienen orden).
- **Radio en FilterSheet**: `radius_m` en `FilterState`/`EMPTY_FILTERS` (default 5000) + `RadiusSelector.tsx` (pills single-select 5/10/20/50 km, patrón `BedroomsSelector`); filtros persistidos viejos hidratan con merge `{...EMPTY_FILTERS, ...parsed}` en `filterStorage`.
- **Centrado (42.4)**: MapScreen ya montaba con coords o GDL (#20); ahora un `useEffect` + `coords_used_ref` hace `animateToRegion` **una sola vez** cuando las coords llegan post-mount (no pelea con el pan del usuario). ⚠️ **Punto azul (`showsUserLocation`) SE MANTIENE** aunque la exploración 027 decía "sin marcador tú-estás-aquí" — decisión: preguntar al cliente en la próxima demo.
- Suite mobile 563/563 · exploración `027-ubicacion-obligatoria-feed-mapa-cercania.md`. Habilita **#56** (buscar en esta zona), que reusa `radius_m` + el loop de expansión.
- **"Buscar en esta zona" (#56, vivo)** — patrón mapa→feed estilo Airbnb (exploración `030-buscar-en-esta-zona.md`, G1 = reusar el RPC de radio, **sin migración nueva**):
  - **`lib/viewportToArea.ts` (CRÍTICA TDD, 7 tests, guardian PASS)**: `viewport_to_area(region) → {center:{lat,lng}, radius_m}` — Haversine a mano (R=6.371e6, sin deps), radio = **mitad de la diagonal** del viewport (círculo sobre-incluye esquinas pero cubre todo lo visible — trade-off aceptado, regla no obvia #6), clamp `[MIN_RADIUS_M=100, MAX_RADIUS_M=50_000]`. Función pura.
  - **Modo zona en `lib/mapProperties.ts` + `feed/lib/feedProperties.ts` (CRÍTICA TDD, EC-Z1..Z7 / EC-ZM1..ZM5, guardian PASS)**: rama `filters.area != null` **aditiva** (evaluada ANTES del check `radius_m===null` en el mapa) que overridea el centro/radio de la RPC con los de la zona, **sin expansión**; zona gana sobre `radius_m`. Con `area==null` las ramas #42/#58/#62 quedan bit-idénticas (restricción del usuario: no-regresión, verificada algebraicamente — `is_unlimited = !has_zone && radius_m===null`).
  - **`MapScreen.tsx` (#56.4, ligera)**: `AreaSearchPill.tsx` (pill flotante bottom-center, aparece tras panear/zoomear con **debounce 500ms** en `onRegionChangeComplete`) → `viewport_to_area(region)` → `set_filter('area', …)` → `router.push('/')` (tab feed). Mini-spec §8 con tokens `theme.ts` (UI ausente del mockup canónico = trabajo nuevo).
  - **Chip + empty state (#56.5, ligera)**: `search/components/ZoneActiveChip.tsx` ("Zona activa · Quitar", prop `dark` para feed oscuro / mapa claro; `onPress`→`set_filter('area', null)` = vuelve a cercanía GPS #42) en feed **y** mapa; en `FeedScreen` el empty state de zona ("No hay publicaciones en esta zona" + "Limpiar zona") va como **PRIMERA** rama del bloque `is_empty` (porque `area` no cuenta en `active_filter_count` → si no, caería por error en "Publicar propiedad").
  - Suite mobile 624/624 · zona **efímera** (no persiste, ver [[busqueda-y-filtros]]).

## Fix: pin rojo default duplicado en Android (tarea #64, vivo)
- **Síntoma**: en Android, el pin temático (`PropertyMarker`/`ClusterMarker`) aparecía duplicado con el pin rojo default de Google Maps superpuesto.
- **Causa raíz**: `tracksViewChanges={false}` fijo desde el primer render del `<Marker>`. Android toma un *snapshot* nativo del contenido custom del marker para reemplazar su pin default — como el contenido es SVG (`MapPinIcon` → `phosphor-react-native` → `react-native-svg`), no pinta de forma síncrona en el primer frame; el snapshot se congela ANTES de que el SVG termine de pintar (`tracksViewChanges=false` nunca vuelve a tomar otro) y Google Maps deja su pin rojo de respaldo visible, duplicado con el pin temático.
- **Descartadas causas de datos** (revisadas por código, sin cambios): la RPC `properties_within_radius` es un `SELECT` puro sin joins (no puede duplicar ids) y `cluster_properties()` asigna cada propiedad a exactamente una celda del grid (sin duplicación posible).
- **Fix** (`PropertyMarker.tsx`/`ClusterMarker.tsx`, ambos `components/**` = no crítico por CLAUDE.md §5): `tracksViewChanges` arranca en `true` (deja que RN tome el snapshot real ya pintado) y se congela a `false` a los 300ms del mount vía `useState`+`useEffect`+`setTimeout` (`TRACKS_VIEW_CHANGES_FREEZE_MS`) — mismo patrón en ambos componentes, sin dependencias nuevas, 100% JS/OTA-safe. El perf win de congelar el snapshot se conserva; solo se retrasa ~300ms.
- Verificado en emulador (mount inicial, zoom-in con pins nuevos simultáneos, unmount/remount del tab): pines limpios en los 3 escenarios, 0 errores logcat.

## Reglas / gotchas (técnico)
- ⚠️ `react-native-maps` con **Google Maps nativo** → requiere **development build** (`expo-dev-client`), **no** Expo Go. Esta es la razón principal del dev build ([[0005-demo-cerrada-3-semanas]]). `GOOGLE_MAPS_API_KEY` ya en `app.config.js` (iOS+Android).
- ⚠️ **PostgREST devuelve `geography` como EWKB hex** por defecto (no WKT) — `parse_location` acepta ambos; **orden lng=X/lat=Y** (invertirlos = marker en lugar equivocado).
- **`GDL_REGION`** (`features/map/constants.ts`) = **fallback** mientras no hay coords; desde #42 el mapa usa `useLocation().coords` y se recentra al llegar. (La decisión grilling #11 "sin expo-location" quedó superada por el épico 40→42.)
- Clustering 100% cliente, sin lib (supercluster/react-native-map-clustering descartados por ponytail).
- Mini-card flotante (NO `Callout` nativo de react-native-maps, que tiene bug `onCalloutPress` en Android).
- DEUDA: `cluster_properties` no atrapa `delta=NaN` (NaN<=0 es false); endurecer a `!(delta>0)` si el viewport llegara a emitirlo. Filtros avanzados (sliders) e isotipo SVG real (falta `react-native-svg`) = futuro.

## Detalle exhaustivo
- `docs/PRD.md` §9 (mapa, radio, dirección exacta) · migración `0005` (`properties.location`) · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[propiedades-y-video]] · [[busqueda-y-filtros]]
