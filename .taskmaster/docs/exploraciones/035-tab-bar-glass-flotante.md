---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: M             # XS | S | M | L | XL — tamaño estimado; define la profundidad del doc
fecha: 2026-07-11    # absoluta
estado: aprobado      # borrador → en-revision → aprobado | descartado
tarea_id: 65          # id(s) de Taskmaster; se llena SOLO al promover (estado: aprobado)
motivo_descarte:      # se llena SOLO si estado: descartado
---

# Tab bar glass flotante (pill "liquid glass")

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede APROBARSE (→ tarea[s]) o DESCARTARSE (registro de decisión).

## Idea original
Reemplazar el panel inferior default de la app (barra anclada de `Tabs`) por una **barra pill flotante** con efecto "liquid glass" — port nativo del `GlassSurface` de ReactBits. El dueño quiere **explícitamente las refracciones/distorsión** del liquid glass (no solo blur frosted) y aceptó el costo aunque `ponytail` lo descartaría. Vía técnica a evaluar: `expo-glass-effect` (GlassView de Apple, iOS 26+, refracción real) con fallback `expo-blur` en Android e iOS < 26. Se conserva TODO el comportamiento actual de la barra.

## Lluvia de ideas (solo si la idea era abstracta)
La idea llegó **concreta** (vía técnica ya elegida por el dueño). Aun así, quedan direcciones de *fidelidad* que el orquestador debe cerrar (ver Preguntas abiertas). Direcciones consideradas para el efecto glass, de mayor a menor fidelidad:

- **[REC] `expo-glass-effect` (GlassView) + fallback `expo-blur`.** Refracción real de Apple en iOS 26+; Android e iOS<26 caen a BlurView (frosted) + borde highlight + tint. Trade-off: **`expo-glass-effect` es módulo nativo NUEVO → NO está instalado → exige rebuild + subir `version` (no viaja por OTA)**. Encaja con el deseo explícito del dueño; es la única vía a refracción real en el stack.
- **Solo `expo-blur` (frosted).** Ya instalado y probado en la app (MapSearchBar, PropertyMiniCard, PrimaryButton) → **viaja por OTA, cero rebuild**. Trade-off: **NO hay refracción/displacement**, solo desenfoque. Contradice el requisito explícito del dueño; queda como el propio *fallback* de la opción REC.
- **Recrear displacement con `react-native-svg` (feDisplacementMap-like) o Skia.** SVG en RN **no** soporta `backdrop-filter` ni `feDisplacementMap` sobre contenido vivo → inviable para refracción real; Skia sí, pero es otro módulo nativo pesado (rebuild igual) y sobre-ingeniería para una tab bar. Descartada.

## Problema / Motivación
Elevar el pulido visual de la navegación principal para la **demo cerrada** ([[0005-demo-cerrada-3-semanas]]): una tab bar flotante "liquid glass" es un detalle de firma que refuerza la percepción premium del producto frente al cliente. No resuelve un bug ni una brecha funcional; es mejora de *lenguaje visual/interacción* decidida por el dueño.

## Resultado esperado
- La barra inferior se dibuja como una **pill flotante** (separada de los bordes, con safe-area inferior respetada), no como panel anclado a pantalla completa.
- Sobre el feed (oscuro/inmersivo) y sobre gestión (claro), la barra muestra vidrio translúcido con **refracción real en iOS 26+** (GlassView) y **frosted degradado con borde highlight** en Android / iOS<26.
- **Todo el comportamiento actual se conserva** sin regresiones (ver Alcance).

