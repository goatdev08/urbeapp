---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: L             # XS | S | M | L | XL  ← se promueve como DOS tareas: A (L) + B (M/S)
fecha: 2026-08-10
estado: aprobado      # borrador → en-revision → aprobado | descartado
tarea_id: 148, 149    # A=148 (hero, L, complejidad 9/10) · B=149 (chips, M/S, complejidad 4/10). #106 cancelada como superseded.
motivo_descarte:
---

# Hero de video vivo con colapso por scroll en el detalle, y chips de características en el wizard

> ⚠️ **El slug del archivo (`038-detalle-sin-autoplay-…`) quedó desalineado**: la 2ª pasada invirtió el punto 1
> (de "cero autoplay" a "autoplay controlado por scroll"). Se conserva la ruta para no romper referencias.
>
> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> **Estado: aprobado** — todas las decisiones de producto están tomadas; no quedan preguntas abiertas.
> NO edita los PRD maestros; "Impacto en PRD" es solo referencia.

## Historial de la exploración

| Pasada | Fecha | Qué cambió |
|---|---|---|
| 1ª | 2026-08-10 | Punto 1 = **miniatura estática táctil, cero autoplay** (ahorro de cuota por no reproducir nunca). Nivel M. Recomendaba **ampliar #106**. |
| 2ª | 2026-08-10 | ⭐ **El punto 1 cambió por completo**: hero de video **vivo** que arranca grande, **colapsa con el scroll**, **se autopausa al mínimo**, **retoma play al subir** y con un **gesto extra tipo pull se expande a pantalla completa**; más **botón play/pause manual**. Trade-off de cuota **aceptado explícitamente**. Nivel **M → L**. **#106 pasa de "ampliable" a "obsoleta en su parte (a)"**. El **punto 2 (chips) NO cambió**. Cerró con **18 preguntas abiertas**. |
| 3ª (esta, final) | 2026-08-10 | ⭐ **Las 18 preguntas quedan RESUELTAS** por decisión del agente principal (criterio de bajo riesgo/reversible). Geometría fijada, gesto fijado, overlays fijados, enfoque técnico A con fallback C declarado, #106 cancelada conservando su parte (b), preview HTML como primer paso, **dos tareas separadas**. ⚠️ **Corrección tardía del usuario sobre el piso del colapso: NO ~100 px, sino los 260 px actuales (`HERO_HEIGHT`)** — el mínimo del hero es exactamente el tamaño que ya tiene hoy en producción. Criterios de aceptación reescritos completos y verificables. **Listo para promover.** |

## Idea final (decidida, vigente)

1. **`PropertyDetailScreen.tsx`** (`mobile/src/features/property-detail/`) — **hero de video vivo, tipo collapsing header, con tres estados**:
   - **Reposo/grande:** al entrar, el hero **reproduce** ocupando **2/3 de la altura de ventana** (≈ **el doble** del hero actual de 260 px).
   - **Colapso por scroll:** al bajar, el hero encoge de forma **continua** hasta un **piso = 260 px** (`HERO_HEIGHT`, exactamente el tamaño que tiene hoy). Al tocar ese piso el video **se pausa automáticamente**. El scroll **nunca** lo reduce por debajo de 260 px.
   - **Retorno:** al subir, el hero crece y el video **retoma play**, con **tope duro en 2/3**. El scroll normal nunca pasa de 2/3.
   - **Fullscreen (estado extra):** desde el tope de 2/3, un **gesto adicional de pull** expande el hero a **pantalla completa full-bleed** (borde a borde, como el feed). Solo alcanzable por ese gesto.
   - **Botón play/pause manual** sobre el hero; la **pausa manual gana** sobre el autoplay por scroll.
   - Se mantiene: **eliminar `AmenityChips`** del detalle y **subir `PropertyMap`** a la **segunda posición** del contenido scrolleable.
   - Se dobla aquí la parte **(b) de #106**: la previsualización de `step5.tsx` deja de reproducir indefinidamente.
   - Debe quedar con buen acabado visual: **preview HTML aprobable de los 3 estados ANTES de portar a RN**.
2. **Wizard de publicar, `step4.tsx`** (`mobile/app/(protected)/publish/`) — **sin cambios respecto a la 1ª pasada**:
   - Se elimina la `toggles_card` actual (3 `Switch`: "Acepta mascotas", "Sin aval / fiador", "Apto estudiantes").
   - Se reemplaza por una **fila compacta de chips** bajo la descripción, **promoviendo `FilterChipGroup`** a componente cross-feature.
   - Los 3 campos **siguen capturándose al publicar** y `FilterSheet.tsx` sigue operando con datos reales.

## Geometría y estados del hero (DECIDIDO — fuente de verdad del plan)

| Estado | Altura | Cómo se llega | Video |
|---|---|---|---|
| **fullscreen** | `window_height` **full-bleed, borde a borde** (como el feed; ignora safe areas y el CTA sticky) | **solo** con el gesto extra de pull más allá del tope de 2/3 | reproduce |
| **reposo / grande** | `HERO_MAX = round(window_height * 2/3)` — ≈ **533 px** en un teléfono de 800 dp, ≈ **el doble** del hero actual | estado inicial al abrir; **tope duro del scroll normal** | reproduce |
| **mínimo / piso** | ⭐ `HERO_MIN = 260` — **exactamente el `HERO_HEIGHT` actual** (`PropertyVideoPlayer.tsx:28`) | colapso continuo por scroll hacia abajo | **pausado** |

- `collapse_range = HERO_MAX - HERO_MIN` (≈ 273 px en 800 dp).
- **Guarda para pantallas cortas:** si `HERO_MAX - 260 < 120` (teléfono muy corto o ventana reducida), se recalcula `HERO_MIN = HERO_MAX - 120` para que el colapso siga siendo perceptible. Regla determinista, sin ramas de plataforma.
- `HERO_MAX` se deriva de `useWindowDimensions()` (patrón vigente del repo: `FeedScreen.tsx:45`, `VideoFeedItem.tsx:60`, `DetailSkeleton.tsx:40`), **no** de `Dimensions.get`.
- ⚠️ **Consecuencia del piso = 260 (no ~100):** el estado "mínimo" **no es una banda nueva**, es la pantalla que ya existe hoy. Esto **reduce el riesgo visual** (el layout colapsado ya está probado en producción) y **reduce el recorrido de la animación** (menos px que interpolar → menos presión de performance). También significa que **el ahorro de cuota es menor** que con un piso de 100 px, porque el video sigue visible y grande durante más recorrido de scroll — sigue habiendo autopausa, que es el mecanismo de ahorro decidido.
- ⚠️ **`DetailSkeleton` debe pasar de 260 → `HERO_MAX`** (hoy duplica a mano `HERO_HEIGHT = 260`, `DetailSkeleton.tsx:31`, con el comentario "sincronizada con PropertyVideoPlayer"). El detalle **abre** en 2/3, así que el skeleton debe medir 2/3 o habrá un salto visible al terminar la carga. Extraer la constante a un único lugar.

## Enfoque técnico (DECIDIDO)

