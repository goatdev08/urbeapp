/**
 * GlassTabBar.tsx — tab bar custom "liquid glass" flotante (#65.3).
 *
 * Reemplaza el panel default de `<Tabs>` (cableado en #65.4) por una pill
 * flotante con vidrio por plataforma:
 *   - iOS 26+ (isLiquidGlassAvailable()): GlassView de expo-glass-effect,
 *     refracción real de Apple.
 *   - Android / iOS < 26: BlurView (expo-blur, experimentalBlurMethod=
 *     "dimezisBlurView" — ver #65.7) + overlay + borde highlight, mismo
 *     patrón que MapSearchBar.tsx / PropertyMiniCard.tsx.
 *
 * Import de expo-glass-effect ESTÁTICO (no require() defensivo): el paquete
 * es un <View/> plano en JS cuando el liquid glass no está disponible, no
 * crashea (a diferencia de expo-linear-gradient, que sí requiere el módulo
 * nativo presente en el build instalado). Ver .taskmaster/docs/exploraciones/
 * 035-tab-bar-glass-flotante.md.
 *
 * Tipos: BottomTabBarProps NO viene de '@react-navigation/bottom-tabs' (ese
 * paquete standalone no existe en este árbol) sino de 'expo-router/tabs',
 * que expo-router re-exporta desde su copia vendorizada de React Navigation
 * (verificado contra expo-router@56.2.11 build/react-navigation/bottom-tabs).
 *
 * Reuso deliberado (no duplicar lógica de _layout.tsx):
 *   - `options.tabBarIcon` / `options.tabBarButton` ya vienen definidos por
 *     cada <Tabs.Screen> en _layout.tsx (tab_icon(), PublishTabButton, el
 *     wrapper de expo-router que oculta tabs con href:null devolviendo null).
 *     GlassTabBar solo los invoca — no reimplementa el mapa de íconos ni el
 *     FAB de publicar.
 *   - Cada item se renderiza en su PROPIO componente (GlassTabBarItem, key
 *     por ruta) para que un tabBarButton custom con hooks (PublishTabButton
 *     usa useRouter/useSegments) tenga un fiber estable por ruta — mismo
 *     mecanismo que BottomTabItem de React Navigation (button(props) se
 *     invoca dentro de un componente persistido por route.key, nunca inline
 *     en un .map() del padre).
 *
 * Navegación: patrón estándar de tab bar custom (navigation.emit('tabPress')
 * + navigation.navigate si !defaultPrevented) — ver
 * https://reactnavigation.org/docs/custom-tab-bar (SDK 56 vigente, revisado
 * contra docs.expo.dev/versions/v56.0.0 por mobile/AGENTS.md).
 *
 * Variante oscura/clara: se decide por state.index → nombre de ruta activa
 * ('index' = feed), NO por useSegments (a diferencia de PublishTabButton en
 * _layout.tsx, que sí lo usa — aquí el estado de navegación ya lo trae la
 * prop `state`).
 *
 * ponytail: sin labels de texto — 5 slots en una pill angosta (insets
 *   horizontales de glass.pill_horizontal_inset a cada lado) no dejan
 *   espacio cómodo para ícono+label sin apretar; solo íconos, con
 *   accessibilityLabel para lectores de pantalla. Decisión visual, anotada
 *   en la bitácora de la subtarea.
 *
 * Lupa deslizante (#65.8, referencia: tab bar de WhatsApp iOS 26) — TabLens:
 * cápsula de vidrio que se desliza con spring hasta la tab activa. Mide la
 * geometría de cada tab REAL vía onLayout (GlassTabBarItem → handle_item_layout)
 * y anima x/y/width/height con Reanimated (mismo idioma que LikeButton.tsx:
 * withSpring para el asentamiento). Diseño ÚNICO en ambas plataformas
 * (dirección del dueño, 2026-07-11 2ª ronda): Android NO es un fallback
 * degradado — misma geometría/blur más intenso/rim, solo cambia el interior
 * (GlassView real en iOS 26+ vs. BlurView simulado en Android/iOS<26). La
 * lupa ignora el FAB de publicar y los slots ocultos (href:null) porque esos
 * nunca invocan on_layout (su rama es tabBarButton custom, no el Pressable
 * estándar) — no hace falta una lista de exclusión explícita.
 */

