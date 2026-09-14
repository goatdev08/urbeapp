---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: M             # M-alto: UI en 5 archivos + UNA subtarea crítica (lib/feedProperties.ts, TDD estricto)
fecha: 2026-09-13
estado: aprobado
tarea_id: 293
motivo_descarte:
---

# Rediseño del layout del overlay del feed (limpieza estilo Reels)

> Documento de exploración de `/tm-explore`. **Fase PROPUESTA**: ponytail NO aplica aquí;
> vuelve a aplicar en `full` al plan de implementación que salga de este doc.
> Las 11 preguntas abiertas fueron respondidas por Abraham el 2026-09-13 (ver
> «Decisiones del intake»): este doc ya NO tiene huecos.

## Idea original

Abraham, 2026-09-13 (verbatim): *"rediseñemos el layout del feed, de manera que quede más limpio el espacio del feed, que los botones solo sean el outline y no estén dentro de un círculo, además el botón de seguir debe ajustarse según el largo del nombre del usuario, anexo imagen de feed de insta como referencia"*.

**Referencia adjunta (captura de Instagram Reels), leída como spec:**
- Video a pantalla completa, sin marcos.
- **Columna derecha**: acciones apiladas; cada una es un **ícono blanco en trazo (outline), SIN círculo ni fondo**, con su **conteo debajo** (corazón, burbuja «530», repost «5,934», avión, marcador «5,716»), luego «…» y la miniatura de audio.
- **Abajo-izquierda**: fila **en línea** → avatar circular con anillo · nombre `oliversue_sydney` + badge verificado · **botón «Seguir» outline pegado al nombre** (borde blanco 1 px, fondo transparente, texto blanco, radio ~8, ancho = ancho de su texto).
- Debajo: caption truncado a 1 línea; debajo, línea de contexto social.
- Tab bar inferior negra sólida.

Es el primer punto de la lista de pendientes anunciados a testers el 2026-09-05 (memoria `roadmap_pendientes_sep_2026`, «remodelación del feed») que aún no tenía tarea: #285/#288 cubrieron el *feed infinito*, no el **layout del overlay**.

## Lluvia de ideas

Se exploraron 4 direcciones. **Abraham eligió la B** (con la fila de agente de A y los conteos de A acotados a like + comentarios).

### Dirección A — «Reels literal»
Rail sin círculos + conteo bajo **cada** ícono (like, comentarios, guardados, compartir) + caption truncado.
- Ganancia: máxima familiaridad y prueba social.
- Trade-off: obliga a traer `like_count` **y** `save_count` al feed (ruta crítica), y el caption/descripción ni siquiera viaja hoy en el select. **Descartada como paquete completo**; se le tomaron dos piezas (fila del agente en línea, conteos de like y comentarios).

### Dirección B — «Urbea limpio» ✅ **ELEGIDA**
Se quita el círculo/glass y se conserva la jerarquía Urbea: íconos outline blancos con realce de legibilidad propio, rail compacto, fila del agente en línea con «Seguir» pegado al nombre, bloque inferior intacto.
- Ganancia: el diff más corto que cumple lo pedido; cero migraciones; 100 % JS ⇒ OTA-safe.
- Trade-off asumido: sin cápsula, el contraste depende del realce que se apruebe en el preview (por eso la decisión 9).

### Dirección C — «Rail mínimo + overflow «…»»
Solo 3 acciones visibles; guardar y WhatsApp colapsados.
- **Descartada:** esconder WhatsApp esconde el CTA que alimenta el CRM (`contact-agent`, `contact_repeat`); un tap extra sobre el flujo que monetiza. Además el mock de `phosphor-react-native` de las suites enumera íconos y un «…» nuevo lo rompe sin ganancia.

### Dirección D — «Aire abajo» (condensar chips/dirección/precio/specs)
- **Descartada (decisión 7):** el bloque inferior se queda **tal cual**. Es información comercial que el mockup canónico sí dibuja; el aire que se busca se gana en el rail.

## Problema / Motivación

El overlay del feed creció por **agregación**: #9 lo sembró con 2 botones glass calcados del mockup, #10/#13 sumaron compartir, #145 la identidad del agente, #170.8 los anuncios, 289.10 comentarios y #78.4 la píldora «Seguir». Hoy el rail puede mostrar **5 pastillas glass de 46×46** apiladas, y la píldora «Seguir» queda **pegada al borde derecho** (`follow_button_wrap: { marginLeft: 'auto' }` en `PropertyOverlay.tsx`) en vez de junto al nombre — se lee como un botón suelto, no como parte de la identidad del agente. El video, que es el producto, queda con menos aire del que un feed vertical necesita.

🔎 **Hallazgo que cambia dónde se arregla lo pedido:** «que el botón de Seguir se ajuste al largo del nombre» **no se arregla en `FollowButton`** — ese componente ya mide exactamente lo que su texto (`Pressable` con `paddingHorizontal: 16`, sin ancho fijo). Lo que lo manda al borde es el **contenedor** del overlay. Y hoy el nombre del agente va **debajo** del avatar (`agent_name: { marginTop: spacing.s_4 }`), no a su derecha: pegar la píldora al nombre exige además pasar la fila a `avatar · nombre · Seguir` en línea.

