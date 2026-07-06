---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: L             # XS | S | M | L | XL — toca app + migración/RPC PostGIS + navegación + dependencia nativa nueva
fecha: 2026-07-04     # absoluta
estado: aprobado      # borrador → en-revision → aprobado | descartado
tarea_id: 40, 41, 42  # A=40 backend RPC · B=41 permiso/ubicación · C=42 integración (C dep. A,B)
motivo_descarte:      # se llena SOLO si estado: descartado
---

# Permiso de ubicación obligatorio (muro bloqueante) + feed y mapa por cercanía

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Retoma la deuda diferida del grilling #11 ("sin expo-location") ahora que el cliente lo pide como requisito.

## Idea original
Permiso de ubicación **OBLIGATORIO** con **muro bloqueante** de pantalla completa + feed y mapa ordenados por **CERCANÍA**. Requisitos confirmados por el cliente:
1. Al abrir la app se pide permiso de ubicación (foreground).
2. Bloqueante: si se niega, un muro de pared completa impide usar la app (sin `exit()`/crash; mismo UX iOS/Android). Botón "Activar ubicación" que dispara `requestForegroundPermissions()` si aún se puede preguntar, o `Linking.openSettings()` si `canAskAgain === false`.
3. Feed muestra propiedades **cercanas ordenadas por distancia** (hoy ordena por `created_at DESC` en `feedProperties.ts`).
4. Mapa se centra en la ubicación **real** del usuario (hoy `GDL_REGION` fijo).

Contexto técnico verificado (dado por hecho, ver mensaje de intake): `expo-location` NO instalado; `app.config.js` solo declara permisos de galería/cámara; backend YA tiene `location geography(Point,4326) not null` + índice GiST `properties_location_gix` (falta solo el RPC por radio); PostGIS activo; `parse_location`/`mapProperties` ya parsean geography → {lat,lng}; datos de la demo en Guadalajara.

## Lluvia de ideas
La idea llegó concreta en su *qué*, pero hubo dos ejes con ambigüedad arquitectónica real. **Ambos resueltos por el orquestador** (ver Decisiones del intake):

**Eje A — cómo integrar el RPC por radio con los filtros existentes (`build_filter_query`). → ELEGIDO: A1.**
Hoy `feedProperties.ts` y `mapProperties.ts` arman la query con el *builder* PostgREST (`.from().select().eq()...`) y le encadenan `build_filter_query` (TS puro). Ordenar por `ST_Distance` / filtrar por `ST_DWithin` **no es posible solo con PostgREST**: requiere un RPC. Pero un RPC "gordo" rompería el reuso de `build_filter_query`. Direcciones:
- **[ELEGIDO] A1 — RPC "flaco" que devuelve `id + distance_m` ordenado por distancia; el resto se resuelve con el builder actual.** El RPC (`properties_within_radius(lat,lng,radius_m)`) solo hace `ST_DWithin` + `ST_Distance` y devuelve `{id, distance_m}` ordenados; feed/mapa siguen usando `.from('properties').in('id', ids)` + `build_filter_query` **intacto** y re-ordenan/filtran en cliente por el set de ids+distancia. Trade-off: 2 round-trips y re-sort cliente, pero **cero duplicación** de la lógica de filtros y `filterQuery.ts` (27 tests) no se toca. Encaja con el principio "reusar > reescribir" y hace barato el "filtros Y cercanía".
- **A2 — RPC "gordo" que recibe todos los filtros como parámetros y los aplica en SQL.** *Descartado:* **duplica** `FilterState` en SQL (drift con `build_filter_query`), ~10 params y pgTAP por cada filtro. Más rápido en runtime, mucho más caro de mantener.
- **A3 — RPC recibe `filters jsonb` y los aplica en SQL con un helper genérico.** *Descartado:* mueve la verdad de los filtros a SQL igual que A2 y añade un parser jsonb→WHERE nuevo (más superficie crítica).