**Primario — opción A:** `Animated.ScrollView` + `useScrollViewOffset` + **`transform`** (scale / translateY) sobre un contenedor de **altura FIJA** con `overflow: hidden`. El offset del scroll maneja la interpolación en el **UI thread** y el `VideoView` **nunca cambia de `height` por frame**.
*Rationale:* en Android el `VideoView` de expo-video se apoya en una superficie nativa; redimensionar esa superficie cada frame es el camino corto al parpadeo/tearing (pariente conocido: crash de #61 *"Cannot set prop player on view SurfaceVideoView"*). Sin dependencia nueva; **viaja por OTA**.

**Fallback automático — opción C:** dos estados discretos (2/3 ↔ 260) con `withTiming` al cruzar un umbral de scroll. **Se activa si y solo si** el perfilado con `dumpsys gfxinfo` en emulador Android gama media reprueba la opción A. Es más barato, trivialmente idéntico en iOS/Android, y pierde la sensación de "componente vivo" — por eso es fallback, no plan A.

**Descartadas:** B (animar `height` → layout por frame, máximo riesgo en gama media) y D (dependencia de terceros → viola "no acumular dependencias"; ninguna maneja "video vivo que se autopausa").

Marcar la decisión con un comentario `// ponytail:` (intención + techo conocido: "si el gfxinfo reprueba, el fallback es C").

**Estructura de la pantalla (reestructura, no parche):**
```
<View root>
  <Animated.View hero>            ← altura FIJA = HERO_MAX, overflow:hidden, transform animado
      <VideoView/>  <Image poster/>  <PlayPauseButton/>  <badge/>  <handle/>
  </Animated.View>
  <Animated.ScrollView            ← useScrollViewOffset
      contentContainerStyle={{ paddingTop: HERO_MAX }}>
      …PropertyInfoHeader, PropertyMap, dirección/descripción, AgentCard…
  </Animated.ScrollView>
  <View back_btn/>                ← FUERA del hero, fijo en safe-area, z-index superior
  <View sticky_cta/>              ← sin cambios
</View>
```

**Máquina de estados / lógica pura (vía TDD crítica):**
- `progress = clamp((offset) / collapse_range, 0, 1)` — `0` = 2/3 (grande), `1` = 260 (piso). Se calcula en el **UI thread**.
- **Histéresis por umbral, decidida:** `should_play = false` cuando `progress >= 0.85`; `should_play = true` cuando `progress <= 0.55`; entre 0.55 y 0.85 **se conserva el estado anterior** (banda muerta que evita el rebote en el umbral). Umbrales nombrados como constantes, ajustables en el tuning visual.
- El cruce se propaga con `useAnimatedReaction` + **`runOnJS` SOLO en el cambio de estado** — una llamada por transición, **no** 60 por segundo.
- ⭐ Esta función es **pura y testeable**: `(offset, hero_max, hero_min, was_playing, manual_paused) → { progress, should_play }`. Va a **`mobile/src/features/property-detail/lib/heroCollapse.ts`** → cae en la **vía TDD CRÍTICA** por regla determinista de path (CLAUDE.md §5: `mobile/**/lib/**`) → **RED antes que GREEN**. Aísla la única lógica real y deja pantalla y componentes en verificación ligera.
- **Pausa manual:** flag `manual_paused` en estado JS. Si está activo, la reacción de scroll **no** llama `play()` — solo el toque del usuario en el botón lo limpia. Es la regla de menor sorpresa: *"pausé a propósito y el scroll me lo volvió a poner"* es un bug percibido.
- **Guard de desmonte:** la función que llega vía `runOnJS` comprueba un `mounted_ref` antes de tocar el player (evita *"shared object already released"* al navegar atrás durante un colapso).

**Gesto de expansión a fullscreen (DECIDIDO):** `Gesture.Pan()` **explícito** sobre el hero, compuesto con el scroll nativo (`simultaneousWithExternalGesture` / `Gesture.Native()`). **Mismo código y mismo comportamiento en iOS y Android** — no se depende del rebote, porque **Android no genera offset al sobre-scrollear** (`overScrollMode` solo pinta el glow). Verificación obligatoria en **ambos** emuladores **por CLI** (`adb` / `xcrun simctl`, nunca computer-use — CLAUDE.md §3).

**Descubribilidad (DECIDIDO):** **chevron/handle** sutil que aparece al llegar al tope de 2/3, como affordance del pull-to-expand (ya hay lenguaje de "pill/handle" en el design system).

**Salida de fullscreen (DECIDIDO):** **ambos** — gesto inverso (pull hacia abajo) **y** botón de cerrar sobre el hero.

**Reproducción (DECIDIDO):** `muted` + `loop` **sin cambios** respecto a hoy. **Sin tope duro de reproducción adicional** en este lote (se difiere conscientemente: no cubre a quien abre el detalle y no scrollea, pero no es objetivo de esta tarea).

**Overlays durante el colapso (DECIDIDO):**
- `back_btn`: **fijo en safe-area, siempre visible por encima de cualquier estado del hero** (incluido fullscreen). 🔴 **Criterio de no-regresión explícito respecto a la tarea #44** (*"On-screen back button for iOS navigation across all demo screens"*, `pending`): este cambio **no puede** dejar el detalle sin back visible en iOS. Sacar el `back_btn` del `hero_wrapper` para que no herede el `transform` del hero.
- `action_overlay` (rail like/save) y badge **"N videos"**: **fade** al colapsar (opacidad interpolada con `progress`, `pointerEvents: 'none'` al llegar a 0), reaparecen al expandir.
  - *Nota registrada, no bloqueante:* con el piso corregido a 260 px, el rail y el badge **sí caben físicamente** en el estado mínimo (es el layout que existe hoy). Si en el preview HTML el fade se percibe como pérdida de función, **mantenerlos visibles en el piso es un cambio de una línea** (clamp de la interpolación de opacidad). Decisión reversible, se resuelve en el preview.

**Selector de chips del wizard:** presentacional puro; el mapeo `string[] ⇄ 3 booleanos` queda **inline en el screen**, **no** en `lib/`, para mantenerlo fuera de la vía crítica.

## Problema / Motivación

- **La pantalla de detalle es estática y el video se siente "muerto".** Hoy el hero es un rectángulo de **260 px fijos** (`PropertyVideoPlayer.tsx:28`) que reproduce en loop de fondo mientras el usuario lee. El video —el corazón del producto— no participa de la lectura. El diseño nuevo lo vuelve el eje: grande cuando miras, del tamaño de hoy cuando lees.
- **Costo real de video.** Cada minuto entregado por Cloudflare Stream se cobra; hoy el detalle reproduce mientras la pantalla exista (`p.loop = true` + `player.play()` al montar, `PropertyVideoPlayer.tsx:66-95`). Es el patrón que ya quemó el egress de Supabase (memoria `video_playback_burns_quota`). **El diseño no elimina el autoplay: lo acota** — la autopausa al colapsar convierte "reproduce mientras la pantalla exista" en "reproduce mientras el video esté grande". ⚠️ El ahorro es **condicional al scroll** y, con el piso en 260 px, **más modesto** que con un piso pequeño: quien abre y no scrollea consume lo mismo que hoy. Trade-off aceptado explícitamente.
- **Jerarquía.** La ubicación es criterio de decisión #1 en renta/venta y hoy está enterrada al final del scroll, tras la ficha del agente (`PropertyDetailScreen.tsx:177`).
- **Ruido.** Los 3 chips de nicho ocupan un bloque sin ser criterio de lectura (y el array `amenities` que ese mismo componente pinta **nunca se escribe desde la app**).
- **Wizard.** La `toggles_card` de step4 (`step4.tsx:99-136`) gasta ~1/3 de pantalla en 3 booleanos opcionales, con estética de formulario de ajustes ajena al resto de la app.
- Encaje con el hito: pulido de la demo cerrada + control de costos de la beta ([[0005-demo-cerrada-3-semanas]]).

## Resultado esperado

**Detalle (`/property/[id]`)**
1. Al abrir: el hero ocupa **2/3 de la altura de ventana** y **reproduce** (muted/loop, como hoy).
2. Al **bajar**, el hero encoge de forma continua hasta **260 px** (el tamaño actual); al tocar ese piso el video **queda en pausa**.
3. Al **subir**, el hero crece y el video **retoma play** (salvo pausa manual vigente), con **tope duro en 2/3**.
4. Desde el tope, un **gesto de pull** lo lleva a **pantalla completa full-bleed**, con **comportamiento idéntico en iOS y Android**; se sale con gesto inverso **o** botón cerrar.
5. Un **botón play/pause manual** sobre el hero corta la reproducción en cualquier estado; **la pausa manual gana** sobre el autoplay por scroll.
6. `back_btn` siempre visible; rail de acciones y badge hacen fade al colapsar.
7. Ya no aparece la fila de chips de amenidades; el mapa sube a la **segunda posición** del contenido.
8. Acabado visual validado con un **preview HTML aprobable de los 3 estados** antes de portar a RN.
9. La previsualización del wizard (`step5.tsx`) deja de reproducir indefinidamente.

**Wizard (publicar)**
10. En `step4`, bajo la descripción, una **fila compacta de chips** ("Pet friendly", "Sin aval", "Estudiantes") con estado activo/inactivo claro; sin card de switches.
11. Los 3 booleanos siguen viajando **idénticos** en el payload de `publish-property` y `edit-property` → `FilterSheet` sigue filtrando con datos reales.

## Alcance

- **SÍ entra (Tarea A — hero):**
  - `mobile/src/features/property-detail/lib/heroCollapse.ts` **(nuevo, vía crítica)** — umbrales, histéresis, `progress`.
  - `mobile/src/features/property-detail/PropertyDetailScreen.tsx` — reestructura del layout (`Animated.ScrollView`, hero con estilo animado, `back_btn` fuera del hero, reordenar secciones, quitar `AmenityChips`).
  - `mobile/src/features/property-detail/components/PropertyVideoPlayer.tsx` — altura controlada desde afuera, control imperativo play/pause, botón manual, handle, overlays con fade.
  - `mobile/src/features/property-detail/components/DetailSkeleton.tsx` — altura del hero pasa de 260 a `HERO_MAX` (constante única).
  - `mobile/src/features/property-detail/components/AmenityChips.tsx` — **se borra** (nadie más lo consume; el array `amenities` que pinta nunca se escribe).
  - `mobile/src/features/property-detail/components/PropertyMap.tsx` — ajuste de estilo/altura al subir de posición (hoy `MAP_HEIGHT = 160`) + revisión de captura de gestos.
  - `mobile/app/(protected)/publish/step5.tsx` — parte **(b) de #106**: preview sin loop infinito + pausa al perder foco.
  - Preview HTML de los 3 estados (artefacto de diseño, en `.taskmaster/docs/exploraciones/` o `previews/`).
- **SÍ entra (Tarea B — chips):**
  - `mobile/src/components/ChipGroup.tsx` **(nuevo, promovido desde `features/search/components/FilterChipGroup.tsx`)**.
  - `mobile/src/features/search/components/FilterSheet.tsx` — solo actualizar el import (único consumidor: `FilterSheet.tsx:44,258,274`).
  - `mobile/app/(protected)/publish/step4.tsx` — quitar `toggles_card`, montar los chips.
- **NO entra (out of scope, ambas):**
  - Cambiar el payload, la validación (`features/publish/validation.ts`) o el schema — los 3 booleanos y `get_property_payload` quedan **intactos**.
  - Capturar `amenities` (JSONB) en el wizard — **YAGNI**, descartado explícitamente.
  - Migrar los 3 `ToggleRow` de `FilterSheet` a chips — **no en este lote**.
  - Migrar todo `step4.tsx` a `theme.ts` — **solo la sección de chips** usa tokens.
  - Tope duro de reproducción por tiempo — diferido.
  - Tocar el feed (`VideoFeedItem`) ni el reproductor del feed.
  - Cualquier cosa de `supabase/**` (sin migraciones, sin Edge Functions).
  - **Dependencias nuevas** — Reanimated 4.3.1 y gesture-handler 2.31.2 ya instalados (`mobile/package.json:39,41`).

## Roles afectados

- **Comprador/buscador:** principal beneficiado — el video protagoniza cuando lo mira y vuelve a su tamaño actual cuando lee; menos ruido; ubicación más arriba.
- **Inmobiliaria + agente:** su video se ve **más grande** que hoy (2/3 vs 260 px) al abrir; captura los 3 flags con menos fricción.
- **Admin de plataforma:** sin impacto.
- **Negocio:** el consumo de Stream por sesión de detalle **baja solo si el usuario scrollea hasta el piso**; a cambio, el hero grande aumenta los minutos de quien se queda arriba mirando. Trade-off aceptado, no ahorro garantizado.

## Impacto en datos

**n/a — cero cambios de BD.** Sin migración, sin enum, sin RLS, sin trigger, sin bucket. Todas las columnas (`pet_friendly`, `allows_no_guarantor`, `student_friendly`, `property_videos.thumbnail_url`) ya existen desde `0005`/#68 y el contrato de escritura no cambia.

⚠️ Dependencia de dato existente: el poster que se pinta detrás del `VideoView` (`PropertyVideoPlayer.tsx:110-112`) debe seguir siendo el **firmado** (`posterUrl`, de la EF `mint-video-url`), **no** la columna cruda `thumbnail_url` (401 con Stream). Con un hero de 2/3, un poster ausente es **mucho más visible** que hoy.

## Impacto en UI y gate de branding (RESUELTO)

Dos pantallas con diseño visual nuevo. **`urbea-identidad-visual.html` mockup #5 "Detalle"** (líneas ~889-898) dibuja un hero **estático de 230 px** con `play-btn` centrado (círculo 66 px, `rgba(246,242,235,.16)`, borde `1.5px rgba(246,242,235,.5)`, blur 8), `op-badge` abajo-izquierda y `vid-count` "3 videos" abajo-derecha. **El hero de 2/3 con colapso continuo y fullscreen NO existe en la referencia canónica.**

**Resolución del gate (CLAUDE.md §8):**
- Se construye un **preview HTML aprobable de los 3 estados** (2/3 reposo · 260 px colapsado · fullscreen expandido) **ANTES** de portar a React Native. Es el método de §8 para componentes de firma.
- Esto **satisface el gate**: se registra como **divergencia consciente** en [[design-system]] (mismo patrón que la tab bar de #65). **No** bloquea con una aprobación de cliente aparte, porque el "cliente" (Abraham) está co-diseñando esto en vivo.
- El **preview HTML es el primer paso del plan** de la Tarea A, no un anexo.
- El `play-btn` del mockup **se reusa tal cual** para el botón play/pause manual (especificación visual ya existente).
- **Divergencias registradas:** (1) hero animado de 3 estados; (2) mapa en segunda posición (el mockup #5 lo pone al final). Quitar los chips de amenidades **alinea** con la referencia (el mockup #5 no los dibuja) → no es divergencia.
- `step4.tsx` usa hoy una paleta local de hex (`COLOR_BG`, `COLOR_ACCENT = '#1A5E44'`, …): **solo la sección de chips** migra a `theme.ts`; el resto del archivo se deja como está (alcance mínimo, deuda registrada).

## Reglas no obvias aplicables

- ⚠️ **`useVideoPlayer` libera el player al desmontar**: llamar `player.pause()`/`release()` en cleanup truena con *"shared object already released"* (`PropertyVideoPlayer.tsx:9-13`, `VideoFeedItem.tsx:301-304`). **Camino nuevo de exposición:** un `runOnJS(pause)` disparado por el scroll puede **aterrizar después del desmonte** (navegar atrás mientras el hero colapsa). → **`mounted_ref` obligatorio.**
- 🔴 **Callbacks de gesture-handler/Reanimated que tocan JS necesitan `runOnJS`** o truenan con *"Tried to synchronously call a non-worklet function on the UI thread"* (`VideoFeedItem.tsx:215-236`). `player.play()/pause()` son JS: **no** se llaman desde un worklet.
- 🔴 **La reproducción de video quema cuota real** (post-#68, minutos de Cloudflare Stream). Verificar reproducción y **parar**; Maestro termina en `stopApp`. — memoria `video_playback_burns_quota`. ⚠️ Iterar el diseño del hero **implica reproducir** decenas de veces: presupuestarlo (ver "Plan de pruebas").
- 🔴 **El `thumbnail_url` del webhook de Stream NO está firmado → 401.** El poster viene del **mint** (`posterUrl`), y el token firmado de Stream va **EN EL PATH**, no como query param. — [[propiedades-y-video]] §GOTCHA CRÍTICO · `wiki/log.md` 2026-07-22.
- ⚠️ **`edit-property` exige body COMPLETO** desde #142: si el selector de chips deja de escribir alguno de los 3 booleanos en `PublishFormState`, la edición los manda en `false` y **borra el dato en silencio**. — [[moderacion]].
- ⚠️ **Semántica de los flags en búsqueda:** en `FilterSheet` un `false` = "no filtrar" (nunca `.eq(col,false)`); en la propiedad `false` = "no aplica". Los chips producen **boolean estricto**, no tri-estado. — [[busqueda-y-filtros]].
- ⚠️ **Criticidad TDD determinista (CLAUDE.md §5):** `components/**`, pantallas y `app/**` = **NO crítica** → verificación ligera (`tsc` + `lint` + smoke). **`lib/heroCollapse.ts` = CRÍTICA → RED antes que GREEN** (`mobile/**/lib/**`). Regla de desempate (*duda o mezcla → crítica*) confirmada.
- ⚠️ **RNTL no ve layout** (memoria `rntl_no_ve_layout`): una suite verde **no** prueba que el hero mida lo que debe. Los tests cubren **solo la función pura**; la geometría se valida por screenshot CLI.
- ⚠️ **Gestos y Reanimated no son simulables en RNTL** — precedente documentado en `RadiusSelector.test.tsx:15` / `RadiusSelector.tsx:13-14`.
- ⚠️ **Testing en emulador SOLO por CLI** (`adb shell input swipe`, `adb exec-out screencap -p`, `adb shell dumpsys gfxinfo`, `xcrun simctl`), **nunca computer-use**. — CLAUDE.md §3 · memoria `emulator_testing_cli_only`.
- ⚠️ **PNPM siempre**; `task-master` por CLI, nunca MCP; `add-task`/`expand`/`update-task` están rotos (`generateObject` → API 400) → crear/editar tareas escribiendo `.taskmaster/tasks/tasks.json` a mano (+ `.bak` + `validate-dependencies`). `update-task`/`update-subtask` además **re-tipan `task.id` string→int** (revisar `git diff`). — memorias `taskmaster_addtask_provider_broken`, `taskmaster_update_task_regenerates`.
- ⚠️ **Todo el cambio es JS → viaja por OTA** (`cd mobile && pnpm ota "<msg>"` desde `main` mergeado). **Sin módulo nativo nuevo** (Reanimated y gesture-handler ya instalados, plugin de babel configurado en `mobile/babel.config.js:5-7`) → sin rebuild. — [[estrategia-releases]].
- ⚠️ **`mobile/AGENTS.md`:** *"Expo HAS CHANGED — read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code"* — obligatorio antes de tocar `expo-video`.
- ⚠️ **Tareas derivadas (CLAUDE.md §5):** título `producto(10.2): …`, descripción abriendo con `Origen: … · Detectado por: usuario`, `dependencies` con la tarea origen y **backlink `DERIVADAS:`** en los details del origen (#10).

## Hallazgos de la investigación (footprint real)

| Hecho | Dónde |
|---|---|
| 🔴 **El hero HOY mide 260 px fijos**, no pantalla completa. El estado grande de 2/3 (~533 px en 800 dp) es **el doble** de hoy; el estado mínimo **es exactamente el de hoy**. | `PropertyVideoPlayer.tsx:28` (`HERO_HEIGHT = 260`) |
| 🔴 **En `mobile/src` NO existe ningún patrón scroll-driven que reusar.** Cero ocurrencias de `useAnimatedScrollHandler`, `useScrollViewOffset`, `interpolate`, `Animated.ScrollView` o `scrollEventThrottle`. **Este sería el primer collapsing header del repo** — razón principal del nivel L. | grep sobre `mobile/src` + `mobile/app` |
| ✅ **Sí hay convenciones Reanimated establecidas** (7 archivos): `useSharedValue` + `useAnimatedStyle` (+ `withTiming`/`withSpring`/`withRepeat`) en `DetailSkeleton`, `FeedSkeleton`, `GridSkeleton`, `HeartAnimation`, `LikeButton`, `SaveButton`, `GlassTabBar`. `GestureHandlerRootView` **ya está montado** en el root. | `app/_layout.tsx:4,54` · `babel.config.js:5-7` |
| ✅ **El toggle play/pause manual ya está resuelto en el feed y es copiable casi literal**: `toggle_play_pause` (guarda `player.playing`, setea `is_paused`) + overlay con `Play` de Phosphor a `rgba(255,255,255,0.85)` weight fill. **Reusar > reescribir.** | `VideoFeedItem.tsx:203-212, 348-351` |
| ✅ **Ya existe `BackButton` reutilizable** (`floating`, respeta `insets.top`, `accessibilityLabel="Volver atrás"`), pero el detalle usa un `Pressable` inline propio dentro de `hero_wrapper`. Al sacar el back del hero, considerar consolidar. | `src/components/BackButton.tsx` · `PropertyDetailScreen.tsx:114-121` |
| ✅ **Ya hay tokens de motion en el theme** (`lens_spring_damping: 30`, `lens_spring_stiffness: 240`, `lens_fade_duration_ms: 180`), nacidos con la lupa de `GlassTabBar`. Usarlos para el snap/expansión en vez de inventar curvas. | `theme.ts:177-181` |
| ✅ **`useWindowDimensions` es el patrón vigente** para medir pantalla (no `Dimensions.get`): de ahí sale el 2/3. | `FeedScreen.tsx:45` · `VideoFeedItem.tsx:60` · `DetailSkeleton.tsx:40` |
| ⚠️ **El hero vive HOY FUERA del `ScrollView`**, como hermano, con `back_btn` y `action_overlay` en `position:absolute` dentro de `hero_wrapper`, y un **CTA sticky** al fondo (`STICKY_CTA_CLEARANCE = 86`). Un collapsing header exige reestructurar el ensamblaje completo de la pantalla. | `PropertyDetailScreen.tsx:106-199, 213-250` |
| ⚠️ **`DetailSkeleton` duplica a mano `HERO_HEIGHT = 260`** ("sincronizada con PropertyVideoPlayer"). Debe pasar a `HERO_MAX` o habrá salto al cargar. | `DetailSkeleton.tsx:31` |
| ⚠️ **`PropertyMap` (react-native-maps, nativo) vive DENTRO del mismo ScrollView.** Un mapa nativo captura gestos verticales; con un ScrollView que ahora también interpreta pan para el hero, hay riesgo de robo de gesto (sobre todo Android). Al subirlo a 2ª posición queda **más cerca del hero**, donde vive el `Gesture.Pan()` → el riesgo sube. | `PropertyDetailScreen.tsx:177` |
| **Orden actual del contenido:** `PropertyInfoHeader` → sección dirección/descripción/`AmenityChips` → `AgentCard` → `PropertyMap`. | `PropertyDetailScreen.tsx:135-180` |
| **#106 quedó contradicha, no ampliada.** Pide literalmente *"detalle SIN reproducción — card de miniatura + descripción"* y *"el detalle es contexto, no reproducción"*. La idea nueva es lo contrario. Su parte **(b)** (preview del wizard en loop) **sí sigue viva**. | `tasks.json` id `106` (`pending`, dep `10`) |
| **#44 está `pending`**: *"On-screen back button for iOS navigation across all demo screens"* — iOS no tiene back de hardware y el root tiene `headerShown:false` global (`app/_layout.tsx:35`). Sacar el back del hero **no puede** regresar ese problema. | `tasks.json` id `44` |
| El hero hoy: `p.loop = true`, `p.muted = true`, `player.play()` al montar; `bufferOptions` anti-OOM (`preferredForwardBufferDuration: 10`, `maxBufferBytes: 25 MB`, fix #57); poster **detrás** del `VideoView`; `nativeControls={false}`; badge "N videos" solo si `videos.length > 1`. | `PropertyVideoPlayer.tsx:60-135` |
| `posterUrl` **solo existe tras** `mint-video-url` (fail-soft: si la EF falla, no hay poster **ni** video). TTL ~4 h. | `usePropertyDetail.ts:143-183` · `mint-video-url/index.ts:15` |
| `AmenityChips` pinta los 3 flags **y** el array `amenities`; **el wizard nunca escribe `amenities`** → siempre vacío. Borrarlo no pierde funcionalidad viva. | `AmenityChips.tsx:62-76` |
| **`FilterChipGroup` es multi-select controlado, listo para promover**: `options/selected/onChange`, `accessibilityRole="checkbox"`, tokens `primary_tint`/`paper_2`/`gray_2`, helper `toggle_chip`. **Un solo consumidor** (`FilterSheet.tsx:44,258,274`) y **cero tests** → la promoción es un `git mv` + 1 import. | `features/search/components/FilterChipGroup.tsx` |
| El wizard son **5 pasos** desde #73.3 (el `mapa-codebase` todavía dice "3 pasos" → **señal de mapa desactualizado**, corregir en el ingest). step3 = obligatorios; step4 = descripción + los 3 toggles (`step4.tsx:99-136`); step5 = video + publicar. | `app/(protected)/publish/step{3,4,5}.tsx` · `mapa-codebase.md:69` |
| El preview del wizard corre en loop sobre un **archivo local** (`local_uri`), no sobre Stream: `player.loop = true` + `play()` al cambiar la URI. ⚠️ Por eso su costo **no es de cuota**, es de **batería/CPU/OOM y UX** — corregir el rationale de #106(b). | `step5.tsx:101-115` |
| Tests existentes en el footprint: **ninguno** para `PropertyDetailScreen`, `PropertyVideoPlayer`, `DetailSkeleton`, `AmenityChips`, `PropertyMap`, `FilterChipGroup` ni `step4`. | `property-detail/components/__tests__/` · `features/search/__tests__/` |
| Precedente de crash Android con expo-video + props del player: **#61** *"Cannot set prop player on view SurfaceVideoView"*. La superficie nativa de video es sensible a cambios de props/layout. | `tasks.json` id `61` (`done`) |
| ⚠️ **Paralelismo obsoleto:** **#145 ya está `done`** y el árbol está limpio sobre `main` → rama normal desde `origin/main`, sin worktree aislado. | `tasks.json` id `145` |

## Fases / épicas

### Tarea A — hero de video con colapso por scroll (nivel L)
1. ⭐ **Preview HTML aprobable de los 3 estados** (2/3 reposo · 260 px colapsado · fullscreen) + la transición → **aprobación** → recién entonces portar a RN. *(Primer paso, no negociable: es lo que satisface el gate de §8.)*
2. *(CRÍTICA, RED primero)* `lib/heroCollapse.ts`: `progress`, clamp de tope 2/3, piso 260, histéresis 0.55/0.85, respeto de `manual_paused`, guarda de pantallas cortas — función pura + tests.
3. Reestructura de `PropertyDetailScreen` a `Animated.ScrollView` + hero de altura fija con `transform` (enfoque A) — 2/3 ↔ 260, sin play/pause aún. Sincronizar `DetailSkeleton` a `HERO_MAX`.
4. Cableo del auto play/pause: `useAnimatedReaction` + `runOnJS` solo en el cambio de estado + `mounted_ref`.
5. Botón play/pause manual (reuso de `VideoFeedItem`) + `manual_paused` que gana sobre el scroll.
6. Overlays: `back_btn` fuera del hero y siempre visible (no-regresión #44); fade de `action_overlay` y badge.
7. Gesto `Gesture.Pan()` de expansión a fullscreen + handle/chevron + salida por gesto inverso y botón cerrar; paridad iOS/Android.
8. Quitar `AmenityChips` (borrar archivo) + subir `PropertyMap` a 2ª posición + revisar robo de gesto del mapa.
9. Parte (b) de #106: `step5.tsx` preview sin loop infinito + pausa al perder foco.
10. Perfilado en Android gama media por CLI (`dumpsys gfxinfo`); **si reprueba → fallback declarado a enfoque C** (dos estados discretos con `withTiming`).

### Tarea B — chips de características en el wizard (nivel M/S)
1. Promover `FilterChipGroup` → `mobile/src/components/ChipGroup.tsx` (`git mv` + actualizar el import de `FilterSheet`); `pnpm tsc --noEmit` verde.
2. Quitar `toggles_card` de `step4.tsx`; montar `ChipGroup` como fila compacta bajo la descripción, con tokens de `theme.ts` **solo en esa sección**.
3. Mapear `string[] ⇄ 3 booleanos` inline en el screen (boolean estricto, nunca tri-estado).
4. Verificar publicar **y** editar contra el stack real (contrato de body completo de #142) + regresión de `FilterSheet`.

## Criterios de aceptación

### Tarea A — hero de video con colapso por scroll (L)

**Gate de diseño**
- [ ] Existe un **preview HTML de los 3 estados** (2/3 reposo, 260 px colapsado, fullscreen full-bleed) con la transición, **aprobado antes** de escribir RN. La divergencia respecto al mockup #5 queda **registrada en [[design-system]]** (patrón tab bar #65).

**Geometría**
- [ ] Al abrir el detalle, el hero mide **`round(window_height * 2/3)`** (±2 px) y **reproduce**. Verificado por screenshot CLI en iOS y Android.
- [ ] Al hacer scroll hacia abajo, el hero encoge de forma **continua**, sin saltos ni parpadeo/tearing de la superficie de video, hasta un piso de **260 px** (`HERO_MIN`, el `HERO_HEIGHT` actual) — **y no menos**. Verificado por screenshot en el estado colapsado.
- [ ] Seguir scrolleando en el piso **no** reduce más el hero ni lo oculta.
- [ ] Al hacer scroll hacia arriba, el hero crece **hasta 2/3 y no más**: el scroll normal **nunca** produce un hero mayor a `HERO_MAX`.
- [ ] En una ventana corta donde `HERO_MAX - 260 < 120`, aplica la guarda `HERO_MIN = HERO_MAX - 120` y el colapso sigue siendo perceptible (verificado en un emulador de pantalla pequeña o con `window_height` reducida).
- [ ] El `DetailSkeleton` usa **`HERO_MAX`** (no 260) y **no** produce salto de altura al terminar la carga (constante en un único lugar, sin duplicación literal).

**Reproducción**
- [ ] Al alcanzar el piso de 260 px, el video **queda pausado** (`player.playing === false`).
- [ ] Al volver a expandir por scroll, el video **retoma play** — **salvo** que haya una pausa manual vigente.
- [ ] **La pausa manual gana:** tras tocar pause, ningún scroll (colapsar ni expandir) reanuda el video; solo vuelve a reproducir al tocar play de nuevo.
- [ ] El botón play/pause manual funciona en **los tres** estados (2/3, colapsado, fullscreen).
- [ ] El hero sigue `muted` y en `loop`, igual que hoy.
- [ ] **Histéresis verificable:** un scroll rápido de ida y vuelta cruzando la banda 0.55–0.85 **no** produce más de una llamada a `play()`/`pause()` por transición real de estado (verificado con un contador instrumentado en dev; **cero** llamadas por frame).

**Fullscreen**
- [ ] Desde el tope de 2/3, un **gesto de pull** expande el hero a **pantalla completa full-bleed** (borde a borde, como el feed).
- [ ] El fullscreen **no** es alcanzable por scroll normal — solo por ese gesto.
- [ ] Se sale de fullscreen **tanto** con el gesto inverso **como** con el botón de cerrar (ambos funcionan).
- [ ] Un **chevron/handle** aparece al llegar al tope de 2/3 como affordance del gesto, y desaparece al colapsar.
- [ ] ⭐ **Paridad de plataforma:** el gesto y los tres estados se comportan **idénticamente en iOS y Android**, verificado en **ambos** emuladores **por CLI** (`adb shell input swipe` + `adb exec-out screencap -p`; `xcrun simctl io … screenshot`). Nunca computer-use.

**Overlays y navegación**
- [ ] 🔴 **No-regresión de #44:** el `back_btn` está **visible y funcional en iOS** en los tres estados del hero (incluido fullscreen), fijo en safe-area y por encima de cualquier transform del hero. Verificado por screenshot iOS en los tres estados.
- [ ] El `action_overlay` (rail like/save) y el badge "N videos" hacen **fade** al colapsar y **reaparecen** al expandir; con opacidad 0 no interceptan toques (`pointerEvents: 'none'`).
- [ ] Like y save siguen funcionando en el estado expandido (sin regresión de `ActionButtons`).

**Estabilidad y performance**
- [ ] Navegar atrás **mientras el hero está animando/colapsando** no produce *"shared object already released"* (guard de montaje), verificado 5 veces seguidas en Android y en iOS.
- [ ] No aparece *"Tried to synchronously call a non-worklet function on the UI thread"* en ningún recorrido.
- [ ] ⭐ **Performance medida, no impresión:** durante un colapso completo con el video reproduciendo en **emulador Android gama media**, `adb shell dumpsys gfxinfo <pkg>` reporta **≤ 5 % de janky frames** y **percentil 95 ≤ 24 ms** (umbral inicial; se confirma al armar el plan de pruebas en `/tm-plan`). **Si reprueba → se aplica el fallback declarado (enfoque C: dos estados discretos con `withTiming`)** y se documenta la decisión con un comentario `// ponytail:`.
- [ ] El `VideoView` **no** cambia de `height` por frame (enfoque A: contenedor de altura fija + `transform` + `overflow:hidden`) — verificable por lectura del diff.

**Contenido de la pantalla**
- [ ] La fila de `AmenityChips` **ya no aparece** en el detalle y el archivo `AmenityChips.tsx` **está borrado** (sin imports huérfanos; `pnpm tsc --noEmit` verde).
- [ ] El orden del contenido scrolleable es: **`PropertyInfoHeader` → `PropertyMap` → dirección/descripción → `AgentCard`** (mapa en **segunda posición**).
- [ ] El `PropertyMap` sigue siendo usable (pan/zoom propios) **sin** que su gesto rompa el colapso ni la expansión del hero, y sin que el `Gesture.Pan()` del hero robe el gesto del mapa.
- [ ] El CTA sticky de WhatsApp sigue anclado y funcional en los tres estados.
- [ ] Si el mint falla (sin `posterUrl`), el hero de 2/3 muestra el fallback `ink_feed` sin romperse (no queda medio teléfono en blanco/negro sin explicación).

**Parte (b) de #106 — preview del wizard**
- [ ] La previsualización de `step5.tsx` **deja de reproducirse indefinidamente**: sin `loop` infinito y **pausada al perder el foco** de la pantalla.
- [ ] Volver a `step5` no deja dos players sonando/corriendo a la vez; publicar o salir del wizard detiene la reproducción.

**Verificación transversal**
- [ ] Tests **RED primero** de `lib/heroCollapse.ts` (vía crítica): progress/clamp, piso 260, tope 2/3, histéresis 0.55/0.85, `manual_paused` gana, guarda de pantalla corta. Todos en verde.
- [ ] `pnpm tsc --noEmit` y `pnpm lint` en verde; suite Jest **sin regresiones**.
- [ ] Todo flujo de verificación con video termina en `stopApp` y **no** se deja el detalle abierto reproduciendo (cuota de Stream).
- [ ] Maestro: `botonera.yaml` sigue pasando.
- [ ] Ingest al vault: `mapa-codebase.md` (entrada de `property-detail/`), [[design-system]] (**primer patrón scroll-driven del repo** + divergencia del mockup #5), [[propiedades-y-video]] (nuevo régimen de consumo) y línea en `wiki/log.md`.

### Tarea B — chips de características en el wizard (M/S)

- [ ] `FilterChipGroup` **está promovido** a `mobile/src/components/ChipGroup.tsx`; `FilterSheet.tsx` lo consume desde la nueva ruta y **no queda** el archivo viejo en `features/search/components/`. `pnpm tsc --noEmit` verde.
- [ ] `FilterSheet` **se ve y funciona exactamente igual que antes** (operación y tipo de propiedad) — regresión visual verificada por screenshot CLI.
- [ ] En `step4.tsx` **ya no existe** la `toggles_card` ni ningún `Switch` (el import de `Switch` queda eliminado).
- [ ] Los 3 flags se capturan con una **fila compacta de chips bajo la descripción**, dentro de `step4`, sin card ni sección dedicada nueva.
- [ ] El copy es **"Pet friendly" · "Sin aval" · "Estudiantes"**, cada chip con un `accessibilityLabel` **largo y descriptivo** ("Acepta mascotas", "No requiere aval o fiador", "Apto para estudiantes") y `accessibilityState` que refleje el seleccionado.
- [ ] **Solo la sección de chips** usa tokens de `theme.ts`; el resto de `step4.tsx` conserva sus hex locales (sin migración masiva).
- [ ] Los chips producen **boolean estricto** (`true`/`false`), nunca `undefined` ni tri-estado, en `PublishFormState`.
- [ ] **Publicar** una propiedad con chips activos deja `pet_friendly` / `allows_no_guarantor` / `student_friendly` correctos en `properties`, **verificado contra el stack real** (leyendo la fila), no solo el form.
- [ ] **Editar** una propiedad que ya tenía flags en `true` los **conserva** — regresión #142 (contrato de body completo de `edit-property`): el body sigue llevando los 3 booleanos.
- [ ] `FilterSheet` sigue devolviendo resultados no vacíos al filtrar por **cada uno** de los 3 flags.
- [ ] Flujo Maestro `publicar.yaml` sigue pasando (ajustando el selector si apuntaba a los `Switch`); termina en `stopApp`.
- [ ] `pnpm tsc --noEmit` y `pnpm lint` en verde; suite Jest sin regresiones.
- [ ] Ingest al vault: `mapa-codebase.md` (nuevo `src/components/ChipGroup.tsx` + **corregir "wizard 3 pasos" → 5 pasos**, `mapa-codebase.md:69`), [[busqueda-y-filtros]] si aplica, y línea en `wiki/log.md`.

## Dependencias

- **Tarea A** y **Tarea B** son **independientes entre sí**: no comparten archivos, ni riesgo, ni orden. B puede entregarse mucho antes.
- **Tarea #106** (`pending`) — **se cancela como superseded** por la Tarea A (lo hace el agente principal vía `task-master set-status --id=106 --status=cancelled` en la promoción). Su parte (b) queda **doblada dentro de la Tarea A**.
- Tarea **#10** (detalle de propiedad, `done`) — base del código tocado; ambas tareas la declaran en `dependencies` y #10 recibe el **backlink `DERIVADAS:`**.
- Tarea **#44** (`pending`, back on-screen en iOS) — **no es dependencia**, pero la Tarea A lleva un **criterio de no-regresión explícito** para no reintroducir el problema.
- ~~Tarea #145~~ — `done`, sin concurrencia; rama normal `tarea/<id>-<slug>` desde `origin/main` fresco, **sin worktree aislado**.
- EF `mint-video-url` (viva) — de ahí sale el poster firmado y el `signed_url`.
- **Sin dependencias nuevas de paquete**: `react-native-reanimated@4.3.1`, `react-native-gesture-handler@~2.31.2`, `expo-video@~56.1.4`, `expo@~56.0.12` ya instalados → **el cambio viaja por OTA**.
- Código a reusar: `VideoFeedItem.toggle_play_pause` + overlay `Play`, `BackButton.tsx`, tokens de motion de `theme.ts` (`lens_spring_*`), `FilterChipGroup.tsx`, `PrimaryButton`.
- Referencias de diseño: `urbea-identidad-visual.html` (mockup #5, clases `.play-btn`/`.op-badge`/`.vid-count`/`.tag`) y `Urbea Prototipo (standalone).html` (**solo layout**).

## Edge cases / riesgos

1. 🔴 **`runOnJS` en vuelo tras el desmonte → *"shared object already released"*.** Si el usuario navega atrás durante un colapso, la llamada aterriza sobre un player liberado. **Mitigación:** `mounted_ref` + nunca tocar el player en cleanup. **Criterio de aceptación dedicado.**
2. 🔴 **Divergencia iOS/Android en el overscroll.** Android **no genera offset** al sobre-scrollear (`overScrollMode` solo pinta glow) → riesgo de que "expandir a fullscreen" funcione en iPhone y no exista en Android. **Mitigación decidida:** `Gesture.Pan()` explícito idéntico + verificación obligatoria en ambos emuladores por CLI.
3. 🔴 **Performance del video reproduciendo mientras su contenedor se anima, en Android gama media.** **Mitigación:** enfoque A (`transform`, nunca `height`) + **umbral medible con `dumpsys gfxinfo`** + **fallback C ya declarado**. El piso corregido a 260 px **reduce** el recorrido animado (≈273 px en vez de ≈433) → menos presión de la que se estimaba en la 2ª pasada.
4. **Robo de gesto del `PropertyMap`.** Al subirlo a 2ª posición queda **más cerca del hero**, justo donde vive el `Gesture.Pan()`. Riesgo elevado respecto al layout actual. **Mitigación:** composición explícita de gestos y prueba dedicada de pan/zoom del mapa.
5. **Cuota de Cloudflare Stream durante el desarrollo.** Iterar un hero de video implica reproducir decenas de veces; el ahorro prometido puede quedar neto negativo. **Mitigación:** iterar contra video local/seed cuando se pueda, `stopApp` al final de cada flujo, nunca dejar el detalle abierto.
6. **El ahorro es condicional y ahora más modesto.** Con piso 260 px el video sigue visible más tiempo; quien abre y no scrollea consume lo mismo que hoy, y el hero de 2/3 invita a quedarse mirando. Se difirió el tope duro por tiempo. **No declarar "ahorro" sin medirlo en el dashboard de Stream.**
7. **`DetailSkeleton` desincronizado** (hoy 260, debe ser `HERO_MAX`) → salto de layout al terminar la carga.
8. **Poster ausente a 2/3 de pantalla.** Lo que hoy es un rectángulo de 260 px pasa a medio teléfono (síntomas de #89 / #91 mucho más visibles).
9. **Regresión de #44** si el `back_btn` hereda el `transform` del hero o queda debajo en z-index.
10. **Accesibilidad / motion sensitivity.** Un hero que se transforma con cada scroll puede marear; hoy el repo **no** consulta `AccessibilityInfo.isReduceMotionEnabled` en ninguna parte. **Deuda registrada** (candidata a tarea derivada, fuera de este lote).
11. **Regresión silenciosa de datos en edición** si los chips no escriben los 3 booleanos (contrato de body completo, #142).
12. **Divergencia de diseño no registrada** (hero animado + mapa arriba) → registrarla en [[design-system]] como se hizo con la tab bar de #65.
13. **Mezcla de sistemas de estilo** en `step4.tsx` (hex locales vs `theme.ts`) — aceptada conscientemente por alcance mínimo; deuda registrada.

## Plan de pruebas (alto nivel)

- **Vía crítica (RED primero):** `lib/heroCollapse.ts` — umbrales, histéresis 0.55/0.85, clamp del tope 2/3, piso 260, guarda de pantalla corta, `manual_paused` gana. Sin RNTL, sin gestos.
- **Vía ligera** para pantalla y componentes: `pnpm tsc --noEmit` + `pnpm lint` + smoke.
- ⚠️ **Gestos y layout NO son testeables en RNTL** (precedente `RadiusSelector.test.tsx:15`; memoria `rntl_no_ve_layout`: una suite verde no ve una altura 0). **La geometría se valida por screenshot, punto.**
- **Smoke por CLI, obligatorio en iOS y Android** (nunca computer-use), recorriendo: abrir (2/3, reproduciendo) → colapsar (260 px, pausado) → expandir (2/3, reproduce) → pausa manual → colapsar/expandir (sigue pausado) → play → pull a fullscreen → salir por gesto → salir por botón.
  - Android: `adb shell input swipe` + `adb exec-out screencap -p` en cada estado; `adb shell dumpsys gfxinfo <pkg>` durante el colapso.
  - iOS: `xcrun simctl io … screenshot` en los mismos estados.
- **Verificación de cuota:** confirmar en el dashboard de Cloudflare Stream que un recorrido con colapso suma **menos** minutos que uno sin colapsar.
- **Verificación de datos real** (lección de #73/#126: los mocks no la vieron): publicar una propiedad de prueba con chips activos y **leer la fila** de `properties`; editarla y confirmar que los flags sobreviven.
- **Maestro:** `publicar.yaml` y `botonera.yaml`; terminar en `stopApp`.
- **Regresión de filtros:** `FilterSheet` → cada flag → resultados no vacíos.

## Impacto en PRD (solo referencia — NO se edita)

`docs/PRD-MVP-demo.md` §6 describe el detalle "con video". El cambio no altera el alcance funcional, pero sí la **naturaleza de la pantalla**: de ficha con video de fondo a experiencia con video protagonista que vuelve a su tamaño actual al leer. Decisión de promoción del dueño, fuera de esta exploración.

## Decisiones tomadas (registro completo — no re-preguntar)

**Geometría (P1–P3)**
- (usuario/agente principal) Estado grande/reposo = **2/3 de la ventana** ≈ el doble del hero actual.
- (usuario/agente principal) Fullscreen = **full-bleed borde a borde** como el feed, **solo** por el gesto extra de pull. El scroll normal nunca pasa de 2/3.
- ⭐ (usuario, corrección tardía) **Piso del colapso = 260 px = el `HERO_HEIGHT` actual**, no ~100 px. El estado mínimo es el tamaño que el hero ya tiene hoy en producción.

**Gesto y descubribilidad (P4–P6)**
- `Gesture.Pan()` explícito compuesto con el scroll nativo; **mismo comportamiento en ambas plataformas** (Android no rebota). Verificación en ambos emuladores **por CLI**.
- **Chevron/handle** que aparece al llegar al tope de 2/3.
- Salida de fullscreen: **gesto inverso Y botón cerrar** (ambos).

**Reproducción y control (P7–P10)**
- La **pausa manual gana** sobre el autoplay por scroll hasta que el usuario vuelva a tocar play.
- **Histéresis por umbral** (pausa `progress ≥ 0.85`, play `progress ≤ 0.55`) + `runOnJS` **solo en el cambio de estado**.
- **Sin tope duro de reproducción adicional** en este lote (diferido conscientemente).
- **Muted/loop sin cambios**.

**Overlays (P11–P14)**
- `back_btn`: **fijo en safe-area, siempre visible** encima de cualquier estado. **No-regresión de #44 como criterio explícito.**
- `action_overlay` y badge "N videos": **fade** al colapsar, reaparecen al expandir *(ajuste reversible previsto: si el preview lo desaconseja, se mantienen visibles en el piso — cambio de una línea)*.
- Se conserva: **quitar `AmenityChips`** (y borrar el archivo) + **subir `PropertyMap` a 2ª posición**.

**Enfoque técnico**
- **A** como primario (`Animated.ScrollView` + `useScrollViewOffset` + `transform` sobre contenedor de altura fija con `overflow:hidden`).
- **C** como **fallback automático** si el perfilado con `dumpsys gfxinfo` en Android gama media reprueba A.
- Criterio de performance medible (umbral inicial ≤ 5 % janky frames / p95 ≤ 24 ms, se confirma en `/tm-plan`).

**Backlog**
- **#106 se cancela como superseded** por la Tarea A (lo hace el agente principal). Su parte **(b)** (preview de `step5.tsx`) **entra doblada en la Tarea A**, no como tarea aparte.
- **Dos tareas separadas**: A (hero, L) y B (chips, M/S), independientes.

**Gate de branding**
- **Preview HTML aprobable de los 3 estados antes de portar a RN** → satisface el gate de §8; se registra como **divergencia consciente** en [[design-system]] (patrón tab bar #65). **No** requiere aprobación de cliente aparte: el cliente co-diseñó esto en vivo.

**Chips del wizard**
- Viven en **`step4.tsx`**, fila compacta bajo la descripción.
- Se **promueve `FilterChipGroup` → `mobile/src/components/ChipGroup.tsx`** (reusar > reescribir).
- **Solo la sección de chips** migra a `theme.ts`.
- Copy: **"Pet friendly / Sin aval / Estudiantes"** con `accessibilityLabel` largo.
- `FilterSheet.tsx` **NO** migra a chips en este lote.
- **No** se capturan `amenities` (JSONB) — YAGNI.

**Verificado (no re-preguntar)**
- Reanimated 4.3.1 y gesture-handler 2.31.2 ya instalados → **sin dependencia nativa nueva, viaja por OTA**.
- `FilterChipGroup` tiene **un solo consumidor** y **cero tests** → la promoción es `git mv` + 1 import.
- El preview de `step5.tsx` corre sobre un **archivo local**, no sobre Stream → su costo es **batería/CPU/UX**, no cuota.

## Preguntas abiertas

**Ninguna.** Las 18 preguntas de la 2ª pasada quedaron resueltas (ver "Decisiones tomadas"). El documento está **listo para promover**.

## Promoción

**Al promover (lo ejecuta el agente principal, no este subagente):**
1. `task-master set-status --id=106 --status=cancelled` con nota de *superseded por la Tarea A*; conservar su parte (b) dentro de A.
2. Crear **dos tareas** (⚠️ `add-task` está roto → escribir `.taskmaster/tasks/tasks.json` a mano, con `.bak` previo y `task-master validate-dependencies` después; ids disponibles a partir de **147**):
   - **A — `producto(10.2): hero de video con colapso por scroll en el detalle`** — nivel L, `dependencies: ["10"]`, prioridad alta.
   - **B — `producto(10.4): chips compactos de características en el wizard step4`** — nivel M/S, `dependencies: ["10"]`, prioridad media.
   Ambas abren su descripción con `Origen: subtarea 10.2 / 10.4 · Detectado por: usuario (2026-08-10)`; **backlink `DERIVADAS: #A · #B`** en los `details` de **#10**.
3. Fijar `tarea_id` en el front-matter de este doc y registrar en los `details` de cada tarea el bloque "Decisiones tomadas".
4. Correr `/tm-plan <id>` para el footprint y el desglose de subtareas (la Tarea A arranca por el **preview HTML**; `lib/heroCollapse.ts` entra por la **vía crítica RED-first**).
5. Rama normal `tarea/<id>-<slug>` desde `origin/main` fresco (sin worktree).

**Ingest posterior obligado:** `wiki/codebase/mapa-codebase.md` (entrada de `property-detail/` — el hero deja de ser estático; nuevo `src/components/ChipGroup.tsx`; **corregir "wizard 3 pasos" → 5 pasos** en `mapa-codebase.md:69`), [[design-system]] (**primer patrón scroll-driven del repo** + divergencia del mockup #5), [[propiedades-y-video]] (nuevo régimen de consumo de Stream en el detalle) y una línea en `wiki/log.md`.