## Resultado esperado

Al deslizar el feed: el video domina; las acciones se leen como **trazo blanco flotando sobre el video**, sin cápsulas, con el conteo de «me gusta» y de comentarios debajo de su ícono; el WhatsApp sigue siendo el único elemento con color de marca (verde sólido) y por eso salta; la fila del agente se lee como una unidad *avatar → nombre → Seguir*, con la píldora ajustada a su texto. Nada cambia funcionalmente: like, guardar, comentarios, compartir, WhatsApp, follow y navegación siguen idénticos, con los mismos `accessibilityLabel`/`testID` (son el contrato de la suite).

## Alcance

- **SÍ entra:**
  1. Rail de acciones sin cápsula: íconos outline blancos + realce de contraste aprobado en preview.
  2. Conteos bajo el ícono de **like** y de **comentarios** (el de comentarios ya existe desde 289.10).
  3. `like_count` en el select del feed + conteo optimista al dar/quitar like.
  4. Fila del agente en línea (`avatar · nombre · Seguir`) con la píldora pegada al nombre.
  5. `FollowButton`: nuevo estilo de píldora (radio ~8, borde 1 px) en **ambas** variantes → el perfil ajeno (`ProfileActions.tsx`) también cambia.
  6. `AdFeedItem`: mismo lenguaje visual del bloque inferior y de la identidad del anunciante.
  7. `ActionButtons.tsx` del **detalle**: se alinea al outline (deuda de copia aceptada, ver §REUSO_CON_RESERVA).
  8. `urbea-identidad-visual.html` pantalla 4 (`.fbtn` / `.frail` / `.feed-agent`) actualizado en el **mismo PR**.
  9. Preview HTML aprobable (frame claro + frame oscuro) **antes** de portar a RN.