import React from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import type { BottomTabBarProps } from 'expo-router/tabs';

import { colors, glass, shadows, spacing } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

// BottomTabDescriptorMap no se re-exporta desde 'expo-router/tabs' (solo el
// subset público: BottomTabBarProps y compañía) — se deriva del propio prop.
type BottomTabDescriptorMap = BottomTabBarProps['descriptors'];

type GlassVariant = 'dark' | 'light';

/** Geometría de un tab item, medida vía onLayout, relativa al contenedor `row`. */
type TabItemLayout = { x: number; y: number; width: number; height: number };

const LENS_SPRING = { damping: glass.lens_spring_damping, stiffness: glass.lens_spring_stiffness };

// ─────────────────────────────────────────────────────────────────────────────
// Fondo de vidrio — split por plataforma/capacidad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capa de vidrio del pill, recortada por el contenedor padre (overflow:
 * hidden). No incluye el borde highlight — ese vive en el contenedor externo
 * para no clip-earlo junto con el FAB que sobresale (ver GlassTabBar).
 */
function GlassBackground({ variant }: { variant: GlassVariant }) {
  const is_dark = variant === 'dark';

  if (isLiquidGlassAvailable()) {
    // iOS 26+: refracción real de Apple (UIGlassEffect vía GlassView).
    //
    // Fix #65.9 (3ª ronda, feedback del dueño): la barra se veía OPACA en
    // iOS. Causa raíz diagnosticada en vivo (console.log temporal de
    // isLiquidGlassAvailable() + log stream del simulador, confirmado true):
    // `tintColor` con un hex SÓLIDO (colors.ink_feed/colors.paper) tiñe el
    // UIGlassEffect nativo con un color 100% opaco — Apple nunca tinta el
    // glass con sólidos (HIG: material puro + vibrancy). Fix: SIN tintColor.
    // `colorScheme` (prop nativa que hace overrideUserInterfaceStyle sobre el
    // UIVisualEffectView, ver GlassView.swift:230-235) reemplaza el tinte:
    // fuerza la variante dark/light del material del sistema — contraste
    // correcto sin tapar la refracción. Se eliminó también el overlay negro
    // extra que antes compensaba el tinte opaco (ya no hace falta con el
    // material real sin tapar).
    return (
      <GlassView
        style={StyleSheet.absoluteFill}
        glassEffectStyle="regular"
        colorScheme={is_dark ? 'dark' : 'light'}
      />
    );
  }

  // Android / iOS < 26: patrón BlurView + overlay, igual que
  // MapSearchBar.tsx:54-62 / PropertyMiniCard.tsx:79-86.
  //
  // experimentalBlurMethod="dimezisBlurView" (#65.7, feedback del dueño):
  // el método default de expo-blur en Android NO desenfoca — solo tiñe. Se
  // diagnosticó en vivo (adb screencap sobre Mapa/CRM): la mitad superior de
  // la pill (antes de la fila de íconos) refractaba el fondo con nitidez,
  // la mitad inferior (desde la fila de íconos) se veía lavada/opaca — una
  // franja/salto brusco justo a la altura de los íconos. dimezisBlurView usa
  // el blur real de Android (RenderEffect, API 31+; expo-blur cae de vuelta
  // al tinte plano en versiones viejas, sin crashear) y elimina el salto.
  // Costo de FPS: medido sobre el feed (video en reproducción) sin caída
  // perceptible — se mantiene blur_intensity_dark reducido (20 vs 30) como
  // margen adicional si un gama media lo necesita.
  const overlay_color = is_dark ? glass.overlay_dark : glass.overlay_light;
  const blur_intensity = is_dark ? glass.blur_intensity_dark : glass.blur_intensity_light;
  return (
    <>
      <BlurView
        tint={is_dark ? 'dark' : 'light'}
        intensity={blur_intensity}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: overlay_color }]} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lupa — cápsula de vidrio deslizante sobre la tab activa (#65.8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Relleno de vidrio de la cápsula (vive DENTRO del recorte del borde-rim,
 * ver TabLens). Mismo split de plataforma que GlassBackground, pero:
 *   - iOS 26+: glassEffectStyle="clear" + isInteractive — el estilo 'clear'
 *     es el que Apple reserva para controles que necesitan más contraste
 *     sobre el contenido (el propio indicador de selección de tab bar en
 *     apps de Apple lo usa); isInteractive agrega el shimmer especular al
 *     tocar, que es la referencia "lupa" del dueño.
 *   - Android / iOS < 26: blur ~2x más intenso que la pill base + overlay
 *     sutil — NO es un fallback degradado (dirección del dueño), es el
 *     mismo diseño simulado sin refracción física real.
 */
