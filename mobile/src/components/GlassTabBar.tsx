/**
 * GlassTabBar.tsx — tab bar custom "liquid glass" flotante (#65.3).
 *
 * Reemplaza el panel default de `<Tabs>` (cableado en #65.4) por una pill
 * flotante con vidrio por plataforma:
 *   - iOS 26+ (isLiquidGlassAvailable()): GlassView de expo-glass-effect,
 *     refracción real de Apple.
 *   - Android / iOS < 26: BlurView (expo-blur) + overlay + borde highlight,
 *     mismo patrón que MapSearchBar.tsx / PropertyMiniCard.tsx.
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
 */

import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { BottomTabBarProps } from 'expo-router/tabs';

import { colors, glass, shadows, spacing } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

// BottomTabDescriptorMap no se re-exporta desde 'expo-router/tabs' (solo el
// subset público: BottomTabBarProps y compañía) — se deriva del propio prop.
type BottomTabDescriptorMap = BottomTabBarProps['descriptors'];

type GlassVariant = 'dark' | 'light';

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
  const overlay_color = is_dark ? glass.overlay_dark : glass.overlay_light;

  if (isLiquidGlassAvailable()) {
    // iOS 26+: refracción real de Apple. Sobre el feed (dark) se mantiene un
    // tinte encima — sin él el contraste del texto/íconos claros cae contra
    // video en reproducción; decisión visual, ver bitácora de la subtarea.
    return (
      <>
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          tintColor={is_dark ? colors.ink_feed : colors.paper}
        />
        {is_dark && <View style={[StyleSheet.absoluteFill, { backgroundColor: overlay_color }]} />}
      </>
    );
  }

  // Android / iOS < 26: patrón BlurView + overlay, igual que
  // MapSearchBar.tsx:54-62 / PropertyMiniCard.tsx:79-86.
  const blur_intensity = is_dark ? glass.blur_intensity_dark : glass.blur_intensity_light;
  return (
    <>
      <BlurView tint={is_dark ? 'dark' : 'light'} intensity={blur_intensity} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: overlay_color }]} />
    </>
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

  return (
    <Pressable
      onPress={on_press}
      onLongPress={on_long_press}
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

export function GlassTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  // `insets` ya viene garantizado (no opcional) en BottomTabBarProps — React
  // Navigation lo calcula para este árbol; no hace falta useSafeAreaInsets()
  // como red de seguridad (ponytail: evita un hook redundante y una
  // dependencia de que el árbol de test/preview monte SafeAreaProvider).
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

      <View style={styles.row}>
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
            />
          );
        })}
      </View>
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
    paddingVertical: spacing.s_8,
  },
  tab_item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.s_12,
  },
});
