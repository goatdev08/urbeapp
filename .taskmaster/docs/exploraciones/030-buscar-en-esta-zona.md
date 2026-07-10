---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: L             # XS | S | M | L | XL — toca map + estado cross-screen + data layer del feed (+ posible RPC nuevo); depende de #42 (pendiente)
fecha: 2026-07-09     # absoluta
estado: aprobado      # borrador → en-revision → aprobado | descartado
tarea_id: 56          # se llena SOLO al promover
motivo_descarte:      # se llena SOLO si estado: descartado
---

# "Buscar en esta zona" (búsqueda por viewport del mapa → feed acotado)

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Relacionada con la exploración `027-ubicacion-obligatoria-feed-mapa-cercania.md` y la tarea **#42** (Fase C, pendiente).

## Idea original
"Buscar en esta zona" en el mapa de Urbea. Al pulsar **buscar en esta zona** (sobre el **viewport actual** del mapa), el feed debe mostrar **SOLO** los videos de propiedades dentro de esa zona. Si no hay videos en la zona, el feed debe mostrar un **empty state claro** ("no hay publicaciones en esta zona") y permitir **salir de ese modo / limpiar** la búsqueda.

## Lluvia de ideas (solo si la idea era abstracta)
La idea llegó concreta en su *qué*, pero tiene **dos ejes con ambigüedad arquitectónica real** que se devuelven como preguntas abiertas (ver más abajo). Direcciones consideradas para el eje geométrico:

