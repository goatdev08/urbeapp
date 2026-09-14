---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: L             # XS | S | M | L | XL
fecha: 2026-09-14
estado: aprobado      # borrador → en-revision → aprobado | descartado
tarea_id: 296         # promovida 2026-09-14
motivo_descarte:
---

# Más tabs superiores en el feed (tipo TikTok) + botón de filtros a la izquierda

> Documento de exploración de `/tm-explore`. Fase de **propuesta**: se exige divergencia
> (CLAUDE.md §0) — aquí hay 10 candidatos a tab y 4 direcciones. Ponytail vuelve a aplicar
> al plan de implementación que salga de aquí.

## Idea original

> "Agregar más tabs superiores en el feed, tipo las de TikTok (Para ti / Siguiendo / etc.).
> Dar recomendaciones de selecciones DISTINTAS además de Venta/Renta que sirvan con nuestro
> backend actual. Los tabs superiores deben cargar rápido al cambiar de uno a otro (sin
> spinner/latencia perceptible). Además, mover el botón de filtros del feed del lado derecho
> al lado izquierdo." — Abraham, 2026-09-14

---

## Lluvia de ideas

### Parte 0 — Hallazgos que condicionan TODO lo demás (leer antes de elegir tabs)

1. **Hoy el feed SIEMPRE se ordena por cercanía.** `fetchFeedProperties`
   (`mobile/src/features/feed/lib/feedProperties.ts:224-300`) llama SIEMPRE a la RPC
   `properties_within_radius(p_lat,p_lng,p_radius_m)` → `{id, distance_m}[]` ordenada por
   distancia, corta la página de 10 **sobre esos ids** y recién entonces consulta PostgREST.
   Consecuencia: **"Cerca de mí" no puede ser una tab diferenciadora** (es el
   comportamiento por defecto), y **cualquier tab con otro orden (Nuevos, Populares, Para ti)
   necesita backend nuevo** — el cliente no tiene `created_at`/`like_count` del universo de
   ids, solo de las 10 filas que ya trajo.
2. **Las tabs con predicado selectivo sufren "páginas cortas".** El `FilterState` se aplica
   *después* del slice de 10 ids (`build_filter_query` sobre `.in('id', page_ids)`) — techo
   ya aceptado en #42.2 y anotado en [[busqueda-y-filtros]]. Con Venta/Renta apenas se nota;
   con «Siguiendo» o «Terrenos» una página puede volver **vacía** aunque haya inventario.
   Cualquier tab nueva y selectiva empuja a mover el filtro **dentro** de la RPC.
