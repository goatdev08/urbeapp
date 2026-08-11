---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: M             # XS | S | M | L | XL
fecha: 2026-08-10
estado: borrador      # borrador → en-revision → aprobado | descartado
tarea_id:             # se llena SOLO al promover — ⚠️ ver "Promoción": #106 YA EXISTE y cubre parte de esto
motivo_descarte:
---

# Detalle sin autoplay (card de miniatura + mapa arriba) y chips de características en el wizard

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ se promueve a tarea[s] en Taskmaster) o **DESCARTARSE**.
> NO edita los PRD maestros; "Impacto en PRD" es solo referencia.

## Idea original

1. **`PropertyDetailScreen.tsx`** (`mobile/src/features/property-detail/`):
   - El video hero (`PropertyVideoPlayer`) deja de reproducirse en autoplay/loop de fondo. En su lugar se muestra la **miniatura estática** (`thumbnail_url` / `posterUrl`) como **card táctil**; al tocarlo se reabre/reproduce el video. Objetivo: dejar de consumir recursos con reproducción automática.
   - Se elimina por completo la sección **`AmenityChips`** (los 3 flags `pet_friendly`, `allows_no_guarantor`, `student_friendly`) de esta pantalla.
   - **`PropertyMap`** pasa a ser el **segundo elemento visible** tras el hero, en vez de ir al final tras `AgentCard`.
   - Debe quedar con buen acabado visual (no es un cambio meramente funcional).
2. **Wizard de publicar, `step4.tsx`** (`mobile/app/(protected)/publish/`):
   - Se elimina la `toggles_card` actual (3 `Switch`: "Acepta mascotas", "Sin aval / fiador", "Apto estudiantes").
   - Se reemplaza por un **selector compacto tipo chips** (patrón visual de `AmenityChips`) integrado dentro de un paso existente (step3 o step4), sin sección/card dedicada. Debe verse bien y con estilo.
   - Ruta elegida (opción 1 de 3 evaluadas por el usuario) para que los 3 campos **sigan capturándose al publicar** y el filtro de `FilterSheet.tsx` siga operando con datos reales. Descartadas: mover la captura a "editar propiedad" (dato ausente en la mayoría de propiedades) e inferirlo del texto libre de la descripción (frágil, falsos negativos silenciosos).
3. **Paralelismo:** desarrollar en **worktree/rama nueva desde `origin/main` fresco**, en paralelo a la tarea #145 (avatar de agente en feed), cuyos archivos tocados (`usePropertyDetail.ts`, `feedProperties.ts`, `useAgentProfile.ts`, `database.types.ts`) **no** coinciden con el footprint de aquí.

## Lluvia de ideas (solo si la idea era abstracta)

n/a — la idea llegó concreta (incluso con las alternativas del punto 2 ya evaluadas y descartadas por el usuario). Las direcciones abiertas que quedan son de **diseño de interacción**, no de enfoque, y viven en "Preguntas abiertas".

## Problema / Motivación

- **Costo real de video.** Cada minuto entregado por Cloudflare Stream se cobra. El hero del detalle hoy hace `player.loop = true` + `player.play()` al montar (`PropertyVideoPlayer.tsx:66-95`): abrir un detalle y dejarlo abierto quema cuota sin que nadie mire. Es el mismo patrón que ya quemó el egress de Supabase (memoria `video_playback_burns_quota`). El video "vive" en el feed; el detalle es **contexto**, no reproducción.
- **Jerarquía de la pantalla.** La ubicación es criterio de decisión #1 en renta/venta y hoy está enterrada al final del scroll, después de la ficha del agente (`PropertyDetailScreen.tsx:177`).
- **Ruido.** Los 3 chips de nicho ocupan un bloque en el detalle sin ser criterio de lectura (y el array `amenities` que ese mismo componente pinta **nunca se escribe desde la app** — el wizard no lo captura, ver "Hallazgos").
- **Wizard.** La `toggles_card` de step4 (`step4.tsx:99-136`) gasta ~1/3 de la pantalla en 3 booleanos opcionales, con estética de formulario de ajustes ajena al resto de la app.
- Encaje con el hito: es pulido de la demo cerrada + control de costos de la beta ([[0005-demo-cerrada-3-semanas]]).