**Eje B — dónde vive el gate de permiso en el árbol de Expo Router. → ELEGIDO: B1.**
- **[ELEGIDO] B1 — gate DESPUÉS del auth gate**, dentro de `mobile/app/(protected)/_layout.tsx` (junto a `FilterProvider`). Login/registro/onboarding no exigen ubicación; el muro aparece ya autenticado, justo antes de feed/mapa que la consumen. **Todos los roles** (comprador, agente, admin) pasan el muro con regla uniforme.
- **B2 — gate en el layout raíz `app/_layout.tsx`**, por encima de todo. *Descartado:* bloquearía login/onboarding que no necesitan ubicación y complica el flujo de auth.

## Problema / Motivación
El cliente quiere que la propuesta de valor (propiedades **cerca de ti**) sea obligatoria: sin ubicación no hay experiencia. Retoma la deuda explícita del grilling #11 (documentada en `constants.ts` y `MapScreen.tsx`). Encaja con la demo cerrada de 3 semanas ([[0005-demo-cerrada-3-semanas]]): el backend geoespacial ya está sembrado, solo falta el RPC y el cableado de cliente + un nuevo dev build por el módulo nativo.

## Resultado esperado
Tres estados de ubicación bien distinguidos, con UX propia para cada uno:
- **Permiso concedido + GPS del SO activo (ubicación OK):** feed lista propiedades cercanas ordenadas por distancia (radio por defecto **5 km**, configurable en el panel de filtros); mapa abre centrado en la ubicación **real** del usuario (sin marcador "tú estás aquí").
- **Permiso NO concedido** (temporal o permanente): **muro bloqueante** de pantalla completa con botón "Activar ubicación" que reintenta `requestForegroundPermissionsAsync()` si `canAskAgain === true`, o abre Ajustes (`Linking.openSettings()`) si `canAskAgain === false`.
- **Permiso concedido pero GPS del SO apagado** (`Location.hasServicesEnabledAsync() === false`): aviso propio **"Activa la ubicación"**, distinto del muro de permiso, también **bloqueante** hasta que haya ubicación real.
- **Fallback radio vacío:** si el radio seleccionado (5 km por defecto o el elegido) trae **0 propiedades**, el radio se **expande progresivamente** hasta encontrar propiedades. El usuario nunca ve una pantalla vacía por estar fuera de GDL.
- **Filtros Y cercanía:** feed/mapa muestran propiedades que cumplen `FilterState` (#12.7) **Y** están dentro del radio, ordenadas por distancia.

## Alcance
- **SÍ entra:**
  - Instalar `expo-location`; declarar permisos iOS (`NSLocationWhenInUseUsageDescription`) + Android (`ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`) en `app.config.js` (patrón del plugin `expo-image-picker` ya presente).
  - Módulo puro de decisión de permiso (`permissionDecision.ts`: estado → acción request/open_settings/granted) — **CRÍTICO TDD**.
  - `LocationProvider`/`useLocation` compartido feed+mapa (patrón `filterStore`/`AuthContext`); precisión `Accuracy.Balanced`, coord **cacheada por sesión** (no re-pedir en cada apertura de pantalla).
  - **Muro bloqueante** de permiso (funcional, tokens del design system) + **aviso "Activa la ubicación"** para GPS del SO apagado (también bloqueante) + gate en `(protected)/_layout.tsx` (tras el auth gate, junto a `FilterProvider`).
  - Nuevo RPC PostGIS por radio (RPC "flaco" A1) + rollback + pgTAP — **CRÍTICO TDD**.
  - Feed ordenado por distancia (con **fallback de expansión progresiva del radio** ante 0 resultados) + centrado del mapa en ubicación real, reusando `parse_location`, `feedProperties`, `mapProperties`, `MapScreen`, `constants`.
  - **Control de radio como un filtro más** dentro de `FilterSheet` + `filterStore` (#12.7), default 5 km — cero UI flotante nueva.
- **NO entra (out of scope):**
  - Permiso de ubicación **background** (solo foreground).
  - Geocoding/búsqueda por dirección (sigue siendo filtro cliente por texto, decisión grilling #11).
  - Persistencia/tracking de la ubicación del usuario en DB (no se guarda `users.location`).
  - Marcador "tú estás aquí" en el mapa (el mapa solo se centra en la ubicación real).
  - Muro como pantalla de firma ilustrada — es acabado **funcional** con tokens existentes (NO dispara gate #19).

**Regla uniforme decidida: todos los roles pasan el muro, sin lógica condicional por rol.**
- **Comprador (buscador):** impacto directo — el muro y el feed/mapa por cercanía son su experiencia.
- **Inmobiliaria + agente:** también pasan por el muro (mismo árbol `(protected)`). El CRM/publish no dependen de ubicación pero quedan detrás del gate — decisión deliberada de mantener una regla única (más simple, sin ramas por rol).
- **Admin:** también pasa el muro. Regla uniforme confirmada por el usuario (sin excepción por rol).

## Impacto en datos
- **Nuevo RPC "flaco" (A1)** `public.properties_within_radius(p_lat, p_lng, p_radius_m)` que devuelve **solo `{ id, distance_m }` ordenado por distancia ascendente** (no la fila completa — el resto lo resuelve el builder PostgREST del cliente con `build_filter_query` intacto). Usa `ST_DWithin(location, ST_Point(p_lng,p_lat,4326)::geography, p_radius_m)` + `ST_Distance` para ordenar. Patrón de migración: **idempotente** (`create or replace`), `security definer` con `set search_path = public, extensions` (PostGIS vive en `extensions`, igual que `publish_property_atomic` en `20260625000001`), **rollback** en `supabase/migrations/rollbacks/`, **tests pgTAP** en `supabase/tests/`.
- 🔒 El RPC base **SIEMPRE** filtra `status = 'active'` **Y** `deleted_at IS NULL` dentro del SQL — aunque sea `security definer`, no debe exponer propiedades pausadas/borradas (RLS como 2ª capa, patrón de filtros base).
- ⚠️ Orden lng=X / lat=Y en `ST_Point` (mismo gotcha que `parse_location`).
- Reusa el índice GiST existente `properties_location_gix` (ya creado en `0005`) — `ST_DWithin` lo aprovecha; **no** se crea índice nuevo.
- RLS: el RPC lee `properties` — respetar filtros base `status='active'` + `deleted_at IS NULL` dentro del SQL (2ª capa). Si es `security definer`, incluir explícitamente esos WHERE (no confiar solo en RLS del caller).
- Sin schema nuevo, sin enum, sin columna nueva.

- **Muro bloqueante de permiso** (nuevo componente de pantalla completa): acabado **FUNCIONAL con tokens del design system** — texto + `PrimaryButton` existente + colores/tipografía de `theme.ts`. **NO** es pantalla de firma ilustrada → **NO dispara el gate de branding #19** (confirmado con el cliente). `GATE_BRANDING: no`.
- **Aviso "Activa la ubicación"** (GPS del SO apagado): variante del muro con copy distinto ("activa el servicio de ubicación del sistema") — mismo acabado funcional, también bloqueante.
- **Feed:** sin cambio visual; cambia el orden de la lista (por distancia).
- **Mapa:** `initialRegion`/`region` pasan de `GDL_REGION` fijo a la ubicación real. **Sin marcador "tú estás aquí"** (decisión del usuario) — el mapa solo se centra.
- **Radio en filtros:** un control más dentro del `FilterSheet` existente (no UI flotante). Reusa la estética del sheet de filtros (#12.7).
- Estados de carga mientras se resuelve el permiso/ubicación (no dejar feed/mapa en blanco).

## Reglas no obvias aplicables
- **RPC PostGIS `security definer` + `search_path = public, extensions`** — PostGIS vive en `extensions`; calificar `ST_*` o incluirlo en el search_path (patrón `publish_property_atomic`, `20260625000001`) · [[propiedades-y-video]] · [[mapa-y-ubicacion]] línea 27-28.
- **PostgREST devuelve geography como EWKB hex, orden lng=X/lat=Y** — invertir = bug silencioso · `parse_location` · [[mapa-y-ubicacion]] gotcha línea 28.
- **Filtros de usuario ADEMÁS de los base, nunca en su lugar** — `build_filter_query` se aplica sobre `status='active'`+`deleted_at IS NULL`; el RPC no debe saltarse esos base · [[busqueda-y-filtros]] · `filterQuery.ts` header.
- **Migraciones idempotentes + rollback + pgTAP** — CLAUDE.md §3, `docs/lineamientos-desarrollo.md` · [[rls-seguridad]].
- **react-native-maps + expo-location = módulos nativos → nuevo development build** (no Expo Go) · [[mapa-y-ubicacion]] línea 27 · CLAUDE.md §3.
- **PNPM siempre** para `pnpm add expo-location` (nunca npm/yarn) · CLAUDE.md §3.
- **Criticidad TDD determinista por path** — `supabase/migrations/**` y `mobile/**/lib/**`/`hooks/**`/`utils/**` = CRÍTICO; pantallas/wiring = ligero · CLAUDE.md §5.

## Arquitectura / enfoque técnico
Capas y reuso (rutas reales del `mapa-codebase`):
- **Permiso (lógica pura, CRÍTICO):** `mobile/src/features/location/lib/permissionDecision.ts (nuevo)` — función pura `decide_permission_action(status)` → `'request' | 'open_settings' | 'granted'` a partir de `{ granted, canAskAgain }`. Testeable sin el módulo nativo (DI/inputs planos). El componente del muro solo despacha la acción.
- **Ubicación compartida (Context, patrón existente):** `mobile/src/features/location/LocationProvider.tsx (nuevo)` + `useLocation()` — expone `{ status, coords, request, refresh }`. Copia el patrón de `filterStore.tsx`/`AuthContext` (context + guard + `useReducer`/`useState`). **Una sola fuente** de la coord del usuario para feed y mapa. Precisión `Location.Accuracy.Balanced`; coord **cacheada por sesión** (no re-pedir en cada apertura de pantalla; `refresh` explícito). Distingue los **tres estados**: permiso no concedido / permiso concedido + `hasServicesEnabledAsync()===false` (GPS off) / ubicación OK. Feed y mapa lo consumen igual que ambos consumen `useFilters`. Se monta junto a `FilterProvider` en `(protected)/_layout.tsx` (Eje B1).
- **Muro (pantalla, ligero):** `mobile/src/features/location/LocationWall.tsx (nuevo)` — full-screen **funcional con tokens de `theme.ts`**, `PrimaryButton` existente, despacha `decide_permission_action` (→ `Location.requestForegroundPermissionsAsync()` o `Linking.openSettings()`). Variante/estado "GPS off" con copy "Activa la ubicación" (también bloqueante).
- **Gate de navegación (ligero):** editar `mobile/app/(protected)/_layout.tsx` para renderizar `<LocationWall/>` (o su variante GPS off) en lugar del `Slot` cuando no hay ubicación real, tras el auth gate. **Uniforme para todos los roles** (sin ramas por rol).
- **RPC (SQL, CRÍTICO):** `supabase/migrations/<ts>_properties_within_radius_rpc.sql (nuevo)` + rollback + `supabase/tests/<n>_properties_within_radius_test.sql (nuevo, pgTAP)`.
- **Data layer feed (CRÍTICO):** editar `mobile/src/features/feed/lib/feedProperties.ts` — A1: `.rpc('properties_within_radius', {p_lat, p_lng, p_radius_m})` → `{id, distance_m}[]` ordenado; luego `.from('properties').in('id', ids)` + `build_filter_query` **intacto**, re-ordenar en cliente por el mapa `id→distance_m`. Si el resultado (tras filtros Y radio) es 0, **expandir el radio progresivamente** y reintentar el RPC hasta encontrar propiedades. ⚠️ La **paginación por cursor `created_at`** es **incompatible** con orden por distancia → hay que **rediseñar la paginación** (paginar por distancia o por offset sobre el set de ids). Riesgo principal (ver riesgos + plan de pruebas).
- **Data layer mapa (CRÍTICO):** `mobile/src/features/map/lib/mapProperties.ts` — el mapa no pagina; consume el mismo RPC por radio para el set de ids+distancia y aplica `build_filter_query`, cambiando además el **centrado**.
- **Centrado mapa (ligero):** `mobile/src/features/map/MapScreen.tsx` + `constants.ts` — `initialRegion` desde `useLocation().coords` con `GDL_REGION` como **fallback** cuando aún no hay coords. **Sin marcador "tú estás aquí"** (solo centrado).
- **Radio en filtros (ligero, wiring):** `mobile/src/features/search/filterStore.tsx` + el `FilterSheet` (#12.7) — añadir `radius_m` a `FilterState` (default 5000 m) como un control más del sheet. El feed/mapa leen el radio desde `useFilters()` y lo pasan al RPC. ⚠️ `radius_m` NO viaja por `build_filter_query` (ese sigue siendo solo filtros PostgREST) — va directo como parámetro del RPC.
- **Config nativa (ligero):** `mobile/app.config.js` — plugin `expo-location` + strings de permiso ES iOS (`NSLocationWhenInUseUsageDescription`) + Android.

Tres fases **separables** con dependencias explícitas, para que el orquestador decida si crea **1 tarea padre con 3 grupos de subtareas** o **3 tareas encadenadas**. Recomendación: 3 tareas (A→B→C) por la mezcla de criticidad y el corte natural backend/cliente/integración.

### Fase A — Backend (CRÍTICO TDD)
Migración RPC por radio `properties_within_radius(p_lat, p_lng, p_radius_m)` con `ST_DWithin`/`ST_Distance`, **idempotente + rollback + pgTAP**. Reusa el patrón `security definer` de `publish_property_atomic` (`20260625000001`) y el índice GiST `properties_location_gix` (0005). Devuelve `{id, distance_m}` ordenado; filtra `status='active'`+`deleted_at IS NULL` en SQL.
- **Path → criticidad:** `supabase/migrations/**` + `supabase/tests/**` = **CRÍTICO** (RED→GREEN→guardian).
- **Dependencias:** ninguna (backend puro). Puede arrancar primero y en paralelo a B.

### Fase B — Cliente: permiso + ubicación (mixto)
Instalar `expo-location` (PNPM) + permisos en `app.config.js`; `LocationProvider`/`useLocation` (Accuracy.Balanced, cacheado por sesión, tres estados); `permissionDecision.ts` (lib pura); `LocationWall` + aviso GPS off (funcional, tokens); gate en `(protected)/_layout.tsx`. Requiere **nuevo dev build** (módulo nativo).
- **Path → criticidad:** `mobile/src/features/location/lib/permissionDecision.ts` = **CRÍTICO** (TDD). `LocationProvider`, `LocationWall`, gate, `app.config.js` = **ligero** (tsc + lint + smoke).
- **Dependencias:** ninguna sobre A en lógica pura (permiso/ubicación no necesitan el RPC). Puede ir en paralelo a A.

### Fase C — Integración: cercanía en feed/mapa + radio en filtros (mixto)
Feed por distancia (`feedProperties.ts`) con **paginación rediseñada** (cursor por distancia/offset) + fallback de expansión progresiva del radio; mapa por radio + centrado (`mapProperties.ts`, `MapScreen`, `constants`); `radius_m` en `filterStore`/`FilterSheet` (default 5 km).
- **Path → criticidad:** `mobile/src/features/feed/lib/feedProperties.ts` y `mobile/src/features/map/lib/mapProperties.ts` = **CRÍTICO** (lib; extender/rediseñar los tests existentes). `MapScreen`, `constants`, `filterStore`/`FilterSheet` wiring = **ligero**.
- **Dependencias:** requiere **A** (el RPC) **y B** (`useLocation` para la coord). Va al final.

El desglose fino en subtareas lo hace `task-master expand` / `/tm-plan` al promover.

### Permiso y estados (Fase B)
- [ ] Al entrar a `(protected)` sin permiso concedido, aparece el muro bloqueante de pantalla completa (no crash, no `exit()`), con acabado funcional de `theme.ts`, idéntico en iOS y Android, para **todos los roles** (comprador, agente, admin).
- [ ] Botón "Activar ubicación" dispara `requestForegroundPermissionsAsync()` si `canAskAgain === true`; abre Ajustes (`Linking.openSettings()`) si `canAskAgain === false`.
- [ ] Con permiso concedido pero `hasServicesEnabledAsync() === false`, aparece el aviso **"Activa la ubicación"** (distinto del muro de permiso), también bloqueante hasta que haya ubicación real.
- [ ] `useLocation` no re-pide ubicación en cada apertura de pantalla (coord cacheada por sesión; `Accuracy.Balanced`).
- [ ] `permissionDecision.ts` cubierto por tests unitarios: `granted` → `granted`; `{granted:false, canAskAgain:true}` → `request`; `{granted:false, canAskAgain:false}` → `open_settings` (fase RED del ciclo crítico).

### Backend / cercanía (Fase A)
- [ ] RPC `properties_within_radius` con pgTAP: incluye puntos dentro del radio, excluye los de fuera, devuelve `distance_m` ordenado ascendente, respeta `status='active'`+`deleted_at IS NULL` (no expone pausadas/borradas), orden de coord `lng=X/lat=Y` correcto.
- [ ] La migración es idempotente (aplicar 2× no falla) y tiene rollback verificado.

### Integración feed/mapa/filtros (Fase C)
- [ ] Con ubicación OK, el feed devuelve propiedades dentro del radio ordenadas por distancia ascendente.
- [ ] Los filtros de usuario (`FilterState`, #12.7) **Y** la cercanía se combinan: el feed/mapa muestran solo propiedades que cumplen ambos, sin drift con `build_filter_query` (que queda intacto — A1).
- [ ] Si el radio seleccionado (5 km default o el elegido) trae 0 propiedades tras filtros, el radio se **expande progresivamente** hasta encontrar propiedades; el usuario nunca ve pantalla vacía por estar fuera de GDL.
- [ ] El control de radio vive dentro del `FilterSheet` existente (default 5 km), no como UI flotante nueva; cambiarlo re-consulta feed/mapa.
- [ ] El mapa abre centrado en la ubicación real del usuario (no `GDL_REGION`) cuando hay coords, **sin** marcador "tú estás aquí"; `GDL_REGION` solo como fallback mientras no hay coord.
- [ ] La paginación del feed funciona con orden por distancia (no regresión): los tests de `feedProperties` (paginación/cursor) pasan tras el rediseño.

## Dependencias
- Migración `0005` (`properties.location` + `properties_location_gix`) — ya existe, se reusa.
- Patrón RPC `security definer` de `20260625000001_publish_property_rpc.sql`.
- Código a reusar: `parse_location` (`property-detail/utils/parseLocation.ts`), `build_filter_query`/`EMPTY_FILTERS` (`search/lib/filterQuery.ts`), patrón `FilterProvider` (`search/filterStore.tsx`), `PrimaryButton` (`src/components/`), `GDL_REGION` (`map/constants.ts`).
- Nueva dependencia: `expo-location` (versión compatible con Expo SDK 56 — verificar en `https://docs.expo.dev/versions/v56.0.0/`).
- Nuevo development build antes de probar en device (módulo nativo).

## Edge cases / riesgos
- **⭐ RIESGO CLAVE — la paginación por cursor `created_at` es incompatible con el orden por distancia.** Hoy `feedProperties.ts` pagina con `.lt('created_at', cursor)` y `nextCursor = created_at` del último item. Con orden por distancia el cursor debe ser la distancia (o un offset sobre el set de ids del RPC). Hay que **rediseñar la paginación** y ajustar/reescribir los tests que asumen el cursor `created_at` (ver lista en Plan de pruebas). Es la mayor fuente de regresión de toda la feature.
- **Fuente única de ids + doble round-trip (A1):** RPC devuelve ids+distancia → builder trae las filas → re-sort cliente. Latencia extra; mitigable con tope de ids. Con **fallback de expansión de radio**, cada expansión es un round-trip más al RPC (acotar nº de expansiones y radio máximo).
- **Fallback radio vacío bien ordenado:** al expandir el radio, seguir ordenando por distancia real (no por el radio); parar en la primera expansión con resultados (tras aplicar filtros de usuario, no solo el radio).
- **Servicio de ubicación del SO apagado** (distinto de permiso negado): `hasServicesEnabledAsync()===false` → aviso propio bloqueante; `getCurrentPositionAsync` podría lanzar/colgar si no se distingue antes. Los **tres estados** deben quedar cubiertos en `permissionDecision`/`LocationProvider`.
- **`security definer` sin filtros base:** si el RPC no incluye `status='active'`/`deleted_at IS NULL`, expondría propiedades pausadas/borradas saltándose la RLS. Debe filtrarlas en SQL (cubierto por pgTAP).
- **Orden lng/lat en `ST_Point`:** invertir = bug silencioso (mismo gotcha que `parse_location`). Test pgTAP con puntos a distancias conocidas.
- **`radius_m` fuera de `build_filter_query`:** el radio NO debe colarse al builder PostgREST (rompería A1); va solo como parámetro del RPC. Cuidado al añadirlo a `FilterState`.
- **Nuevo dev build:** `expo-location` es módulo nativo → cualquier probador reinstala el build; coordinar con la demo.
- **Gate uniforme para todos los roles:** decisión tomada (sin excepción admin/agente); asumido como fricción aceptable a cambio de una regla única y simple.

- **CRÍTICO / TDD estricto (RED→GREEN→guardian):**
  - **`permissionDecision.ts`** (Fase B) — Jest, inputs planos: `granted → 'granted'`, `{granted:false, canAskAgain:true} → 'request'`, `{granted:false, canAskAgain:false} → 'open_settings'`. (Estado GPS off se modela en el Provider, no aquí, pero conviene un caso que lo represente.)
  - **RPC `properties_within_radius`** (Fase A) — **pgTAP**: incluye dentro del radio, excluye fuera, `distance_m` ordenado ascendente, honra `status='active'`+`deleted_at IS NULL`, orden lng/lat correcto, idempotencia + rollback.
  - **`feedProperties.ts` / `mapProperties.ts`** (Fase C) — extender/rediseñar los tests existentes (`lib/**`, siguen críticos).

  ⚠️ **Tests de feed en riesgo de regresión por el rediseño de paginación** (fuente: `mobile/src/features/feed/__tests__/`):
  - `feedProperties.test.ts` — **EC-5** (`cursor_aplica_filtro_lt_created_at`), **EC-6** (`sin_cursor_no_aplica_filtro_lt`), **EC-7** (`next_cursor_...ultimo_created_at`), **EC-8** (`next_cursor_menos_de_10_items_es_null`): asumen cursor=`created_at` → **hay que rediseñarlos a cursor por distancia/offset**.
  - `feedProperties.filters.test.ts` — **EC-F13** (`cursor_y_filtros_combinados`): asume `.lt("created_at", cursor)` junto a filtros → ajustar al nuevo cursor.
  - EC-1..EC-4, EC-9..EC-15 (happy path, signed_url merge, fail-closed, errores, reconciliación de video) **no dependen del cursor** pero pasan a consumir el set de ids del RPC → verificar que el mock del RPC no los rompa.
  - EC-F1..EC-F12 (integración de `FilterState` con `build_filter_query`) **deben seguir verdes sin cambios** — A1 mantiene `build_filter_query` intacto; son la prueba de "filtros Y cercanía sin drift".
  - **Nuevos tests a agregar (Fase C):** ids+distancia del RPC re-ordenan el feed por distancia; fallback de expansión de radio cuando el set filtrado es 0; `radius_m` no viaja por `build_filter_query`.
- **Ligero (tsc + lint + smoke):** `LocationWall` + aviso GPS off, `LocationProvider` wiring, gate en `(protected)/_layout.tsx`, `MapScreen` centrado, `constants`, `filterStore`/`FilterSheet` (control de radio), `app.config.js`.
- **Datos de prueba:** propiedades sembradas en GDL ya existen; para pgTAP, insertar puntos a distancias conocidas del centro y aserciones sobre inclusión/orden/distancia.

## Impacto en PRD (solo referencia — NO se edita)
`docs/PRD.md` §9 (mapa, **radio**, dirección exacta) ya contempla búsqueda por radio — esta exploración la implementa. `docs/PRD-MVP-demo.md`: el muro bloqueante de permiso es UX nueva no descrita explícitamente; una eventual actualización del PRD la anotaría (decisión del dueño, fuera de esta exploración).

Requisitos 1-4 confirmados por el cliente en conversación (foreground, muro bloqueante sin crash, feed+mapa por cercanía, mismo UX iOS/Android). Contexto técnico dado por hecho (expo-location ausente, backend geo listo, datos en GDL). **Todas las preguntas abiertas resueltas por el orquestador (2026-07-04):**

**Decisiones de producto (usuario):**
1. **Radio → configurable, default 5 km**, controlado **dentro del `FilterSheet`** existente (+ `filterStore`, #12.7) como un filtro más. Cero UI flotante nueva (reusar > reescribir).
2. **Fallback 0 resultados → ampliar el radio automáticamente y de forma progresiva** hasta encontrar propiedades. El usuario nunca ve pantalla vacía por estar fuera de GDL.
3. **Muro → acabado FUNCIONAL con tokens del design system** (texto + `PrimaryButton` + colores/tipografía de `theme.ts`). NO pantalla de firma ilustrada → **NO dispara el gate de branding #19** (confirmado con el cliente).
4. **Alcance del gate → todos los roles** (comprador, agente, admin) pasan el muro. Regla uniforme, sin lógica condicional por rol.
5. **Posición del gate → DESPUÉS del login/registro**, antes de feed/mapa: vive en `mobile/app/(protected)/_layout.tsx` (tras el auth gate, junto a `FilterProvider`). Login/onboarding NO se bloquean. (Eje B → B1.)
6. **GPS del SO apagado (`servicesEnabled=false`) ≠ permiso negado:** aviso propio **"Activa la ubicación"** distinto del muro de permiso, también bloqueante hasta que haya ubicación real. Se distinguen **tres estados**: permiso no concedido / permiso concedido pero GPS apagado / ubicación OK.
7. **Filtros Y cercanía se combinan:** feed/mapa muestran propiedades que cumplen `FilterState` (#12.7) **Y** están dentro del radio, ordenadas por distancia.

**Decisiones técnicas (orquestador):**
- **Eje A → A1 (RPC "flaco").** El RPC devuelve solo `id + distance_m` ordenado por distancia; feed/mapa siguen usando su builder PostgREST con `build_filter_query` **intacto** y re-ordenan/filtran en cliente por el set de ids+distancia. Hace barato "filtros Y cercanía" sin duplicar `FilterState` en SQL (evita el drift del enfoque "gordo"). A2/A3 descartados.
- **RPC base SIEMPRE respeta `status='active'` + `deleted_at IS NULL`** (no exponer pausadas/borradas aunque sea `security definer` con `search_path=public,extensions`).
- **Ubicación compartida vía `LocationProvider`/`useLocation`** (mismo patrón que `filterStore` y `AuthContext`) — una sola fuente de la coord del usuario para feed y mapa.
- **Precisión `Accuracy.Balanced`, cacheada por sesión** (no re-pedir en cada apertura de pantalla).
- **Sin marcador "tú estás aquí"** por ahora (el mapa solo se centra en la ubicación real).

**LISTO PARA PROMOVER.** Todas las preguntas abiertas resueltas; sin gate de branding (muro funcional confirmado); criterios de aceptación verificables y sin huecos. `estado: en-revision`.

Recomendación de promoción: **3 tareas encadenadas** por el corte natural y la mezcla de criticidad —
- **Tarea A (backend, CRÍTICO):** RPC `properties_within_radius` + rollback + pgTAP. Sin dependencias.
- **Tarea B (cliente permiso/ubicación, mixto):** expo-location + `app.config.js` + `LocationProvider`/`useLocation` + `permissionDecision.ts` (CRÍTICO) + `LocationWall`/aviso GPS off + gate. Sin dependencia sobre A.
- **Tarea C (integración, mixto):** feed por distancia (paginación rediseñada) + fallback de radio + mapa centrado + radio en `FilterSheet`. **Depende de A y B.**

Alternativa: 1 tarea padre L con 3 grupos de subtareas (A/B/C) — decisión del orquestador. Comando siguiente sugerido: `/tm-plan <id>` (por cada tarea creada). El desglose fino lo hace `task-master expand`/`/tm-plan`.
