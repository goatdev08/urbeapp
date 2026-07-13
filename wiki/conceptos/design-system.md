---
tipo: concepto
dominio: ui
estado: vivo
fuentes: [urbea-identidad-visual.html, urbea-logo-final.html, "Urbea Prototipo (standalone).html", .taskmaster/docs/exploraciones/003-reconciliacion-y-kit.md, .taskmaster/docs/exploraciones/026-layout-system-extraction.md, .taskmaster/docs/exploraciones/028-iconografia-phosphor-logo-app-icon.md]
codigo: [mobile/src/theme/theme.ts, mobile/app/_layout.tsx, mobile/src/components/PropertyGridCard.tsx, mobile/src/components/PrimaryButton.tsx, mobile/src/components/IsotipoMark.tsx, mobile/src/components/UrbeaLockup.tsx, mobile/app/login.tsx, mobile/app/(protected)/(tabs)/_layout.tsx]
actualizado: 2026-07-05
---

# Design system

> Tokens + tipografía + componentes de firma de Urbea. Sembrado por la tarea **#16** (perfil de agente), la primera pantalla con identidad visual tras levantarse el gate de branding.

## ⭐ Referencia visual canónica — `urbea-identidad-visual.html` (raíz del repo)
**Antes de diseñar/implementar CUALQUIER pantalla de la demo, ábrelo en el navegador y úsalo como spec visual.** Es el entregable maduro del kit 003 (sucede al borrado `urbea-personality-kit.html`): tokens + tipografía + 3 componentes de firma + **mockups fieles de las ~13 pantallas del MVP** (`docs/PRD-MVP-demo.md` §6), montados con estos mismos tokens. Sus tokens coinciden 1:1 con `theme.ts` (verificado #16) → es la fuente de verdad del *look*, no solo inspiración. Estética **híbrida**: descubrimiento oscuro/inmersivo (feed, detalle, mapa) · gestión clara/editorial (publicar, CRM, perfil, admin).

**Cómo usarlo para acotar alcance (scope) por tarea:** cada `<div class="phone-fig">` numerado es **una pantalla = el techo de alcance** de su tarea. El `phone-cap` dice qué incluye. No agregues UI que el mockup no muestra (evita scope-creep); si una pantalla real necesita algo ausente del mockup, es **trabajo nuevo** → `add-task`/`add-subtask`, no se cuela en la tarea en curso.

## 📐 Dos referencias canónicas — lenguaje visual vs layout (#26)
Hay **dos** specs canónicos en la raíz, con roles distintos (CLAUDE.md §8):
- `urbea-identidad-visual.html` = techo del **lenguaje visual** → color, tipografía, componentes de firma.
- `Urbea Prototipo (standalone).html` (export de Claude Design) = techo del **layout** → acomodo, jerarquía, grid, espaciado y composición por pantalla.

⚠️ **Del prototipo se toma SOLO el layout; nunca color ni fuente** (los manda la identidad). Regla: **layout del prototipo + lenguaje visual de la identidad = pantalla final.**

### Sistema de layout extraído (#26.2, medido en navegador)
Doc completo: `.taskmaster/docs/exploraciones/026-layout-system-extraction.md`. El prototipo es **off-grid** (usa 11/13/18/30 px) → se mapea su *intención* a la escala base-4 de `theme.ts`, no se copian px sucios. Tokens vivos:
- **Frame de pantalla:** 390×844 (lógico); el bezel r46 es del device, **no** se porta.
- **`layout.screen_inset = 20`** — inset horizontal de página (prototipo midió 18 → base-4 20).
- **`layout.grid_gutter = 14`** — separación de columnas del grid de tarjetas (medido exacto; `PropertyGridCard` 2-col en contenido de 354 = 170+14+170).
- **`layout.grid_cols = 2`** — grid de propiedades por defecto.
- Anatomía por pantalla (Feed/Detalle/Wizard/Perfil/CRM) en [[layout-anatomy-screens]] (#26.5).

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
- ~~**Isotipo** no existe en RN~~ → **RESUELTO (#43.4)**: `IsotipoMark` es react-native-svg con la geometría del logo final; ver sección "Logo final + iconografía".
- ~~**Set de iconos a medida** con Text/emoji~~ → **RESUELTO (#43.1)**: toda la app usa `phosphor-react-native` bold.
- **Precio-héroe editorial + hairlines de plata en specs** — ya en `PropertyGridCard`; replicar en detalle/feed.
- **Embudo de leads de firma** (barra segmentada Arcilla→Salvia, 7 estados) — para [[crm-leads]].

### Divergencias detectadas: Perfil shipped (#16) vs mockup #10
Registradas para decidir si se alinean ahora o se difieren (candidatas a #22 o tareas nuevas):
- **`profstats`** (fila Publicaciones / Leads / Cerrados) — el mockup la tiene; **#16 no la construyó**. Requiere conteos agregados (queries nuevas) → probable trabajo nuevo.
- **Badge isotipo "U+play"** sobre el avatar (`.vb`) — no portado (#16 usa iniciales sin badge); llega con `<IsotipoMark>`.
- **Grid del perfil:** el mockup #10 usa una `gcell` simple 3:4 (thumb+precio+play); **#16 shipea la `PropertyGridCard` rica 4:5** (badges/zona/precio-héroe) aprobada aparte por el cliente vía preview HTML. Divergencia **intencional** (la card rica fue aprobada); el mockup queda como variante compacta alterna.
- Botón **Editar** (top-right) — stub en #16 → [[perfil-agente]] / tarea **#22**.

## ⭐ Logo final + iconografía (#43, vivo, 2026-07-05)
Superó las premisas "sin react-native-svg" de #32/#11 (el cliente aprobó instalarlo).
- **Logo final canónico = `urbea-logo-final.html` (raíz).** Símbolo NUEVO (reemplaza el "U + play" del `#iso` de identidad): **U/pin cuya pata derecha sube y remata en flecha ↑ + dos puntos (la Ü)**, trazo monolínea 19u round (viewBox 240). Paleta EXCLUSIVA del logo: **verde `#1A5E44` + carnita `#EEE4D0`**, wordmark **"URBEA"** en **Outfit** 600 tracking .24em. ⚠️ Alcance acotado (decisión cliente): el verde/carnita del logo vive **solo en el icono de app + el login**; el resto de la app sigue con Salvia `#5A8A5E`.
- **`react-native-svg` + `phosphor-react-native` instalados** (rebuild nativo del dev-client, #43.1) — desbloquea el isotipo vectorial y toda la iconografía.
- **`IsotipoMark.tsx`** (#43.4): migrado de primitivas RN → **react-native-svg** con los paths exactos del logo final; interfaz `{size?,color?}` intacta (3 consumers: PropertyMarker/PropertyGridCard/ProfileHeader).
- **`UrbeaLockup.tsx`** (#43.2, nuevo): lockup del logo (mark + "URBEA" Outfit) `{size?,color?,direction:'row'|'column'}` — `column` = hero vertical (lo usa el login). Reusa IsotipoMark.
- **Iconografía Phosphor bold** (#43.1): TODA la app migró de `@expo/vector-icons` (Ionicons) a **`phosphor-react-native`** (variante bold, `weight="fill"` en estados activos) en 15 archivos + tab bar (HouseLine/Bookmarks/MapPin/Ranking/UserCircle). `@expo/vector-icons` removido.
- **Icono de app** (#43.3): `assets/icon.png` (iOS, verde full-bleed + símbolo carnita) + adaptive Android (`android-icon-foreground/background.png`, sin monochrome), `app.config.js` backgroundColor `#1A5E44`. Assets rasterizados de SVG con **`qlmanage`** (Quick Look de macOS) + `sips` — resuelve el bloqueo SVG→PNG histórico (#32) sin instalar convertidor.
- **`theme.ts`**: +`brand` tokens (green/green_deep/carnita/carnita_2/ink, ADITIVO) + `fonts.logo = Outfit_600SemiBold`.

## Gate de branding
**Levantado** (cliente, 2026-06-26). Antes en pausa por CLAUDE.md §8 / tarea #19. Método: bajo demanda por pantalla, diseñar antes de implementar escalado por complejidad (simple → mini-spec; firma → preview HTML aprobable → portar a RN). El `theme.ts` **crece orgánicamente**: la primera pantalla lo siembra, no se diseña por adelantado.

## `theme.ts` (sembrado #16)
Fuente única de tokens, **plana** (sin theming engine). 6 grupos, todos snake_case:
- **`colors`** — 20 tokens EXACTOS del kit 003: `primary` `#5A8A5E` (Salvia) + soft/tint/deep, `accent` `#9A7150` (Arcilla) + soft/tint/deep, `ink_feed` `#17140F`, `ink` `#1E1A15`, `paper` `#F6F2EB` + paper_2/3, `gray_1/2/3`, `silver` + silver_dk, `whatsapp`. **+2 semánticos (#33):** `on_primary` `#FFFFFF` (texto/iconos sobre primary) y `surface` `#FFFFFF` (superficie blanca de modal/card) — saldan la deuda de theming que el guardian marcó en #29 (3 `#FFFFFF` hardcodeados en `LeadExpandedView`). ⚠️ `LeadCard`/`AgentSelector` aún hardcodean `#FFFFFF` (`surface` listo para que lo adopten en una auditoría futura).
- **`radii`** — r_4…r_24 + r_pill (999).
- **`shadows`** — sm/md/lg/primary (objetos RN `shadowColor/Offset/Opacity/Radius/elevation`, traducidos de los box-shadow CSS del kit; `primary` = glow verde).
- **`fonts`** — `display: SpaceGrotesk_600SemiBold` + `sans: HankenGrotesk_400/500/600/700` + **`logo: Outfit_600SemiBold` (#43, solo wordmark del logo final)**.
- **`brand`** (#43) — paleta EXCLUSIVA del logo final (`green #1A5E44`/`green_deep`/`carnita #EEE4D0`/`carnita_2`/`ink`), ADITIVA (no toca `colors` Salvia); alcance: icono de app + login.
- **`type_scale`** — display 44 / h1 28 / price 34 / body 16 / caption 12 (caption uppercase, letterSpacing ~1.6; display/h1 letterSpacing negativo en px absolutos).
- **`spacing`** — base-4 (s_4…s_40), incl. `s_20`/`s_40` añadidos del prototipo (#26); el kit no la define explícita.
- **`layout`** (#26) — `screen_inset: 20` (inset horizontal de página), `grid_gutter: 14`, `grid_cols: 2`. Estructura de pantalla extraída del prototipo de layout (ver ↓).
- ⚠️ **ponytail — sin dual-mode aún:** solo modo **gestión claro** (paper/ink). El modo **feed oscuro** (`ink_feed`) se añadirá cuando lo toque el feed **#9**.

## Tipografía
⚠️ **Canónica = Space Grotesk (display) + Hanken Grotesk (sans), la del KIT HTML — NO Fraunces.** El doc de exploración 003 decía "Fraunces (serif)" pero el entregable real (`003-kit/urbea-personality-kit.html`) usa `--display: Space Grotesk`. Cliente confirmó Space Grotesk (2026-06-27, #16). Carga: `@expo-google-fonts/space-grotesk` + `@expo-google-fonts/hanken-grotesk` + `expo-font`, vía `useFonts` en `mobile/app/_layout.tsx` (retorna `null` mientras `!loaded`, sin expo-splash-screen).

## Componentes
- **`PropertyGridCard.tsx`** (#16.5, global, **lo reusará el feed #9**) — card de firma. Variante grid gestión-claro portada del **preview HTML aprobado** (`003-kit/property-grid-card-preview.html`). Anatomía: thumbnail vertical **4:5** (videos verticales), badge operación (Renta=primary / Venta=accent / both=Renta/Venta), badge "Pausada" glass si `status='paused'` (+ overlay media atenuado), título display 1 línea, zona con pin, **precio héroe** display con tick Salvia 26×3, `/mes` en rent. Placeholder café **sólido** (`View` con `paper_2`) cuando `thumbnail_url` es null (común en la demo) — ⚠️ **no usar `expo-linear-gradient`**: su módulo nativo no está en el dev build instalado y crashea la pantalla ("Unable to get the view config for default view from module ExpoLinearGradient"); regla durable hasta que se reconstruya el .apk con la dep. Props `{ item: GridProperty, onPress }`. ponytail demo: ícono video `▷` (Text) y pin `dot` (sin react-native-svg instalado); sin backdrop-filter.
- **`PrimaryButton.tsx`** (#6, **predata theme.ts**) — CTA liquid-glass; hardcodea Salvia `#5A8A5E` (coincide con el token; refactor a theme.ts pendiente, bajo prioridad).

## Navegación (introducida en #16.1; split por plataforma en #65)
**Tab bar con split por plataforma (#65, exploración 035):** `mobile/app/(protected)/(tabs)/_layout.tsx` solo bifurca por `Platform.OS`:
- **iOS → `IosNativeTabsLayout.tsx`** (`NativeTabs` de expo-router 56): UITabBar del sistema — **liquid glass real de iOS 26** (material, lupa deslizante y morphing nativos de Apple, cero imitación). Íconos Phosphor conservados vía PNG rasterizados (`mobile/assets/tab-icons/`, `src={{default: regular, selected: fill}}` @1x/2x/3x; ⚠️ gotcha del rasterizado: `qlmanage` aplana el alpha sobre blanco → se reconstruye la máscara con PIL `alpha=255-luminancia`). El [+] publicar = trigger `disabled` + listener `tabPress` → `router.push('/publish/step1')` (nunca se marca activo). Slot 4 por rol con `hidden`. La barra sigue el colorScheme del sistema (no fuerza variante por pantalla — comportamiento Apple estándar).
- **Android → `AndroidTabsLayout.tsx`** (`Tabs tabBar={GlassTabBar}`): **`GlassTabBar.tsx`** pill flotante custom — BlurView `experimentalBlurMethod="dimezisBlurView"` (⚠️ sin esa prop BlurView NO desenfoca en Android, solo tinta — causa de la "franja opaca" original) + overlays translúcidos + rim highlight + **lupa deslizante** (cápsula Reanimated spring denso damping 32/stiffness 420, blur 2x, overlay por variante — oscura en feed). Rama `GlassView`/`isLiquidGlassAvailable()` presente para iOS<26 pero en la práctica iOS usa NativeTabs. ⚠️ GlassView: NUNCA `tintColor` con hex sólido (opaca el material — usar `colorScheme`). ⚠️ React Navigation invoca `tabBar(props)` como función plana: los hooks viven en `GlassTabBarRow` interno, no en el top-level.
- **Tokens `glass` en `theme.ts`**: intensidades/overlays/rim/pill/lens_* + **`floating_content_clearance`** (`Platform.select`: Android 66 = pill flotante que no reserva alto; iOS 12 — ⚠️ bajo NativeTabs `insets.bottom` YA incluye el alto de la barra, sumar el token Android duplica el despeje). Consumidores: PropertyOverlay (feed), AreaSearchPill, PropertyMiniCard, SavedScreen, CRMScreen, PropertiesGrid.
- **Divergencia consciente del mockup canónico:** `urbea-identidad-visual.html` define la tabbar **anclada** (líneas 374-383) — obsoleta para esta pantalla desde #65 (decisión del dueño, referencia WhatsApp iOS 26). La referencia viva es la exploración `035-tab-bar-glass-flotante.md` + este concepto.
- Rutas/slots sin cambio: Feed · Mapa · [+] · Leads(agente)/Guardados(no-agente) · Perfil; `admin/` y `publish/` siguen como Stack fuera de tabs. Íconos: `fill` activo / `regular` inactivo (evolución de #43, antes bold). Los grupos `(tabs)` son transparentes a la URL → `router.replace('/')` post-login/publish sigue resolviendo al feed.
- ⚠️ **Release:** `expo-glass-effect@56.0.4` (pineado — latest=57 es SDK 57) es módulo nativo → NO viaja por OTA; build 1.0.2.

## Relacionados
[[perfil-agente]] · [[feed-vertical-video]] · [[propiedades-y-video]]