## Resultado esperado

**Detalle (`/property/[id]`)**
1. Al abrir: se ve la **portada** (frame del video) a pantalla completa arriba, con affordance de play visible, badge de operación y contador "N videos" — **cero reproducción, cero consumo**.
2. Tocar la portada **reproduce el video** (destino exacto = pregunta abierta 1), sin loop, y al salir/perder foco el player se detiene.
3. Bajo el hero, la información en el orden nuevo (orden exacto = pregunta abierta 6), con el **mapa arriba**.
4. Ya no aparece la fila de chips de amenidades.
5. Acabado visual con tokens de `theme.ts`, alineado a `urbea-identidad-visual.html` (mockup #5) y al prototipo de layout.

**Wizard (publicar)**
6. En el paso de opcionales, bajo la descripción, una fila de **chips seleccionables** ("Pet friendly", "Sin aval", "Estudiantes") con estado activo/inactivo claro; sin card de switches.
7. Los 3 booleanos siguen viajando **idénticos** en el payload de `publish-property` y `edit-property` → `FilterSheet` sigue filtrando con datos reales.

## Alcance

- **SÍ entra:**
  - `mobile/src/features/property-detail/PropertyDetailScreen.tsx` — reordenar secciones, quitar `AmenityChips`, montar el card de portada.
  - `mobile/src/features/property-detail/components/PropertyVideoPlayer.tsx` — dejar de autoplay/loop; portada + play; reproducción bajo demanda.
  - `mobile/src/features/property-detail/components/AmenityChips.tsx` — se retira del detalle (¿borrar el archivo? → pregunta 8).
  - `mobile/src/features/property-detail/components/PropertyMap.tsx` — posible ajuste de estilo/altura al subir de posición (hoy `MAP_HEIGHT = 160`).
  - `mobile/app/(protected)/publish/step4.tsx` — quitar `toggles_card`, montar el selector de chips.
  - Componente de chips reutilizable (nuevo o promovido desde `features/search/components/FilterChipGroup.tsx` → pregunta 10).
- **NO entra (out of scope):**
  - Cambiar el payload, la validación (`features/publish/validation.ts`) o el schema — los 3 booleanos y `get_property_payload` quedan **intactos**.
  - Capturar `amenities` (JSONB) en el wizard (YAGNI: el filtro no lo usa).
  - Tocar el feed (`VideoFeedItem`) ni el reproductor del feed.
  - `FilterSheet` (los `ToggleRow` de búsqueda se quedan como están — pregunta 13b).
  - Cualquier cosa de `supabase/**` (sin migraciones, sin Edge Functions nuevas).
- **Zona gris (decidir en pregunta 15):** la previsualización del wizard (`step5.tsx:101-113`, `player.loop = true` + `play()`) que también se queda corriendo — es la parte **(b)** de la tarea #106 ya existente y comparte objetivo (no quemar cuota).

## Roles afectados

- **Comprador/buscador:** principal beneficiado — abre el detalle sin reproducción no solicitada, encuentra la ubicación antes, ve menos ruido.
- **Inmobiliaria + agente:** captura los 3 flags con menos fricción en el wizard; su propiedad se sigue viendo en los filtros del buscador.
- **Admin de plataforma:** sin impacto (la moderación no lee estas pantallas).
- **Negocio:** menos minutos entregados de Cloudflare Stream por sesión.

## Impacto en datos

**n/a — cero cambios de BD.** Sin migración, sin enum, sin RLS, sin trigger, sin bucket. Todas las columnas (`pet_friendly`, `allows_no_guarantor`, `student_friendly`, `property_videos.thumbnail_url`) ya existen desde `0005`/#68 y el contrato de escritura no cambia.

⚠️ Dependencia de dato existente (ver "Hallazgos"): la miniatura utilizable es la **firmada** (`posterUrl`, de la EF `mint-video-url`), **no** la columna cruda `thumbnail_url`.

## Impacto en UI

Dos pantallas, ambas con **diseño visual nuevo** → **gate de branding aplicable (CLAUDE.md §8)**:

1. **Card de portada táctil** (componente de firma nuevo en el detalle). Insumos canónicos:
   - `urbea-identidad-visual.html` — **mockup #5 "Detalle"** (líneas ~889-921) **ya dibuja exactamente esto**: hero estático de 230 px con `play-btn` centrado (círculo 66 px, `rgba(246,242,235,.16)`, borde `1.5px rgba(246,242,235,.5)`, blur 8), `op-badge` abajo-izquierda y `vid-count` "3 videos" abajo-derecha. El card táctil **no diverge** de la referencia: la restaura.
   - `Urbea Prototipo (standalone).html` — techo de layout (proporciones/espaciado); nunca su color ni su tipografía.
2. **Selector de chips del wizard** (patrón `.tag`/`r_pill` de la identidad; en código ya existe `FilterChipGroup`).
3. **Divergencias respecto al mockup canónico** (requieren visto bueno explícito, ver preguntas 6-7):
   - el mockup #5 pone el **mapa al FINAL** (tras la ficha del agente) — subirlo es divergencia deliberada;
   - el mockup #5 **no dibuja chips de amenidades** — quitarlos **alinea** con la referencia (no es divergencia);
   - `step4.tsx` usa hoy una paleta local de hex (`COLOR_BG`, `COLOR_ACCENT = '#1A5E44'`, …) en vez de `theme.ts`; meter chips con tokens del theme mezcla dos sistemas en la misma pantalla (pregunta 10).

## Reglas no obvias aplicables

- 🔴 **El `thumbnail_url` que guarda el webhook de Stream NO está firmado → 401.** La portada tiene que venir del **mint** (`posterUrl` de `mint-video-url`, o la EF batch `mint-poster-urls` que se creó justo por esto en #89). Además, **el token firmado de Stream va EN EL PATH, no como query param**. — [[propiedades-y-video]] §Stream / §GOTCHA CRÍTICO · `wiki/log.md` 2026-07-22.
- 🔴 **La reproducción de video quema cuota real** (así se quemó el egress de Supabase; post-#68 son minutos de Cloudflare). Verificar reproducción y **parar**; Maestro debe terminar en `stopApp`. — memoria `video_playback_burns_quota`.
- ⚠️ **`useVideoPlayer` libera el player al desmontar**: llamar `player.pause()`/`release()` en cleanup truena con *"shared object already released"* (bug ya corregido en `VideoFeedItem` y documentado en `PropertyVideoPlayer.tsx:9-13`). El "pausar al salir" tiene que hacerse **sin** tocar el objeto liberado.
- ⚠️ **`edit-property` exige body COMPLETO** desde #142: un parcial ya no se coacciona a falsy — pero si el nuevo selector deja de escribir alguno de los 3 booleanos en `PublishFormState`, la edición los manda en `false` y **borra el dato en silencio**. — [[moderacion]] · fila #126–#142 de [[mapa-codebase]].
- ⚠️ **Semántica de los flags en búsqueda:** en `FilterSheet` un booleano `false` = "no filtrar" (nunca `.eq(col,false)`); en la propiedad, `false` = "no aplica". El selector de chips debe seguir produciendo **boolean estricto**, no tri-estado. — [[busqueda-y-filtros]].
- ⚠️ **Criticidad TDD determinista (CLAUDE.md §5):** `components/**`, pantallas y `app/**` = **NO crítica** → verificación ligera (`pnpm tsc --noEmit` + `pnpm lint` + smoke). Pero si la lógica del selector o del card aterriza en `mobile/**/lib/**`, `hooks/**`, `utils/**` o `validation*` → **CRÍTICA** (RED antes que GREEN). Diseñar el selector como **presentacional puro** mantiene el lote en la vía ligera.
- ⚠️ **Testing en emulador SOLO por CLI** (`adb shell input`, `adb exec-out screencap -p`, `xcrun simctl`), nunca computer-use. — CLAUDE.md §3 · memoria `emulator_testing_cli_only`.
- ⚠️ **PNPM siempre**; `task-master` por CLI, nunca MCP; y `add-task`/`expand`/`update-task` están rotos en este entorno (`generateObject` → API 400) → crear/ampliar tareas escribiendo `.taskmaster/tasks.json` a mano (+ `.bak` + `validate-dependencies`). `update-task`/`update-subtask` además **re-tipan `task.id` string→int** (revisar `git diff`). — CLAUDE.md §4 · memorias `taskmaster_addtask_provider_broken`, `taskmaster_update_task_regenerates`.
- ⚠️ **Todo el cambio es JS → viaja por OTA** (`cd mobile && pnpm ota "<msg>"` desde `main` mergeado). Ningún módulo nativo nuevo → sin rebuild. — [[estrategia-releases]].
- ⚠️ **Tareas derivadas (CLAUDE.md §5):** si esto se promueve como tarea nueva, título `producto(10.2): …`, descripción abriendo con `Origen: … · Detectado por: usuario`, `dependencies` con la tarea origen y **backlink `DERIVADAS:`** en los details del origen.

## Hallazgos de la investigación (footprint real, `wiki/codebase/mapa-codebase.md` + lectura puntual)

| Hecho | Dónde |
|---|---|
| **Ya existe la tarea #106** (`pending`, dep `10`): *"producto(10.2): detalle sin reproducción — card de miniatura + descripción, y previsualización de subida que no se queda corriendo"*. Cubre el punto 1 de esta idea **y** el preview del wizard. Su `details` pide *"card horizontal alargado con miniatura + descripción, MISMO footprint que el player"* y deja abierto *"decidir si el card lleva al feed al tocarlo (probable, pero confirmar con Abraham)"* — la idea nueva dice "reproduce el video de nuevo": **contradicción a resolver** (preguntas 1 y 2). | `.taskmaster/tasks/tasks.json` (id `106`) |
| El hero hoy: `p.loop = true`, `p.muted = true`, `player.play()` al montar; poster ya se pinta **detrás** del `VideoView` (`posterUrl ?? thumbnail_url`). Quitar el autoplay es, literalmente, no montar el `VideoView` y dejar el `Image` que ya está. | `PropertyVideoPlayer.tsx:60-118` |
| `posterUrl` **solo existe tras** `mint-video-url` (fail-soft: si la EF falla, no hay poster **ni** video). `thumbnail_url` crudo → 401 con Stream. TTL de firma ~4 h (`DEFAULT_TTL_SECONDS = 14400`). | `usePropertyDetail.ts:143-183` · `mint-video-url/index.ts:15` |
| `AmenityChips` pinta los 3 flags **y** el array `amenities`; **el wizard nunca escribe `amenities`** (grep: cero referencias en `features/publish/`) → en la práctica el array siempre viene vacío y el componente ya solo muestra los 3 flags. Borrarlo no pierde funcionalidad viva. | `AmenityChips.tsx:62-76` · `features/publish/**` |
| **Ya existe un multi-select de chips reutilizable**: `FilterChipGroup` (controlado, `accessibilityRole="checkbox"`, tokens `primary_tint`/`paper_2`, `r_pill`), usado por `FilterSheet` para operación y tipo. **Reusar > reescribir.** | `mobile/src/features/search/components/FilterChipGroup.tsx` |
| El wizard son **5 pasos** desde #73.3 (el `mapa-codebase` todavía dice "3 pasos" en la entrada de `features/publish/` → **señal de mapa desactualizado**, corregir en el ingest). step3 = precio/visibilidad/recámaras/baños/m²/dirección/mapa (obligatorios); step4 = descripción + los 3 toggles (opcionales); step5 = video + publicar. | `app/(protected)/publish/step{3,4,5}.tsx` · `mapa-codebase.md:69` |
| El preview del wizard también corre en loop: `useVideoPlayer(local_uri, p => { p.loop = true })` + `play()`. | `step5.tsx:101-113` |
| Tests existentes en el footprint: **ninguno** para `PropertyDetailScreen`, `PropertyVideoPlayer`, `AmenityChips`, `PropertyMap` ni `step4` (solo `components/__tests__/ActionButtons.test.tsx`). Los tests de `publish/validation.test.ts` cubren los 3 booleanos **a nivel de payload**, no de UI → no se rompen si no se toca `validation.ts`. | `property-detail/components/__tests__/` · `features/publish/__tests__/` |
| Flujos Maestro: `publicar.yaml` recorre el wizard; hay que revisar si algún selector cae sobre los textos de los switches ("Acepta mascotas"). | `mobile/.maestro/publicar.yaml` |
| Sin solape con #145 (`usePropertyDetail.ts`, `feedProperties.ts`, `useAgentProfile.ts`, `database.types.ts`) — confirmado contra `git diff --stat origin/main`. Único roce: **misma feature**, distinta capa (hook vs pantalla) → conflicto de merge improbable, orden de PRs indiferente. | `git diff --stat origin/main -- mobile/src/features/property-detail/` |

## Arquitectura / enfoque técnico  (L/XL — n/a para fixes)

n/a formal (nivel M, cero backend). Notas de implementación:
- Mantener `PropertyVideoPlayer` como **un solo componente** con dos estados internos (`poster` → `playing`) en vez de partir en dos componentes: menos superficie, y el `useVideoPlayer` puede quedar montado con `source = null` hasta el tap (evita el crash de "shared object already released").
- El selector de chips debe ser **presentacional puro** (props `{value: boolean; onToggle}` o el `FilterChipGroup` con `selected: string[]`) para no caer en la vía TDD crítica.
- El mapeo `string[] ⇄ 3 booleanos` (si se reusa `FilterChipGroup`) es lógica trivial: mantenerla **inline en el screen**, no en `lib/`, por la misma razón.

## Fases / épicas  (L/XL — n/a para cambios chicos)

n/a. Desglose orientativo (lo fija `/tm-plan` al promover): (1) card de portada + no-autoplay; (2) reorden de secciones + retiro de `AmenityChips`; (3) chips en el wizard; (4) *(opcional, pregunta 15)* preview del wizard sin loop; (5) smoke por CLI + ingest al vault.

## Criterios de aceptación

- [ ] Abrir `/property/[id]` **no** inicia reproducción: no hay `VideoView` montado ni `player.play()` hasta que el usuario toca la portada.
- [ ] La portada se ve con la **URL firmada** (`posterUrl`); si el mint falla o no hay poster, se muestra un fallback intencional (no un rectángulo negro accidental) — {? pregunta abierta 5}.
- [ ] Tocar la portada lleva a {? pregunta abierta 1} y la reproducción **no** es en loop.
- [ ] Al salir de la pantalla (back o cambio de tab) la reproducción se detiene, sin error *"shared object already released"*.
- [ ] La fila de `AmenityChips` ya no aparece en el detalle.
- [ ] `PropertyMap` aparece en la posición {? pregunta abierta 6}, con acabado (radio, borde, altura) alineado a los tokens.
- [ ] En el wizard, los 3 flags se capturan con chips (sin `Switch`), en el paso {? pregunta abierta 9}.
- [ ] Publicar con chips activos deja `pet_friendly`/`allows_no_guarantor`/`student_friendly` correctos en la fila de `properties` (verificado en el stack real, no solo en el form).
- [ ] **Editar** una propiedad que ya tenía flags en `true` los conserva (regresión #142: body completo).
- [ ] `FilterSheet` sigue devolviendo resultados al filtrar por cada uno de los 3 flags.
- [ ] `pnpm tsc --noEmit` y `pnpm lint` en verde; suite Jest sin regresiones; smoke en emulador **por CLI** (screenshot del detalle y del paso del wizard).
- [ ] Flujo Maestro `publicar.yaml` sigue pasando (o se actualiza si dependía del texto de los switches).

## Dependencias

- **Tarea #106** (`pending`) — **solapamiento directo**; ver "Promoción / descarte" y pregunta 14.
- Tarea **#10** (detalle de propiedad, `done`) — base del código tocado.
- Tarea **#145** (`in-progress`) — sin solape de archivos; se recomienda **git worktree** desde `origin/main` fresco (`git fetch origin && git worktree add ../urbea-<slug> -b tarea/<id>-<slug> origin/main`).
- EF `mint-video-url` (viva) y `mint-poster-urls` (#89, viva) — de una de ellas sale la portada firmada.
- Código a reusar: `FilterChipGroup.tsx`, `PrimaryButton`, tokens de `theme.ts` (`radii.r_pill`, `colors.primary_tint`, `layout.screen_inset`, `spacing.*`).
- Referencias de diseño: `urbea-identidad-visual.html` (mockup #5, clases `.play-btn`/`.op-badge`/`.vid-count`/`.tag`) y `Urbea Prototipo (standalone).html`.

## Edge cases / riesgos

- **Portada en blanco por URL sin firmar.** Si el card usa `thumbnail_url` crudo, los videos de Stream devuelven 401 y el card queda vacío en producción aunque se vea bien en el seed local (síntoma idéntico al que motivó #89, y a #91 "feed sin miniatura en dev"). **Mitigación:** usar `posterUrl` y probar con una propiedad de Stream real.
- **Mint fail-soft.** `usePropertyDetail` no bloquea si `mint-video-url` falla → puede haber detalle sin poster **y** sin `signed_url`: el card táctil no debe prometer un video que no puede reproducir.
- **TTL de 4 h.** Si se difiere el mint al tap (pregunta 4) hay que re-mintear; si se mantiene al cargar, el TTL sobra para la sesión.
- **Pausa al salir.** El "ahorro" se evapora si el player queda vivo al navegar atrás o al backgroundear la app; y hacerlo mal reproduce el crash del objeto liberado.
- **Regresión silenciosa de datos en edición** si el selector no escribe los 3 booleanos (contrato de body completo de `edit-property`, #142).
- **Divergencia no registrada del mockup canónico** (mapa arriba) → deuda de diseño; registrarla explícitamente en [[design-system]] como se hizo con la tab bar de #65.
- **Mezcla de sistemas de estilo** en `step4.tsx` (hex locales vs `theme.ts`) → chips que se ven "de otra app" dentro del wizard.
- **Cuota durante el propio testing:** verificar reproducción una vez y parar; nunca dejar el detalle abierto en loop mientras se itera.

## Plan de pruebas (alto nivel)

- **NO crítico** por la regla determinista de paths (pantallas + `components/**`): `pnpm tsc --noEmit` + `pnpm lint` + smoke.
- **Smoke por CLI** (nunca computer-use): Android `adb shell input tap …` + `adb exec-out screencap -p` sobre el detalle (estado portada → estado reproduciendo → back) y sobre el paso del wizard con los chips; iOS `xcrun simctl io … screenshot` si se valida en simulador.
- **Verificación de datos real** (la lección de #73/#126: los mocks no la vieron): publicar una propiedad de prueba con chips activos y leer la fila de `properties` en el stack real; editarla y confirmar que los flags sobreviven.
- **Jest:** solo si algún helper aterriza fuera de la UI (entonces sería crítico → RED primero). Si se toca `features/publish/validation.ts`, la suite `validation.test.ts` (40 tests) es el guardián.
- **Maestro:** correr `publicar.yaml` (y `botonera.yaml`) tras el cambio; el flujo debe terminar en `stopApp` para no dejar video corriendo.
- **Regresión de filtros:** `FilterSheet` → cada flag → resultados no vacíos con datos sembrados.

## Impacto en PRD (solo referencia — NO se edita)

`docs/PRD-MVP-demo.md` §6 (pantallas de la demo: detalle y wizard de publicación) describiría el detalle "con video"; pasa a "con portada + reproducción bajo demanda". Es un cambio de interacción, no de alcance funcional — decisión de promoción del dueño, fuera de esta exploración.

## Decisiones del intake

- (usuario, previo) Los 3 flags se **siguen capturando en el wizard** — descartado moverlos a "editar propiedad" (dato ausente para la mayoría) y descartado inferirlos de la descripción (frágil, falsos negativos silenciosos). Motivo: que `FilterSheet` filtre con datos reales.
- (usuario, previo) El trabajo se hace en **worktree/rama nueva desde `origin/main` fresco**, en paralelo a #145.
- {? Pendientes: las 15 preguntas abiertas de abajo — este doc NO las responde.}

## Preguntas abiertas (para el orquestador)

**A · Card de portada**
1. ¿Qué hace el tap del card? (a) **reproduce inline** en el mismo hero, con controles nativos y sin loop **(REC**, es lo que pide la idea nueva y lo más barato); (b) abre el video en **modal fullscreen**; (c) **navega al feed** posicionado en esa propiedad (lo que sugería #106); (d) no reproduce, solo lleva al feed.
2. ¿Qué forma tiene el card? (a) **hero full-bleed 230-260 px con portada + botón play centrado**, tal cual el mockup #5 (**REC**, alineado a la referencia canónica); (b) **card horizontal alargado miniatura + descripción** con el mismo footprint, como pide el `details` de #106.
3. ¿La reproducción es con `nativeControls` visibles y sonido? (a) **controles nativos + sonido activo al tocar play (REC** — el tap es intención explícita); (b) sin controles y muteado como hoy.
4. ¿Cuándo se mintea la URL? (a) **mantener el mint al cargar** (TTL 4 h; el ahorro está en no reproducir, no en no mintear) **(REC)**; (b) diferir el mint al tap para ahorrar un invoke de EF en el arranque — ⚠️ con (b) hay que resolver de dónde sale la **portada firmada** (EF `mint-poster-urls`), o el card queda sin imagen.
5. Fallback cuando no hay poster (video legacy, mint fallido, propiedad sin video): (a) **bloque `ink_feed` con isotipo/ícono y sin affordance de play (REC)**; (b) ocultar el hero y subir el contenido; (c) imagen genérica de marca.

**B · Orden y contenido del detalle**
6. Orden final del scroll: (a) hero → **`PropertyInfoHeader`** (precio/specs) → **mapa** → dirección/descripción → agente **(REC** — el mapa sube, pero el precio sigue siendo lo primero que se lee); (b) literal de la idea: hero → **mapa** → info header → descripción → agente; (c) hero → mapa+dirección fusionados en un bloque → info header → descripción → agente.
7. La divergencia respecto al mockup canónico #5 (que pone el mapa al final) ¿se aprueba explícitamente? (a) **sí, y se registra como divergencia consciente en [[design-system]] (REC**, mismo trato que la tab bar de #65); (b) no, respetar el mockup y dejar el mapa donde está; (c) actualizar el mockup/identidad primero.
8. `AmenityChips.tsx` tras quitarlo del detalle: (a) **borrar el archivo** (nadie más lo consume; no acumular código) **(REC)**; (b) conservarlo si el selector del wizard reusa su estilo; (c) moverlo a `src/components/` como chip de solo lectura.

**C · Selector de chips del wizard**
9. ¿En qué paso viven los chips? (a) **step4, bajo la descripción, donde ya están (REC** — no toca el paso de obligatorios ni su validación); (b) step3, junto a recámaras/baños; (c) step4 pero como fila compacta pegada al header del paso.
10. ¿De dónde sale el componente? (a) **promover `FilterChipGroup` a `src/components/ChipGroup.tsx`** y consumirlo desde search y publish **(REC** — reusar > reescribir, un solo lenguaje de chips); (b) importarlo tal cual desde `features/search` (acoplamiento cross-feature); (c) chips locales nuevos en `step4.tsx`.
11. Si se promueve el componente, ¿se migra `step4.tsx` a los tokens de `theme.ts`? (a) **solo la sección de chips usa tokens, el resto del wizard queda como está (REC**, alcance mínimo); (b) migrar todo `step4.tsx` a `theme.ts` (más limpio, más superficie); (c) mantener hex locales también en los chips (evita mezcla, duplica tokens).
12. ¿Se aprovecha para capturar `amenities` (JSONB, hoy nunca escrito) con chips multi-valor? (a) **no, fuera de alcance (REC** — YAGNI, el filtro no lo usa); (b) sí, como fase 2 aparte.
13. Copy de los chips: (a) **"Pet friendly" · "Sin aval" · "Estudiantes"** (labels cortos del `AmenityChips` actual) con `accessibilityLabel` largo **(REC)**; (b) conservar el copy actual de los switches ("Acepta mascotas", "Sin aval / fiador", "Apto estudiantes"); (c) otro copy que dé el cliente.
   13b. ¿`FilterSheet` (búsqueda) también migra sus 3 `ToggleRow` a chips por consistencia? (a) **no en este lote (REC)**; (b) sí, mismo PR; (c) tarea aparte.

**D · Alcance y proceso**
14. ⚠️ **Ya existe la tarea #106** con parte de este alcance. ¿Cómo se promueve? (a) **ampliar #106** (título/descripción/subtareas) y ejecutarla como esta idea **(REC** — reusar > reescribir también en el backlog; ⚠️ `update-task` está roto y re-tipa ids → editar `tasks.json` a mano con `.bak`); (b) tarea **nueva** que dependa de #106 y cerrar #106 como duplicada; (c) dos tareas: #106 para el detalle y una nueva para el wizard.
15. La parte (b) de #106 — la **previsualización del wizard (`step5.tsx`) que se queda reproduciendo en loop** — ¿entra en este lote? (a) **sí, mismo objetivo de no quemar cuota (REC)**; (b) no, tarea aparte; (c) sí, y de paso auditar **todos** los puntos de reproducción (feed incluido).

## Promoción / descarte

**⚠️ Antes de promover:** la tarea **#106** (`pending`, dep `10`, sin subtareas) ya cubre el punto 1 de esta idea + el preview del wizard. La ruta recomendada es **ampliar #106** con el alcance completo (chips del wizard, retiro de `AmenityChips`, reorden del mapa) en vez de crear una tarea nueva — y ejecutarla en un **worktree desde `origin/main` fresco** (`tarea/106-<slug>`), en paralelo a #145.

Al aprobar: fijar `tarea_id`, correr `/tm-plan 106` (o el id resultante) para el footprint y el desglose de subtareas, y registrar en los `details` de la tarea las decisiones de las 15 preguntas.
Ingest posterior obligado: `wiki/codebase/mapa-codebase.md` (entrada de `features/publish/` dice "wizard 3 pasos" y ya son **5** — corregir de paso), [[propiedades-y-video]] o [[design-system]] según dónde caiga la decisión de la portada, y una línea en `wiki/log.md`.

Al descartar: registrar el motivo y si el ahorro de cuota se atacará por otra vía (p. ej. bajar TTL o mover el detalle a `mint-poster-urls` sin tocar la UI).
