---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: L             # XS | S | M | L | XL
fecha: 2026-07-04
estado: aprobado      # borrador → en-revision → aprobado | descartado
tarea_id: 43          # 1 tarea con subtareas A→B→C(→D opc.) · promovida 2026-07-04
motivo_descarte:
---

# Migrar iconografía a Phosphor (bold) + logo Urbea en login + icono de app

> Documento de exploración/planeación de `/tm-explore`.

## Idea original
Migrar toda la iconografía de la app a **Phosphor Icons (variante BOLD)** e integrar el **logo de Urbea** (1) en la pantalla de login y (2) como **icono propio de la app** (assets nativos iOS/Android). Decisión del cliente ya tomada: **SÍ instalar `react-native-svg` + `phosphor-react-native`**, aceptando el rebuild nativo del dev-client. Esto **revierte** la decisión "sin react-native-svg" de la tarea #32.

## Lluvia de ideas
n/a — la idea llegó concreta (dependencias, variante bold, mapeo de tabs y alcance ya definidos por el cliente). Las decisiones abiertas restantes son de detalle (elección de iconos ambiguos, fraccionamiento, peso), no de dirección; se listan como preguntas abiertas.

## Problema / Motivación
Hoy la app usa **dos sistemas de icono inconsistentes**:
- `@expo/vector-icons` (Ionicons) en ~15 archivos de pantallas/componentes.
- **Placeholders**: la tab bar usa **emojis `<Text>`** (`app/(protected)/(tabs)/_layout.tsx`), el FAB de publicar es un `<Text>"+"`, y el isotipo se aproxima con primitivas RN (`IsotipoMark.tsx`, #32) por la ausencia de `react-native-svg`.

El login sigue con branding neutro ("Urbea" en texto, comentario `diseño visual en pausa hasta tarea #19`) y el icono de app usa los assets por defecto de Expo (fondo `#E6F4FE` azul). Con el **gate de branding levantado** (2026-06-26) y la decisión de instalar `react-native-svg`, ahora es viable: (a) unificar en un solo set de iconos vectoriales de firma (Phosphor bold), (b) portar el logo vectorial real al login, y (c) generar un icono de app con la identidad Urbea. Encaje con la demo de 3 semanas: pulido visual de cierre, no funcionalidad nueva.

## Resultado esperado
- Cero usos de `@expo/vector-icons`/Ionicons; todos los iconos son **Phosphor bold** (fill en estados activos).
- Tab bar con iconos Phosphor reales (no emojis): Inicio·Guardados·Mapa·CRM(Leads)·Perfil.
- Login muestra el **lockup de marca real** (isotipo U+play sobre cuadro Salvia + wordmark "urbea" Space Grotesk).
- Icono de app (iOS + adaptive Android foreground/background/monochrome) con la identidad Urbea; fondo Salvia.
- La app compila y arranca en un **dev build reconstruido** (react-native-svg + phosphor son módulos nativos vía SVG).

## Alcance
- **SÍ entra:**
  1. Instalar `react-native-svg` (vía `pnpm expo install`, versión alineada a SDK 56) + `phosphor-react-native`. Un **único rebuild nativo** que cubra las 3 áreas.
  2. Reemplazar TODOS los Ionicons de los ~15 archivos por Phosphor bold (tabla de mapeo abajo). Reemplazar emojis de tab bar y el `<Text>"+"` del FAB.
  3. Logo en `mobile/app/login.tsx`: lockup de marca (isotipo real SVG + wordmark).
  4. Icono de app: regenerar `assets/icon.png` (iOS) + adaptive icons Android + actualizar `mobile/app.config.js` (backgroundColor Salvia).
- **Re-skin completo del login** a la identidad (Salvia/Space Grotesk/PrimaryButton) — **DECIDIDO: SÍ entra** (ronda 1). Además del lockup, se aplica el lenguaje visual de la identidad a toda la pantalla de login.
- **NO entra (out of scope):**
  - Migrar el `IsotipoMark` de primitivas a SVG real en TODOS sus consumers (PropertyMarker, PropertyGridCard, ProfileHeader) — Fase D **opcional**, no comprometida.
  - Deuda de colores hardcodeados (`#FFFFFF` en ContactAgentButton/HeartAnimation) — adyacente, no objetivo.
  - Splash screen (`splash-icon.png`) — no lo pidió el cliente.

## Roles afectados
Transversal a UI; sin cambios por rol. La tab bar de agente muestra el tab CRM (Leads=Ranking); buscador no. FAB de publicar solo lo ve el agente. Sin impacto en datos ni permisos.

## Impacto en datos
n/a — no toca schema, RLS, triggers ni Storage.

## Impacto en UI
Alto y transversal (ver footprint). **Toca branding/diseño visual nuevo** (login lockup + icono de app son superficies de marca que NO están en los mockups de `urbea-identidad-visual.html`) → aunque el gate general está levantado, estas dos piezas requieren **visto bueno visual del cliente** antes de finalizar (CLAUDE.md §8: cada superficie de marca = techo de su mockup; el icono de app no tiene mockup).

⚠️ **Divergencia de lenguaje visual a documentar:** los iconos "a medida" del `urbea-identidad-visual.html` son de **línea fina** (`stroke-width` 1.6–1.7). Phosphor **bold** es de trazo grueso. Es una decisión deliberada del cliente (bold), pero se aparta del set canónico de la identidad; se registra como consideración de diseño (pregunta abierta #2).

## Tabla de mapeo COMPLETA de iconos (Ionicon actual → Phosphor bold)

Todos con `weight="bold"` por defecto; los estados **activos/filled** usan `weight="fill"` (preserva el patrón outline↔filled actual). `phosphor-react-native` expone cada icono como componente con props `{ size, color, weight }`.

### Tab bar — `app/(protected)/(tabs)/_layout.tsx` (hoy: emojis `<Text>`)
| Tab | Placeholder hoy | Phosphor (bold) | Nota |
|-----|-----------------|------------------|------|
| Inicio | 🏠 | **HouseLine** | mapeo cliente |
| Guardados | 🔖 | **Bookmarks** | mapeo cliente |
| Mapa | 🗺️ | **MapPin** | mapeo cliente |
| CRM (Leads) | 📋 | **Ranking** | mapeo cliente ("Leads=Ranking") |
| Perfil | 👤 | **UserCircle** | mapeo cliente |

### Iconos Ionicons por archivo
| Archivo | Ionicon actual | Phosphor (bold) | Estado/nota |
|---------|----------------|------------------|-------------|
| `src/components/LikeButton.tsx` | `heart` / `heart-outline` | **Heart** (`fill` activo / `bold` inactivo) | patrón toggle |
| `src/components/SaveButton.tsx` | `bookmark` / `bookmark-outline` | **BookmarkSimple** (`fill`/`bold`) | {? single vs Bookmarks} |
| `src/components/ContactAgentButton.tsx` | `logo-whatsapp` | **WhatsappLogo** | mapeo cliente; hoy color `#FFFFFF` hardcode |
| `src/features/feed/FeedScreen.tsx` | `options-outline` (filtros) + `<Text>"+"` (FAB) | **SlidersHorizontal** (Filtros=Sliders) + **Plus** (Subir=Plus) | 2 iconos |
| `src/features/feed/components/HeartAnimation.tsx` | `heart` | **Heart** (`fill`) | animación doble-tap |
| `src/features/feed/components/VideoFeedItem.tsx` | `play` | **Play** (`fill`) | overlay video |
| `src/features/feed/components/PropertyOverlay.tsx` | `bed-outline`; `water-outline`; `heart`/`heart-outline`; `bookmark`/`bookmark-outline` | **Bed**; **Bathtub**; **Heart**; **BookmarkSimple** | `water-outline` es proxy de baño (ver comentario ponytail) |
| `src/features/map/components/MapSearchBar.tsx` | `search`; `options-outline` | **MagnifyingGlass**; **SlidersHorizontal** | |
| `src/features/map/components/PropertyMiniCard.tsx` | `bed-outline`; `water-outline`; `chevron-forward`; `play` | **Bed**; **Bathtub**; **CaretRight**; **Play** (`fill`) | |
| `src/features/property-detail/PropertyDetailScreen.tsx` | `chevron-back`; `location-outline`; `home-outline` | **CaretLeft**; **MapPin**; **HouseLine** | back flotante + empty state |
| `src/features/property-detail/components/AgentCard.tsx` | `logo-whatsapp` | **WhatsappLogo** | |
| `src/features/property-detail/components/AmenityChips.tsx` | `paw-outline` | **PawPrint** | pet-friendly |
| `src/features/property-detail/components/PropertyInfoHeader.tsx` | `bed-outline`; `water-outline`; `resize-outline` (dinámico `spec.icon`) | **Bed**; **Bathtub**; **Ruler** | m² = Ruler {? Ruler vs ArrowsOut} |
| `src/features/search/components/FilterSheet.tsx` | `close` | **X** | cerrar sheet |
| `src/features/map/components/PropertyMarker.tsx` | (usa `IsotipoMark`, no Ionicon) | — | isotipo; ver track logo/isotipo |

**Mapeos ambiguos que confirmar (pregunta abierta #3):** baño (`Bathtub` vs `Drop` vs `Shower`), m² (`Ruler` vs `ArrowsOutSimple` vs `Square`), guardar individual (`BookmarkSimple` vs `Bookmark`), back (`CaretLeft` vs `ArrowLeft`), chevron adelante (`CaretRight` vs `ArrowRight`).

## Reglas no obvias aplicables
- **`react-native-svg` + `phosphor-react-native` + regen de app icon = módulos/assets nativos → rebuild del dev-client** (mismo costo que documentó #32). No se puede aplicar en caliente sobre el emulador de otra sesión. — `wiki/estado/estado-actual.md` (#27: iterar en emulador requiere dev build local) · CLAUDE.md §3 (gotcha Expo+pnpm).
- **Instalar deps con `pnpm expo install`** (no `pnpm add` a secas) para que resuelva la versión de `react-native-svg` alineada al SDK 56. — CLAUDE.md §3 · `mobile/AGENTS.md` (leer docs versionados SDK 56).
- **Branding: cada pantalla/superficie = techo de su mockup**; login lockup e icono de app son superficies NUEVas de marca → visto bueno del cliente. — CLAUDE.md §8 (tarea #19/#26).
- **Skill `ponytail`**: importar iconos Phosphor individuales (no el set entero) por bundle size; preferir import directo sobre wrapper salvo justificación. — CLAUDE.md §0.
- **Sin convertidor SVG→PNG local** (memoria #32): generar los PNG del icono de app necesita plan de tooling. — MEMORY: `project_skills_installed` / nota #32.
- **Criticidad TDD por path = LIGERA en todo el footprint**: `components/**`, pantallas, navegación, `app.config.js`, assets → verificación `pnpm tsc --noEmit` + `pnpm lint` + smoke. `IsotipoMark.tsx` vive en `src/components/` (no `lib/hooks/utils`) → no crítico. Ningún path de `supabase/**`, EF, migración ni lógica pura. — CLAUDE.md §5 (regla determinista por path).

## Arquitectura / enfoque técnico (L)
- **Un solo rebuild nativo** que empaquete: `react-native-svg`, `phosphor-react-native` y el nuevo icono de app. Es la palanca de eficiencia clave: 3 rebuilds → 1.
- **Iconos**: import directo de componentes Phosphor por archivo (`import { Heart } from 'phosphor-react-native'`), `weight="bold"` default, `weight="fill"` en activos. Reemplazo mecánico archivo por archivo; barrido final con grep para 0 usos de `@expo/vector-icons`.
- **Reuso vs nuevo**:
  - Reusar: `mobile/src/theme/theme.ts` (colors Salvia/Arcilla/whatsapp, sizes) para color/size de los iconos; `IsotipoMark.tsx` como base geométrica del isotipo (upgrade a SVG real opcional).
  - Nuevo: componente/lockup de logo para login (isotipo SVG real `#iso` de `urbea-identidad-visual.html` líneas 488–490: `M6 4.2v8.2a6 6 0 0 0 12 0V4.2` stroke #fff 2.1 + triángulo play `M10.4 9.1l4.3 2.5-4.3 2.5z`), sobre cuadro `color_primary #5A8A5E` redondeado + wordmark "urbea" (Space Grotesk 600, ya cargado en #16).
  - Nuevo: assets de icono (iOS `icon.png` 1024, Android foreground/background/monochrome) + `backgroundColor: '#5A8A5E'` en `app.config.js` (hoy `#E6F4FE`).
- **Con `react-native-svg` disponible**, el isotipo del icono de app y del login puede ser el vector real; los consumers actuales de `IsotipoMark` (pin de mapa, grid card, avatar badge) pueden migrar a SVG real en una fase opcional (deuda de #32 saldada).

## Fases / épicas (L)
Orden y dependencias (el desglose fino lo hace `/tm-plan` al promover):

- **Fase A — Setup nativo + migración de iconos** (raíz; habilita B y C):
  1. `pnpm expo install react-native-svg` + `pnpm add phosphor-react-native` (verificar compat SDK 56 / RN 0.85).
  2. Migrar los ~15 archivos + tab bar + FAB a Phosphor bold (tabla de mapeo).
  3. (Opcional) remover `@expo/vector-icons` del `package.json`.
  4. Rebuild del dev-client **compartido con Fase C** (batch). Gate: tsc + lint + smoke.
- **Fase B — Login re-skineado + logo** (dep: A por `react-native-svg`): lockup isotipo SVG + wordmark **y re-skin a la identidad** (Salvia/Space Grotesk/PrimaryButton) en `login.tsx`. Gate branding (visto bueno del resultado visual). Coordinar con #20 (login.tsx modificado en `tarea/20`).
- **Fase C — Icono de app** (dep: diseño del isotipo/asset + A): regenerar assets nativos + `app.config.js`, incluir en el mismo rebuild que A. Gate branding + tooling SVG→PNG.
- **Fase D (opcional) — Isotipo SVG real en consumers** (dep: A): migrar `IsotipoMark` a `react-native-svg`; saldar deuda #32 en PropertyMarker/PropertyGridCard/ProfileHeader.

Recomendación de fraccionamiento: **una tarea con subtareas A→B→C** (comparten un único rebuild) — ver pregunta abierta #1.

## Criterios de aceptación
- [ ] `react-native-svg` (versión SDK 56) y `phosphor-react-native` instalados; dev-client reconstruido arranca sin crash.
- [ ] `grep -r "@expo/vector-icons"` en `mobile/src` y `mobile/app` = 0 resultados (o solo el `package.json` si se decide no desinstalar).
- [ ] Tab bar renderiza los 5 iconos Phosphor bold (no emojis); FAB usa `Plus`.
- [ ] Todos los iconos de la tabla migrados con weight bold (fill en activos); estados like/save/play conservan el toggle outline↔fill.
- [ ] Login **re-skineado a la identidad**: lockup de marca (isotipo SVG + wordmark) + Salvia/Space Grotesk/PrimaryButton — **aprobado visualmente por el cliente**.
- [ ] Icono de app actualizado (iOS + adaptive Android + monochrome) con fondo Salvia; `app.config.js` refleja `backgroundColor` Salvia — **aprobado visualmente por el cliente**.
- [ ] `pnpm tsc --noEmit` 0 · `pnpm lint` 0 err · suite jest verde · smoke en emulador.

## Dependencias
- Depende de: rebuild nativo del dev-client (EAS build development / `expo run:android`) y reinstalación del `.apk`.
- Coordinación: `mobile/app/login.tsx` está **modificado en la rama `tarea/20`** (#20 in-progress) → hacer Fase B tras integrar #20 o rebasar para evitar conflicto.
- Revierte la premisa de: **#32** ("sin react-native-svg") — ver sección Cambio de decisión.
- Reusa: `mobile/src/theme/theme.ts`, `mobile/src/components/IsotipoMark.tsx`, geometría `#iso` de `urbea-identidad-visual.html`.

## Cambio de decisión — #32 / grilling #11
- **Qué decía #32:** la tarea #32 ("Install react-native-svg and migrate IsotipoMark") se **resolvió SIN instalar `react-native-svg`**. `IsotipoMark.tsx` se implementó con **primitivas RN puras** (View + bordes: "bucket shape" para la U + triángulo por bordes para el play) — cero assets, cero deps nativas, cero rebuild. Motivo registrado: la máquina no tenía convertidor SVG→PNG y `react-native-svg` exigía rebuild nativo; el uso (badge pequeño) no justificaba la fidelidad vectorial. Techo declarado: "migrar a `react-native-svg` cuando ≥2 consumers pidan fidelidad fina". (`mobile/src/components/IsotipoMark.tsx` líneas 8–17; `wiki/codebase/mapa-codebase.md` §src/components.)
- **Grilling #11 (mapa):** `PropertyMarker.tsx` usa el isotipo por primitivas contra-rotado, con nota `// ponytail:` de que `react-native-svg` NO fue necesario (evitó el rebuild). El mapa también decidió clustering **custom sin dependencia**.
- **Por qué se revierte (decisión del cliente, no reabrir):** ahora aparecen **múltiples consumers que sí requieren vector real** (todo el set de iconos Phosphor + logo de login + icono de app), lo que cruza el umbral "≥2 consumers" que el propio #32 fijó. Se acepta explícitamente el **rebuild nativo**.
- **Qué implica:** con `react-native-svg` disponible, el isotipo puede ser el SVG real (Fase D opcional salda la deuda de #32 en pin/grid/avatar). El "techo conocido" del `// ponytail:` de `IsotipoMark` queda **cosechable** (`/ponytail-debt`).

## Edge cases / riesgos
- **Rebuild nativo obligatorio** (react-native-svg + phosphor + icono de app): no hot-reload; requiere EAS build/`expo run:android` + reinstalar `.apk`; **bloquea el emulador de otra sesión**. Mitigación: **un solo rebuild** que empaquete las 3 áreas.
- **Tooling SVG→PNG** para el icono de app: memoria #32 dice que no hay convertidor local. Necesita plan (herramienta de iconos de Expo, export de diseño, o servicio) — riesgo de bloqueo de Fase C.
- **Peso Phosphor bold vs línea fina de la identidad**: posible inconsistencia visual con el set "a medida" canónico. Decisión del cliente (bold), pero flag de diseño.
- **Bundle size**: `phosphor-react-native` es grande; importar iconos individuales, no el barril completo.
- **Remoción de `@expo/vector-icons`**: un uso omitido rompe tsc; barrido grep + tsc como red.
- **Conflicto con #20** en `login.tsx` (Fase B).
- **iOS**: el `app.config.js` no define `googleMapsApiKey` (react-native-maps en iOS usa Apple Maps); `react-native-svg` no lo afecta, pero validar `pod install` limpio tras instalar.

## Plan de pruebas (alto nivel)
Todo el footprint es **verificación ligera** (no crítico por path): `pnpm tsc --noEmit` + `pnpm lint` + jest existente + **smoke en emulador** tras el rebuild (arranque sin crash, tab bar con iconos, login con logo, iconos en feed/detalle/mapa/filtros). Barrido `grep @expo/vector-icons` = 0. Verificación visual del login lockup y del icono de app **con el cliente** (gate branding). Sin pgTAP/Deno (no toca backend).

## Impacto en PRD (solo referencia — NO se edita)
n/a — pulido visual, sin feature nueva en `docs/PRD-MVP-demo.md`.

## Decisiones del intake
**Pre-decidido por el cliente (no reabrir):**
- Instalar `react-native-svg` + `phosphor-react-native`, variante **BOLD**, aceptar rebuild nativo.
- Mapeo de tabs (Inicio=HouseLine, Mapa=MapPin, Leads=Ranking, Guardados=Bookmarks, Perfil=UserCircle) + Filtros=Sliders, WhatsApp=WhatsappLogo, Subir=Plus.

**Resueltas en la desambiguación (AskUserQuestion, 2026-07-04):**
- **#1 Fraccionamiento → UNA tarea con subtareas A→B→C** (comparten un único rebuild nativo). Fase D (isotipo SVG en consumers) queda opcional/no comprometida.
- **#2 Peso de iconos → BOLD por defecto + `fill` en estados activos** (preserva el toggle outline↔fill de like/save/play/tab activo).
- **#3 Iconos ambiguos → set recomendado**: baño=**Bathtub**, m²=**Ruler**, guardar individual=**BookmarkSimple**, atrás=**CaretLeft**, adelante=**CaretRight**.
- **#4 Desinstalar `@expo/vector-icons` → SÍ** tras migrar (un solo sistema de iconos; criterio de aceptación: 0 usos, dep removida del `package.json`).
- **#5 Wrapper de iconos → import directo por archivo** (ponytail/YAGNI; default sensato, no se preguntó al usuario).
- **#6 Alcance del login → RE-SKIN COMPLETO a la identidad** (Salvia/Space Grotesk/PrimaryButton), no solo el lockup. Superficie de marca → visto bueno visual del cliente antes de cerrar Fase B.
- **#7 Icono de app → isotipo blanco sobre Salvia #5A8A5E, generado con la herramienta de iconos de Expo** (autónomo; monochrome=isotipo). Resuelve el riesgo de tooling SVG→PNG de #32.
- **#8 Fondo del icono de app → Salvia #5A8A5E en AMBAS plataformas** (isotipo blanco). ⚠️ Esto **reemplaza** la respuesta inicial "Paper #F6F2EB" de la ronda 1: al elegir uniformidad iOS/Android con isotipo blanco (que no contrasta sobre Paper), el fondo canónico queda **Salvia**. `app.config.js` → `backgroundColor: '#5A8A5E'`.

**Branding (gate levantado 2026-06-26):** el re-skin de login (#6) y el icono de app (#7) son superficies de marca nuevas; el cliente dio visto bueno al alcance, pero el **resultado visual** de ambas se aprueba con el cliente antes de cerrar sus subtareas.

## Promoción / descarte
**APROBADA y promovida (2026-07-04)** → **Tarea #43** (`master`), prioridad `medium`, sin dependencias formales (se quitó la dep espuria a #1 que añadió la IA). Estructura elegida: **una tarea** con subtareas A→B→C(→D opc.) compartiendo un único rebuild. Coordinación soft con **#20** (`login.tsx` en `tarea/20`) para la Fase B — integrar/rebasar antes, no es dep de Taskmaster. Complejidad: ver `.taskmaster/reports/exploracion-028-complexity.json`. Siguiente: `/tm-plan 43` (desglose fino de subtareas) cuando el emulador de la otra sesión libere el working tree (implica rebuild nativo).