**Eje Geometría — cómo se traduce "esta zona" (rectángulo del viewport) a una consulta geoespacial:**
- **[REC] G1 — Reusar el RPC de radio `properties_within_radius` (#40, ya desplegado).** El viewport es un rectángulo; se toma su **centro** y un **radio = mitad de la diagonal** (o el menor semilado, según se decida cobertura). Cero migración nueva, reusa el RPC y el índice GiST `properties_location_gix`. Trade-off: un círculo no calza exacto con el rectángulo visible (sobre-incluye esquinas o sub-incluye bordes según la fórmula). Para la demo es aceptable. Encaja con "reusar > reescribir" (CLAUDE.md §0).
- **G2 — Nuevo RPC por bounding-box `properties_within_bounds(min_lat,min_lng,max_lat,max_lng)`** con `ST_MakeEnvelope` + operador `&&` (bbox) / `ST_Contains`, mismo patrón A1 "flaco" (`{id, distance_m?}`). Fiel al rectángulo visible ("esta zona" = lo que veo). Trade-off: **nueva migración idempotente + rollback + pgTAP** (CRÍTICO TDD), más superficie. Aprovecha igual el GiST.
- **G3 — Filtrado por bounds 100% en cliente** sobre el set que ya trae `mapProperties.ts` (todas las props parseadas). Sin RPC nuevo; el feed reusaría los ids del viewport. Trade-off: el **feed** necesita traer video + signed_url por su propio camino (no basta el set del mapa); acopla feed↔mapa y no escala si el dataset crece. Descartable salvo que se quiera cero backend.

**Recomendación:** **G1** para la demo (reuso máximo, sin migración). Si el cliente exige precisión de "exactamente lo que veo en pantalla", subir a **G2**.

## Problema / Motivación
El mapa hoy es **navegable** (pan/zoom, clustering) pero **no acciona** sobre el feed: mirar una colonia en el mapa no acota lo que se ve en el feed vertical. "Buscar en esta zona" cierra ese lazo mapa→feed, un patrón esperado en apps inmobiliarias/mapas (Airbnb, Idealista). Encaja con la demo cerrada de 3 semanas ([[0005-demo-cerrada-3-semanas]]): el backend geoespacial (#40) y el `LocationProvider` (#41) ya están vivos; falta el gesto de "buscar aquí" y su acoplamiento al feed.

⚠️ **Depende de decisiones que aún no aterrizan en código:** la tarea **#42** (Fase C de la exp. 027, **pendiente**) es la que hace que `feedProperties.ts` consuma un RPC geoespacial + rediseña la paginación (de cursor `created_at` a orden por distancia). Esta idea se **apoya sobre esa misma plomería**; construirla antes de #42 duplicaría el rediseño de `feedProperties`.

## Resultado esperado
- Con el mapa abierto y desplazado a una zona, aparece un control **"Buscar en esta zona"** (sobre el viewport actual).
- Al pulsarlo, el **feed** pasa a mostrar **solo** propiedades (con video ready) dentro de esa zona.
- Si la zona **no tiene** publicaciones, el feed muestra un **empty state claro**: "No hay publicaciones en esta zona" + una acción para **limpiar/salir** del modo zona.
- Existe siempre una forma visible de **quitar el filtro de zona** y volver al feed por defecto (proximidad de #42 o `created_at`, según el estado del proyecto).

## Alcance
- **SÍ entra:**
  - Control **"Buscar en esta zona"** en `MapScreen` (pill/botón flotante) que captura el `region` actual (ya disponible en `set_region`/`onRegionChangeComplete`).
  - **Estado compartido cross-screen** (mapa → feed) de la zona seleccionada `{center, radius}` (o bounds).
  - Data layer del **feed** acotado a la zona (reusando el camino de #42: RPC → ids → `.in('id', ids)` + `build_filter_query` **intacto** + mint-video-url).
  - **Empty state** de "no hay publicaciones en esta zona" (reusa `EmptyState` de `profile/components/EmptyState`) con CTA de **limpiar zona**.
  - Affordance persistente para **salir del modo zona** (chip/banner "Zona: activa · Quitar").
  - **Filtrado también de los marcadores del mapa** (decisión 7): al aplicar zona, `mapProperties.ts`/`MapScreen` muestran solo pines dentro de la zona → amplía el footprint a `map/lib/mapProperties.ts` (**CRÍTICO**) + pantalla de mapa.
  - **Cambio automático al tab feed** al aplicar (decisión 6).
- **NO entra (out of scope):**
  - Dibujar polígonos a mano / radios arrastrables (solo el rectángulo del viewport).
  - Geocoding / buscar zona por nombre/dirección (sigue siendo el filtro cliente por texto del `MapSearchBar`).
  - Guardar zonas favoritas / **persistir** la zona entre sesiones (decisión 8: búsqueda **efímera**, al reabrir la app = modo normal).

## Roles afectados
- **Comprador (buscador):** impacto directo — es su gesto de descubrimiento ("qué hay por aquí").
- **Inmobiliaria + agente / Admin:** sin impacto funcional (feature de descubrimiento del lado buscador); pasan por el mismo `(protected)` pero no cambia su CRM/publish.

## Impacto en datos
**Decisión 1 → G1: sin cambios de datos.** Reusa el RPC `properties_within_radius` (#40) y el índice GiST `properties_location_gix` (0005). El único cálculo nuevo (centro del viewport + radio = diagonal/2) es **cliente**. No hay migración nueva, ni pgTAP nuevo de backend.

## Impacto en UI
- **`MapScreen.tsx`** — nuevo control flotante **pill "Buscar en esta zona"** (decisión 5: aparece tras panear/zoomear el mapa, patrón Airbnb; el `region` ya se rastrea con `onRegionChangeComplete`). Al pulsar: setea `area` y **cambia automáticamente al tab feed** (decisión 6). El mapa también se acota a la zona (decisión 7). ⚠️ **UI ausente del mockup canónico** (`urbea-identidad-visual.html` **no** contiene "buscar en esta zona" ni el empty state de zona — verificado): UI **nueva sobre el techo del mockup** (CLAUDE.md §8 "lo que falte = trabajo nuevo"). Se resuelve con **mini-spec de diseño escrita antes de implementar, usando tokens del `theme.ts`** (decisión 9) — control menor, gate global levantado → **sin** esperar visto bueno del cliente.
- **Feed (`FeedScreen.tsx`)** — nuevo **empty state** "No hay publicaciones en esta zona" (variante del `EmptyState` existente `message="Aún no hay propiedades"`), con CTA **limpiar zona** (no el CTA "publicar video" del empty actual). Banner/chip persistente "Zona activa · Quitar".
- Estados de carga al re-consultar feed **y mapa** por la zona (no dejar en blanco durante la transición).

## Reglas no obvias aplicables
- **Filtros de usuario ADEMÁS de los base (`status='active'`+`deleted_at IS NULL`), nunca en su lugar** — la consulta de zona no debe saltarse los base (el RPC #40 ya los filtra en SQL) · [[busqueda-y-filtros]] · `filterQuery.ts` header · [[rls-seguridad]].
- **`area`/parámetros de zona NO viajan por `build_filter_query`** (A1: el builder sigue siendo solo filtros PostgREST; la geografía va por el RPC) · exp. 027 L103/158.
- **`area` NO se persiste** (efímera, decisión 8) — excluirla de `save_filters`/`load_filters` de `filterStorage.ts` (que hoy persiste todo `FilterState`) · `search/lib/filterStorage.ts`.
- **Paginación por distancia ≠ cursor `created_at`** — `feedProperties.ts` hoy pagina con `.lt('created_at', cursor)` (L75-78); la búsqueda por zona hereda el **rediseño de paginación de #42** · exp. 027 L152.
- **PostgREST devuelve `geography` como EWKB hex, orden lng=X/lat=Y** — invertir = bug silencioso · `parse_location` · [[mapa-y-ubicacion]] gotcha L39.
- **react-native-maps = módulo nativo → dev build** (ya vigente) · [[mapa-y-ubicacion]] L38 · CLAUDE.md §3.
- **Criticidad TDD determinista por path** — `feedProperties.ts`/`mapProperties.ts` + fórmula `map/lib/*.ts` (`lib/**`) = **CRÍTICO**; `MapScreen`/pill/empty state/tab = **ligero** · CLAUDE.md §5.
- **PNPM siempre** (nunca npm/yarn) · CLAUDE.md §3.

## Arquitectura / enfoque técnico  (L/XL)
Capas y reuso (rutas reales del `mapa-codebase`). Decisiones ya tomadas — sin ambigüedad pendiente:
- **Captura del viewport (crítico/ligero):** `mobile/src/features/map/MapScreen.tsx` ya mantiene `region` (state, `onRegionChangeComplete=set_region`). El pill "Buscar en esta zona" lee `region` y calcula `{center:{lat,lng}, radius_m = diagonal/2}` (**G1**, decisión 1). La **fórmula viewport→{center,radius}** vive en `map/lib/*.ts` (**CRÍTICO TDD**, inputs planos: `Region → {center, radius_m}`), con guard de min/max radio.
- **Estado compartido mapa→feed (decisión 3):** **extender `filterStore.tsx`/`FilterState`** con `area: {center:{lat,lng}, radius_m} | null`, consistente con cómo feed+mapa **ya** comparten `useFilters()`. El feed y el mapa reaccionan por identidad de `filters` (ya hay `useEffect` de refetch). ⚠️ **`area` NO viaja por `build_filter_query`** (igual que `radius_m` de #42) — va como parámetro del RPC. `area` **no** se persiste en AsyncStorage (decisión 8: efímera) → excluirlo de `save_filters`/`load_filters` o resetearlo al hidratar.
- **Data layer feed (CRÍTICO):** `mobile/src/features/feed/lib/feedProperties.ts` — mismo flujo A1 que #42: cuando `area != null`, RPC `properties_within_radius(area.center, area.radius_m)` → `{id, distance_m}[]` → `.from('properties').in('id', ids)` + `build_filter_query` **intacto** (zona **Y** filtros, decisión 4) → mint-video-url + merge fail-closed. ⚠️ En modo zona se **DESACTIVA la expansión progresiva de radio de #42** (decisión 2), para que 0 resultados → empty state (si se expandiera, nunca aparecería).
- **Data layer mapa (CRÍTICO, footprint ampliado por decisión 7):** `mobile/src/features/map/lib/mapProperties.ts` — cuando `area != null`, acota los pines al mismo set de ids del RPC + `build_filter_query`. Antes solo el feed; ahora **también los marcadores**.
- **Empty state (ligero):** `mobile/src/features/feed/FeedScreen.tsx` — variante del `EmptyState` (reuso de `profile/components/EmptyState`) cuando `area != null` y el resultado es 0, con CTA `clear_area()`.
- **Salir del modo (ligero):** banner/chip "Zona activa · Quitar" en feed y mapa que limpia `area` → el feed vuelve al **modo cercanía GPS de #42** (decisión 2: zona es un **override**; al limpiar, "cerca de mí").
- **Cambio de tab (ligero):** al aplicar el pill, navegar al tab feed (`router` de expo-router) — decisión 6.

**Interacción con la proximidad de #42 (decisión 2, resuelta):** la zona es un **modo override** del feed de cercanía GPS. Con `area != null` manda la zona (centro = viewport, **sin** expansión de radio); con `area == null` el feed vuelve al comportamiento de #42 (cerca del usuario, con expansión). Limpiar filtros normales **no** quita la zona y viceversa (decisión 4: ejes independientes).

## Fases / épicas  (L/XL)
Ola única, tras #42 (sin backend nuevo por G1). Sub-bloques naturales (el desglose fino lo hace `/tm-plan`/`expand`):
1. **Estado + fórmula:** `area` en `filterStore`/`FilterState` (excluido de persistencia) + fórmula viewport→{center,radius} en `map/lib/*.ts` (**CRÍTICO TDD**).
2. **Data layer:** rama de zona en `feedProperties.ts` **y** `mapProperties.ts` (**CRÍTICO**, extiende tests); desactivar expansión de radio en modo zona.
3. **UI:** pill "Buscar en esta zona" en `MapScreen` + cambio de tab, empty state de zona + chip "Quitar" (**ligero**; mini-spec de diseño §8 con tokens `theme.ts`, sin gate de cliente).

## Criterios de aceptación
- [ ] En el mapa, tras panear/zoomear el viewport, aparece el pill "Buscar en esta zona".
- [ ] Al pulsarlo, la app **cambia automáticamente al tab feed** y el feed muestra **solo** propiedades (video ready) dentro de la zona (centro del viewport, radio = diagonal/2); las de fuera **no** aparecen.
- [ ] Los **marcadores del mapa** también quedan acotados a la zona activa (no solo el feed).
- [ ] El filtro de zona se **combina** con `FilterState` (#12.7) — zona **Y** precio/tipo/etc. — sin drift con `build_filter_query` (A1 intacto, `area` fuera del builder). Limpiar filtros normales no quita la zona y viceversa.
- [ ] Si la zona no tiene publicaciones (tras filtros), el feed muestra "No hay publicaciones en esta zona" con acción para **limpiar/salir**; **NO** se expande el radio automáticamente en modo zona.
- [ ] Existe siempre una forma visible de quitar el filtro de zona → el feed y el mapa vuelven al **modo cercanía GPS de #42** ("cerca de mí").
- [ ] La zona **no persiste** entre sesiones: al reabrir la app, modo normal (sin `area`).
- [ ] Los tests de `feedProperties` **y** `mapProperties` no regresan (compatibles con el rediseño de paginación de #42); la fórmula viewport→{center,radius} tiene tests unitarios.
- [ ] `pnpm tsc --noEmit` + `pnpm lint` verdes; smoke en device (dev build ya requerido por react-native-maps).

## Dependencias
- ⭐ **Tarea #42** (Fase C, pendiente) — aporta el consumo del RPC + rediseño de paginación en `feedProperties.ts` sobre el que esta idea se apoya. **Recomendado: depender de #42** (evita duplicar el rediseño).
- **Tarea #40** (done) — RPC `properties_within_radius` (reuso directo en G1).
- **Tarea #41** (done) — `LocationProvider`/`useLocation`, gate de ubicación (contexto; la zona no necesita GPS pero convive con el gate).
- Migración `0005` (`properties.location` + `properties_location_gix`) — reuso.
- Código a reusar: `build_filter_query`/`EMPTY_FILTERS` (`search/lib/filterQuery.ts`), `filterStore.tsx` (`useFilters`), `EmptyState` (`profile/components/EmptyState`), `region`/`set_region` de `MapScreen.tsx`, mint-video-url + merge de `feedProperties.ts`.

## Edge cases / riesgos
- **⭐ Dependencia de #42 (pendiente) que reescribe `feedProperties.ts` + paginación.** Construir zona antes de #42 = rediseñar la paginación dos veces y probable conflicto de merge. Mitigación decidida: **esta tarea DEPENDE de #42** (se ejecuta después).
- **Círculo vs rectángulo (G1, aceptado):** el radio = diagonal/2 desde el centro **incluye todo lo visible y algo más** (sobre-incluye esquinas). Aceptado para la demo (decisión 1). Documentar la fórmula en el `lib`.
- **Footprint ampliado a los marcadores (decisión 7):** `mapProperties.ts` pasa a ser CRÍTICO adicional; hay que extender sus 10 tests para la rama de zona sin romper el camino sin zona.
- **Estado cross-screen con tab desmontado (resuelto):** al usar `filterStore` (montado en `(protected)/_layout.tsx`), la zona sobrevive el cambio de tab. Un provider ad-hoc mal ubicado se perdería → por eso se extiende `filterStore` (decisión 3).
- **Dos modos de proximidad confusos:** "cerca de mí" (#42) vs "en esta zona" (viewport). La UI (chip "Zona activa · Quitar") debe dejar claro cuál está activo y cómo salir.
- **Expansión de radio de #42 vs empty state de zona (resuelto):** en modo zona se **desactiva** la expansión (decisión 2), o el empty state exigido nunca aparecería.
- **`area` colándose a `build_filter_query`:** rompería A1; va solo como parámetro del RPC (mismo gotcha que `radius_m` en #42).
- **`area` colándose a la persistencia:** `filterStorage.ts` hoy persiste todo `FilterState`; hay que **excluir `area`** (decisión 8) o la zona reviviría al reabrir la app.
- **Zoom extremo:** viewport muy grande (país entero) o muy chico (una cuadra) → radios absurdos; acotar min/max en la fórmula.

## Plan de pruebas (alto nivel)
Sin backend nuevo por G1 → **cero pgTAP nuevo** (reusa el RPC #40 ya con su pgTAP `09`).
- **CRÍTICO (TDD estricto RED→GREEN→guardian):**
  - Fórmula **viewport→{center, radius}** en `map/lib/*.ts` (inputs planos: `Region → {center, radius_m}`, guards min/max).
  - **`feedProperties.ts`** — rama de zona: acota por ids del RPC, combina con `build_filter_query` sin drift, `area` no viaja al builder, empty state (0 resultados **sin** expandir). Extender/no romper los tests existentes (EC-1..EC-15, EC-F*).
  - **`mapProperties.ts`** — rama de zona: marcadores acotados al set del RPC; sin regresión de los 10 tests actuales.
  - **`filterStorage.ts`** — `area` excluida de `save_filters`/`load_filters` (no persiste).
- **Ligero (tsc + lint + smoke):** pill "Buscar en esta zona" + cambio de tab en `MapScreen`, empty state de zona + chip "Quitar", wiring de `area` en `filterStore`/`FilterState`.
- **Datos de prueba:** props sembradas en GDL ya existen; encuadrar el mapa sobre una zona con y sin propiedades para el smoke del empty state.

## Impacto en PRD (solo referencia — NO se edita)
`docs/PRD.md` §9 (mapa, radio, dirección exacta) contempla búsqueda geoespacial; "buscar en esta zona" es una **acción de mapa** no descrita explícitamente. Una eventual actualización del PRD la anotaría (decisión del dueño, fuera de esta exploración).

## Decisiones del intake
Todas las preguntas abiertas resueltas por el usuario (2026-07-09):
1. **Geometría → G1:** reusar RPC `properties_within_radius` (#40); centro del viewport + radio = **diagonal/2**. **Sin migración nueva.** (Se descartó G2 bounds-RPC y G3 filtro cliente.)
2. **Relación con #42 → tarea NUEVA que DEPENDE de #42.** La zona es un **modo override** de la cercanía GPS: al limpiar la zona, el feed vuelve a "cerca de mí". En modo zona se **DESACTIVA la expansión progresiva de radio** de #42 (para que el empty state pueda aparecer).
3. **Estado → extender `filterStore`/`FilterState`** con `area:{center,radius}|null` (feed y mapa ya comparten `useFilters`).
4. **Combinación → zona SE COMBINA con los demás filtros** (zona Y precio/tipo). Limpiar filtros no quita la zona y viceversa (ejes independientes).
5. **Disparador → pill flotante "Buscar en esta zona"** que aparece tras panear/zoomear el mapa (patrón Airbnb).
6. **Al aplicar → cambio automático al tab feed** mostrando resultados o el empty state "No hay publicaciones en esta zona" (con acción de limpiar/salir).
7. **⚠️ Desviación de la recomendación → la zona filtra TAMBIÉN los marcadores del mapa**, no solo el feed → amplía footprint a `map/lib/mapProperties.ts` + pantalla de mapa (reflejado en alcance, arquitectura, criterios y riesgos).
8. **Persistencia → NO persiste** entre sesiones (efímera; al reabrir, modo normal). `area` excluida de `filterStorage`.
9. **Branding → resuelto:** mini-spec escrita antes de implementar con tokens existentes del `theme.ts`, **SIN** esperar visto bueno del cliente (gate global levantado, CLAUDE.md §8; control menor). `GATE_BRANDING` satisfecho con esa condición.

## Promoción / descarte
**LISTO PARA PROMOVER.** Sin huecos: todas las preguntas resueltas, criterios de aceptación verificables, sin gate de branding bloqueante.
Recomendación: **tarea nueva que DEPENDE de #42** (no plegarla dentro de #42, ya acotado por la exp. 027). Prioridad sugerida: **media** (mejora de descubrimiento, no bloquea la demo; entra después de #42). Comando siguiente tras crear la tarea: `/tm-plan <id>`.
