---
tipo: concepto
dominio: ui
estado: vivo
fuentes: [urbea-identidad-visual.html, .taskmaster/docs/exploraciones/003-reconciliacion-y-kit.md]
codigo: [mobile/src/theme/theme.ts, mobile/app/_layout.tsx, mobile/src/components/PropertyGridCard.tsx, mobile/src/components/PrimaryButton.tsx]
actualizado: 2026-06-27
---

# Design system

> Tokens + tipografía + componentes de firma de Urbea. Sembrado por la tarea **#16** (perfil de agente), la primera pantalla con identidad visual tras levantarse el gate de branding.

## ⭐ Referencia visual canónica — `urbea-identidad-visual.html` (raíz del repo)
**Antes de diseñar/implementar CUALQUIER pantalla de la demo, ábrelo en el navegador y úsalo como spec visual.** Es el entregable maduro del kit 003 (sucede al borrado `urbea-personality-kit.html`): tokens + tipografía + 3 componentes de firma + **mockups fieles de las ~13 pantallas del MVP** (`docs/PRD-MVP-demo.md` §6), montados con estos mismos tokens. Sus tokens coinciden 1:1 con `theme.ts` (verificado #16) → es la fuente de verdad del *look*, no solo inspiración. Estética **híbrida**: descubrimiento oscuro/inmersivo (feed, detalle, mapa) · gestión clara/editorial (publicar, CRM, perfil, admin).

**Cómo usarlo para acotar alcance (scope) por tarea:** cada `<div class="phone-fig">` numerado es **una pantalla = el techo de alcance** de su tarea. El `phone-cap` dice qué incluye. No agregues UI que el mockup no muestra (evita scope-creep); si una pantalla real necesita algo ausente del mockup, es **trabajo nuevo** → `add-task`/`add-subtask`, no se cuela en la tarea en curso.

### Mapeo pantalla → tarea (techo de alcance)
| # | Pantalla (mockup) | Tarea | Estado |
|---|---|---|---|
| 1 | Login | #2 | ✅ |
| 2 | Canje de código | #5 | ✅ |
| 3 | Onboarding (nombre+foto) | #6 | ✅ |
| 4 | Feed vertical | #9 | pending |
| 5 | Detalle de propiedad | (ruta `/property/[id]`, sin tarea aún) | falta |
| 6 | Mapa global (pines+clustering) | [[mapa-y-ubicacion]] | backlog |
| 7 | Búsqueda / filtros | [[busqueda-y-filtros]] | backlog |
| 8 | Wizard publicar (3 pasos) | #8 | ✅ |
| 9 | Mis publicaciones (activa/pausada/vendida) | (sin tarea aún) | falta |
| 10 | Perfil del agente | #16 | ✅ (con divergencias ↓) |
| 11 | CRM / leads (7 estados + embudo) | [[crm-leads]] | backlog |
| 12 | Guardados (cuadrícula) | (sin tarea aún) | falta |
| 13 | Panel admin | #7 | ✅ |

### Elementos de firma aún NO portados a RN (pendientes, los pedirá el mockup)
- **Isotipo "U + play"** como motivo recurrente — botón de play del feed, anillo de avatar (con badge), pin de mapa, loader, estado vacío, ícono de app. Hoy **no existe** en RN (requiere `react-native-svg`, no instalado). Es la pieza que "cose" la marca; planear su componente `<IsotipoMark>` cuando lo toque la primera pantalla que lo use (feed #9 / mapa).
- **Set de iconos a medida** (trazo fino 24×24, sprite del HTML) — hoy suplido con Text/emoji (ponytail). Migrar a `react-native-svg` cuando entre.
- **Precio-héroe editorial + hairlines de plata en specs** — ya en `PropertyGridCard`; replicar en detalle/feed.
- **Embudo de leads de firma** (barra segmentada Arcilla→Salvia, 7 estados) — para [[crm-leads]].

### Divergencias detectadas: Perfil shipped (#16) vs mockup #10
Registradas para decidir si se alinean ahora o se difieren (candidatas a #22 o tareas nuevas):
- **`profstats`** (fila Publicaciones / Leads / Cerrados) — el mockup la tiene; **#16 no la construyó**. Requiere conteos agregados (queries nuevas) → probable trabajo nuevo.
- **Badge isotipo "U+play"** sobre el avatar (`.vb`) — no portado (#16 usa iniciales sin badge); llega con `<IsotipoMark>`.
- **Grid del perfil:** el mockup #10 usa una `gcell` simple 3:4 (thumb+precio+play); **#16 shipea la `PropertyGridCard` rica 4:5** (badges/zona/precio-héroe) aprobada aparte por el cliente vía preview HTML. Divergencia **intencional** (la card rica fue aprobada); el mockup queda como variante compacta alterna.
- Botón **Editar** (top-right) — stub en #16 → [[perfil-agente]] / tarea **#22**.

## Gate de branding
**Levantado** (cliente, 2026-06-26). Antes en pausa por CLAUDE.md §8 / tarea #19. Método: bajo demanda por pantalla, diseñar antes de implementar escalado por complejidad (simple → mini-spec; firma → preview HTML aprobable → portar a RN). El `theme.ts` **crece orgánicamente**: la primera pantalla lo siembra, no se diseña por adelantado.

## `theme.ts` (sembrado #16)
Fuente única de tokens, **plana** (sin theming engine). 6 grupos, todos snake_case:
- **`colors`** — 20 tokens EXACTOS del kit 003: `primary` `#5A8A5E` (Salvia) + soft/tint/deep, `accent` `#9A7150` (Arcilla) + soft/tint/deep, `ink_feed` `#17140F`, `ink` `#1E1A15`, `paper` `#F6F2EB` + paper_2/3, `gray_1/2/3`, `silver` + silver_dk, `whatsapp`.
- **`radii`** — r_4…r_24 + r_pill (999).
- **`shadows`** — sm/md/lg/primary (objetos RN `shadowColor/Offset/Opacity/Radius/elevation`, traducidos de los box-shadow CSS del kit; `primary` = glow verde).
- **`fonts`** — `display: SpaceGrotesk_600SemiBold` + `sans: HankenGrotesk_400/500/600/700`.
- **`type_scale`** — display 44 / h1 28 / price 34 / body 16 / caption 12 (caption uppercase, letterSpacing ~1.6; display/h1 letterSpacing negativo en px absolutos).
- **`spacing`** — base-4 (s_4…s_32), derivada (el kit no la define explícita).
- ⚠️ **ponytail — sin dual-mode aún:** solo modo **gestión claro** (paper/ink). El modo **feed oscuro** (`ink_feed`) se añadirá cuando lo toque el feed **#9**.

## Tipografía
⚠️ **Canónica = Space Grotesk (display) + Hanken Grotesk (sans), la del KIT HTML — NO Fraunces.** El doc de exploración 003 decía "Fraunces (serif)" pero el entregable real (`003-kit/urbea-personality-kit.html`) usa `--display: Space Grotesk`. Cliente confirmó Space Grotesk (2026-06-27, #16). Carga: `@expo-google-fonts/space-grotesk` + `@expo-google-fonts/hanken-grotesk` + `expo-font`, vía `useFonts` en `mobile/app/_layout.tsx` (retorna `null` mientras `!loaded`, sin expo-splash-screen).

## Componentes
- **`PropertyGridCard.tsx`** (#16.5, global, **lo reusará el feed #9**) — card de firma. Variante grid gestión-claro portada del **preview HTML aprobado** (`003-kit/property-grid-card-preview.html`). Anatomía: thumbnail vertical **4:5** (videos verticales), badge operación (Renta=primary / Venta=accent / both=Renta/Venta), badge "Pausada" glass si `status='paused'` (+ overlay media atenuado), título display 1 línea, zona con pin, **precio héroe** display con tick Salvia 26×3, `/mes` en rent. Placeholder café **sólido** (`View` con `paper_2`) cuando `thumbnail_url` es null (común en la demo) — ⚠️ **no usar `expo-linear-gradient`**: su módulo nativo no está en el dev build instalado y crashea la pantalla ("Unable to get the view config for default view from module ExpoLinearGradient"); regla durable hasta que se reconstruya el .apk con la dep. Props `{ item: GridProperty, onPress }`. ponytail demo: ícono video `▷` (Text) y pin `dot` (sin react-native-svg instalado); sin backdrop-filter.
- **`PrimaryButton.tsx`** (#6, **predata theme.ts**) — CTA liquid-glass; hardcodea Salvia `#5A8A5E` (coincide con el token; refactor a theme.ts pendiente, bajo prioridad).

## Navegación (introducida en #16.1)
**Tabs navigator** `mobile/app/(protected)/(tabs)/_layout.tsx` (expo-router `Tabs`): tabs **Inicio** (`index.tsx`, el feed placeholder, URL `/`) + **Perfil** (`profile.tsx`, URL `/profile`). `admin/` y `publish/` siguen como Stack fuera de tabs. Íconos emoji inline (ponytail: @expo/vector-icons no instalado). Los grupos `(tabs)` son transparentes a la URL → `router.replace('/')` post-login/publish sigue resolviendo al feed.

## Relacionados
[[perfil-agente]] · [[feed-vertical-video]] · [[propiedades-y-video]]
