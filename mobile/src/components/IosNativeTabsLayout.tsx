/**
 * IosNativeTabsLayout.tsx — navigator de tabs para iOS (#65.10, split por
 * plataforma).
 *
 * Decisión del dueño (2026-07-11, 4ª ronda): en iOS usamos el `UITabBar`
 * 100% nativo vía `NativeTabs` de expo-router (liquid glass y "lupa"/morphing
 * de selección genuinos de Apple, no la reimplementación con GlassView de
 * GlassTabBar.tsx) en vez de portar la pill custom. "Cada plataforma su
 * mejor versión" — Android sigue con GlassTabBar (AndroidTabsLayout.tsx),
 * sin tocar esa pieza.
 *
 * Import: `expo-router/unstable-native-tabs` — verificado en
 * node_modules/expo-router@56.2.11: NO existe un subpath estable
 * `expo-router/native-tabs` en esta versión (el `package.json` de
 * expo-router no declara "exports", así que Node resuelve por archivo
 * literal; solo hay `unstable-native-tabs.{js,d.ts}` en la raíz del
 * paquete, que reexporta `build/native-tabs/*`). El nombre "unstable" es
 * la única vía real hoy — no hay alias estable que ignorar.
 *
 * Íconos Phosphor rasterizados a PNG (@1x/2x/3x en mobile/assets/tab-icons/,
 * receta qlmanage + sips — ver memoria `svg_to_png_qlmanage`): NativeTabs no
 * acepta componentes React como ícono (a diferencia de Tabs/tabBarIcon), solo
 * SF Symbols, xcassets, drawables o `src` con ImageSourcePropType. Los SVG de
 * phosphor-react-native no vienen como archivo (son <Path d="..."/> inline en
 * node_modules/phosphor-react-native/src/defs/<Icono>.tsx) — se extrajeron
 * esos `d` literalmente a .svg propios y se rasterizaron. `renderingMode=
 * "template"` (Icon prop, no NativeTabs-level) fuerza que iOS tiña el PNG
 * negro con el color de la tab (activa/inactiva) en vez de pintarlo negro
 * sólido — así no hace falta generar variantes de color.
 *
 * Slot [+] de publicar: NO puede sobresalir como FAB en un UITabBar nativo.
 * Opción elegida (confirmada en los tipos, NativeTabTrigger.d.ts +
 * NativeBottomTabsNavigator.js:110-124): `disabled` en el Trigger suprime SOLO
 * la selección nativa (el tab nunca queda "activo", nunca navega) pero el
 * evento `tabPress` se sigue emitiendo (`isPrevented: true`, pero el evento
 * llega) — se engancha con `listeners.tabPress` para empujar el wizard. Es la
 * opción (a) del brief (interceptar el press), NO la (b) (redirect vía
 * useFocusEffect) — no hizo falta esa alternativa.
 * `canPreventDefault` es `false` en el evento `tabPress` de NativeTabs (a
 * diferencia de JS Tabs) — confirmado en types.d.ts — por eso la vía es
 * `disabled`, no un intento de `preventDefault()`.
 *
 * Slot 4 por rol (Leads agente / Guardados no-agente): `hidden` en el
 * Trigger — mismo prop que `NativeTabTrigger.hidden`, semántica idéntica a
 * `href:null` en AndroidTabsLayout (el tab desaparece de la barra y no es
 * navegable). Es seguro fijarlo desde el primer render: `useAuth()` ya
 * garantiza `user.role` resuelto antes de que (protected)/(tabs) monte
 * (context.tsx carga el profile ANTES de bajar `isLoading`, ver
 * ProtectedLayout) — no hay un segundo render con `is_agent` distinto que
 * dispare el remount que advierte la doc de NativeTabs.
 *
 * Apariencia: SIN blurEffect/backgroundColor/colorScheme explícitos —
 * "dejar al sistema hacer su trabajo" (el liquid glass de iOS 26+ y la
 * variante dark/light del UITabBar siguen el userInterfaceStyle del
 * dispositivo). Limitación real vs. GlassTabBar: GlassTabBar fuerza la
 * variante oscura/clara POR PANTALLA (feed oscuro vs. gestión clara),
 * NativeTabs no expone ese control (no hay prop de colorScheme por
 * NativeTabs a diferencia de GlassView) — la barra sigue el modo del
 * SISTEMA, no el de la pantalla activa. Se documenta como límite conocido,
 * no se fuerza un workaround (fuera de alcance de esta subtarea).
 * `tintColor` = verde de marca para el estado seleccionado; el resto
 * (ícono/label inactivos) queda en los grises dinámicos del sistema.
 * `minimizeBehavior="onScrollDown"` (iOS 26+, referencia WhatsApp) — trivial,
 * activado.
 */
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useRouter } from 'expo-router';

import { colors } from '@/theme/theme';
import { useAuth } from '@/features/auth/context';

const icons = {
  feed: {
    default: require('../../assets/tab-icons/house-line-regular.png'),
    selected: require('../../assets/tab-icons/house-line-fill.png'),
  },
  map: {
    default: require('../../assets/tab-icons/map-pin-regular.png'),
    selected: require('../../assets/tab-icons/map-pin-fill.png'),
  },
  publish: {
    default: require('../../assets/tab-icons/plus-regular.png'),
    selected: require('../../assets/tab-icons/plus-fill.png'),
  },
  crm: {
    default: require('../../assets/tab-icons/ranking-regular.png'),
    selected: require('../../assets/tab-icons/ranking-fill.png'),
  },
  saved: {
    default: require('../../assets/tab-icons/bookmark-simple-regular.png'),
    selected: require('../../assets/tab-icons/bookmark-simple-fill.png'),
  },
  profile: {
    default: require('../../assets/tab-icons/user-circle-regular.png'),
    selected: require('../../assets/tab-icons/user-circle-fill.png'),
  },
} as const;

export function IosNativeTabsLayout() {
  const { user } = useAuth();
  const router = useRouter();
  const is_agent = user?.role === 'agent';

  return (
    <NativeTabs tintColor={colors.primary} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon src={icons.feed} renderingMode="template" />
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="map">
        <NativeTabs.Trigger.Icon src={icons.map} renderingMode="template" />
        <NativeTabs.Trigger.Label>Mapa</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/* [+] publicar — disabled: nunca se selecciona ni navega a la ruta
          dummy; el listener de tabPress (isPrevented sigue emitiendo el
          evento) empuja el wizard. Ver nota de cabecera. */}
      <NativeTabs.Trigger
        name="publish"
        disabled
        listeners={{ tabPress: () => router.push('/publish/step1') }}
      >
        <NativeTabs.Trigger.Icon src={icons.publish} renderingMode="template" />
        <NativeTabs.Trigger.Label hidden>Publicar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/* Slot 4 compartido — mismo criterio que href:null en AndroidTabsLayout. */}
      <NativeTabs.Trigger name="crm" hidden={!is_agent}>
        <NativeTabs.Trigger.Icon src={icons.crm} renderingMode="template" />
        <NativeTabs.Trigger.Label>Leads</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="saved" hidden={is_agent}>
        <NativeTabs.Trigger.Icon src={icons.saved} renderingMode="template" />
        <NativeTabs.Trigger.Label>Guardados</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon src={icons.profile} renderingMode="template" />
        <NativeTabs.Trigger.Label>Perfil</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