## Alcance
- **SÍ entra:**
  - `tabBar` custom en `<Tabs tabBar={...}>` dentro de `mobile/app/(protected)/(tabs)/_layout.tsx` (o un componente nuevo `mobile/src/components/GlassTabBar.tsx` — decidir, ver preguntas).
  - Contenedor pill flotante con vidrio por plataforma: `GlassView` (iOS 26+) / `BlurView` + overlay + borde highlight (resto).
  - Conservar: FAB central de publicar (48×48, radio 16, empuja el wizard de publicación, borde que imita el "notch"), slot 4 compartido Leads(agente)/Guardados(no-agente) vía `href:null`, variante oscura sobre feed / clara en gestión (detección por pantalla con `useSegments`), safe area inferior, íconos Phosphor `weight="fill"` activo / trazo inactivo (#43), `freezeOnBlur`.
  - Tokens de glass en `theme.ts` (borde highlight, intensidad blur, radio pill, tints) — **decidido:** viven en el design system para reuso con MapSearchBar/PropertyMiniCard/futuros glass.
  - Ajuste de íconos inactivos: `bold` → `regular` en `tab_icon()` — **decidido** (trazo fino para la estética glass; activo sigue `fill`).
  - **Rebuild dentro de la tarea:** `pnpm add expo-glass-effect` → subir `version` 1.0.1→1.0.2 → `eas build` (Android + iOS) → distribuir a testers. La tarea NO cierra por OTA.
- **NO entra (out of scope):**
  - Cambios de navegación/rutas o del set de tabs (siguen Feed · Mapa · [+] · Leads/Guardados · Perfil).
  - Refactor del wizard de publicación ni de las pantallas destino.
  - Migrar la estética glass de otros componentes (MapSearchBar/PrimaryButton) a la nueva vía.
  - Migrar `runtimeVersion.policy` a `fingerprint` (recomendación de [[estrategia-releases]], tarea aparte).
  - Actualizar el mockup canónico `urbea-identidad-visual.html` (es divergencia consciente; ver preguntas).

## Roles afectados
- **Comprador / no-agente:** ve la barra con Guardados en el slot 4. Sin cambio funcional.
- **Inmobiliaria + agente:** ve Leads en el slot 4. Sin cambio funcional.
- **Admin:** navega por Stack fuera de `(tabs)` — no afectado.
Es un cambio puramente visual/interacción, **transversal a todos los roles** que usan la barra.

## Impacto en datos
n/a — no toca BD, RLS, Edge Functions, Storage ni migraciones.

## Impacto en UI
Toca la **navegación principal** (tab bar) en `mobile/app/(protected)/(tabs)/_layout.tsx`. Es diseño visual: el **gate de branding está LEVANTADO** (cliente, 2026-06-26; CLAUDE.md §8), así que no bloquea. **Pero diverge del mockup canónico** `urbea-identidad-visual.html`, que define la tabbar **anclada, no flotante** (líneas 374-383, variantes oscura/clara). El dueño ya decidió la divergencia conscientemente en el chat; conviene registrarla (ver preguntas) porque §8 marca cada pantalla del mockup como techo de alcance de su tarea.

## Reglas no obvias aplicables
- **OTA vs rebuild (CRÍTICA aquí):** `expo-glass-effect` = módulo nativo **nuevo** → **NO viaja por OTA**; exige `eas build` + subir `version` (hoy `1.0.1` → p.ej. `1.0.2`) + reinstalar/`eas submit`. `expo-blur` YA está instalado (`^56.0.3`) → el fallback SÍ es OTA-able. — [[estrategia-releases]] · CLAUDE.md §3 · `mobile/app.config.js:55` (`runtimeVersion.policy: 'appVersion'`).
- **Precedente de crash por dep nativa ausente del dev build:** `expo-linear-gradient` crashea porque su módulo nativo no está en el `.apk` instalado ("Unable to get the view config… ExpoLinearGradient"). Mismo riesgo con `expo-glass-effect`: **no funcionará hasta reconstruir el build**; no se puede probar en el dev-client actual sin recompilar. — `wiki/codebase/mapa-codebase.md` (nota #93, PropertyGridCard) · memoria `dev_client_vs_release_apk`.
- **ReactBits = referencia visual, NO import:** `GlassSurface` usa `backdrop-filter` + filtros SVG (`feDisplacementMap`, offsets RGB) inexistentes en RN. Se recrea con primitivas RN + tokens de `theme.ts`. — CLAUDE.md §8, método de branding.
- **Convención de íconos #43:** Phosphor `weight="fill"` activo / trazo inactivo, ya implementada en `tab_icon()`. Reusar, no reinventar. Ajuste inactivo `bold`→`regular` es opcional (ver preguntas). — Exploración `028-iconografia-phosphor-logo-app-icon.md`.
- **Estética liquid-glass ya existe en la app:** `MapSearchBar` (`BlurView tint="light" intensity={30}` + overlay), `PropertyMiniCard` (`intensity={35}`), `PrimaryButton` (BlurView). **Reusar el patrón** para el fallback, no crear uno nuevo. — `wiki/conceptos/design-system.md`.
- **PNPM siempre** para instalar `expo-glass-effect` (`cd mobile && pnpm add expo-glass-effect`); `.npmrc` `node-linker=hoisted` ya configurado. — CLAUDE.md §3.

## Arquitectura / enfoque técnico  (L/XL — n/a para fixes)
Nivel M, pero el enfoque importa:
- **Prop `tabBar` de `<Tabs>`** (expo-router SDK 56 pasa por React Navigation `BottomTabBar` props: `state`, `descriptors`, `navigation`, `insets`). Un `GlassTabBar` custom recibe esos props y dibuja: contenedor pill flotante + un botón por ruta visible (respetando `href:null` que ya oculta slots) + el FAB central en la posición 3/5.
- **Vidrio por plataforma (component split):**
  - iOS ≥ 26: `GlassView` de `expo-glass-effect` (refracción real) como fondo del pill.
  - Android / iOS < 26: `BlurView` (`expo-blur`, ya instalado) + overlay semi-translúcido + borde highlight 1px — mismo patrón que `MapSearchBar`.
  - Detección de capacidad: check de disponibilidad de `GlassView` (o `Platform.OS === 'ios'` + versión) con fallback estático.
- **Reuso máximo:** `tab_icon()`, `PublishTabButton` (FAB), la lógica `is_agent`/`href:null`, las variantes `dark_bar_options`/`light_bar_options` y la detección `on_feed` con `useSegments` — todo migra casi tal cual desde el `_layout.tsx` actual. Lo nuevo es el **contenedor** (pill + glass + posicionamiento flotante), no la lógica de slots.
- **Sin lógica de negocio** → no aplica Edge Functions / RLS / triggers.

## Fases / épicas  (L/XL — n/a para cambios chicos)
n/a — cabe en una sola tarea. `/tm-plan` la descompondrá en subtareas (p.ej.: 1) contenedor pill + fallback BlurView, 2) integración GlassView iOS + detección de capacidad, 3) migrar FAB/slots/variantes, 4) rebuild + version bump + verificación en dispositivo).

