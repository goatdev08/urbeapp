---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: L             # XS | S | M | L | XL — sistema de diseño completo (tokens dual-mode + componentes base + 4 pantallas clave), múltiples capas y roles
fecha: 2026-06-21
estado: aprobado      # borrador → en-revision → aprobado | descartado
tarea_id: 19         # tarea preexistente; esta exploración la re-planifica (ruta código-primero). Se confirma al aprobar.
motivo_descarte:
gate_branding: si     # ⚠️ #19 EN PAUSA hasta visto bueno expreso del cliente (CLAUDE.md §8). NO inicia diseño formal.
---

# Branding + Design System de Urbea (app móvil)

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ se promueve a tarea[s] en Taskmaster — aquí, re-planifica la #19 existente)
> o **DESCARTARSE** (queda como registro de decisión).
> NO edita los PRD maestros ni `mobile/**` ni `supabase/**`.
> ⚠️ **GATE DE BRANDING (#19, CLAUDE.md §8):** esta exploración produce un plan **aprobable**; el inicio
> del diseño formal y de su implementación requiere **visto bueno expreso del cliente**.

## Idea original
Identidad visual + design system + pantallas clave de la app móvil Urbea (Expo + Supabase), **tomando la
identidad del proyecto hermano URBEARG** (sitio web Next.js en `/Users/fru/Dev/URBEARG`, hoy inhabilitado).
Objetivo: un sistema cohesivo y premium, derivado de URBEARG pero adaptado a la naturaleza **híbrida** de la
app (feed de video oscuro/inmersivo + lado de gestión claro/limpio).

Dos restricciones duras que reorientan la tarea #19 tal como está escrita en Taskmaster:
1. **Código primero, Figma después.** El seat de Figma del usuario es View/Starter (~6 llamadas MCP al mes),
   inservible para iterar. La #19 original asume Figma desde el paso 3; este plan **invierte el orden**:
   tokens (`theme.ts`) + componentes base en preview primero; Figma queda para cuando haya seat Full/Dev.
2. **Solo planeación.** Branding en pausa (#19) hasta aprobación del cliente. `gate_branding: si`.

## Lluvia de ideas (solo si la idea era abstracta)

La parte abstracta es **cómo reconciliar la identidad clara/editorial de URBEARG con el feed oscuro
inmersivo** sin fragmentar la marca. Cuatro direcciones; la **recomendada va primero**.

### Dirección A — [RECOMENDADA] Tokens semánticos con dos temas (`light` gestión / `dark` feed), una sola escala de marca
- **En qué consiste:** Un único set de **tokens semánticos** (`color_bg`, `color_surface`, `color_text`,
  `color_text_muted`, `color_accent`, `color_border`, `color_primary`) que resuelven a valores distintos
  según el modo. La **paleta de marca** (verde bosque, cobre/tierra, arena, tinta) es la misma fuente; el
  modo `dark` del feed **deriva** su base de un verde-bosque casi negro y usa arena/cobre como acentos
  cálidos sobre fondo oscuro. La cohesión vive en que **ambos modos beben del mismo brand-core**.
- **Trade-off:** requiere disciplina en el contrato de tokens (nunca hardcodear color en pantallas), pero es
  exactamente lo que el skill `urbea-design` ya pide (tokens → componentes → pantallas) y lo que la #19
  pide en el paso 10 ("dark mode feed con light mode para otras secciones"). Aterriza limpio en `theme.ts`.
- **Encaje stack/reglas:** alto. Expo/RN soporta theming por contexto; snake_case en tokens (skill);
  evita "modo claro y modo oscuro como dos design systems" que es el riesgo real de fragmentación.

### Dirección B — Fidelidad máxima a URBEARG (mismo light, dark = inversión mecánica)
- **En qué consiste:** Portar literalmente los tokens de URBEARG al lado claro y generar el modo oscuro por
  inversión algorítmica (mismos hues, luminancias volteadas).
- **Trade-off:** rapidísimo y de bajísimo riesgo de marca en el lado claro; pero la inversión mecánica suele
  dar un feed apagado/lavado (el cobre y la arena pierden calidez sobre negro), justo lo contrario del
  "inmersivo premium" que pide el feed. El feed es el **diferenciador** del producto, no conviene
  resolverlo por defecto.
- **Encaje:** medio. Bueno para gestión, flojo para el feed.

### Dirección C — Dos sub-marcas tonales (feed con identidad cinematográfica propia)
- **En qué consiste:** El feed adopta una estética más "cine/OTT" (negros profundos, gradientes, overlays de
  vidrio, acentos cobre como único color), tratado casi como sub-marca; la gestión se queda 100% URBEARG.
- **Trade-off:** el feed puede verse espectacular y muy diferenciado, pero arriesga que app y feed "no
  parezcan la misma marca". Más trabajo de diseño y de gobierno de tokens. Sobredimensionado para una demo.
- **Encaje:** medio-bajo para el hito demo; reservable como evolución futura.

### Dirección D — Divergir de URBEARG y rebrandear desde cero para mobile
- **En qué consiste:** Tratar URBEARG solo como inspiración y proponer una identidad nueva nativa-mobile.
- **Trade-off:** desperdicia el activo ya shipeado (paleta, tipografía, principios) y contradice el
  principio del proyecto "reusar > reescribir". Solo tendría sentido si el cliente quisiera distanciarse de
  URBEARG, lo cual es una decisión de negocio, no técnica.
- **Encaje:** bajo, salvo decisión explícita del cliente.

**Recomendación:** **Dirección A**. Maximiza reuso del activo URBEARG, da al feed la profundidad que necesita
por **derivación cohesiva** (no inversión mecánica ni sub-marca), y es la que mejor aterriza en `theme.ts`.

## Problema / Motivación
La app aún no tiene código ni identidad propia (tarea #1 init Expo pendiente). Antes de construir pantallas
hace falta un **contrato visual estable** (tokens + componentes) para no hardcodear estilos y no acumular
deuda. Existe un activo de marca ya shipeado en URBEARG que conviene capitalizar en lugar de inventar.
Encaje con el hito **demo cerrada de 3 semanas** ([[0005-demo-cerrada-3-semanas]]): la demo necesita verse
**premium y coherente** en sus 4 superficies (feed, detalle, wizard de publicación, CRM) con el mínimo de
diseño formal. Un `theme.ts` + librería base de componentes desbloquea TODAS las demás tareas de UI.

## Resultado esperado
1. Una **paleta canónica de Urbea** documentada (reconciliando shipeado vs spec), con su **derivación de
   modo oscuro** para el feed.
2. Un `theme.ts` (prospectivo) con tokens semánticos en **snake_case** para `light` (gestión) y `dark` (feed).
3. Una **librería base de componentes** (`Button`, `Input`, `Card`, `Badge`/`Chip`, `BottomSheet`) que
   consume tokens, nunca colores crudos.
4. Las **4 pantallas clave** maquetadas con esos componentes: Feed (oscuro), Detalle de propiedad,
   Wizard de publicación (claro), CRM (utilitario).
5. Todo validable primero en **preview código (HTML/React)**, sin depender de Figma.

## Alcance
- **SÍ entra:**
  - Identidad visual derivada de URBEARG (paleta, tipografía, principios) adaptada a mobile híbrido.
  - Sistema de **tokens dual-mode** (`light`/`dark`) y su contrato semántico.
  - Librería base de componentes y maquetado de las 4 pantallas clave.
  - **Ruta código-primero** (tokens + componentes en preview) como camino vigente; Figma diferido.
- **NO entra (out of scope):**
  - Iniciar el diseño/implementación formal antes del **visto bueno del cliente** (gate #19).
  - Logo/logotipo definitivo (concepto sí; arte final es decisión del cliente — ver pregunta abierta).
  - Trabajo en Figma esta fase (seat View/Starter insuficiente; se retoma con seat Full/Dev).
  - Escribir código en `mobile/**` (la app aún no existe; tarea #1 va antes).
  - Animaciones avanzadas, micro-interacciones finas, modo claro/oscuro automático por sistema operativo.

## Roles afectados
La estética híbrida mapea directo a quién usa cada superficie ([[roles-y-permisos]], [[inmobiliarias-y-agentes]]):
- **Comprador / consumidor del feed** — superficie **oscura/inmersiva** (en la demo, los propios agentes
  consumen el feed — [[feed-vertical-video]]). Detalle de propiedad: transición de oscuro a claro.
- **Inmobiliaria + agente** — superficies **claras/limpias**: wizard de publicación, CRM de leads
  ([[crm-leads]]), perfil. Aquí la identidad URBEARG encaja casi 1:1.
- **Admin de plataforma** — panel utilitario (claro). Reusa los mismos componentes base.

## Impacto en datos
n/a. Branding/diseño no toca schema, RLS, triggers ni Storage. (La única intersección indirecta: thumbnails
y avatares viven en Storage, pero eso es de otra tarea; aquí solo se define cómo se *presentan*.)

## Impacto en UI
**Es 100% UI/branding** → **gate de la tarea #19 (CLAUDE.md §8): el cliente debe dar el visto bueno antes de
iniciar.** Superficies (Expo Router, prospectivas — [[mapa-codebase]] `mobile/src/`):
- `src/features/feed/` — Feed vertical (`expo-video`/FlashList), tema **dark**. ⚠️ delicado: legibilidad de
  overlays (precio, CTA, agente) sobre video variable → ver edge cases.
- `src/features/publish/` — Wizard 3 pasos, tema **light** limpio.
- `src/features/leads/` — CRM utilitario, tema **light**.
- Detalle de propiedad — transición dark→light.
- `src/theme/` (nuevo) — `theme.ts` con tokens. `src/components/` (nuevo) — librería base.

## Paleta canónica propuesta para Urbea  (reconciliación shipeado vs spec)

**Regla de reconciliación:** ante divergencia entre lo **shipeado** (`URBEARG/src/app/globals.css`,
verificado) y la **spec** (`URBEARG/docs/DESIGN.md`), **gana lo shipeado** (es la verdad en producción). La
spec queda como contexto histórico. Divergencias detectadas: primary `#1F3B2D`(ship) vs `#2B5D3F`(spec);
sand `#EEE5DA`(ship) vs `#F5F5DC`(spec); ink `#1A1A1A`(ship) vs `#1F2937`(spec); accent `#B08968`(ship) vs
`#8B7355`(spec). **Se adoptan los valores shipeados como canónicos.**

### Brand-core (fuente única, ambos modos beben de aquí)
| Rol | Hex | Notas |
|-----|-----|-------|
| primary (verde bosque) | `#1F3B2D` | hover `#0F1A11` |
| accent (tierra/cobre) | `#B08968` | hover `#9A7356` |
| sand (arena/beige) | `#EEE5DA` | fondo cálido |
| ink (tinta) | `#1A1A1A` | texto base |

### Modo LIGHT — gestión (wizard, CRM, admin, detalle) — URBEARG ~1:1
| Token (snake_case) | Valor | Origen URBEARG |
|--------------------|-------|----------------|
| `color_bg` | `#EEE5DA` (sand) | `--background` |
| `color_surface` (card) | `#FFFFFF` | card |
| `color_surface_muted` | `#F5F5F4` | muted |
| `color_text` | `#1A1A1A` (ink) | `--foreground` |
| `color_text_muted` | `#78716C` | muted-foreground |
| `color_border` | `#E7E5E4` | border/input |
| `color_primary` | `#1F3B2D` / hover `#0F1A11` | primary |
| `color_accent` | `#B08968` / hover `#9A7356` | accent |
| `color_ring` (focus) | `#1F3B2D` | ring = primary |

### Modo DARK — feed inmersivo (DERIVADO, no shipeado en URBEARG — **propuesta a validar**)
Derivación cohesiva (Dirección A): base = verde-bosque oscurecido casi a negro; arena/cobre como acentos
cálidos y único color de marca visible. **Valores propuestos, sujetos a aprobación del cliente:**
| Token | Valor propuesto | Razonamiento |
|-------|-----------------|--------------|
| `color_bg` | `#0F1A11` | el `primary-hover` shipeado como fondo casi-negro verdoso (no negro puro → mantiene marca) |
| `color_surface` (overlays/sheets) | `rgba(15,26,17,0.72)` + blur | panel de vidrio sobre video |
| `color_text` | `#F7F3EC` | "arena clara" para texto sobre oscuro (calidez, no blanco frío) |
| `color_text_muted` | `#C9C1B5` | arena desaturada |
| `color_accent` | `#C79A77` | cobre **aclarado ~1 paso** para contraste AA sobre fondo oscuro |
| `color_primary_on_dark` | `#3E6B50` | verde más claro para chips/estados activos legibles en dark |
| `color_overlay_scrim` | gradiente `transparent → rgba(0,0,0,0.6)` | legibilidad de overlays sobre video |

> Nota de accesibilidad: el cobre shipeado `#B08968` sobre `#0F1A11` debe verificarse contra **WCAG 2.1 AA**;
> por eso se propone aclararlo a `#C79A77` para texto/acentos pequeños. Esto es una **decisión de diseño a
> confirmar**, no un hecho — ver preguntas abiertas.

### Tipografía  (decidido)
- **Display/títulos:** **Fraunces** (serif premium con *optical sizing*) — **sustituye a Playfair Display**.
  Conserva el carácter editorial/boutique premium de URBEARG pero rinde mejor en mobile: Playfair, de alto
  contraste tipo didone, se vuelve frágil en pantallas chicas; Fraunces ajusta su contraste por tamaño
  (eje `opsz`) y suma personalidad con los ejes `SOFT`/`WONK`. Uso **acotado a títulos grandes / hero**.
  Requisito explícito del usuario: "que SÍ se vea premium, no fuentes genéricas pero hermosas".
- **Cuerpo/UI:** **Inter** (sans). Workhorse de máxima legibilidad mobile en tamaños chicos; lo "premium" lo
  aportan el serif display + el color + el espaciado generoso.
- En RN/Expo ambas se cargan con `expo-font`/`@expo-google-fonts` (Fraunces e Inter están en Google Fonts;
  Fraunces es **variable** → aprovechar ejes `opsz`/`wght`/`SOFT`).
- Escala tipográfica, de espaciado (grid **8px**, heredado de URBEARG), radios y sombras → a definir como
  tokens en `theme.ts` (snake_case: `space_md`, `radius_lg`, etc., per skill `urbea-design`).

## Reglas no obvias aplicables
- **Branding en pausa / gate del cliente** — `CLAUDE.md` §8 + nota literal en tarea #19 ("Per PRD section 8,
  do NOT start until client gives express approval"). El skill `urbea-design` lo repite en su encabezado.
- **Tokens y utilidades en snake_case; componentes en PascalCase** — skill `urbea-design` (Naming). NO
  hardcodear colores/medidas en pantallas; todo vía tokens.
- **Flujo del skill `urbea-design`: tokens → componentes base → pantallas clave** — coincide con la
  Dirección A y con la ruta código-primero. (El skill menciona Figma; este plan lo difiere por el seat.)
- **Copy en español, mobile-first, claridad sobre adornos** — skill `urbea-design` (Principios).
- **Reusar > reescribir** — `CLAUDE.md` §0: capitalizar el activo URBEARG en vez de rebrandear (descarta D).
- **Verificación** — `pnpm tsc --noEmit`, `pnpm lint`, montaje de componentes (skill `urbea-design`).
  **PNPM siempre**, nunca npm/yarn (`CLAUDE.md` §3).
- (No aplican reglas de RLS/Edge Functions/triggers: branding no toca backend — `docs/lineamientos-desarrollo.md`.)

## Arquitectura / enfoque técnico  (L/XL)
Ruta **código-primero** (vigente), Figma diferida:
1. **`mobile/src/theme/theme.ts` (nuevo, prospectivo)** — exporta el objeto de tokens con sub-objetos
   `light` y `dark` y un contrato semántico estable. Provider de tema (Context) que expone el modo según la
   superficie (feed = `dark`, resto = `light`), no según el sistema operativo.
2. **`mobile/src/components/` (nuevo)** — componentes base que **solo** leen tokens del provider:
   `Button` (variantes primary/accent/ghost), `Input`, `Card`, `Badge`/`Chip`, `BottomSheet`. PascalCase.
3. **Preview sin Figma** — validar tokens y componentes en un **preview HTML/React** (storybook-like o página
   de muestra) para iterar visualmente sin gastar las ~6 llamadas MCP de Figma. Skills disponibles que
   ayudan: `ui-ux-pro-max`, `building-native-ui`, `expo-ui`.
4. **Pantallas clave** — maquetadas componiendo la librería base (no rediseñar desde cero cada una).
5. **Figma (diferido)** — cuando el usuario tenga seat Full/Dev, se documenta el sistema YA decidido en
   código hacia Figma (o se usa Code Connect), invirtiendo el sentido original de la #19.
- **Reuso:** activo de marca URBEARG (paleta/tipografía/principios ya shipeados) + skills RN/diseño ya
  instalados. **Nuevo:** `theme.ts`, librería de componentes, preview.
- **No hay capa backend** en esta tarea (lineamientos de Edge Functions/RLS/triggers no aplican).

## Fases / épicas  (L/XL)
Orden sugerido (cada fase es aprobable de forma incremental; **todo el conjunto bloqueado por el gate #19**):
- **Fase 0 — Aprobación de dirección (GATE):** cliente elige Dirección (A recomendada), valida paleta
  canónica + derivación dark, y da luz verde a branding. *Sin esto no se inicia nada.*
- **Fase 1 — Identidad y paleta:** concepto(s) de logo (2–3), confirmación de paleta canónica y tipografía,
  decisión de uso de Playfair en mobile.
- **Fase 2 — Tokens:** `theme.ts` con `light`/`dark`, escala de espaciado/tipografía/radios/sombras,
  provider de tema por superficie.
- **Fase 3 — Componentes base:** `Button`, `Input`, `Card`, `Badge`/`Chip`, `BottomSheet` en preview.
- **Fase 4 — Pantallas clave:** Feed (dark), Detalle (dark→light), Wizard (light), CRM (light).
- **Fase 5 (diferida) — Figma:** documentar el sistema en Figma con seat Full/Dev. Fuera del hito demo.
> El desglose fino en subtareas lo hará `task-master expand`/`/tm-plan` al promover (la #19 ya tiene 9
> subtareas Figma-céntricas que habría que **re-escribir** a la ruta código-primero — ver promoción).

## Criterios de aceptación
- [ ] Cliente **aprobó** la dirección de branding y la paleta canónica (gate #19). *(bloqueante)*
- [ ] Dirección de reconciliación dark/light elegida (A/B/C/D) y documentada.
- [ ] Paleta canónica de Urbea fijada (light + derivación dark) con contrastes **WCAG 2.1 AA** verificados
      en los pares de texto/fondo críticos del feed.
- [ ] `theme.ts` (prospectivo) con tokens semánticos snake_case para `light` y `dark`, sin colores
      hardcodeados fuera de él.
- [ ] Librería base (`Button`, `Input`, `Card`, `Badge`/`Chip`, `BottomSheet`) consume tokens y monta en preview.
- [ ] Las 4 pantallas clave maquetadas con la librería; feed contrasta (dark) vs gestión (light) de forma cohesiva.
- [ ] Decidido el alcance de Figma (diferido a seat Full/Dev) y reflejado en el plan de la #19.
- [ ] `pnpm tsc --noEmit` y `pnpm lint` limpios sobre el código de tema/componentes (cuando se implemente).

## Dependencias
- **Tarea #1 (init Expo + dev build)** — `theme.ts` y componentes viven en `mobile/`, que aún no existe. La
  #19 ya declara `dependencies: [1]` en Taskmaster. *Esta exploración (planeación) no depende de #1; la
  implementación sí.*
- **Activo URBEARG** — `/Users/fru/Dev/URBEARG/src/app/globals.css` (paleta shipeada, verdad) y
  `docs/DESIGN.md` (spec, contexto). Reuso, no edición.
- **Seat de Figma Full/Dev** — bloquea solo la Fase 5 (diferida), no el resto.
- **Skills:** `urbea-design`, `ui-ux-pro-max`, `building-native-ui`, `expo-ui`, `expo-tailwind-setup` (si se
  opta por Tailwind/NativeWind para tokens).
- **Decisión del cliente sobre branding** — gate #19 (bloqueante de todo).

## Edge cases / riesgos
- **Fragmentación de marca:** si dark y light se diseñan como dos sistemas separados, la app deja de
  "sentirse" una sola marca. Mitiga: tokens semánticos con brand-core único (Dirección A).
- **Legibilidad de overlays sobre video:** el feed pone texto (precio, agente, CTA) sobre video de luminancia
  impredecible. Necesita `color_overlay_scrim`/gradiente garantizado, no confiar en el video.
- **Contraste AA del cobre en dark:** `#B08968` sobre `#0F1A11` puede no alcanzar AA en texto pequeño → se
  propone `#C79A77`. A verificar con herramienta de contraste antes de fijar.
- **Serif (Fraunces) en UI densa:** todo serif elegante puede restar legibilidad en mobile fuera de títulos
  grandes. Fraunces mitiga el problema de Playfair vía *optical sizing*, pero igual se acota a display/hero;
  Inter para el resto.
- **Divergencia shipeado vs spec:** ya reconciliada (gana shipeado), pero conviene que el cliente lo confirme
  por si su intención era la spec (#2B5D3F etc.).
- **La #19 ya tiene 9 subtareas Figma-céntricas:** promover esta exploración implica **re-escribir** el plan
  de la #19 (no crear tarea nueva), o el plan quedará incoherente con la ruta código-primero.
- **Riesgo de gate ignorado:** empezar diseño sin aprobación viola CLAUDE.md §8. Este doc lo bloquea explícitamente.

## Plan de pruebas (alto nivel)
No hay pgTAP/Edge Functions aquí (sin backend). Verificación de diseño/código:
- **Contraste WCAG 2.1 AA** sobre los pares críticos (texto sobre feed dark, accent sobre dark, texto sobre
  sand). Herramienta de contraste; criterio bloqueante para el feed.
- **Montaje de componentes** en preview (no smoke de app aún, porque `mobile/` no existe): cada componente
  base renderiza en `light` y `dark` sin colores hardcodeados.
- **`pnpm tsc --noEmit` + `pnpm lint`** sobre `theme.ts` y componentes cuando se implementen.
- **Revisión visual con el cliente** (parte del gate) — el skill `urbea-design` la marca como verificación.
- *Crítico/TDD:* n/a en esta fase (diseño, no lógica de negocio). El TDD estricto aplica a tareas de
  feature con backend, no a tokens visuales.

## Impacto en PRD (solo referencia — NO se edita)
- `docs/PRD.md` §8 (branding / aprobación del cliente) — origen del gate. No se edita; solo se respeta.
- `docs/PRD-MVP-demo.md` — la demo necesita las 4 superficies con identidad coherente; este sistema las
  habilita. Una eventual actualización del PRD (decisión del dueño, fuera de esta exploración) reflejaría la
  ruta código-primero y la paleta canónica adoptada.

## Decisiones del intake
Resueltas con el usuario (orquestador `/tm-explore`, 2026-06-21, 2 rondas de `AskUserQuestion`):
- **Dirección de reconciliación dark/light → A** (tokens dual-mode con **brand-core único**): light y dark
  beben de la misma paleta; el feed deriva su base de verde-bosque casi negro con arena/cobre de acento.
- **Paleta canónica → gana lo shipeado de URBEARG:** primary `#1F3B2D`, accent `#B08968`, sand `#EEE5DA`,
  ink `#1A1A1A`. La spec (`#2B5D3F`/`#F5F5DC`/`#1F2937`/`#8B7355`) queda como contexto histórico.
- **Derivación dark del feed → aprobada, con verificación WCAG 2.1 AA antes de fijar:** fondo `#0F1A11`,
  texto arena `#F7F3EC`, cobre aclarado `#C79A77`.
- **Tipografía → sustituir Playfair por Fraunces** (serif premium con optical sizing, mobile-friendly),
  acotada a display; **Inter** para cuerpo/UI. Requisito del usuario: premium y hermosa, no genérica.
- **Logo → 2–3 conceptos** para aprobar dirección en esta fase; arte final después.
- **Proceso/Figma → diferir Figma y re-planificar la #19** a la ruta código-primero (no crear tarea nueva).
- **Modo → solo planeación:** el **gate de branding (#19, visto bueno del cliente) sigue ABIERTO**; este doc
  se aprueba como **PLAN**, la implementación espera la luz verde del cliente.

## Promoción / descarte
- **✅ APROBADO (2026-06-21) — plan aprobado por el usuario; re-planificada la #19 (no se creó tarea nueva).**
  Se ejecutó `task-master update-task --id=19` con la reorientación a ruta código-primero + decisiones de
  diseño (Dirección A, paleta shipeada, derivación dark AA, Fraunces+Inter, logo 2–3 conceptos). El desglose
  fino de subtareas (sustituir las 9 Figma-céntricas por las Fases 1–5) queda para **`/tm-plan 19`**.
  ⚠️ El **gate de branding del cliente sigue abierto**: aprobado el PLAN, NO la ejecución.
- **Plan de re-planificación (referencia):** NO crear tarea nueva — **re-planificar la #19 existente**.
  - `task-master update-task --id=19 --prompt="Reorientar a ruta código-primero: tokens(theme.ts)+componentes en preview antes que Figma; Figma diferido a seat Full/Dev. Adoptar paleta canónica shipeada de URBEARG + derivación dark del feed (Dirección A)."`
  - Re-escribir/sustituir las 9 subtareas Figma-céntricas por las Fases 1–5 de este doc (`expand`/`/tm-plan 19`).
  - Comando siguiente sugerido: `/tm-plan 19`.
- **Al descartar:** registrar motivo (p.ej. el cliente prefiere rebrand desde cero, Dirección D, o posponer
  branding más allá de la demo) y la alternativa elegida.