function LensGlass({ variant }: { variant: GlassVariant }) {
  const is_dark = variant === 'dark';

  if (isLiquidGlassAvailable()) {
    // `colorScheme` explícito (#65.9): sin él, 'auto' sigue el
    // userInterfaceStyle del sistema en vez de la variante local de la tab
    // bar — en el feed (dark) el estilo "clear" se veía blanco/lechoso
    // porque el material tomaba la apariencia clara del sistema, no la
    // oscura del feed. Mismo fix que GlassBackground.
    return (
      <GlassView
        style={StyleSheet.absoluteFill}
        glassEffectStyle="clear"
        isInteractive
        colorScheme={is_dark ? 'dark' : 'light'}
      />
    );
  }

  const blur_intensity = is_dark ? glass.lens_blur_intensity_dark : glass.lens_blur_intensity_light;
  const overlay_color = is_dark ? glass.lens_overlay_dark : glass.lens_overlay_light;
  return (
    <>
      <BlurView
        tint={is_dark ? 'dark' : 'light'}
        intensity={blur_intensity}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: overlay_color }]} />
    </>
  );
}

/**
 * Cápsula que se desliza (spring) hasta la tab activa. Geometría vive en
 * shared values animados desde `layout` (posición/tamaño medidos por
 * GlassTabBarItem vía onLayout, relativos a `row`) — sin layout aún, la
 * lupa queda con opacity 0 (evita el flash en x:0 antes del primer onLayout).
 *
 * Borde-rim con gradiente (destello arriba → transparente abajo): truco de
 * "padding border" — la vista externa pinta el gradiente de fondo con
 * borderRadius+overflow:hidden, la interna (inset por lens_border_width)
 * recorta el relleno de vidrio con un radio ligeramente menor.
 */