3. **Inventario real ≈ 8 propiedades activas en producción** (smoke de #285: "26 swipes
   sobre 8 propiedades"; #250: "las 8 propiedades activas de producción"). Es **el riesgo
   número uno**: 6 tabs sobre 8 propiedades = 6 tabs que muestran casi lo mismo, o tabs
   vacías frente a inversores. La elección de tabs debe optimizar *"nunca vacía"* antes que
   *"muy específica"*.
4. **Ya existe backlog para esto:** `#74.3 «RPC de ranking §9.8 (PostGIS + score)»` sigue
   **pending** (PRD §9.8: intención del onboarding, cercanía, preferencias, frescura,
   anti-clustering, expansión de radio, bucle). Y la exploración 047 §derivadas nombró
   explícitamente `producto(285)` — *"RPC de feed con epoch/ranking servidor (dirección B),
   **para cuando entren follow y comentarios**"*. Follow (#78) y comentarios (#289) ya
   entraron: **este es ese momento**. Reusar > reescribir: la tarea de ranking no se inventa
   aquí, se conecta con #74.3.
5. **#78 dejó «Siguiendo» explícitamente fuera** ("sin sección Siguiendo ni aviso de nuevo
   video", decisión de Abraham 2026-09-10) — pero la tabla `follows` y `useFollow` ya están
   **desplegados en producción**. Reabrir esa decisión es justo lo que pide esta idea.
6. **El chrome superior del feed ya está lleno.** Fila superior actual
   (`FeedScreen.tsx:290-310`): scrim + `FeedSectionTabs` centrado + botón de filtros a la
   **derecha**; debajo cuelgan `RefreshingChip` y `ZoneActiveChip`. Y arriba-**izquierda**
   ya vive un elemento **legal e intocable**: el badge «Patrocinado»/«Anuncio» de
   `AdFeedItem.tsx:279-285` (`left: spacing.s_16`, `top: insets.top + s_8`), cuya posición
   fija fue aprobada en el gate de 170.8 precisamente para que nada la empuje. **Mover el
   botón de filtros a la izquierda lo pone encima del badge legal en cada anuncio.**

### Parte 1 — Candidatos a tab (10), con lo que el backend YA sirve

| # | Tab | Qué la sirve hoy | Falta | Valor | Riesgo |
|---|-----|------------------|-------|-------|--------|
| 1 | **Venta / Renta** (actual) | `filters.operation_types` + `build_filter_query`; `'both'` cae en ambas | nada | base ya entendida por el usuario | ocupa el eje de tabs con un *filtro*, no con una *fuente* |
| 2 | **Siguiendo** | `follows` (#78, desplegado; `follows_select` deja al follower leer SUS filas) + `properties.owner_user_id` ya en `FEED_SELECT` | **S** cliente (path propio sin radio: `.in('owner_user_id', ids)` + orden `published_at` desc + `mint_videos`) o **M** si va dentro de la RPC | paridad TikTok real; le da sentido económico al follow recién lanzado (el publicador gana algo por seguidores) | **vacía para casi todos hoy** (follow tiene días); necesita empty state que no parezca bug |
| 3 | **Nuevos / Recién publicados** | `properties.published_at`/`created_at` + índice `properties_feed_idx (status, created_at desc)` | **S** (consulta plana ordenada, sin RPC) o **M** (param de orden en RPC aditiva, conserva radio) | frescura = razón para volver; el inversor lo entiende de inmediato | con 8 propiedades ≈ el mismo feed en otro orden |
| 4 | **Populares / Tendencia** | `like_count`, `save_count`, `view_count`, `comment_count` (denormalizados, triggers atómicos #13/#289) | **S** (PostgREST `.order('like_count', desc)`) o **M** (score compuesto en RPC) | prueba social; aprovecha likes/comentarios ya vivos | números diminutos → orden ≈ ruido; **gameable** (auto-like); expone qué se ve poco |
| 5 | **Por tipo** (Casas · Deptos · Terrenos · Locales · Oficinas) | enum `property_type` + `build_filter_query` | **XS** UI / **S–M** para que no dé páginas cortas (filtro dentro de la RPC) | es lo que un usuario **inmobiliario** de verdad quiere segmentar | 5 tipos × 2 operaciones fragmentan 8 propiedades; muchas tabs vacías |
| 6 | **Para ti** (ranking real) | `user_preferences` (operación, tipos, presupuesto, recámaras, radio) + `events_raw` (`video_view`/`video_completed`/`video_progress`, #112/#268) + contadores | **M–L**: RPC `SECURITY DEFINER` (events_raw es **service_role only**) siguiendo PRD §9.8 = **#74.3** | la narrativa "TikTok inmobiliario" que vende la demo | con 8 propiedades y poca señal es indistinguible de aleatorio; **no se puede verificar visualmente** que "funciona"; datos de conducta = privacidad |
| 7 | **Guardados** | `saves` + hook `useSavedProperties` ya existentes | **S** (path propio) | volver a ver lo guardado **en video** (la tab actual es grilla) | **duplica** la tab «Guardados» de la tab bar; vacía para usuarios nuevos |
| 8 | **Nicho: Pet friendly · Sin aval · Estudiantes** | 3 booleanos con **índices parciales** ya creados en 0005 | **XS–S** (ya están en `FilterState`) | diferenciador real de Urbea en renta; barato | solo aplica a renta; inventario minúsculo por nicho |
| 9 | **Preventa / Nuevo desarrollo** | **nada** — no existe columna | **M**: migración aditiva (`is_preconstruction` o enum), UI del wizard, backfill, decisión de producto | alto valor comercial (desarrolladoras) | no hay dato hoy; no entra en una v1 |
| 10 | **Oportunidad / Precio bajo zona** | `price` + `zone`/colonias DCAH | **M–L**: mediana por zona + RPC | gancho de descubrimiento fuerte | con 8 propiedades la mediana no existe; fácil de percibir como engaño |

*(Descartados por no aportar tab: «Cerca de mí» = el default actual, ver hallazgo 1;
«Con recorrido» = `duration_seconds` existe pero no segmenta nada; «Destacados» = sería una
tab de anuncios, riesgo legal/UX.)*

### Parte 2 — Direcciones (agrupaciones), con trade-offs

#### Dirección A — "Social tipo TikTok": `Para ti · Siguiendo`
Dos tabs de **fuente**; Venta/Renta baja al `FilterSheet` (de donde salió en #241) o a una
segunda fila de chips. «Para ti» = ranking §9.8 (#74.3), «Siguiendo» = `follows`.
- ✅ Es literalmente lo que pidió Abraham y lo que el inversor reconoce.
- ✅ Capitaliza #78 (follow) y #289 (comentarios) recién lanzados; cierra la derivada
  `producto(285)` que quedó nombrada en el doc 047.
- ❌ «Para ti» honesto exige RPC de ranking (**M–L**, backend + pgTAP + guardian) y aun así,
  con 8 propiedades, **no se distingue del feed actual** — riesgo de "humo" ante el cliente.
- ❌ «Siguiendo» hoy sale vacía para el 100 % de los testers → la segunda tab de la app
  parece rota el día del demo.
- ❌ Quitar Venta/Renta de la barra superior es una regresión de #241 (decisión de Abraham
  de hace 12 días) y desacopla el mapa, que hoy **sigue la sección** vía `FilterState`.

#### Dirección B — "Descubrimiento por orden": `Cerca · Nuevos · Populares`
Mismo universo de propiedades, **tres órdenes distintos**. Una RPC aditiva
`properties_feed_ranked(p_lat,p_lng,p_radius_m,p_sort)` (o `p_order text`) devuelve
`{id, distance_m, rank}`.
- ✅ **Ninguna tab puede quedar vacía**: las tres muestran el mismo inventario. Es la única
  dirección inmune al hallazgo 3 (8 propiedades).
- ✅ Un solo cambio de backend, aditivo, cubre las tres; y es el escalón natural hacia §9.8.
- ✅ El cambio instantáneo entre tabs es trivial de cachear (mismo conjunto, distinto orden).
- ❌ Con 8 propiedades las tres tabs se **ven casi iguales** → el usuario no percibe valor.
- ❌ Suena a "ordenar", no a "descubrir"; menos parecido a TikTok que lo pedido.

#### Dirección C — "Intención inmobiliaria": `Venta · Renta · Casas · Deptos …`
Se mantiene el eje de operación y se suman tabs de **tipo de propiedad** (y/o los nichos
pet friendly / sin aval / estudiantes).
- ✅ **Cero backend nuevo en el caso feliz**: `property_type` y los booleanos ya están en
  `FilterState` y en `build_filter_query`, con índices parciales desde 0005.
- ✅ Es lo que un buscador de vivienda realmente quiere segmentar.
- ❌ Mezcla dos ejes (operación + tipo) en una sola fila: seleccionar «Casas» ¿anula
  «Renta»? Conceptualmente sucio.
- ❌ Fragmenta el inventario al extremo (5 tipos × 2 operaciones sobre 8 propiedades).
- ❌ Arrastra el bug de **páginas cortas** post-slice (hallazgo 2) justo donde más duele.

#### Dirección D — **[RECOMENDADA]** Híbrido de dos ejes, en dos filas
**Fila 1 (fuente, tipo TikTok):** `Para ti · Siguiendo · Nuevos` — con «Para ti» **default** y
definida con honestidad (ver Q3: puede ser el feed de cercanía actual **renombrado**, sin
prometer IA, hasta que #74.3 exista).
**Fila 2 (contexto, chips pequeños):** `Venta · Renta` se conserva como hoy — sigue siendo
`filters.operation_types`, sigue mandando en el mapa, sigue persistiendo. Cero regresión de #241.
- ✅ Separa **fuente** de **filtro**, que es exactamente lo que TikTok hace (Para ti/Siguiendo
  son fuentes; el filtro vive en otro lado). Evita la pregunta imposible de la dirección C.
- ✅ Permite entregar por fases: fase 1 sin backend nuevo (Para ti = cercanía actual,
  Siguiendo = path cliente sobre `follows`, Nuevos = orden por `published_at`), fase 2
  cambia «Para ti» a la RPC de ranking real (#74.3) **sin tocar la UI**.
- ✅ «Siguiendo» vacía tiene salida digna: empty state con CTA + fallback opcional.
- ❌ Dos filas comen ~60 pt de alto sobre el video (el feed es inmersivo) → hay que medirlo
  en el preview; alternativa: fila 2 solo visible en «Para ti»/«Nuevos».
- ❌ Es la dirección con más superficie de UI → la más cara en aprobación de diseño.

### Parte 3 — Cómo se logra el "cambio de tab sin spinner"

| Opción | Cómo | Trade-off |
|---|---|---|
| **I1 [REC] Caché por tab en memoria + prefetch del vecino** | Un `Map<tab_key, {items, next_cursor, lap, scroll_index, fetched_at}>` en un provider (o en `useFeedProperties` elevado); una sola `FlashList` que cambia de dataset; al quedar idle se precarga la página 1 de las otras tabs (**datos y URLs firmadas, no reproducción**) | 100 % JS → **OTA-safe**, sin deps nuevas. Cambio instantáneo desde la 2ª visita. ⚠️ Las URLs firmadas de Stream **expiran (TTL 4 h)** → al restaurar caché vieja hay que **re-mintear** (#285 ya tuvo que re-pedir la página 1 por esto). Memoria: solo metadatos, no video. |
| **I2 Pager horizontal con N listas montadas** | Swipe lateral entre tabs, cada una con su `FlashList` viva | `react-native-pager-view` **no está instalado** → módulo nativo nuevo = **rebuild, NO OTA** (§3). Con `reanimated`+`gesture-handler` (ya instalados) se puede, pero N listas vivas = N pools de players → riesgo de memoria (#57) y de **reproducir dos videos a la vez** (cuota de Stream, §0.5.5). El gesto horizontal además compite con el swipe vertical del feed. |
| **I3 Prefetch solo de ids (sin mint)** | Se precarga la lista de ids de cada tab; el mint ocurre al entrar | Más barato en firmas, pero el primer video de la tab **sí** tarda → no cumple "sin latencia perceptible". |
| **I4 Un viaje que trae las N tabs** | RPC aditiva que devuelve los primeros k ids de cada tab en una llamada | Menos viajes al abrir; pero multiplica el batch de `mint-video-url` (firmas, no minutos) y complica el contrato. Buen candidato **solo** si la dirección elegida comparte inventario (dirección B). |

**Nota de cuota (§0.5.5):** precargar *datos* y *URLs firmadas* NO consume minutos de
Cloudflare Stream; lo que se factura es reproducir. La regla sigue siendo **un solo video
reproduciendo a la vez** — cualquier opción que deje dos listas activas la rompe.

### Parte 4 — El botón de filtros a la izquierda (parte XS… con una colisión)

Mover `styles.filter_btn` de `right: spacing.s_16` a `left: spacing.s_16`
(`FeedScreen.tsx:401-410`) es un cambio de una línea. **Pero** arriba-izquierda ya vive el
badge legal «Patrocinado»/«Anuncio» (`AdFeedItem.tsx:396-407`, `left: s_16`), cuya posición
fija fue **aprobada en el gate de 170.8** para que nada la desplace. En cada anuncio del feed
quedarían superpuestos. Salidas posibles (→ Q6):
(a) el badge legal se mueve a la derecha (requiere re-aprobar el elemento legal);
(b) el botón de filtros baja una fila **solo** en anuncios (condicional frágil);
(c) el botón de filtros se ancla a la izquierda pero **debajo** de la fila de tabs, siempre;
(d) en un ítem de anuncio el botón de filtros se oculta (hoy es alcanzable siempre menos en
skeleton/error).

---

## Problema / Motivación
El feed tiene una sola dimensión de navegación (Venta/Renta) y un solo orden posible
(cercanía). Para los testers e inversores el feed "se acaba" conceptualmente: no hay razón
para volver ni forma de descubrir distinto. Follow (#78) y comentarios (#289) acaban de
aterrizar y **no tienen superficie de consumo**: sigues a alguien y no pasa nada. Las tabs
superiores son el lugar natural para exponer esas señales y para que la app se lea como el
"TikTok inmobiliario" que promete. Además, el botón de filtros en la derecha compite con la
mano que hace swipe y con el rail de acciones.

## Resultado esperado
- El feed muestra **una sola fila de tabs superiores, deslizable horizontalmente** (tipo
  TikTok) con **5 tabs**: `Para ti · Siguiendo · Nuevos · Venta · Renta`. La tab activa se
  resalta; si no caben, la fila hace scroll lateral (el chrome no crece en alto).
- «Para ti» es la tab **default** cuando no hay sesión guardada; la tab elegida **persiste**
  entre sesiones (mismo mecanismo AsyncStorage del `filterStore`).
- Tocar una tab cambia el contenido **sin spinner perceptible** (< ~150 ms desde la 2ª
  visita en la sesión) y **sin perder** la posición de scroll de cada tab. Solo tap, sin swipe.
- Cada tab tiene contenido o un vacío explicado con CTA (nunca pantalla negra muda).
- El botón de filtros vive **a la izquierda**, a la altura de la fila de tabs; el badge legal
  «Patrocinado» de los anuncios pasa **a la derecha** (re-aprobado en el preview).
- El mapa **sigue la tab**: Venta→venta, Renta→renta, Para ti/Siguiendo/Nuevos→ambas.

## Alcance
- **SÍ entra:** fila de tabs deslizable (5 tabs) con estado propio persistido; «Para ti» =
  feed de cercanía actual renombrado (cero backend); «Siguiendo» = filtro en cliente por
  `follows.followed_user_id` → `properties.owner_user_id`, con empty state + CTA; «Nuevos» =
  consulta directa a `properties` ordenada por `published_at desc` sin radio, con los mismos
  filtros dentro de la query; caché por tab + prefetch de la tab vecina (opción I1); botón de
  filtros a la izquierda + badge legal a la derecha; preview HTML aprobable del chrome
  superior (frames: 3 estados de tab, con y sin anuncio, empty state de Siguiendo) y
  sincronización de la pantalla 4 del mockup canónico al cerrar.
- **NO entra:** ranking real §9.8 (queda en #74.3 y se conecta por dentro de «Para ti» en una
  fase 2); «Populares/Tendencia»; mover los filtros dentro de la RPC (deuda marcada +
  derivada `hardening(050)`); swipe horizontal entre tabs; pager nativo; anti-clustering
  (#74.4); popup de detalles (#74.6); tabs con datos inexistentes (Preventa, Oportunidad);
  follow a agencias; rediseño del rail o bloque inferior (#293); tab bar inferior.

## Roles afectados
- **Comprador/buscador:** es quien gana — nuevas formas de descubrir; riesgo de confusión si
  las tabs se ven iguales.
- **Inmobiliaria + agente:** «Siguiendo» y «Populares» cambian dónde aparece su inventario →
  incentivo real al follow y al engagement (y presión: tabs que premian números públicos).
- **Admin de plataforma:** sin cambios directos; si entra ranking, aparece una palanca nueva
  de configuración (`app_config`) que alguien debe poder mover.

## Impacto en datos
**Cero migraciones en la v1.** Todo sale de columnas y tablas existentes:
- «Para ti» y Venta/Renta: `properties_within_radius` intacta (contrato publicado §0.5.2).
- «Siguiendo»: `follows` (RLS `follows_select` abre solo las filas del propio follower, #78)
  → lista de `followed_user_id` → filtro `owner_user_id in (...)` sobre la página del feed.
  Hereda el bug de páginas cortas (filtro tras el slice de 10 ids) → deuda marcada
  `// ponytail: deuda` + derivada `hardening(050)`: RPC aditiva que reciba filtros y follows.
- «Nuevos»: PostgREST `from('properties')` con `build_filter_query` + `status='active'` +
  `order('published_at', desc)` + paginación por rango. Sin radio (lo nuevo de toda la
  ciudad). Los filtros van **dentro** de la query → sin páginas cortas en esta tab.
- Fase 2 (fuera de alcance, ya nombrada en #74.3): `properties_feed_ranked(...)` aditiva,
  `SECURITY DEFINER`, `revoke from public, anon` + `grant to authenticated`, pgTAP + rollback.
  Personalización por conducta solo vía función `SECURITY DEFINER` (`events_raw` es
  `service_role`-only). Orden seguro: backend → cliente.

## Impacto en UI
- `mobile/src/features/feed/components/FeedSectionTabs.tsx` — hoy asume **exactamente 2**
  tabs sin scroll (`// ponytail: dos Pressable con Text — sin ScrollView (solo hay 2 tabs)`).
  Con 3+ hay que decidir scroll horizontal vs. repartir el ancho. ⚠️ Un `ScrollView`
  horizontal sobre el video tiene precedente de dolor en Android (zona muerta al tacto,
  memoria `android_overlay_scrollview_dead_zone`).
- `mobile/src/features/feed/FeedScreen.tsx` — fila superior, posición del botón de filtros,
  offsets de `RefreshingChip` y `ZoneActiveChip` (ambos cuelgan de
  `top_row_y + FEED_SECTION_TABS_HEIGHT`).
- `mobile/src/features/feed/hooks/useFeedProperties.ts` — caché por tab, prefetch, reset de
  `lap`/keys (`feed_key_extractor` produce `kind:id#lap`; una caché que reviva una lista con
  `lap` incoherente **rompe el render de FlashList**, #285).
- `mobile/src/features/search/lib/feedSection.ts` + `filterStore.tsx` — hoy la sección **ES**
  `filters.operation_types`, compartido con el mapa. Un eje de "fuente" **no debe** filtrar
  el mapa → probablemente estado nuevo, separado del `FilterState` (→ Q9).
- `mobile/src/features/feed/components/AdFeedItem.tsx` — solo si se decide mover el badge legal.
- ⚠️ **Componente de firma:** el chrome superior del feed es la primera pantalla de la app y
  su elemento más visible → **preview HTML aprobable** antes de portar a RN (§8). Precedente
  atenuante: #241 resolvió los 2 tabs con **mini-spec escrito**, sin preview (→ Q7).

## UI/interacción fuera del mockup
Abiertas las dos referencias canónicas:
- `urbea-identidad-visual.html` **pantalla 4 · Feed vertical** (líneas 860-900): la fila
  superior dibuja **chip de operación a la izquierda** («Renta») y **contador de videos a la
  derecha** («1/3»). **No dibuja tabs superiores ni botón de filtros.**
- `Urbea Prototipo (standalone).html`: no contiene «Para ti», «Siguiendo», «Nuevos»,
  «Cerca» ni «Tendencia» en ninguna pantalla; tampoco dibuja tabs de feed.

Es decir, **la fila de tabs actual ya vive fuera del mockup** desde #241 (documentado en el
docblock de `FeedSectionTabs.tsx` como "UI ausente del mockup canónico"). Lo pedido vuelve a
caer fuera, en dos frentes:

**UI_FUERA_DEL_MOCKUP (1/2):** tabs superiores de N fuentes + reubicación del botón de
filtros · el mockup solo dibuja un chip de operación y un contador; sin tabs la idea no
existe y sin mover el filtro no se cumple lo pedido · **costo M**.
  → opción 1 (**en conjunto**): entra en esta tarea — implica preview HTML del chrome
    superior completo (tabs + filtro + badge legal + chips colgantes, frames claro y oscuro,
    con y sin anuncio), decidir scroll vs. reparto de ancho, y **sincronizar la pantalla 4
    del mockup canónico** al cerrar (como se hizo en #293).
  → opción 2 (**DEFAULT**): derivada `producto(050)` — *«producto(feed): chrome superior del
    feed con N tabs de fuente y filtros a la izquierda»*. Descripción: «Origen: exploración
    050 · Detectado por: usuario. El mockup canónico (pantalla 4) dibuja chip de operación +
    contador, no tabs ni botón de filtros; #241 ya añadió 2 tabs por mini-spec. Esta tarea
    diseña y aprueba el chrome superior definitivo (preview HTML, frames claro/oscuro, con y
    sin anuncio) y sincroniza `urbea-identidad-visual.html`.» `dependencies`: tarea origen;
    backlink `DERIVADAS:` en el origen.

**UI_FUERA_DEL_MOCKUP (2/2):** colisión del botón de filtros (izquierda) con el badge legal
«Patrocinado»/«Anuncio» de `AdFeedItem` · el badge tiene posición fija **aprobada** y es
obligación legal; dos elementos no pueden ocupar el mismo punto · **costo S**.
  → opción 1 (**en conjunto**): se resuelve dentro de esta tarea eligiendo (a)/(b)/(c)/(d) de
    la Parte 4 y re-aprobando el elemento legal si se mueve.
  → opción 2 (**DEFAULT**): derivada `producto(050)` — *«producto(feed): reubicar el badge
    legal del anuncio para liberar la esquina superior izquierda»*, con el preview y la
    re-aprobación del gate de 170.8.

*(Cupo §8/§0: 2 propuestas — cumplido. Nada más se propone; lo demás solo se nombra.)*

## Reglas no obvias aplicables
- 🔴 **Contrato publicado (§0.5.2):** `properties_within_radius` la llaman los builds
  instalados → RPC de orden/ranking **aditiva**, nunca modificar la existente —
  `supabase/migrations/20260706000001_properties_within_radius_rpc.sql`.
- 🔴 **Cuota de Stream (§0.5.5 · memoria `video_playback_burns_quota`):** un solo video
  reproduciendo; precargar datos/URLs sí, reproducir N tabs no; todo smoke termina en `stopApp`.
- 🔒 **Invariante A1** — `radius_m` y `area` **NUNCA** pasan por `build_filter_query`; son
  parámetros de la RPC — [[busqueda-y-filtros]].
- 🔒 **`operation_type='both'` aparece en las dos secciones** — cualquier tab nueva que
  filtre operación debe respetarlo — `mobile/src/features/search/lib/feedSection.ts`.
- 🔒 **`events_raw` es append-only y solo `service_role`** (RLS `20260808000001`) →
  personalización solo vía `SECURITY DEFINER`/EF; "registrar ≠ exponer" —
  [[privacidad-datos]].
- 🔒 **`follows_select` solo abre la fila al propio follower** (#78): el cliente puede
  resolver "a quién sigo", **jamás** "quién sigue a X" — `20260914100001_follows.sql`.
- 🔒 **URLs firmadas de Stream expiran (~4 h)** → una caché por tab debe re-mintear al
  restaurar; el token va en el PATH y un 404 disfraza el fallo de firma —
  [[feed-vertical-video]].
- 🔒 **Keys de FlashList con `lap`** (`kind:id#lap`, #285): restaurar una caché con `lap`
  incoherente rompe el render — `mobile/src/features/feed/lib/feedKeyExtractor.ts`.
- 🔒 **`bounces` en iOS** es obligatorio para que el pull-to-refresh viva
  (memoria `ios_refreshcontrol_needs_bounces`); **overlay absoluto sobre ScrollView en
  Android** = zona muerta al tacto (`android_overlay_scrollview_dead_zone`) — aplica si las
  tabs pasan a ser un carrusel horizontal.
- 🔴 **OTA:** cualquier dependencia nativa nueva (p. ej. `react-native-pager-view`) **exige
  rebuild y rompe la ruta OTA** (§3, `estrategia-releases`).
- **Criticidad TDD determinista (§5):** `mobile/**/lib/**` y `mobile/**/hooks/**` (caché por
  tab, selección de fuente, orden) → **CRÍTICA, TDD estricto**;
  `supabase/migrations/**` (RPC nueva) → **CRÍTICA + pgTAP + rollback**;
  `components/**` y pantalla (tabs, posición del botón) → verificación ligera.
- **PNPM** para todo; identificadores propios en **snake_case**.

## Arquitectura / enfoque técnico  (L/XL)
1. **Estado `feed_tab`** (`'para_ti' | 'siguiendo' | 'nuevos' | 'venta' | 'renta'`) en su
   propio store ligero, persistido en AsyncStorage con el mismo patrón del `filterStore`
   (hidratación fail-safe → `'para_ti'`, debounce 500 ms). **Deriva** `operation_types`:
   `venta → ['sale']`, `renta → ['rent']`, resto → ambas. Esa derivación reemplaza a
   `section_from_filters`/`with_section` como fuente de la sección, y el mapa la sigue sin
   cambios propios. (`operation_type='both'` sigue apareciendo en ambas.)
2. **Resolución por tab en `lib/`** (pura, TDD): `tab → estrategia de fetch`:
   `proximidad` (la actual, `fetchFeedProperties` intacta; sirve a Para ti/Venta/Renta),
   `por_owner` (Siguiendo: `follows` → `owner_user_id in`), `ordenada` (Nuevos: PostgREST
   ordenada por `published_at`). **Reuso:** `mint_videos`, `build_feed_data`,
   `fetch_agent_profiles`, `interleave_ads_with_state`, `feed_key_extractor` no se duplican.
   **REUSO_CON_RESERVA registrado:** el pipeline "RPC → slice 10 → filtros client-side" es
   deuda; se reusa para Siguiendo con `// ponytail: deuda` y derivada `hardening(050)`
   (decisión de Abraham, Q9).
3. **Caché por tab (I1):** `Map<tab, {items, next_cursor, lap, scroll_index, fetched_at}>`
   + frescura (re-mint si `fetched_at` supera el TTL de la URL firmada, ~4 h) + prefetch en
   idle de la página 1 de las tabs vecinas (**datos y URLs, nunca reproducción**).
   `lap` se preserva por tab para que las keys `kind:id#lap` de FlashList no colisionen.
   **Lógica pura → TDD estricto + guardian.**
4. **Una sola `FlashList` montada**; al cambiar de tab se intercambia el dataset y se
   restaura `scroll_index`. Nunca dos listas activas (cuota §0.5.5 + memoria #57).
5. **Chrome:** `FeedSectionTabs` pasa de 2 Pressables a fila con `ScrollView` horizontal
   (`nestedScrollEnabled`, render inline — precedente del dead zone Android #231); botón de
   filtros `left: s_16`; badge legal de `AdFeedItem` a `right: s_16`; offsets de
   `RefreshingChip`/`ZoneActiveChip` sin cambio de alto.
6. **Backend:** ninguno en la v1. Todo sale por **OTA**.

## Fases / épicas  (L/XL)
**Una sola tarea** (decisión Q-tareas) con las fases como subtareas, en serie:
1. Preview HTML aprobable del chrome superior (firma, §8) → aprobación de Abraham.
2. Chrome: fila de tabs deslizable (5 tabs, solo tap) + botón de filtros a la izquierda +
   badge legal a la derecha. Ligera (tsc + lint + smoke).
3. Estado `feed_tab` persistido + derivación de `operation_types` (mapa la sigue). Crítica
   (`lib/**`/`hooks/**`, TDD).
4. Fuentes «Siguiendo» (cliente sobre follows + empty state con CTA) y «Nuevos» (PostgREST
   ordenada). Crítica (`lib/**`, TDD).
5. Caché por tab + prefetch de vecinas + restauración de scroll, un solo player. Crítica (TDD
   + guardian).
6. Smoke Android + iOS por CLI (sin skeleton en el 2º tap, frame con anuncio, empty state),
   terminando en `stopApp`; sincronizar pantalla 4 del mockup; ingest al vault; OTA.
**Fase 2 (otra tarea, ya existe como #74.3):** ranking real detrás de «Para ti».
**Derivada `hardening(050)`:** filtros y follows dentro de una RPC aditiva (páginas cortas).

## Criterios de aceptación
- [ ] La fila superior muestra exactamente `Para ti · Siguiendo · Nuevos · Venta · Renta`,
      deslizable horizontalmente si no cabe, tab activa resaltada, cambio solo por tap.
- [ ] Sin sesión guardada la app abre en «Para ti»; la tab elegida se conserva al reabrir.
- [ ] «Para ti» muestra el mismo contenido que hoy el feed de cercanía con ambas operaciones.
- [ ] «Venta»/«Renta» muestran solo esa operación (más `'both'`) y el mapa refleja la misma
      operación; en Para ti/Siguiendo/Nuevos el mapa muestra ambas.
- [ ] «Siguiendo» muestra solo propiedades cuyo `owner_user_id` está entre mis follows; sin
      follows (o sin inventario) muestra un vacío explicado con CTA, nunca skeleton infinito.
- [ ] «Nuevos» lista propiedades activas ordenadas por `published_at` descendente
      (verificable contra una consulta SQL de solo lectura en producción).
- [ ] Cambiar de tab **no muestra skeleton** a partir de la 2ª visita a esa tab en la sesión
      (medido por dumps de UI antes/después del tap, patrón #285/#288).
- [ ] Cada tab conserva su posición de scroll al volver.
- [ ] Un solo video reproduciendo en todo momento (cuota); el prefetch no reproduce.
- [ ] Al restaurar una caché con URLs firmadas vencidas se re-mintea (sin 404 disfrazado).
- [ ] El botón de filtros está a la izquierda y el badge legal «Patrocinado» a la derecha,
      sin superposición, verificado en un frame con anuncio real.
- [ ] Preview HTML aprobado por Abraham antes de portar; pantalla 4 del mockup sincronizada.
- [ ] Cero migraciones; `pnpm tsc --noEmit` + `pnpm lint` verdes; suites del feed verdes;
      smoke Android e iOS por CLI terminando en `stopApp`.

## Dependencias
- **#78** (follows, desplegado) — habilita «Siguiendo».
- **#289** (comentarios, `comment_count`) — señal para «Populares».
- **#241/#242/#243/#248/#285/#288/#293** — todo el chrome superior y la mecánica del feed
  actual; esta tarea los toca a todos.
- **#74.3** (pending, «RPC de ranking §9.8») — **debe conectarse**, no duplicarse.
- Derivada nombrada en el doc 047: `producto(285)` "RPC de feed con epoch/ranking servidor" —
  esta exploración la materializa.
- Código a reusar: `lib/feedProperties.ts` (`mint_videos`, `build_feed_data`),
  `lib/interleaveAds.ts`, `lib/feedKeyExtractor.ts`, `components/FeedSectionTabs.tsx`,
  `hooks/useFollow.ts`, `hooks/useSavedProperties`.

## Edge cases / riesgos
- 🔴 **Inventario de 8 propiedades activas**: tabs vacías o idénticas frente a inversores. Es
  el riesgo mayor y debe decidirse antes de codear (Q5).
- 🔴 **Colisión del botón de filtros con el badge legal del anuncio** (obligación legal).
- 🔴 **Cuota de Stream**: cualquier diseño que deje 2 listas vivas puede reproducir dos
  videos a la vez y facturar doble.
- **URLs firmadas expiradas** al restaurar caché → video muerto con 404 disfrazado.
- **`lap` y keys de FlashList** al restaurar caché → "same key" y render roto.
- **Páginas cortas** (hallazgo 2) amplificadas por tabs selectivas.
- **Regresión de #241**: si el eje de fuente se mete en `FilterState`, el mapa hereda
  «Siguiendo» y deja de tener sentido.
- **Gestos**: tabs con scroll horizontal sobre una FlashList vertical (Android dead zone,
  conflicto de pan).
- **Percepción de "recomendación" sin recomendación**: llamar «Para ti» a un orden por
  cercanía puede leerse como engaño si se promete personalización.

## Plan de pruebas (alto nivel)
- **CRÍTICO (TDD estricto + guardian):** caché/prefetch por fuente y selector de estrategia
  (`lib/**`, `hooks/**`); si entra RPC, **pgTAP** con rollback probado (orden correcto,
  `status='active' and deleted_at is null`, grants: `anon` sin EXECUTE, `authenticated` sí).
  ⚠️ Lecciones vigentes: el reset/estado se prueba **desde estado poblado**
  (`reset_solo_se_prueba_desde_estado_poblado`); un test de una condición entre varias
  **apaga las demás** en el fixture.
- **Ligero:** tabs, posición del botón, empty states → `pnpm tsc --noEmit` + `pnpm lint` +
  smoke por CLI (adb / simctl), con un frame de anuncio, terminando en **`stopApp`**.
- **Medición explícita del "sin spinner":** dumps de UI antes/después del tap de tab para
  confirmar que no aparece el skeleton (patrón #285/#288).
- Datos: hará falta seguir a alguien y tener ≥2 publicadores con inventario para que
  «Siguiendo» no sea vacua; {? ¿se puebla el remoto con propiedades de prueba o se prueba en
  local? — NUNCA seeds al remoto, §0.5.1}.

## Impacto en PRD (solo referencia — NO se edita)
`docs/PRD.md` §9.8 (ranking del feed: intención del onboarding, cercanía, preferencias,
frescura, anti-clustering, expansión de radio, bucle) y §9.4 (filtros rápidos). Una eventual
actualización tendría que describir las fuentes del feed, que hoy el PRD no contempla.

## Decisiones del intake
Rondas de `AskUserQuestion` del 2026-09-14 (Abraham):
- **Q1 Dirección:** una sola fila social tipo TikTok. **Aclaración de Abraham:** Venta y Renta
  **se mantienen como tabs** en la misma fila (no van al FilterSheet); si no caben, la fila
  es **deslizable lateralmente** como TikTok. «Para ti» es el default sin sesión guardada.
- **Q2 Tabs v1:** Para ti + Siguiendo + Nuevos (más Venta/Renta). Populares fuera.
- **Q3 «Para ti»:** el feed de cercanía actual renombrado; ranking real en fase 2 (#74.3).
- **Q4 «Siguiendo»:** en cliente sobre `follows` + empty state con CTA. Reabre la decisión
  de #78 de dejarla fuera.
- **Q5 Vacíos:** empty state explicado + CTA (implícito en Q4; Nuevos/Para ti no pueden
  quedar vacías sin que el feed entero lo esté).
- **Q6 Filtros vs badge:** botón a la izquierda; el badge legal «Patrocinado» se mueve a la
  derecha (re-aprobar en el preview, gate de 170.8).
- **Q7 Gate de diseño:** preview HTML aprobable antes de portar.
- **Q8 Gesto:** solo tap.
- **Q-mapa:** el mapa sigue la tab (Venta→venta, Renta→renta, resto→ambas).
- **Q-nuevos:** consulta directa a `properties` ordenada por fecha, sin radio (cero backend).
- **Q9 Páginas cortas:** no se ataca; deuda marcada + derivada `hardening(050)`.
- **Q-tareas:** una sola tarea con las fases como subtareas.
- **Persistencia:** la tab elegida persiste entre sesiones (dicho por Abraham en Q1).

## Promoción / descarte
**Aprobada por Abraham el 2026-09-14 → tarea #296** (`producto(293)`, prioridad high,
dependencias #78, #293, #241; backlink `DERIVADAS: #296` en los details de #293). Escrita
directo en `tasks.json` con respaldo `.bak` y `validate-dependencies` verde (`add-task` roto,
CLAUDE.md §4). `analyze-complexity` omitido por la misma razón (generateObject roto);
estimación manual: **nivel L**, 6 subtareas (ver Fases). Derivadas a abrir al cerrar:
`hardening(296)` (páginas cortas → RPC aditiva) y enlace a #74.3 (ranking real).
Siguiente paso: `/tm-plan 296`.
