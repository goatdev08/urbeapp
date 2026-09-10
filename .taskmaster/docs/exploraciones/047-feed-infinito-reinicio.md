---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: S             # decidido: dirección A + D — cliente solo, OTA-safe, sin migración
fecha: 2026-09-10
estado: aprobado
tarea_id: 285
motivo_descarte:
---

# Feed infinito: qué pasa cuando se acaban los videos

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ se promueve a tarea[s] en Taskmaster) o **DESCARTARSE**.
> Fase PROPUESTA (CLAUDE.md §0): **ponytail NO aplica** — se exige divergencia.

## Idea original

Abraham, 2026-09-10, verbatim:

> "quiero hacer que el feed sea realmente infinito, es decir que cuando se acaben los videos disponibles se reinicie"

Pidió **propuestas antes de decidir nada**. Follow de cuentas y comentarios integrados con reportes vienen después y **no se exploran aquí** — solo se anota si alguna dirección los facilita o estorba (ver §Roadmap).

---

## 1. Estado actual (medido en el código, no narrado)

### 1.1 Cómo pagina el feed HOY

| Pieza | Ruta exacta | Qué hace |
|---|---|---|
| Capa de datos | `mobile/src/features/feed/lib/feedProperties.ts:228` `fetchFeedProperties(cursor?, deps?, filters?)` | Orquesta RPC → PostgREST → EF |
| RPC de proximidad | `public.properties_within_radius(p_lat, p_lng, p_radius_m)` — `supabase/migrations/20260706000001_properties_within_radius_rpc.sql:24` | `security definer`, filtro `status='active' AND deleted_at IS NULL` **dentro del cuerpo**; devuelve **`{id, distance_m}[]` ordenado por distancia ASC**, **SIN `LIMIT`** |
| Cursor | `feedProperties.ts:237` y `:344` | **NO es keyset ni `created_at`**: es un **OFFSET entero serializado como string** (`parseInt(cursor,10)`), aplicado con `rpc_ids.slice(offset, offset + PAGE_SIZE)` |
| Tamaño de página | `feedProperties.ts:50` `PAGE_SIZE = 10` | |
| Hidratación de filas | `feedProperties.ts:311-320` | `.from('properties').select(FEED_SELECT).in('id', page_ids).eq('status','active').is('deleted_at',null)` + `build_filter_query(...)` (`mobile/src/features/search/lib/filterQuery.ts`) |
| Identidad del publicador | `feedProperties.ts:140` `fetch_agent_profiles` | Vista `agent_public_profiles`, batch por `owner_user_id`, **fail-open** |
| URLs de video | `feedProperties.ts:120` `mint_videos` → EF `mint-video-url` | HLS firmado de Cloudflare Stream; **TTL default 14 400 s = 4 h** (`supabase/functions/mint-video-url/index.ts:15`) |
| Merge | `feedProperties.ts:166` `build_feed_data` | **fail-closed**: propiedad sin `signed_url` o sin video embebido que matchee el `video_id` de la EF → se omite |
| Re-sort | `feedProperties.ts:339` | Cliente, por `distance_m` ASC (PostgREST no garantiza el orden de `.in()`) |
| Hook | `mobile/src/features/feed/hooks/useFeedProperties.ts:319` | `data / isLoading / error / nextCursor / loadInitial / refetch / loadMore`; `load_more` es **acumulativo** (`set_data(prev => [...prev, ...items])`) |
| Anti-race | `useFeedProperties.ts:346` `request_seq_ref` (#249) | Solo la petición vigente escribe estado |
| Pantalla | `mobile/src/features/feed/FeedScreen.tsx:205` | FlashList v2, `snapToInterval={height}`, `drawDistance={height}` (~3 players vivos, #57/#68), `onEndReached={loadMore}` con `onEndReachedThreshold={0.3}` |
| Key de lista | `mobile/src/features/feed/lib/feedKeyExtractor.ts:31` | `` `property:${id}` `` / `` `ad:${id}` `` |
| Ads | `useFeedProperties.ts:181` `compose_feed_items` → RPC `ads_feed_config()` + RPC `ads_for_zone(p_lat,p_lng,p_neighborhood_id,p_municipality_id)` → EF `mint-ad-urls` / `mint-video-url` → `mobile/src/features/feed/lib/interleaveAds.ts:163` `interleave_ads_with_state` | |
| Engagement | `mobile/src/features/feed/lib/videoEngagementDedupe.ts` + `hooks/useVideoEngagementEvents.ts` | `video_view` (sin umbral, al `isActive`), `video_completed` (≥95 % de `duration`), `video_progress` (máx % por sesión) — **dedupe por `(session_id, event_type, property_id)`** |

**No hay ranking servidor, ni exclusión de vistos, ni "epoch".** El orden es **distancia ASC** y punto. El PRD §9 pide radio progresivo y anti-clustering; `wiki/conceptos/feed-vertical-video.md` documenta que **ninguno de los dos se implementó** (decisión de alcance de #9).

### 1.2 Filtros de zona (#56, #281–#284) y su interacción con la paginación

- `EMPTY_FILTERS.radius_m = null` (`filterQuery.ts:24`) → **el default de la app es "Sin límite"**: `UNLIMITED_RADIUS_M = 21_000_000` m (`feedProperties.ts:60`), o sea **todo el planeta ordenado por cercanía**. No hay nada que "relajar" en el caso default.
- `filters.area` (#56/#281/#284) = círculo del viewport del mapa; **gana** sobre `radius_m` y sobre el GPS (`feedProperties.ts:245-264`). Con `area` activa **la expansión ×2 se desactiva a propósito** (`attempts = MAX_EXPANSION_ATTEMPTS`, `:274`): *una zona dibujada a mano no debe crecer sola*.
- La expansión ×2 (5 000 → 10 000 → 20 000 → 40 000) **solo dispara si la RPC devuelve CERO filas**, nunca si devuelve pocas (`:287`).
- 🔴 **Municipio y colonia NO llegan al feed.** `properties_within_municipality` (`supabase/migrations/20260902200002_...`) y `properties_within_neighborhood` (`20260813000002`) existen y funcionan, pero su **único llamador es el mapa** (`mobile/src/features/map/MapScreen.tsx:333`). El feed solo conoce **círculo**.
- 🔴 **La sección Venta/Renta se aplica DESPUÉS de paginar.** `section` = `filters.operation_types` con un solo valor (`mobile/src/features/search/lib/feedSection.ts:36`), y ese filtro viaja por `build_filter_query` → PostgREST, **después** del `slice` sobre `rpc_ids`. Consecuencia dura: **`rpc_ids.length` NO es el número de ítems de la sección**. Cualquier "wrap-around módulo `rpc_ids.length`" produciría páginas vacías.

### 1.3 Qué pasa EXACTAMENTE hoy cuando se acaba el inventario

Trazado línea por línea:

1. `nextCursor = offset + PAGE_SIZE < rpc_ids.length ? String(offset + PAGE_SIZE) : null` (`feedProperties.ts:344`).
2. Con **8 propiedades activas** y `PAGE_SIZE = 10`: `0 + 10 < 8` es falso → **`nextCursor = null` desde la PRIMERA página**. El feed entero cabe en una sola carga.
3. El usuario hace swipe hasta el último video. `onEndReached` dispara.
4. `load_more` (`useFeedProperties.ts:406`): `if (!nextCursor || isLoading || !coords) return;` → **retorna en la primera línea, sin efecto**.
5. **Resultado visible: el feed se queda quieto.** No hay mensaje "fin", no hay spinner, no se repite nada. En iOS la lista rebota (`bounces={Platform.OS === 'ios'}`, `FeedScreen.tsx:218`); en Android simplemente no se mueve. **El último video se queda en loop indefinido** (`loop=true` en `VideoFeedItem`).
6. `is_empty` (`FeedScreen.tsx:117`) **no aplica**: hay datos. Los tres `EmptyState` (`:153-184`) son para "cero resultados", no para "se acabó".

**No existe ningún estado de "fin del feed" en el código ni en los mockups.**

### 1.4 Cuánto inventario hay en producción (leído de la wiki, sin consultar prod)

- `wiki/log.md:127` — sonda del release: **`active = 8`, `draft = 3`**. Las 8 activas son de Vladimir (`wiki/log.md:18`, `wiki/conceptos/rls-seguridad.md:22`).
- `wiki/log.md:127` — `ads_feed_config()` → **`ads_enabled = true`, `ad_frequency_n = 8`, `ad_max_per_session = 5`**.
- `interleaveAds.ts:184` deja constancia medida: *"con `ad_frequency_n=8` y 8 propiedades en Venta, jamás se sirvió uno (`ad_impressions=0` en producción, smoke #222)"*.

**Estimación de lo que ve un usuario real hoy:** ~8 videos como techo absoluto en la sección Venta, **menos** en Renta (las 8 son de un mismo owner y `operation_type` las parte). El fondo del feed se toca en **menos de un minuto de scroll**. Ese es el problema que Abraham está nombrando.

---

## 2. Lluvia de ideas — 4 direcciones para el reinicio

> Régimen de fase: **propuesta ⇒ divergencia obligatoria**. Las cuatro son viables; la elección es de Abraham.

### Dirección A — Wrap-around en cliente sobre lo ya cargado  🟢 **RECOMENDADA**

**Cómo se implementa.** Solo cliente. `useFeedProperties` gana un `lap_ref`. Cuando `nextCursor === null` y `load_more` es invocado, en vez de `return` temprano se **compone una vuelta nueva** a partir de las propiedades ya en `data` (o de un re-fetch de la página 1, ver Q6) y se apende. `feed_key_extractor` pasa a `` `property:${id}#${lap}` `` — **obligatorio**, no cosmético: FlashList rompe el render con keys duplicadas (memoria `flatlist_numcolumns_row_keys.md`, y el propio docblock de `feedKeyExtractor.ts:21-26` lo advierte). Cero backend, cero migración → **viaja por OTA**.

**Qué ve el usuario.** Configurable (Q3): sin costura (el video 1 aparece después del último, silencioso) o con un chip efímero «Ya viste todo · volvemos a empezar» reusando `RefreshingChip` (`mobile/src/components/RefreshingChip.tsx`, ya aprobado y ya posicionado bajo los tabs).

**Ranking / vistos / ads / zona.**
- Ranking: idéntico cada vuelta (distancia ASC). Loop reconocible — de ahí que D exista.
- Vistos: **no hay exclusión de vistos** que resetear; nada que tocar.
- Engagement: el dedupe `(session, event_type, property_id)` hace que la vuelta 2 **no** emita `video_view`/`video_completed` otra vez → **las estadísticas del agente NO se inflan**. Es un efecto deseable y gratis.
- Ads: **hay decisión que tomar** (Q7). Clonar los ítems `kind:'ad'` tal cual rompería los invariantes de 170.3 (nunca dos anuncios seguidos, `min_gap_between_repeats`). Lo correcto es **recomponer con `interleave_ads_with_state`** pasando `already_shown_ref` y `since_last_ad_ref` — que ya existen y ya cruzan costuras entre páginas (#256). Efecto secundario positivo: hoy **jamás se sirve un anuncio** en Venta; con vueltas, los slots aparecen hasta agotar `ad_max_per_session = 5`. Las impresiones **no se facturan dos veces**: unique `(user_id, ad_id, session_id)` + `ON CONFLICT DO NOTHING`.
- Zona: transparente. La vuelta reusa exactamente el mismo conjunto que la zona produjo.

**Riesgo con la cuota de Stream.** Real y directo: cada vuelta **re-descarga** los mismos segmentos HLS (el player se recrea por instancia reciclada, `replaceAsync`). Sin techo, un teléfono olvidado en scroll factura minutos indefinidamente. Mitigación propuesta: **cap de vueltas** (Q5). Nota: el riesgo *ya existe hoy* con `loop=true` sobre el último video; la dirección lo amplifica, no lo estrena.

**Costo: XS–S.** Footprint: `hooks/useFeedProperties.ts`, `lib/feedKeyExtractor.ts` (ambos **ruta crítica TDD por path**, §5), `FeedScreen.tsx` (verificación ligera).

**Trade-off.** El más barato, el más rápido, cero riesgo de producción (sin migración, sin contrato, sin EF) — a cambio de que **la repetición es literal y evidente**: mismo orden, mismos videos, y el usuario puede darse cuenta de que la app "no tiene más". Es la dirección honesta para 8 propiedades; envejece mal cuando haya inventario de verdad.

---

### Dirección B — La RPC cicla con "epoch"/vuelta y re-rankea

**Cómo se implementa.** Ambas capas, con el peso en backend. RPC nueva `public.feed_page(p_lat, p_lng, p_radius_m, p_operation_types text[], p_lap int, p_seed int, p_limit int, p_offset int)` que devuelve la página ya rankeada y ya filtrada por sección, y que al agotar el inventario **arranca `lap+1`** reseteando la exclusión de vistos y re-rankeando (recencia, no solo distancia). El cliente pasa a un solo viaje en vez de RPC + select + EF-en-paralelo.

**Qué ve el usuario.** Sin costura por defecto: la vuelta 2 llega como una página más y **puede venir en otro orden**, así que el reinicio se disfraza solo.

**Ranking / vistos / ads / zona.**
- Es la **única** dirección que arregla de raíz el desajuste de §1.2 (la sección se aplica después de paginar) y que permite un ranking real: recencia, anti-clustering del PRD §9, exclusión de reportados/bloqueados.
- Ads: sin cambio (la composición vive en el cliente y sigue funcionando igual).
- Zona: `area` y municipio/colonia podrían por fin unificarse en una sola firma en vez de tres RPCs distintas entre feed y mapa.

**Riesgo con la cuota de Stream.** Igual que A (mismo número de reproducciones), salvo que un re-ranking por recencia hace que la vuelta 2 muestre "otras cosas" y el usuario aguante más → **potencialmente más minutos**, no menos.

**Costo: L.** Migración + rollback + pgTAP + `revoke public/anon` + `grant authenticated` (patrón de todas las RPC del repo) + reescritura de `feedProperties.ts` y de sus **~15 call sites** de tests. `properties_within_radius` **no se toca** (la llaman builds instalados, §0.5.2): la RPC nueva es **aditiva** y el cliente viejo sigue funcionando.

**Trade-off.** Es la inversión correcta a 6 meses y **la casa natural de "follow" y de "ocultar reportados"** (ver §Roadmap) — pero es un rediseño de la capa de datos del feed para resolver un problema que hoy tiene 8 filas de inventario. Rompe la proporción entre esfuerzo y síntoma.

---

### Dirección C — Rellenar relajando filtros antes de repetir

**Cómo se implementa.** Cliente, con backend ya existente. Al agotar, en vez de repetir: **relajar en cascada** — zona dibujada (`filters.area`) → municipio que contiene ese centro (`properties_within_municipality`, ya desplegada, hoy solo la usa el mapa) → sin zona (nacional) → y en último término repetir (cae en A). Cada tramo relajado se marca con un separador («Fuera de tu zona»).

**Qué ve el usuario.** Corte **necesariamente visible**: contenido de fuera de lo que pidió sin avisar sería mentirle al filtro.

**Ranking / vistos / ads / zona.** 🔒 Debe respetar el **invariante A1** (#42, `types.ts:33-47`): `radius_m` y `area` son **solo** parámetros de la RPC geoespacial y **nunca** viajan por `build_filter_query`. Los ads seguirían resolviendo su zona por el centro original (`resolve_ad_zone_coords`, `useFeedProperties.ts:358`) — habría que decidir si el anuncio también se relaja, y ahí hay **dinero de por medio**: servir inventario de otra zona es exactamente lo que #194/#195 se ocuparon de evitar.

**Riesgo con la cuota de Stream.** El **más alto de los cuatro**: es la única que trae videos *nuevos* (no cacheados, no repetidos) al agotar, o sea minutos que hoy no se facturan.

**Costo: M.**

**Trade-off.** La más honesta y la que mejor envejece — pero **hoy no compra casi nada**: con el default `radius_m = null` ya se está buscando en todo el planeta, así que solo aplica cuando hay `area` activa. Con 8 propiedades nacionales, relajar la zona devuelve las mismas 8. Es la dirección correcta **el día que haya inventario**, no hoy.

---

### Dirección D — Barajado por vuelta con semilla  🟢 (modificador recomendado sobre A)

**Cómo se implementa.** Función pura nueva `lib/feedShuffle.ts`: `shuffle_with_seed(ids, seed)` con PRNG determinista (`seed = hash(session_id) + lap`). No es una dirección autónoma: se monta sobre A (o sobre B).

**Qué ve el usuario.** La vuelta 2 **no es idéntica** a la 1 → el loop deja de ser obvio sin necesidad de UI de costura.

**Ranking / vistos / ads / zona.** Rompe la promesa "lo más cercano primero" a partir de la vuelta 2. Variante conservadora: barajar **dentro de tramos de distancia** (p. ej. bloques de 5 ítems) para no mandar lo lejano al frente. Ads: neutro (la composición ocurre después del barajado).

**Riesgo con la cuota de Stream.** Neutro respecto de A, con el matiz de que "se siente distinto" invita a scrollear más.

**Costo: XS–S** encima de A. `mobile/**/lib/**` → **TDD estricto**, determinismo trivialmente testeable (misma semilla → misma salida, sin `Date.now()` ni `Math.random()`; ojo con la memoria `tests_bomba_de_fecha_y_estado_inicial`).

**Trade-off.** Barato y con el mayor efecto percibido por peso. El costo es que "cerca de ti" deja de ser literal después de la primera vuelta — y ese es un mensaje que la app hoy sostiene con el orden por distancia.

---

### Recomendación → ✅ DECIDIDO por Abraham (2026-09-10)

**Se toma A + D.** Cliente solo, OTA-safe, sin migración, sin contrato publicado tocado, sin riesgo para producción viva — resuelve el síntoma en la escala en que existe (8 propiedades).

- **B se RESERVA** como derivada sin fecha: es la dirección a tomar cuando lleguen follow y comentarios, porque el "ranking servidor" es su casa natural.
- **C se DESCARTA** (no se difiere: con el default `radius_m = null` ya se busca en todo el país, así que no hay nada que relajar hasta que el inventario cambie de orden de magnitud).
- 🔴 **Sin techo de vueltas** (decisión explícita de Abraham, ver §20): el feed es infinito de verdad y el gasto de Cloudflare Stream se asume a sabiendas.

---

## 3. Problema / Motivación

El feed —el diferenciador central de Urbea ([[feed-vertical-video]])— **se acaba en menos de un minuto** y lo hace **en silencio**: el último video se queda en loop y la lista no responde. Para un tester real o un inversor con el APK instalado, "la app se trabó" y "ya no hay más" son indistinguibles. Con `active = 8` en producción no hay forma de que el fondo no se toque.

## 4. Resultado esperado

Al llegar al último video disponible, el feed **continúa** en vez de detenerse: aparece contenido reproducible al seguir haciendo swipe, con una señal de que se volvió a empezar (o sin ella, según Q3), respetando el techo de vueltas que se decida y sin inflar métricas de agentes ni facturar impresiones de anuncios dos veces.

## 5. Alcance

- **SÍ entra:** el wrap de vuelta al agotar el inventario; la key de FlashList con sufijo de vuelta; el barajado con semilla por vuelta; el re-fetch silencioso de la página 1 al arrancar cada vuelta; la recomposición de anuncios cruzando la costura; el **chip efímero** de reinicio (`UI_FUERA_DEL_MOCKUP` resuelto como opción 1, §9).
- **NO entra:** techo de vueltas (decisión Q5: **sin techo**); pausa por inactividad; poda de `data`; dirección **B** (RPC con epoch — reservada, §21); dirección **C** (relajar filtros — descartada); follow de cuentas; comentarios; reportes; ranking por recencia/anti-clustering del PRD §9; el mapa; la pantalla de Guardados; cualquier cambio a `properties_within_radius` o a `RefreshingChip.tsx`.

## 6. Roles afectados

- **Comprador/buscador:** único rol con cambio visible. Deja de topar con pared.
- **Agente/inmobiliaria:** **sin cambio en sus números** — el dedupe de engagement por sesión impide que las vueltas inflen `video_view`/`video_completed`/`video_progress` y por tanto la temperatura del CRM (#266/#268).
- **Anunciante:** cambio **favorable y medido**: hoy `ad_impressions = 0` en Venta porque `ad_frequency_n = 8` y hay 8 propiedades; con vueltas los slots aparecen hasta `ad_max_per_session = 5`. Sin doble facturación (unique `(user_id, ad_id, session_id)`).
- **Admin:** ninguno, salvo que el techo de vueltas se ponga en `app_config` (Q5, opción 3).

## 7. Impacto en datos

- **A / D: ninguno.** Cero migraciones, cero RLS, cero EF. Solo cliente → **OTA**.
- **A/D con techo configurable (Q5 opción 3):** una clave nueva en `app_config` (`feed_max_laps`), aditiva e idempotente, patrón idéntico a `ads_enabled`/`ad_frequency_n` (`20260817000001`).
- **B:** migración nueva con RPC `feed_page`, `security definer`, `search_path` fijo, **filtros de visibilidad (`status='active'`, `deleted_at is null`) repuestos DENTRO del cuerpo** — precedente obligado: el guardian de #269 cazó una fuga entre agencias justamente porque una RPC `security definer` no repuso a mano la frontera que la policy habría dado. Más rollback + pgTAP + `revoke public, anon` / `grant authenticated`.
- **C:** ninguno (las RPC de municipio/colonia ya están desplegadas).

## 8. Impacto en UI

- `mobile/src/features/feed/FeedScreen.tsx` — solo si se aprueba la señal de costura.
- **Reuso disponible:** `mobile/src/components/RefreshingChip.tsx` (`tone="dark"`, ya posicionado bajo los tabs, ya usado por el pull-to-refresh de #243.2) sirve tal cual para «Ya viste todo · volvemos a empezar». Reusarlo evita un componente nuevo **y** evita el gate de aprobación por pantalla.
- Sin cambios en `VideoFeedItem`, `PropertyOverlay`, `AdFeedItem` ni en el rail de acciones.

## 9. UI/interacción fuera del mockup

Abierto y revisado `urbea-identidad-visual.html` (pantalla 4 · Feed vertical, líneas **848–886**) y `Urbea Prototipo (standalone).html`. La pantalla del feed dibuja: badge de operación, contador `1/3`, rail de acciones (like/guardar/contactar/compartir), bloque de info del agente + precio + specs, tab bar. **Ninguno de los dos dibuja un estado de "fin del feed", un separador entre vueltas ni un indicador de reinicio.**

`UI_FUERA_DEL_MOCKUP: indicador de reinicio de vuelta («Ya viste todo · volvemos a empezar») · sin él, el reinicio es indistinguible de un bug de repetición —que es exactamente la lectura que un tester haría hoy— y el mockup no tiene nada que reutilizar para comunicarlo · costo XS`

- **→ opción 1 (en conjunto): ✅ ELEGIDA por Abraham (2026-09-10).** Entra a esta tarea como **subtarea de verificación ligera** (`components/**` / pantalla no son ruta crítica por path, §5): al cruzar la costura se muestra `RefreshingChip` con **copy propio durante ~2 s**, reusando el posicionamiento que ya existe bajo los tabs de sección y que ya convive con `ZoneActiveChip` y con el chip de «Actualizando». **Cero componente nuevo, cero tokens nuevos, cero preview HTML** → el gate de aprobación por pantalla (§8) **no** se dispara.
  - Detalle de reuso verificado: `mobile/src/components/RefreshingChip.tsx:29-36` ya expone `label?: string`, `tone?: 'dark'|'light'`, `top?: number` y `visible: boolean`, renderiza `null` cuando no está visible, es `pointerEvents="none"` y trae `accessibilityLiveRegion="polite"`. **El componente NO se modifica**: solo se instancia una segunda vez con `label` distinto.
  - Copy propuesto (decide Abraham en el smoke, es una línea): «Ya viste todo · volvemos a empezar».
  - ⚠️ Colisión de posición a resolver en la implementación: `FeedScreen.tsx:316-335` ya apila `RefreshingChip` y `ZoneActiveChip` con offsets calculados. El chip de vuelta debe entrar en esa misma pila y **nunca** mostrarse a la vez que el de «Actualizando» (son estados mutuamente excluyentes: refrescar y cruzar la costura no ocurren juntos).
- **→ opción 2 (DEFAULT, no elegida):** derivada `producto(<origen>)`. Se conserva redactada por trazabilidad, pero **no se crea**.

**`APROBACION_DISENO: no`** — la tarjeta interstitial a pantalla completa (que **sí** habría sido componente de firma y habría exigido preview HTML aprobable antes de portar a RN, §8) quedó descartada al elegir el chip.

## 10. Reglas no obvias aplicables

- **Cuota real de Cloudflare Stream** — CLAUDE.md §0.5.5 + memoria `video_playback_burns_quota`. Ver video en pruebas = verificar que reproduce y **PARAR**; los E2E terminan en `stopApp`. Un feed infinito es, por definición, reproducción sin techo. · [[storage-hibrido]] · [[propiedades-y-video]]
- **Keys duplicadas rompen FlashList** — memoria `flatlist_numcolumns_row_keys` + docblock de `mobile/src/features/feed/lib/feedKeyExtractor.ts:21-26`. Repetir una propiedad sin sufijo de vuelta es el bug garantizado de esta feature.
- **Player estable por instancia (#61)** — `wiki/conceptos/feed-vertical-video.md` §"Player estable": en listas recicladas **nunca** dejar que `useVideoPlayer` recree por cambio de fuente; se reemplaza el medio con `player.replaceAsync()`. Duplicar ítems multiplica los reciclajes y por tanto la exposición a este bug.
- **Closure obsoleto de `property_id` al reciclar FlashList** — memoria `expo_video_capture_gotchas`. Con la misma propiedad presente varias veces en `data`, es la trampa más probable.
- **Dedupe de engagement por `(session, event_type, property_id)`** — `videoEngagementDedupe.ts:97-101`. La vuelta 2 no reemite; las métricas del agente y la temperatura del CRM no se inflan. Si alguien quisiera contar vueltas como señal, tendría que tocar el dedupe — y ahí aplica **registrar ≠ exponer** (§0.5.4, memoria `privacidad_registrar_no_es_exponer`, [[privacidad-datos]]).
- **Invariantes de intercalado de anuncios (170.3)** — `interleaveAds.ts:163`: nunca dos anuncios seguidos, `min_gap_between_repeats`, tope `ad_max_per_session`, costura entre páginas vía `since_last_ad` (#256). Clonar ítems `kind:'ad'` los rompe todos a la vez. · [[publicidad-anuncios]]
- **Un anuncio sin URL firmada NO se sirve** — [[publicidad-anuncios]] §170.8. Aplica igual en la vuelta: si el re-mint falla, ese anuncio se cae, no se sirve mudo.
- **Invariante A1 (#42)** — `mobile/src/features/search/types.ts:33-47`: `radius_m` y `area` son **solo** parámetros de la RPC geoespacial, jamás de `build_filter_query`. Crítico para C.
- **Contratos publicados (§0.5.2)** — `properties_within_radius` la llaman los builds instalados (APKs de inversores, TestFlight). En B se **agrega** RPC nueva; no se altera la existente. Precedente de deprecación en dos pasos: #116.
- **RLS 2ª capa en RPC `security definer`** — [[rls-seguridad]] + guardian de #269: una `security definer` debe **reponer a mano** la frontera que la policy habría dado. Aplica solo a B.
- **Criticidad TDD determinista por path (§5)** — `mobile/**/hooks/**` y `mobile/**/lib/**` ⇒ **CRÍTICA, TDD estricto**. Es decir: `useFeedProperties.ts`, `feedKeyExtractor.ts`, `feedShuffle.ts` (nuevo). `FeedScreen.tsx` (`components`/pantalla) ⇒ verificación ligera.
- **PNPM siempre**, nunca npm/yarn (§3).

## 11. Arquitectura / enfoque técnico  (L/XL)

n/a para A/D (nivel S, cambio local en dos archivos de `hooks/` + `lib/` y un ajuste de copy en la pantalla). Si se elige **B**, esta sección debe llenarse a fondo antes de promover: firma exacta de `feed_page`, plan de convivencia con `properties_within_radius` mientras haya builds viejos instalados, y migración de los ~15 call sites de tests de `feedProperties.ts`.

## 12. Fases / épicas  (L/XL)

n/a para A/D. Para B: (1) RPC + pgTAP + rollback → (2) cliente detrás de flag en `app_config` → (3) retiro del path viejo cuando no queden builds antiguos.

## 13. Criterios de aceptación

*Todas cerradas y verificables — las 8 preguntas están respondidas (§19/§20).*

- [ ] **Continuidad:** con el inventario agotado (`nextCursor === null`), `onEndReached` **apende una vuelta nueva** en vez de retornar sin efecto, y esto se repite **sin techo** — verificado en test con 5 vueltas consecutivas y en smoke por CLI cruzando al menos 2 costuras.
- [ ] **Keys únicas:** `feed_key_extractor` devuelve keys distintas para la misma propiedad en vueltas distintas (`property:<id>#<lap>`); **cero** warnings `same key` en consola tras 3 vueltas completas.
- [ ] **Orden barajado y determinista:** la vuelta N≥2 llega permutada con semilla `session_id + lap`; misma semilla ⇒ misma permutación (test puro, sin `Date.now()` ni `Math.random()`), la permutación contiene **exactamente** los mismos elementos que la vuelta 1, y **dos vueltas consecutivas no arrancan con el mismo `property.id`** salvo que el inventario tenga 1 solo ítem.
- [ ] **Re-fetch, no memoria:** cada vuelta dispara **un** re-fetch silencioso de la página 1 (RPC `properties_within_radius` + select + `mint-video-url`) → las `signed_url` de la vuelta son **distintas** a las de la vuelta anterior y el inventario publicado entre vueltas aparece; el `RefreshControl`/skeleton **no** se activa y `data` **no** se vacía durante la operación.
- [ ] **Anuncios:** cruzando la costura de vuelta no hay dos anuncios consecutivos ni el mismo anuncio a menos de `min_gap_between_repeats` posiciones (`already_shown_ref` y `since_last_ad_ref` se arrastran, no se reinician), el total de anuncios servidos en la sesión **nunca excede `ad_max_per_session`**, y `ad_impressions` no gana filas duplicadas por `(user_id, ad_id, session_id)`.
- [ ] **Métricas intactas:** tras 3 vueltas sobre la misma propiedad, `events_raw` tiene **exactamente un** `video_view` y **un** `video_completed` por `(session_id, property_id)` — el dedupe no se toca.
- [ ] **Chip de costura:** al cruzar la costura aparece `RefreshingChip` con `tone="dark"` y copy propio durante ~2 s, **sin** solaparse con el chip «Actualizando» ni con `ZoneActiveChip`, y **sin** modificar `RefreshingChip.tsx`.
- [ ] **Zona y sección respetadas:** con `filters.area` activa la vuelta reusa **solo** propiedades de esa zona; la sección Venta/Renta se conserva en cada vuelta (la vuelta se compone sobre los **ítems ya compuestos**, nunca módulo `rpc_ids.length`); cambiar de sección o de filtros **resetea el contador de vuelta a 0**.
- [ ] **Verde:** `pnpm tsc --noEmit` y `pnpm lint` limpios; suite de `mobile/src/features/feed` verde; ciclo RED → GREEN → guardian con mutación real en las piezas críticas.

## 14. Dependencias

- Código a reusar (rutas reales): `mobile/src/features/feed/hooks/useFeedProperties.ts` · `mobile/src/features/feed/lib/feedProperties.ts` · `mobile/src/features/feed/lib/feedKeyExtractor.ts` · `mobile/src/features/feed/lib/interleaveAds.ts` (`interleave_ads_with_state`, `already_shown_count`, `since_last_ad`) · `mobile/src/components/RefreshingChip.tsx`.
- Tareas previas relevantes: **#9** (feed), **#42/#58/#62** (proximidad y radio), **#56/#281/#284** (zona), **#170 + derivadas** (anuncios), **#247/#256** (costura de anuncios entre páginas), **#249** (anti-race), **#241** (secciones), **#112/#268** (engagement).
- Backend existente que **no** se toca en A/D: `properties_within_radius` (`20260706000001`), EF `mint-video-url`, `ads_for_zone`, `ads_feed_config`.

## 15. Edge cases / riesgos

- 🔴 **Cuota de Stream sin techo — RIESGO ACEPTADO A SABIENDAS (Abraham, 2026-09-10).** Cada vuelta re-descarga los segmentos HLS de Cloudflare Stream; **no hay tope de vueltas** y un dispositivo dejado en scroll factura minutos reales sin límite. Abraham asume el gasto: el feed tiene que sentirse infinito de verdad. Queda escrito aquí y en §20 para que nadie lo trate como descuido pendiente de arreglar.
  - **Mitigación que YA existe y hay que no romper:** `mobile/src/features/feed/hooks/useFeedActiveIndex.ts:56-77` cruza tres señales — viewability (≥70 %), `AppState` y foco de tab — de modo que **al irse a background o al salir del tab del feed ningún ítem queda activo y la reproducción se detiene**. O sea: la factura solo corre con la app en primer plano y el feed a la vista. La implementación **no debe** introducir un camino que avance vueltas fuera de ese gate.
  - **Mitigación que NO existe:** pausa por inactividad (sin swipe durante N minutos → pausar). Hoy un feed en primer plano y quieto sigue reproduciendo en loop. **No entra a esta tarea** — se nombra como candidata a derivada `hardening(<origen>)` si el consumo medido lo justifica.
  - **Regla operativa que sigue vigente:** en pruebas, verificar que reproduce y **PARAR**; todo E2E termina en `stopApp` (§0.5.5, memoria `video_playback_burns_quota`).
- 🔴 **Keys duplicadas** → FlashList rompe el render. Mitigado por el sufijo de vuelta; **debe ir en el RED**, no descubrirse en el smoke.
- ✅ **URLs firmadas caducadas — MITIGADO por la decisión Q6.** TTL 4 h (`mint-video-url/index.ts:15`); una URL vencida da **404, no 401/403** ([[feed-vertical-video]] §Datos/técnico), o sea se disfraza de "el video no existe". Como cada vuelta hace **re-fetch** de la página 1 (nada de memoria), las URLs se re-mintean en cada vuelta y el caso no puede darse salvo que una sola vuelta dure > 4 h.
- 🔴 **Crecimiento sin techo de `data`.** El array acumula (`set_data(prev => [...prev, ...items])`) y ahora **sin cap de vueltas**: con ~8 ítems por vuelta, una sesión larga llega a miles de entradas. FlashList recicla **vistas**, no el array. Es la consecuencia directa de "sin techo" y **hay que medirla en el smoke** (`adb shell dumpsys meminfo` tras N vueltas, §3). Si el heap crece de forma monótona, la salida barata es **podar por la cabeza** (mantener una ventana de las últimas K vueltas) — se nombra aquí, no se implementa a ciegas.
- **Wrap sobre `rpc_ids` en vez de sobre los ítems compuestos** = páginas vacías, porque la sección Venta/Renta se filtra **después** de paginar (§1.2). Es el error más fácil de cometer aquí.
- **Percepción ante inversores.** Repetir el mismo inventario puede leerse como "la app no tiene nada". Sin señal visible el reinicio es indistinguible de un bug (§9).
- **Propiedad borrada a media sesión.** `onPropertyDeleted` (`useFeedProperties.ts:446`) filtra por `item.property.id` → elimina **todas** las copias de todas las vueltas. Correcto por accidente; conviene que un test lo fije.
- **Sección Renta con 0 o 1 video.** Con un solo ítem la "vuelta" es el mismo video una y otra vez, que es peor que el estado actual. Q2 cubre el piso mínimo de inventario para activar el reinicio.

## 16. Plan de pruebas (alto nivel)

- **CRÍTICO (TDD estricto, RED → GREEN → guardian):**
  - `lib/feedKeyExtractor.ts` — unicidad de key con la misma propiedad en N vueltas.
  - `hooks/useFeedProperties.ts` — el wrap dispara **solo** con `nextCursor === null`; no dispara con `isLoading` ni sin `coords`; **no** tiene techo (5 vueltas consecutivas en el test, ninguna rechazada); cada vuelta hace **un** re-fetch de página 1 y **no** vacía `data` ni levanta el skeleton; `already_shown_ref` y `since_last_ad_ref` cruzan la costura de vuelta igual que la de página (#256); `request_seq_ref` sigue descartando respuestas tardías; cambiar `filters` **resetea el contador de vuelta**.
  - `lib/feedShuffle.ts` (si D) — determinismo puro: misma semilla → misma permutación; permutación válida (mismos elementos); **sin `Date.now()` ni `Math.random()`** (memoria `tests_bomba_de_fecha_y_estado_inicial`: fijar reloj en todos los casos).
  - Invariantes de anuncios cruzando la costura: `interleaveAds.page-seam.test.ts` es el precedente exacto a extender.
- **Ligero:** `FeedScreen.tsx` — `pnpm tsc --noEmit`, `pnpm lint`, render del chip de costura.
- **Smoke en dispositivo:** 🔴 **por CLI, nunca computer-use** (§3). `adb shell input swipe` hasta cruzar **al menos 2 costuras**, `adb exec-out screencap -p` para leer el chip y confirmar que el orden cambió, `adb shell dumpsys meminfo` **antes y después** para medir el crecimiento de `data` (riesgo de §15), **verificar que reproduce y PARAR** (`stopApp`) — memoria `video_playback_burns_quota`. Testing manual junto a Abraham (memoria `testing_manual_juntos_automatizado_solo`).
- ⚠️ Antes de validar un merge: reiniciar Metro con `-c` y relanzar el dev-client (memoria `metro_bundle_stale_tras_git_switch`).
- **pgTAP:** n/a para A/D. Obligatorio para B.
- **Datos de prueba:** no hace falta sembrar nada — el escenario "se acaba el inventario" es el estado **normal** de producción hoy (8 activas).

## 17. Impacto en PRD (solo referencia — NO se edita)

`docs/PRD.md` §9 describe radio progresivo y anti-clustering, ninguno implementado (decisión de alcance de #9). El "reinicio" no está contemplado en el PRD. Si se eligiera **B**, esa RPC sería el lugar natural donde §9 por fin se cumpliría — y ahí sí tocaría actualizar §9. Decisión de promoción del dueño, fuera de esta exploración.

## 18. Roadmap adyacente (follow + comentarios) — solo anotado, NO explorado

Abraham pidió explícitamente **no** explorar follow ni comentarios aquí. Anotación de interferencia, que es lo único que corresponde:

- **A y D no estorban ni facilitan.** Son cliente puro sobre la lista ya compuesta. Un comentario o un follow se cuelgan del `property.id` / `owner_user_id`, que la vuelta conserva intactos. **Un cuidado**: un contador de comentarios por ítem debe leerse de estado compartido por `property.id`, **no** del ítem clonado, o las copias mostrarán números distintos.
- **B las facilita mucho.** "Solo de las cuentas que sigo", "no me muestres lo que reporté", "prioriza lo que tiene comentarios" son cláusulas de **ranking servidor**, y B es precisamente el lugar donde ese ranking nacería. Si follow y comentarios están cerca en el roadmap, hay un argumento real para tomar B ahí y no aquí.
- **C es ortogonal** a ambos.

## 19. Preguntas abiertas para Abraham (8, agrupadas) — ✅ TODAS RESPONDIDAS

> Resueltas con `AskUserQuestion` el **2026-09-10**. Se conservan con sus opciones por trazabilidad
> (por qué el plan quedó así). **✅ = elegida.** (REC) = la que este doc recomendaba.
> Q4/Q6/Q7 las tomó el orquestador como **defaults rutinarios** (coincidieron con la recomendación
> y no cambian alcance ni costo); Q1/Q2/Q3/Q5/Q8 las decidió Abraham.

**Grupo A — Dirección y cuándo aplica**

1. **¿Qué dirección se toma?**
   - ✅ (REC) **A + D**: wrap-around en cliente + barajado por vuelta. Cliente solo, OTA-safe, costo S, cero riesgo de producción.
   - **A sola**: wrap literal, mismo orden cada vuelta. Costo XS; el loop es evidente.
   - **B**: RPC nueva con epoch y re-ranking servidor. Costo L; es la casa natural de follow/comentarios/reportes.
   - **C** (**DESCARTADA**): relajar filtros (zona → municipio → nacional) antes de repetir. Costo M; hoy casi no compra nada porque el default ya busca en todo el país.

2. **¿Cuándo se activa el reinicio?**
   - ✅ (REC) **Siempre que se agote**, con o sin filtros/zona.
   - **Solo sin zona activa** (con `filters.area` el usuario pidió un lugar concreto y repetir 2 videos ahí molesta más de lo que ayuda).
   - **Solo si hay ≥ N videos** (p. ej. 4): con 1–2 videos el "reinicio" es el mismo video en bucle, peor que el estado actual.

**Grupo B — Qué ve el usuario en la costura**

3. **¿Corte visible o sin costura?**
   - ✅ (REC) **Chip efímero** «Ya viste todo · volvemos a empezar» (~2 s) reusando `RefreshingChip`: sin componente nuevo, sin preview HTML, sin gate de diseño. → resuelve `UI_FUERA_DEL_MOCKUP` como **opción 1, en conjunto** (§9).
   - **Sin costura**: el video 1 aparece después del último, en silencio. Cero UI; riesgo de que se lea como bug.
   - **Tarjeta interstitial a pantalla completa** entre vueltas. ⚠️ Es **componente de firma** → exige preview HTML aprobable antes de portar a RN (§8) y sube el costo a M.

4. **¿La vuelta 2 va en el mismo orden?**
   - ✅ (REC) **Barajada con semilla** `session_id + vuelta` (determinista, testeable). *Default rutinario del orquestador; la variante por tramos de distancia queda descartada por simplicidad.*
   - **Mismo orden exacto** (lo más simple; el loop se nota).
   - **Barajada solo dentro de tramos de distancia** (bloques de ~5): conserva "lo cercano primero" y aun así cambia.

**Grupo C — Costo real (cuota de Stream)**

5. **¿Techo de vueltas por sesión?** *(toca facturación real de Cloudflare Stream, §0.5.5)*
   - (REC, **NO elegida**) **3 vueltas** y después un estado final que deja de pedir más.
   - ✅ **Sin techo** (verdaderamente infinito; minutos facturados sin tope). **Abraham asume el gasto de Stream a sabiendas** — ver §15 y §20. Es el único punto donde la decisión se apartó de la recomendación de este doc.
   - **Configurable en `app_config`** (`feed_max_laps`), ajustable en runtime sin OTA — como ya se hace con `ads_enabled`.

6. **¿La vuelta re-consulta el backend o reusa lo que ya está en memoria?**
   - ✅ (REC) **Re-fetch silencioso de la página 1**: recoge publicaciones nuevas y **re-mintea las URLs firmadas antes del TTL de 4 h** (una URL vencida da 404 de Cloudflare, que se disfraza de "el video no existe"). Costo: 1 RPC + 1 select + 1 EF por vuelta. *Default rutinario del orquestador; **nada de memoria**.*
   - **Reusar en memoria**: instantáneo, cero red — pero rompe en sesiones > 4 h y nunca ve inventario nuevo.
   - **Re-fetch solo si pasó > 1 h** desde la última carga (híbrido).

**Grupo D — Anuncios**

7. **¿Cómo se tratan los anuncios en la vuelta?**
   - ✅ (REC) **Recomponer** con `interleave_ads_with_state`, arrastrando `already_shown_ref` y `since_last_ad_ref`, respetando `ad_max_per_session`. Respeta los invariantes de 170.3 y aprovecha que hoy **no se sirve ni un anuncio** en Venta (`ad_frequency_n=8`, 8 propiedades, `ad_impressions=0`). *Default rutinario del orquestador.*
   - **Clonar los ítems tal cual**: lo más barato, pero rompe "nunca dos anuncios seguidos" y el `min_gap`.
   - **Vueltas sin anuncios**: la vuelta es solo propiedades; el más conservador comercialmente.

**Grupo E — Roadmap**

8. **¿Se reserva B como paso siguiente para follow + comentarios, o se descarta ya?**
   - ✅ (REC) **Reservar** como derivada `producto(<origen>)` sin fecha, con este doc como origen. **No se crea la tarea hoy** — queda nombrada aquí y se abre cuando follow/comentarios entren al roadmap.
   - **Abrirla ahora** en paralelo (tarea L propia).
   - **Descartarla**: el feed se queda en paginación por distancia en cliente indefinidamente.

## 20. Decisiones del intake

Log de la desambiguación. **Una pasada de preguntas** (`AskUserQuestion`, 2026-09-10) → las 8 cerradas.

| # | Pregunta | Decisión | Quién |
|---|---|---|---|
| Q1 | Dirección | **A + D** (vuelta en cliente + barajado con semilla). **B se reserva**, **C se descarta** | Abraham |
| Q2 | Cuándo se activa | **Siempre** que se agote el inventario, con o sin filtros/zona | Abraham |
| Q3 | Costura visible | **Chip efímero** reusando `RefreshingChip` con copy propio → `UI_FUERA_DEL_MOCKUP` resuelto como **opción 1 «en conjunto»** | Abraham |
| Q4 | Orden de la vuelta N≥2 | **Barajado con semilla `session_id + lap`**, puro y determinista. **Sin** tramos de distancia | Orquestador (default rutinario) |
| Q5 | Techo de vueltas | 🔴 **SIN TECHO** | Abraham |
| Q6 | Re-fetch vs memoria | **Re-fetch silencioso de la página 1** al arrancar cada vuelta (URLs firmadas re-minteadas). **Nada de memoria** | Orquestador (default rutinario) |
| Q7 | Anuncios en la vuelta | **Recomponer** con `interleave_ads_with_state` respetando `ad_max_per_session` | Orquestador (default rutinario) |
| Q8 | ¿Se reserva B? | **Sí, derivada sin fecha** para cuando lleguen follow y comentarios. No se crea hoy | Abraham |

**Notas sobre cómo se tomaron.** Q1/Q2/Q3/Q5/Q8 las decidió **Abraham**. Q4/Q6/Q7 las tomó el **orquestador como defaults rutinarios**: las tres coincidían con la recomendación de este doc, ninguna cambia alcance ni costo, y ninguna descarta una alternativa que Abraham hubiera nombrado. Quedan anotadas como tales para que se puedan revertir sin discusión si el smoke las contradice.

🔴 **Q5 — el gasto de Stream se asume a sabiendas.** El doc recomendaba un techo de 3 vueltas por sesión precisamente para acotar los minutos facturados de Cloudflare Stream (§0.5.5). **Abraham eligió sin techo**: el feed tiene que sentirse infinito de verdad y el costo es un costo de producto, no un descuido. Es el único punto donde la decisión se apartó de la recomendación, y se registra aquí para que ninguna sesión futura lo "arregle" por su cuenta.
- **Mitigación que ya existe y hay que preservar:** `useFeedActiveIndex.ts:56-77` corta la reproducción al irse a background o al salir del tab (viewability + `AppState` + foco de tab). La factura solo corre con la app en primer plano y el feed a la vista.
- **Mitigación que NO existe y NO entra:** pausa por inactividad (sin swipe durante N minutos). Se **nombra** como candidata a derivada `hardening(<origen>)` si el consumo medido lo justifica; no se implementa de forma preventiva.

## 21. Promoción / descarte

✅ **LISTO PARA PROMOVER.** Cero preguntas abiertas, los 9 criterios de aceptación (§13) están redactados de forma verificable, y no hay gate de aprobación de diseño pendiente (`APROBACION_DISENO: no` — el chip reusa un componente ya aprobado).

- **Tarea propuesta:** `#285 — feed infinito: la vuelta se reinicia barajada al agotar el inventario` (siguiente id libre; `add-task` está roto por el gotcha de §4 → se escribe directo en `.taskmaster/tasks/tasks.json` con respaldo `.bak` y validación con `task-master list` / `validate-dependencies`).
- **Desglose sugerido (5 subtareas):** (1) key con vuelta *(crítica)* · (2) barajado con semilla *(crítica)* · (3) wrap + re-fetch en el hook *(crítica)* · (4) anuncios en la costura *(crítica)* · (5) chip de costura *(ligera)*.
- **Riesgo de producción viva (§0.5):** **nulo por construcción** — cero migraciones, cero EFs, cero contratos publicados tocados. Todo el cambio es JS/UI ⇒ **viaja por OTA** (`cd mobile && pnpm ota "<mensaje>"` desde `main` ya mergeado).
- **Comando siguiente:** `/tm-plan 285`.
- **Derivadas nombradas, NO creadas:** (a) `producto(285)` — RPC de feed con epoch/ranking servidor (dirección B), para cuando entren follow y comentarios; (b) `hardening(285)` — pausa por inactividad, solo si el consumo de Stream medido lo justifica; (c) poda por la cabeza de `data`, solo si el smoke muestra crecimiento monótono de heap. Las tres se abren **con las 4 marcas del §5** el día que se decidan.
