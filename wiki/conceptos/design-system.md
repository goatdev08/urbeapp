---
tipo: concepto
dominio: ui
estado: vivo
fuentes: [.taskmaster/docs/exploraciones/003-reconciliacion-y-kit.md, .taskmaster/docs/exploraciones/003-kit/urbea-personality-kit.html]
codigo: [mobile/src/theme/theme.ts, mobile/app/_layout.tsx, mobile/src/components/PropertyGridCard.tsx, mobile/src/components/PrimaryButton.tsx]
actualizado: 2026-06-27
---

# Design system

> Tokens + tipografía + componentes de firma de Urbea. Sembrado por la tarea **#16** (perfil de agente), la primera pantalla con identidad visual tras levantarse el gate de branding.

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
- **`PropertyGridCard.tsx`** (#16.5, global, **lo reusará el feed #9**) — card de firma. Variante grid gestión-claro portada del **preview HTML aprobado** (`003-kit/property-grid-card-preview.html`). Anatomía: thumbnail vertical **4:5** (videos verticales), badge operación (Renta=primary / Venta=accent / both=Renta/Venta), badge "Pausada" glass si `status='paused'` (+ overlay media atenuado), título display 1 línea, zona con pin, **precio héroe** display con tick Salvia 26×3, `/mes` en rent. Placeholder café (expo-linear-gradient) cuando `thumbnail_url` es null (común en la demo). Props `{ item: GridProperty, onPress }`. ponytail demo: ícono video `▷` (Text) y pin `dot` (sin react-native-svg instalado); sin backdrop-filter.
- **`PrimaryButton.tsx`** (#6, **predata theme.ts**) — CTA liquid-glass; hardcodea Salvia `#5A8A5E` (coincide con el token; refactor a theme.ts pendiente, bajo prioridad).

## Navegación (introducida en #16.1)
**Tabs navigator** `mobile/app/(protected)/(tabs)/_layout.tsx` (expo-router `Tabs`): tabs **Inicio** (`index.tsx`, el feed placeholder, URL `/`) + **Perfil** (`profile.tsx`, URL `/profile`). `admin/` y `publish/` siguen como Stack fuera de tabs. Íconos emoji inline (ponytail: @expo/vector-icons no instalado). Los grupos `(tabs)` son transparentes a la URL → `router.replace('/')` post-login/publish sigue resolviendo al feed.

## Relacionados
[[perfil-agente]] · [[feed-vertical-video]] · [[propiedades-y-video]]