function TabLens({ variant, layout }: { variant: GlassVariant; layout: TabItemLayout | undefined }) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const opacity = useSharedValue(0);
  const has_measured = React.useRef(false);

  React.useEffect(() => {
    if (!layout) return;
    if (!has_measured.current) {
      // Primera medición: salta directo (sin spring) y aparece con fade.
      x.value = layout.x;
      y.value = layout.y;
      width.value = layout.width;
      height.value = layout.height;
      opacity.value = withTiming(1, { duration: glass.lens_fade_duration_ms });
      has_measured.current = true;
      return;
    }
    x.value = withSpring(layout.x, LENS_SPRING);
    y.value = withSpring(layout.y, LENS_SPRING);
    width.value = withSpring(layout.width, LENS_SPRING);
    height.value = withSpring(layout.height, LENS_SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout?.x, layout?.y, layout?.width, layout?.height]);

  const outer_style = useAnimatedStyle(() => {
    const inset = glass.lens_horizontal_inset;
    return {
      left: x.value + inset,
      top: y.value,
      width: Math.max(width.value - inset * 2, 0),
      height: height.value,
      borderRadius: height.value / 2,
      opacity: opacity.value,
    };
  });

  const inner_style = useAnimatedStyle(() => ({
    borderRadius: Math.max(height.value / 2 - glass.lens_border_width, 0),
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.lens_outer, outer_style]}>
      <LinearGradient
        colors={[glass.lens_rim_color_top, glass.lens_rim_color_bottom]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.lens_inner, inner_style]}>
        <LensGlass variant={variant} />
      </Animated.View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Item de tab — un componente por ruta (fiber estable para tabBarButton con hooks)
// ─────────────────────────────────────────────────────────────────────────────

interface GlassTabBarItemProps {
  descriptors: BottomTabDescriptorMap;
  route_key: string;
  route_name: string;
  focused: boolean;
  tint_active: string;
  tint_inactive: string;
  on_press: () => void;
  on_long_press: () => void;
  /**
   * Reporta la geometría (relativa a `row`) para la lupa. Solo se invoca en
   * la rama del Pressable estándar — el FAB de publicar y los slots ocultos
   * (href:null, tabBarButton custom devuelto por expo-router) NUNCA lo
   * reciben, por eso la lupa los ignora sin lógica extra de exclusión.
   */
  on_layout?: (route_key: string, layout: TabItemLayout) => void;
}

function GlassTabBarItem({
  descriptors,
  route_key,
  route_name,
  focused,
  tint_active,
  tint_inactive,
  on_press,
  on_long_press,
  on_layout,
}: GlassTabBarItemProps) {
  const descriptor = descriptors[route_key];
  if (!descriptor) return null;
  const { options } = descriptor;

  // tabBarButton custom: el FAB de publicar (PublishTabButton, siempre
  // presente en la ruta 'publish') o el wrapper que expo-router inyecta
  // cuando el Tabs.Screen tiene href:null (devuelve null → el slot
  // desaparece de la fila sin reservar espacio). Se invoca tal cual, sin
  // reimplementar su lógica.
  if (options.tabBarButton) {
    const render_button = options.tabBarButton;
    return (
      <>
        {render_button({
          children: null,
          onPress: on_press,
          onLongPress: on_long_press,
          accessibilityState: { selected: focused },
        })}
      </>
    );
  }

  const color = focused ? tint_active : tint_inactive;
  const label = typeof options.title === 'string' ? options.title : route_name;

  const handle_layout = on_layout
    ? (event: LayoutChangeEvent) => {
        const { x, y, width, height } = event.nativeEvent.layout;
        on_layout(route_key, { x, y, width, height });
      }
    : undefined;

  return (
    <Pressable
      onPress={on_press}
      onLongPress={on_long_press}
      onLayout={handle_layout}
      style={styles.tab_item}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
    >
      {options.tabBarIcon?.({ focused, color, size: 24 })}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fila de tabs + lupa — componente PROPIO (no inline en GlassTabBar).
 *
 * Necesario para la lupa (#65.8): React Navigation invoca `tabBar(props)`
 * como llamada de función plana dentro del render-prop de
 * `SafeAreaInsetsContext.Consumer` (ver expo-router/build/react-navigation/
 * bottom-tabs/views/BottomTabView.js:154 — `children: (insets) =>
 * tabBar({...})`), NO vía `createElement`/JSX. Esa posición nunca obtiene su
 * propio Fiber, así que cualquier hook llamado directamente en el cuerpo de
 * GlassTabBar (la función pasada como `tabBar`) rompe las Rules of Hooks con
 * "Invalid hook call" — confirmado en vivo (adb logcat) al agregar el
 * primer useState ahí para trackear la geometría de la lupa. Los hooks
 * DENTRO de un componente instanciado por JSX (GlassTabBarItem, TabLens, y
 * ahora GlassTabBarRow) sí son seguros, porque React sí les crea Fiber
 * propio. Fix: todo el estado nuevo (item_layouts) vive aquí, no en
 * GlassTabBar.
 */
function GlassTabBarRow({
  state,
  descriptors,
  navigation,
  variant,
  tint_active,
  tint_inactive,
}: {
  state: BottomTabBarProps['state'];
  descriptors: BottomTabDescriptorMap;
  navigation: BottomTabBarProps['navigation'];
  variant: GlassVariant;
  tint_active: string;
  tint_inactive: string;
}) {
  // Geometría de tabs REALES (no el FAB de publicar ni slots ocultos — esos
  // nunca llaman handle_item_layout, ver GlassTabBarItem). Estado plano en
  // vez de un ref: el cambio debe re-disparar el efecto de TabLens.
  const [item_layouts, set_item_layouts] = React.useState<Record<string, TabItemLayout>>({});
  const handle_item_layout = React.useCallback((route_key: string, layout: TabItemLayout) => {
    set_item_layouts((prev) => {
      const existing = prev[route_key];
      if (existing && existing.x === layout.x && existing.y === layout.y && existing.width === layout.width && existing.height === layout.height) {
        return prev;
      }
      return { ...prev, [route_key]: layout };
    });
  }, []);

  // La lupa nunca aplica a 'publish' (no navega, jamás queda focused) — este
  // guard es defensivo: si la ruta activa no tiene layout medido (porque es
  // un tabBarButton custom), simplemente no se le pasa geometría a TabLens.
  const active_route = state.routes[state.index];
  const active_layout = active_route ? item_layouts[active_route.key] : undefined;

  return (
    <View style={styles.row}>
      {/* Primer hijo del row → queda DEBAJO de los íconos en el stacking
          (los tabs se pintan después). Sin geometría medida aún, opacity 0. */}
      <TabLens variant={variant} layout={active_layout} />

      {state.routes.map((route, index) => {
        const focused = index === state.index;
        const on_press = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };
        const on_long_press = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        return (
          <GlassTabBarItem
            key={route.key}
            descriptors={descriptors}
            route_key={route.key}
            route_name={route.name}
            focused={focused}
            tint_active={tint_active}
            tint_inactive={tint_inactive}
            on_press={on_press}
            on_long_press={on_long_press}
            on_layout={handle_item_layout}
          />
        );
      })}
    </View>
  );
}

export function GlassTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  // `insets` ya viene garantizado (no opcional) en BottomTabBarProps — React
  // Navigation lo calcula para este árbol; no hace falta useSafeAreaInsets()
  // como red de seguridad (ponytail: evita un hook redundante y una
  // dependencia de que el árbol de test/preview monte SafeAreaProvider).
  //
  // GlassTabBar en sí NO usa hooks (ver nota en GlassTabBarRow arriba) — solo
  // deriva variant/tints, que son cálculos puros por render, no estado.
  const bottom_inset = insets.bottom;

  const active_route = state.routes[state.index];
  const variant: GlassVariant = active_route?.name === 'index' ? 'dark' : 'light';
  const is_dark = variant === 'dark';

  const tint_active = is_dark ? colors.primary_soft : colors.primary;
  const tint_inactive = is_dark ? colors.silver_dk : colors.gray_2;
  const border_color = is_dark ? glass.border_highlight_dark : glass.border_highlight_light;

  const container_style: ViewStyle = {
    position: 'absolute',
    left: glass.pill_horizontal_inset,
    right: glass.pill_horizontal_inset,
    bottom: bottom_inset + glass.pill_bottom_offset,
    borderRadius: glass.pill_radius,
    borderWidth: 1,
    borderColor: border_color,
  };

  return (
    <View style={[container_style, shadows.lg]}>
      {/* Capa de vidrio — recortada al radio del pill. Vive separada de la
          fila de tabs para que el FAB de publicar (sobresale hacia arriba,
          marginTop negativo en PublishTabButton) no quede clip-eado. */}
      <View style={[StyleSheet.absoluteFill, styles.glass_clip, { borderRadius: glass.pill_radius }]}>
        <GlassBackground variant={variant} />
      </View>

      <GlassTabBarRow
        state={state}
        descriptors={descriptors}
        navigation={navigation}
        variant={variant}
        tint_active={tint_active}
        tint_inactive={tint_inactive}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  glass_clip: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.s_8,
    paddingVertical: spacing.s_4,
  },
  tab_item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.s_8,
  },
  lens_outer: {
    position: 'absolute',
    overflow: 'hidden',
    padding: glass.lens_border_width,
  },
  lens_inner: {
    flex: 1,
    overflow: 'hidden',
  },
});