- **NO entra (out of scope):** conteos de guardados y de compartir (decisión 2); condensar el bloque inferior (decisión 7); caption/descripción truncada; la tab bar (`GlassTabBar`/`NativeTabs`, firma de #65 — la referencia tiene barra negra sólida, pero es otra pantalla y otra decisión); ranking del feed (#74); cualquier cosa que nombre personas («le gusta a X y otras personas»); lógica de like/save/follow/comentarios; backend, migraciones y Edge Functions.

## Roles afectados

- **Comprador (rol dominante del feed):** es quien ve el cambio. Gana aire y prueba social (conteos); el riesgo es perder descubribilidad de una acción que hoy salta por su cápsula — mitigado dejando WhatsApp en verde sólido (decisión 3).
- **Inmobiliaria + agente:** su identidad (foto, nombre, «Seguir») gana protagonismo en la fila en línea; su CTA de contacto **no** se toca. En el **perfil ajeno** ven la píldora con el nuevo radio (decisión 6).
- **Admin de plataforma:** n/a — ninguna pantalla de `admin/` se toca.

## Impacto en datos

**Ninguna migración. Ningún cambio de contrato de backend.** Verificado:

- `properties.like_count` **ya existe** como columna: `supabase/migrations/20260604000005_properties_and_videos.sql:33` → `like_count int not null default 0 check (like_count >= 0)`.
- La mantiene un **trigger atómico** `AFTER INSERT OR DELETE` sobre `likes`: `supabase/migrations/20260701000001_engagement_count_triggers.sql` (función `public.update_like_count()`, `SECURITY DEFINER` + `search_path=''`, decremento con `GREATEST(0, like_count - 1)` para respetar el CHECK, + backfill de las propiedades ya publicadas). pgTAP: `supabase/tests/07_engagement_counts_test.sql`.
- Lo único que cambia es el **cliente**: agregar `like_count` a `FEED_SELECT` (`mobile/src/features/feed/lib/feedProperties.ts:111`) y al mapeo de `build_feed_data` con **fail-open a 0**, exactamente el patrón que ya usa `comment_count` (`feedProperties.ts:212`), más el campo en `FeedProperty` (`mobile/src/features/feed/types.ts`).
- 🔒 **§0.5.2 — aditivo y compatible hacia atrás:** pedirle más columnas a PostgREST no rompe ningún build instalado; los APKs de inversores y TestFlight siguen pidiendo su propio select. No hay deprecación ni orden OTA-primero que respetar.
- 🔒 **§0.5.1** — no se toca la DB remota: cero migraciones, cero seeds, cero resets.

## Impacto en UI

Footprint previsto (rutas reales; todo existente — lo único nuevo es el preview HTML):

| Archivo | Qué cambia | Crítico (§5) |
|---|---|---|
| `mobile/src/features/feed/lib/feedProperties.ts` + `types.ts` | `like_count` en `FEED_SELECT` + mapeo fail-open a 0 + campo en `FeedProperty` | 🔴 **SÍ — `features/feed/lib/**` ⇒ TDD estricto + guardian** |
| `mobile/src/features/feed/components/PropertyOverlay.tsx` | `styles.rail` / `action_btn` / `ActionButton` (outline sin cápsula + conteo), `agent_row` / `agent_info` / `agent_name` / `follow_button_wrap` (fila en línea, píldora pegada); `whatsapp_btn` **intacto** | NO (`components/**` ⇒ verificación ligera) |
| `mobile/src/features/feed/components/VideoFeedItem.tsx` | pasa `likeCount` al overlay y sostiene el conteo optimista (mismo patrón local que ya usa para `comment_count`) | NO |
| `mobile/src/components/FollowButton.tsx` | `styles.pill`: radio 20 → ~8, borde 1.5 → 1, en **ambas** variantes | NO |
| `mobile/src/features/profile/components/ProfileActions.tsx` | consume la variante `light` — verificar que el nuevo radio no desalinee la fila de acciones del perfil ajeno | NO |
| `mobile/src/features/feed/components/AdFeedItem.tsx` | coherencia del bloque inferior e identidad del anunciante (ver nota abajo) | NO |
| `mobile/src/features/property-detail/components/ActionButtons.tsx` | glass 46×46 copiado → outline, alineado al feed | NO |
| `urbea-identidad-visual.html` (raíz) | pantalla 4: `.fbtn` (líneas ~215–225), `.frail`, `.feed-rail`/`.feed-agent` (líneas ~391–397) | n/a (doc) |
| `.taskmaster/docs/exploraciones/049-.../preview/` *(nuevo)* | preview HTML aprobable: overlay sobre frame claro y frame oscuro | n/a (doc) |

⚠️ **Nota honesta sobre `AdFeedItem` (decisión 11):** **no tiene rail** — un anuncio no lleva like/guardar/comentarios/compartir; solo badge «Patrocinado»/«Anuncio», identidad del anunciante (`styles.identity`: logo + nombre **ya en línea**) y el CTA. O sea, «mismo lenguaje de rail» aquí se traduce en: (a) **no** introducirle un rail, (b) mantener su identidad alineada al nuevo tratamiento de la fila del agente (tamaño de avatar, anillo, gap, sombra del nombre — hoy lo calca de #145.4 por #248), y (c) **conservar el `INFO_BOTTOM` compartido** para que no reaparezca el salto de #206. Si el preview cambia el tamaño del avatar o el gap, el anuncio cambia con él.

⚠️ **Componente de firma → gate del §8 activo.** El rail glass (`.fbtn`: `rgba(23,20,15,.36)` + `backdrop-filter:blur(10px)` + borde `rgba(255,255,255,.2)`) es lenguaje visual de la identidad, compartido por feed y detalle. Quitarlo cambia la firma del producto ⇒ **preview HTML aprobable por Abraham antes de portar a RN** (decisión 9), sobre **frame claro y frame oscuro**, que es donde se juega el contraste.

## UI/interacción fuera del mockup

Abiertos ambos techos antes de escribir esto: `urbea-identidad-visual.html` (`.frail`/`.fbtn` ~215–225; `.feed-rail`/`.feed-info`/`.feed-agent` ~391–397) y `Urbea Prototipo (standalone).html`.

1. **El rediseño CONTRADICE el techo vigente en dos puntos** y **gana el prompt explícito de Abraham** (CLAUDE.md §0, fila «Override»):
   - La identidad dibuja las acciones **dentro** de la cápsula glass → se quitan. **Resolución (decisión 10): se actualiza `urbea-identidad-visual.html` EN EL MISMO PR** (pantalla 4 + reglas `.fbtn`/`.frail`/`.feed-agent`), para que el techo no le mienta a la próxima tarea que abra el feed. Costo XS, cero riesgo de runtime.
   - El prototipo de layout dibuja literalmente el div «Seguir» con `margin-left:auto; padding:6px 16px; border:1.5px solid #fff; border-radius:20px` — es de donde salió el estilo actual de #78.4. **Resolución (decisión 10): el prototipo NO se edita**; queda registrado aquí que su layout de esa fila está **superado por prompt explícito** (la píldora va pegada al nombre, radio ~8, borde 1 px). Regla del §8 intacta para todo lo demás del prototipo.
2. **Caption/descripción truncada a 1 línea** (la referencia la tiene; el mockup de Urbea no dibuja descripción en el feed) → **descartada** por la decisión 7 (el bloque inferior se queda como hoy). No se propone derivada: no es que falte, es que se decidió no traerla.
3. **`REUSO_CON_RESERVA` (§0) — ACEPTADO EN CONJUNTO (decisión 8):** `ActionButtons.tsx` del detalle **copia a mano** el glass de `PropertyOverlay.action_btn` — lo dice su propio comentario (`mobile/src/features/property-detail/components/ActionButtons.tsx:11-12` y `:170`: *«ponytail: estilos glass copiados de PropertyOverlay.action_btn (rgba hardcoded)»*). Es deuda: un cambio de firma en el feed dejaba el detalle desalineado en silencio, a dos taps de distancia para el mismo usuario. Cabe en el footprint, no toca contrato publicado ni migraciones ⇒ **se alinea en esta misma tarea**. `REUSO_CON_RESERVA: estilo glass duplicado entre PropertyOverlay.action_btn y ActionButtons · peor que lo que se escribiría hoy porque la firma vive en dos archivos sin token común · cabe`.

**Cupo del §8 (máx 2, compartido): consumido por (1) y (3). Ambas resueltas por decisión de Abraham, ninguna queda pendiente.**

## Reglas no obvias aplicables

- **Techo por pantalla con propuesta + dos referencias con roles distintos** — `CLAUDE.md §8` (identidad = lenguaje visual; prototipo = layout). Aquí el prompt explícito gana y el techo **se actualiza**, no se ignora.
- **Régimen de ponytail por fase** — `CLAUDE.md §0` / [[0011-ponytail-y-fases-del-workflow]]: divergencia en este doc, `full` en `/tm-plan` y `/tm-tarea`.
- **Criticidad determinista por path §5** — `features/feed/lib/**` ⇒ **TDD estricto + guardian** (subtarea de `like_count`); `components/**` y pantallas ⇒ verificación ligera (`pnpm tsc --noEmit`, `pnpm lint`, smoke).
- **Producción viva §0.5.3** — merge a `main` = candidato a release. Este cambio es **100 % JS/UI ⇒ mismo `fingerprint` ⇒ OTA-safe** (ningún módulo nativo nuevo): se publica con `cd mobile && pnpm ota "<mensaje>"` desde `main` ya mergeado, y se **verifica la entrega real** (no NO-OP). ⚠️ El OTA hornea el backend desde `.env.local`, no desde EAS (`ota_hornea_env_local_no_eas`) — el guard de `ota.sh` lo cubre, pero se comprueba.
- **PNPM siempre** (§3) — `pnpm tsc --noEmit`, `pnpm lint`, `pnpm jest`; nunca npm/yarn. En worktree: binarios directos de `node_modules/.bin/*`, jamás `pnpm install` (`worktree_symlink_node_modules_pnpm`).
- **Offsets compartidos feed↔anuncio** — `INFO_BOTTOM` se **exporta** desde `PropertyOverlay.tsx` porque `AdFeedItem` monta su bloque a la misma altura (#206), y es `Platform.select` porque en iOS `insets.bottom` YA incluye la NativeTabs (#65.11). Cualquier ajuste vertical se prueba en **ambas** plataformas.
- **Un componente animado se valida en dispositivo real** — `reanimated_svg_muere_en_build_produccion` (#244): Reanimated sobre props de SVG animó en los dos emuladores y quedó clavado en el Android físico. Si el like outline lleva animación, **Animated clásico con `useNativeDriver:false`** + validación en físico.
- **Sustituir un componente de RN = copiar su LAYOUT, no solo sus props** — `sustituir_componente_rn_copiar_layout` (#245): quitar el fondo cambia la caja, no solo la piel; el área táctil se conserva o se compensa con `hitSlop`.
- **Los tests RNTL no ven layout** — `rntl_no_ve_layout`: la suite puede quedar verde con el rail invisible o fuera de pantalla. La verificación visual es **por CLI** (`adb exec-out screencap -p`, `xcrun simctl io screenshot`), **nunca computer-use** (§3, `emulator_testing_cli_only`).
- **Ver video en pruebas quema cuota real** — `video_playback_burns_quota`: verificar que reproduce y **PARAR**; el smoke **termina en `stopApp`**.
- **Reciclaje de FlashList y estado local** — `expo_video_capture_gotchas` («closure obsoleto de `property_id` al reciclar»): el conteo optimista de like debe estar **atado a `property.id`**, igual que el `comment_count` local de `VideoFeedItem`, o un ítem reciclado arrastra el número del anterior.
- **Testing manual juntos, automatizado solo** — `testing_manual_juntos_automatizado_solo`: el juicio estético sobre video real lo valida Abraham; jest/pgTAP/sondas los corre el agente.
- **Privacidad §0.5.4** — un conteo agregado no es identidad; no toca el radar anónimo del CRM ([[privacidad-datos]]). Nombrar personas queda fuera de alcance por diseño.

## Arquitectura / enfoque técnico

Cambio presentacional + una lectura extra en la capa de datos del feed. Sin capa nueva, sin dependencia nueva.

**Lo que se reusa:**
- `ActionButton` (subcomponente interno de `PropertyOverlay.tsx`) ya centraliza el botón del rail → el rediseño es su estilo + un slot de conteo; `whatsapp_btn` queda como caso aparte, sin tocar.
- `phosphor-react-native` (iconografía del proyecto, #28) soporta `weight="regular" | "light" | "bold"` ⇒ el outline **no** necesita assets ni librería nueva.
- `FollowButton` ya se dimensiona por su texto; el cambio es de estilo (radio/borde) y de **contenedor** en el overlay.
- El patrón de conteo local ya existe: `VideoFeedItem` sostiene `comment_count` con +1 local sin refetch, reseteado por reciclaje. El like usa el mismo molde.

**Legibilidad sin cápsula (se decide en el preview, decisión 9).** `textShadow` **no** aplica a un SVG de Phosphor. Opciones técnicas reales, sin dependencia nueva:
1. `shadowColor/shadowOpacity/shadowRadius` en el `Pressable` contenedor — funciona en iOS; en Android `elevation` sobre fondo transparente **no dibuja sombra**.
2. Ícono duplicado en negro a ~35 % desplazado 1 px bajo el blanco — funciona en ambas plataformas; costo: un render más por botón.
3. `LinearGradient` vertical tenue detrás del rail — barato y `expo-linear-gradient` **ya está montado** en el overlay.
→ **(3) + (2) son las que encajan con el stack**; el preview decide cuál se aprueba y con qué opacidad.

**Conteo optimista de like — la parte con filo.** 🔴 Hoy `VideoFeedItem` llama `useLikeProperty({ property_video_id, property_id })` **sin `initialLiked`**, así que el hook arranca en `false` en cada montaje: **el feed no sabe si el usuario ya había dado like** (es el mismo hueco que la tarea **#156** `producto(13)` *«el bookmark del feed y del detalle no reflejan el estado real de guardado»*, hoy `pending`). Consecuencia para el conteo:
- Regla de render: `display = max(0, property.like_count + (isLiked ? 1 : 0))`, con el delta atado a `property.id` para sobrevivir al reciclaje.
- **Techo conocido y aceptado:** si el usuario ya había likeado esa propiedad en una sesión anterior, el corazón sigue apareciendo apagado (bug preexistente de #156) y su like ya está contado en el servidor; al tocarlo el número sube +1 visualmente aunque el `INSERT` sea un no-op idempotente (23505 tratado como «ya liked»). **Esta exploración NO crea el problema ni lo arregla**: se documenta y se marca como resuelto por #156 cuando se ejecute. Si Abraham quiere cerrarlo aquí, es alcance nuevo (pedir el estado de like propio en el feed) y sube el nivel.

## Fases / épicas

**Sugerencia para `/tm-plan` — el desglose fino lo hace él, no este doc.** Orden pensado para que el gate de diseño no bloquee la parte crítica y para que cada paso sea verificable solo:

| # | Subtarea sugerida | Criticidad (§5) | Notas |
|---|---|---|---|
| 1 | **Preview HTML aprobable** del overlay (rail outline + conteos + fila del agente) sobre **frame claro y frame oscuro** — agente `design`; ahí se aprueba el realce de contraste (gradiente del rail / sombra doble) | ligera (doc) | **Bloquea a 3 y 4.** Servir por http 127.0.0.1, no `file://` (`chrome_mcp_file_url_gotcha`) |
| 2 | **`like_count` en el feed** — `FEED_SELECT` + mapeo fail-open a 0 + `FeedProperty` | 🔴 **CRÍTICA — TDD estricto + guardian** | Independiente del preview: se puede arrancar en paralelo |
| 3 | **Rail outline + conteos + fila del agente en línea** en `PropertyOverlay.tsx` y conteo optimista en `VideoFeedItem.tsx` | ligera | Depende de 1 y 2 |
| 4 | **`AdFeedItem`** — identidad del anunciante alineada al nuevo tratamiento, `INFO_BOTTOM` compartido intacto | ligera | Depende de 3 |
| 5 | **`FollowButton` ambas variantes** (radio ~8, borde 1 px) + verificación del perfil ajeno (`ProfileActions.tsx`) | ligera | Independiente; puede ir en paralelo a 3 |
| 6 | **`ActionButtons.tsx` del detalle** al outline (REUSO_CON_RESERVA aceptado) | ligera | Depende de 3 (el detalle copia al feed) |
| 7 | **Mockup canónico** `urbea-identidad-visual.html` pantalla 4 (`.fbtn`/`.frail`/`.feed-agent`) | ligera (doc) | Cierra el §8; mismo PR |

**Prioridad sugerida: `high`.** Es el primer pendiente anunciado a los testers el 2026-09-05 que sigue sin tarea, es visible en el primer segundo de uso y es **OTA-safe** (llega a testers sin rebuild). ⚠️ Coordinar con **#74** (`in-progress`, «Ola 1 — Feed ranking»): no colisiona conceptualmente (ranking vs. presentación) pero sí puede chocar en el merge sobre `mobile/src/features/feed/**`.

## Criterios de aceptación

- [ ] Los botones del rail se dibujan **sin círculo ni fondo**: ícono outline blanco sobre el video. Evidencia: screenshot por CLI en Android y en iOS, sobre **un frame claro** (fachada al sol) y **uno oscuro**, con los 4 íconos legibles en ambos.
- [ ] El **botón de WhatsApp conserva su verde sólido `#25D366`** y su forma actual: es el único elemento con color de marca en el rail.
- [ ] Debajo del ícono de **me gusta** aparece su conteo, y debajo del de **comentarios** el suyo. **Guardados y compartir no muestran conteo.**
- [ ] El conteo de me gusta cambia **al instante** al tocar el corazón (optimista) y vuelve a su valor si la operación falla; nunca baja de 0. Regla verificable: `display === max(0, property.like_count + (isLiked ? 1 : 0))`.
- [ ] Al reciclar la lista (deslizar ≥ 10 ítems y volver), el conteo mostrado corresponde a la propiedad en pantalla — ningún número heredado del ítem anterior.
- [ ] `like_count` ausente o `null` en la fila ⇒ el overlay muestra **0**, no `NaN` ni `undefined` (fail-open, mismo criterio que `comment_count`). Cubierto por test en `feedProperties`.
- [ ] La fila del agente se dibuja **en línea**: avatar · nombre a su derecha · píldora «Seguir» **pegada al nombre** (separación fija, no `marginLeft:'auto'`).
- [ ] Con un nombre de **1 palabra corta** la píldora queda junto al nombre (no al borde derecho); con un nombre de **≥ 28 caracteres** el nombre se trunca con `numberOfLines={1}` y la píldora sigue completa y dentro del bloque (no se sale por `right: 74`).
- [ ] Tras seguir, la píldora dice **«Siguiendo»** y sigue visible (no desaparece), y un segundo tap revierte.
- [ ] La píldora usa el **nuevo estilo (radio ~8, borde 1 px) en las dos variantes**: feed (`dark`) y perfil ajeno (`light`, vía `ProfileActions.tsx`), sin desalinear la fila de acciones del perfil.
- [ ] Los botones de acción del **detalle** (`ActionButtons.tsx`) se ven con el mismo lenguaje outline que el feed — sin cápsulas glass sobrantes.
- [ ] El bloque inferior del **anuncio** (`AdFeedItem`) queda a la misma altura que el de una propiedad: **sin salto perceptible** al deslizar entre anuncio y propiedad, en Android **y** iOS.
- [ ] El bloque de info de la propiedad (chips de operación/tipo, dirección, precio, specs) **no cambia**.
- [ ] Los `accessibilityLabel` y `testID` actuales se conservan intactos: `overlay-comments-btn`, `follow-button`, «Dar like»/«Quitar like», «Guardar propiedad»/«Quitar de guardados», «Compartir propiedad», «Contactar por WhatsApp», «Comentarios», `ad-feed-item`, `ad-cta-button`, `ad-sponsored-badge`.
- [ ] Suites verdes sin editar asserts de **comportamiento** (solo se ajustan mocks/estilos): `PropertyOverlay.comments.test.tsx`, `PropertyOverlay.cacheKey.test.tsx`, `VideoFeedItem.test.tsx`, `VideoFeedItem.comments.test.tsx`, `AdFeedItem.test.tsx`, `FollowButton.test.tsx`, `ProfileActions.whatsapp_rpc.test.tsx`, `feedProperties.*.test.ts`.
- [ ] `pnpm tsc --noEmit` y `pnpm lint` en verde.
- [ ] Smoke en emulador Android + iOS **por CLI**, terminando en `stopApp` (cuota de Stream).
- [ ] El **preview HTML fue aprobado por Abraham** (frame claro + frame oscuro) **antes** de escribir el estilo en RN.
- [ ] `urbea-identidad-visual.html` (pantalla 4: `.fbtn`, `.frail`, `.feed-agent`) refleja el overlay aprobado, en el **mismo PR**.
- [ ] La migración/el backend **no se tocan**: el diff no contiene `supabase/migrations/**` ni `supabase/functions/**`.

## Dependencias

- **#78** (follow F1 — `FollowButton`, `useFollow`, `follows`): cerrada hoy, 2026-09-13. Es dependencia dura: la píldora que se restila y reposiciona nació ahí.
- Footprint heredado de tareas cerradas: **#9** (overlay), **#13** (triggers de contadores), **#145** (identidad del agente), **#170.8 / #206** (anuncios y offsets compartidos), **#241–#245** (tabs, video, loader), **#248** (identidad del anunciante), **#289** (comentarios en el rail).
- **Sin dependencia de backend.** Ninguna migración; `like_count` ya vive en `properties` (`20260604000005`) y lo mantiene `20260701000001`.
- Relacionada, **no bloqueante**: **#156** `producto(13)` (pending) — el feed no refleja el estado real de like/guardado; determina el techo conocido del conteo optimista (ver §Arquitectura).
- ⚠️ **#74** `in-progress` sobre `mobile/src/features/feed/**`: riesgo de conflicto de merge, no de diseño.
- No existe tarea previa de «remodelación del feed» (verificado sobre `.taskmaster/tasks/tasks.json`); la **#290** *«producto(289): ícono de comentarios con contador en el rail»* está **cancelled** (absorbida por 289.10). Este doc no duplica nada.

## Edge cases / riesgos

- 🔴 **Legibilidad sin cápsula sobre video claro.** *El* riesgo del cambio: la cápsula glass no era decoración, era contraste. Un video de fachada blanca a mediodía puede dejar los íconos invisibles. Mitigación obligatoria decidida en el preview (gradiente tenue del rail + ícono-sombra), verificada con screenshot sobre un frame claro **real**.
- **Área táctil.** Hoy el `Pressable` mide 46×46 por el `borderRadius`; si el estilo se reduce al tamaño del ícono (~24) el blanco táctil encoge y el feed se siente duro. Mantener la caja o compensar con `hitSlop` (#245).
- **Conteo optimista y #156.** Con `initialLiked` siempre `false`, un like previo del usuario ya está en el conteo del servidor: al tocar, el número sube +1 aunque el INSERT sea idempotente. Techo conocido, documentado, resuelto por #156.
- **Conteos grandes.** `1,234` bajo un ícono sin cápsula puede empujar el espaciado del rail; definir formato (`1.2k`?) o `numberOfLines={1}` + ancho mínimo, para que el rail no baile entre ítems.
- **Nombres largos de agente.** «Inmobiliaria Vladimir Ramos y Asociados» con la píldora pegada: el nombre trunca (`flexShrink:1` ya existe en `agent_info` precisamente por esto) y la píldora nunca se comprime.
- **Mock de `phosphor-react-native`**: `PropertyOverlay.cacheKey.test.tsx`, `PropertyOverlay.comments.test.tsx` y `AdFeedItem.test.tsx` **enumeran los íconos** en el mock; un ícono nuevo revienta esas suites con un error opaco (`undefined is not a component`). Con la dirección B no se agregan íconos, pero si el preview introduce uno hay que tocar los 3 mocks.
- **`FollowButton.test.tsx` no asserta estilo** (FB-1..FB-4 son comportamiento: `is_own`, `loading`, label, `accessibilityState`) ⇒ el cambio de radio/borde **no** lo rompe… y tampoco lo verifica: el radio se comprueba visualmente, no en jest.
- **Perfil ajeno.** El nuevo radio aplica también ahí (decisión 6): revisar que la píldora no quede desalineada con los botones vecinos de `ProfileActions.tsx`.
- **Regresión de salto feed↔anuncio** (#206) si se mueve `INFO_BOTTOM` sin actualizar `AdFeedItem`.
- **Metro sirve bundle cacheado tras `git switch`** (`metro_bundle_stale_tras_git_switch`): reiniciar Metro con `-c` antes de dar por bueno el smoke, o se valida UI vieja.

## Plan de pruebas (alto nivel)

- 🔴 **CRÍTICO (TDD estricto + guardian) — `mobile/src/features/feed/lib/feedProperties.ts`:**
  RED → GREEN → guardian. Casos mínimos: (a) `like_count` presente en la fila se mapea al ítem del feed; (b) ausente/`null` ⇒ **0** (fail-open, igual que `comment_count`); (c) el `FEED_SELECT` sigue trayendo todas las columnas que las demás suites esperan (`feedProperties.test.ts`, `.listing-meta`, `.comment-count`, `.agent-identity`, `.zone`, `.filters`, `.radius-null`, `.parallel-mint`). El guardian restaura mutantes **re-aplicando el archivo**, nunca `git checkout`/`stash` (`guardian_mutant_restore_rule`).
- **Ligero (resto del footprint):** `pnpm tsc --noEmit` + `pnpm lint` + las suites listadas en Criterios, ajustando **solo** mocks/estilos. Si se agregan asserts de UI (conteo visible, píldora presente), que sean de **comportamiento observable** (texto/`testID`/label), no de estructura.
- **Smoke visual por CLI** (§3): Android `adb exec-out screencap -p`, iOS `xcrun simctl io screenshot`; frame claro y frame oscuro; deslizar ≥ 10 ítems para ejercitar el reciclaje del conteo; pasar por un **anuncio** para ver la costura; **terminar en `stopApp`**.
  ⚠️ El smoke por CLI en **simulador iOS con dev-client está bloqueado** (`ios_simulator_devclient_smoke_cli_bloqueado`: alerta de springboard intocable) → la parte iOS la ejecuta **Abraham**.
- **Manual con Abraham** (`testing_manual_juntos_automatizado_solo`): aprobación del preview y juicio estético sobre video real.
- **Doble camino al mismo número:** probar el like por **botón** y por **doble-tap** (`likeOnly` idempotente + `HeartAnimation`) — ambos deben mover el conteo igual.
- **Post-merge:** OTA (`cd mobile && pnpm ota "<mensaje>"` desde `main`) y **verificación de entrega real** del runtime, no NO-OP (`ota_fingerprint_verify_delivery`).

## Impacto en PRD (solo referencia — NO se edita)

`docs/PRD.md` §9 describe el **comportamiento** del feed (radio, anti-clustering, métricas), no el layout del overlay ⇒ no requiere edición. `docs/PRD-MVP-demo.md` §6 lista la pantalla 4; lo que cambia es el **mockup** (`urbea-identidad-visual.html`), no el texto del PRD. Ninguno de los dos se toca en esta tarea.

## Decisiones del intake

Las 11 preguntas de la primera pasada, respondidas por Abraham el 2026-09-13:

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Dirección de layout | **B «Urbea limpio»** — sin cápsula glass, íconos outline blancos, fila `avatar · nombre · Seguir` con la píldora pegada al nombre. (A, C y D descartadas; de A se toman la fila en línea y conteos acotados.) |
| 2 | Conteos bajo los íconos | **Like + comentarios.** Guardados y compartir **sin** conteo. ⇒ `like_count` entra al select del feed (subtarea CRÍTICA, TDD) + conteo optimista al dar/quitar like. |
| 3 | WhatsApp | **Se queda verde sólido** — es el CTA de negocio; su color es la excepción deliberada a «solo outline». |
| 4 | Fila del agente | **Avatar · nombre a la derecha · «Seguir» pegado**, como la referencia (hoy el nombre va debajo del avatar). |
| 5 | Píldora tras seguir | **Se queda «Siguiendo»** (reversible en un tap). No se oculta. |
| 6 | Nuevo estilo de píldora (radio ~8, borde 1 px) | **Ambas variantes** — `dark` del feed y `light` del perfil ajeno ⇒ toca `FollowButton.tsx`, `ProfileActions.tsx` y sus tests. |
| 7 | Bloque inferior de info | **Todo como hoy** (chips, dirección, precio, specs). Dirección D descartada; caption/descripción fuera de alcance. |
| 8 | `ActionButtons.tsx` del detalle | **Se alinea al outline en la misma tarea** — `REUSO_CON_RESERVA` aceptado **en conjunto**. |
| 9 | Preview HTML aprobable | **Sí**, sobre **frame claro y frame oscuro**, antes de portar a RN. Subtarea del agente `design`; ahí se aprueba el realce de contraste (gradiente tenue del rail / sombra). |
| 10 | Mockup canónico | **En conjunto, mismo PR**: `urbea-identidad-visual.html` pantalla 4 (`.fbtn`/`.frail`/`.feed-agent`). El **prototipo standalone NO se edita**; su `margin-left:auto` en el div «Seguir» queda anotado como layout **superado por prompt explícito**. |
| 11 | `AdFeedItem` | **Mismo lenguaje en esta tarea.** Matiz registrado: el anuncio **no tiene rail** ⇒ se traduce en alinear la identidad del anunciante y conservar el `INFO_BOTTOM` compartido (#206), no en agregarle botones. |

**Restricciones que Abraham dejó por escrito y quedan ancladas en el plan:**
1. Cambio **100 % JS ⇒ OTA-safe**, sin cambio nativo (mismo `fingerprint`).
2. Columnas nuevas en el select del feed son **aditivas** (§0.5.2): no rompen builds instalados.
3. **No se toca backend ni migraciones** — `like_count` ya existe en `properties` (`20260604000005_properties_and_videos.sql:33`) y lo mantiene el trigger de `20260701000001_engagement_count_triggers.sql`.
4. Tests RNTL existentes **se ajustan** (mocks de `phosphor-react-native` que enumeran íconos; `PropertyOverlay.*`, `AdFeedItem`, `FollowButton`, `ProfileActions`) sin tocar asserts de comportamiento.
5. El smoke **termina en `stopApp`** (cuota de Cloudflare Stream).
6. **Dependencia de #78** (`FollowButton`).

## Promoción / descarte

**Listo para promover.** Al aprobar:
- **1 tarea nueva**, título sugerido: `producto(9): rediseño del overlay del feed — rail outline sin cápsula, conteos de like/comentarios y «Seguir» pegado al nombre`. Prioridad sugerida **`high`**. `dependencies`: `["78"]`.
- **7 subtareas sugeridas** (ver §Fases), de las cuales **una es CRÍTICA** (`like_count` en `features/feed/lib/feedProperties.ts` ⇒ TDD estricto + guardian) y el resto de verificación ligera.
- **Cero derivadas pendientes**: la actualización del mockup (§8) y la alineación de `ActionButtons.tsx` (`REUSO_CON_RESERVA`) entran **en conjunto** por decisión de Abraham (10 y 8). #156 queda como tarea ya existente relacionada, no se abre nada nuevo.
- ⚠️ `add-task` y `expand` están rotos en este entorno (§4) ⇒ la tarea y sus subtareas se escriben **directo en `.taskmaster/tasks/tasks.json`** (respaldo `.bak` + `task-master list` / `validate-dependencies`).
- Siguiente comando sugerido: **`/tm-plan <id>`**.

**Promovida el 2026-09-13 → tarea #293** (7 subtareas escritas directo en `tasks.json`, respaldo `.bak`, `validate-dependencies` verde; backlink `DERIVADAS` en la tarea #9). `analyze-complexity` omitido: está roto en este entorno (§4).