## Criterios de aceptación
- [ ] La barra se renderiza como pill flotante con safe-area inferior respetada, sobre feed (oscuro) y gestión (claro).
- [ ] En iOS 26+ se ve refracción real (GlassView); en Android / iOS<26, frosted (BlurView) + borde highlight, **sin crash** en el build reconstruido.
- [ ] FAB central de publicar conserva geometría (48×48, radio 16, sobresale, borde tipo notch) y sigue empujando `/publish/step1`.
- [ ] Slot 4 compartido: agente ve Leads, no-agente ve Guardados; el rol que no usa el otro lo tiene en `href:null`. `[+]` centrado (posición 3/5).
- [ ] Íconos Phosphor: `fill` activo / `regular` inactivo (ajuste sobre convención #43, decidido en intake).
- [ ] `pnpm tsc --noEmit` verde y `pnpm lint` verde.
- [ ] Visual OK en ambas plataformas, verificado por CLI: captura en emulador Android (frosted BlurView + borde highlight) y simulador iOS 26 (refracción GlassView).
- [ ] Feed fluido en Android: scroll del feed de video sin caída de FPS perceptible con la barra encima (intensidad de blur reducida sobre el feed si hace falta).
- [ ] Suite E2E Maestro (`run-e2e.sh`) sigue verde — la navegación por tabs no se rompió con el `tabBar` custom.
- [ ] Build 1.0.2 generado con EAS y distribuido/instalado por los testers (el release cierra dentro de la tarea).

## Dependencias
- Código a reusar (rutas reales): `mobile/app/(protected)/(tabs)/_layout.tsx` (`tab_icon`, `PublishTabButton`, variantes de barra), `mobile/src/theme/theme.ts` (colors, radii `r_pill`, shadows), `mobile/src/features/map/components/MapSearchBar.tsx` y `PropertyMiniCard.tsx` (patrón BlurView de referencia).
- Dep nueva: `expo-glass-effect` — **compatibilidad verificada** (2026-07-11): la librería se versiona junto al SDK de Expo y tiene línea estable `56.0.x` (última `56.0.4`) → compatible con SDK 56. Instalar con `pnpm add expo-glass-effect` (pnpm resolverá la 56.x acorde al SDK).
- **Rebuild obligatorio** (EAS build Android APK + iOS) tras instalar la dep nativa; no llega por OTA.

## Edge cases / riesgos
- **Rebuild + version bump obligatorio (no OTA):** los testers deben **reinstalar** (Android APK / TestFlight). Rompe el flujo ágil de OTA de la beta; hay que coordinarlo. Precedente `expo-linear-gradient`: no probar en el dev-client actual sin recompilar.
- **Compatibilidad `expo-glass-effect` ↔ SDK 56 / RN 0.85 / New Architecture:** GlassView apunta a iOS 26+ y librerías recientes; puede no soportar SDK 56 o requerir config plugin. Verificar contra `https://docs.expo.dev/versions/v56.0.0/` (regla `mobile/AGENTS.md`) antes de comprometer.
- **Rendimiento de blur sobre video en Android:** `BlurView` sobre el feed en reproducción puede costar FPS en gama media (el feed ya es pesado). Posible mitigación: intensidad reducida u overlay sólido semi-translúcido en Android sobre el feed.
- **Divergencia visual iOS vs Android:** iOS 26+ tendrá refracción; Android solo frosted → dos experiencias distintas. Decidir la fidelidad mínima aceptable del fallback.
- **Divergencia del mockup canónico:** la barra anclada del mockup deja de ser fuente de verdad para esta pantalla; sin registro, futuras tareas pueden "corregir" hacia el mockup viejo.
- **iOS en la demo:** confirmar si iOS entra en la demo cerrada; si es Android-first, la refracción real (iOS 26+) puede no verse en la demo y el esfuerzo del rebuild recaería solo en el frosted.

## Plan de pruebas (alto nivel)
Footprint: `mobile/app/(protected)/(tabs)/_layout.tsx` + posible `mobile/src/components/GlassTabBar.tsx` → **componentes/navegación = NO crítico** por la regla determinista de CLAUDE.md §5 (no toca `lib/`, `hooks/`, `utils/`, `validation`, Edge Functions ni migraciones). **Verificación ligera:** `pnpm tsc --noEmit` + `pnpm lint` + smoke visual en emulador **por CLI** (adb/simctl screenshot; nunca computer-use). No hay tests existentes de la tab bar (solo `protected-layout.test.tsx`/`admin-layout.test.tsx` cubren redirección de auth, no la barra). Verificación real requiere el **build reconstruido** (el dev-client actual no tiene el módulo nativo).

## Impacto en PRD (solo referencia — NO se edita)
n/a — mejora visual, no feature de producto nueva; no toca `docs/PRD-MVP-demo.md`.

## Decisiones del intake  (2026-07-11, todas resueltas con el dueño)
- Vía técnica del glass: `expo-glass-effect` + fallback `expo-blur` — **decidida por el dueño** (quiere refracción real, aceptó el costo vs ponytail).
- Set de tabs y comportamiento (FAB, slot compartido, variantes) — **se conserva** tal cual.
- **Alcance iOS:** sí entra en la demo cerrada → la refracción real de GlassView se justifica.
- **Release:** la tarea INCLUYE el rebuild — `version` 1.0.1→1.0.2 + `eas build` (Android + iOS) + distribución a testers. No cierra por OTA.
- **Fallback Android:** BlurView + tint + overlay + borde highlight (patrón MapSearchBar/PropertyMiniCard), con intensidad reducida sobre el feed de video.
- **Divergencia del mockup:** se registra en el vault (`design-system.md`): la tabbar anclada del mockup queda obsoleta para esta pantalla; este doc es la nueva referencia. NO se actualiza el HTML ni se hace preview aprobable.
- **Íconos inactivos:** `bold` → `regular` (activo sigue `fill`).
- **Tokens de glass:** viven en `theme.ts` (design system), no locales al componente.
- **Compatibilidad de la dep:** verificada — `expo-glass-effect@56.0.4` empareja con Expo SDK 56.
- **Criterios de cierre:** visual OK en ambas plataformas (por CLI), feed fluido en Android, E2E Maestro verde, build distribuido a testers.

## Promoción / descarte
**APROBADA** (2026-07-11) → promovida a la tarea **#65** de Taskmaster (prioridad media, tag `master`). La tarea **incluye rebuild + version bump 1.0.2 + distribución a testers** (no cierra por OTA). Reporte de complejidad: `.taskmaster/reports/exploracion-035-complexity.json`. Siguiente paso: `/tm-plan 65`.
