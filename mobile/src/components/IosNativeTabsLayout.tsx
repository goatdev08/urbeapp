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
import { useAssets } from 'expo-asset';
import { useMemo } from 'react';
import { Image, type ImageSourcePropType } from 'react-native';

import { colors } from '@/theme/theme';
import { useAuth } from '@/features/auth/context';

/**
 * Íconos "se ven a veces sí, a veces no" en dev (fix 2026-08-08) — POR QUÉ este
 * archivo resuelve los PNG a archivo local en vez de pasar el `require` directo.
 *
 * `NativeTabs.Trigger.Icon src={...}` termina en
 * `convertOptionsIconToScreensPropsIcon` (expo-router/build/native-tabs/utils/
 * optionsIconConverter.ios.js) como `{ type: 'templateSource', templateSource:
 * <ImageSource> }`, que react-native-screens le entrega a la `UITabBar`. En un
 * dev-client ese ImageSource es una **URL http del asset server de Metro**, así
 * que la barra NATIVA tiene que salir a bajar cada ícono por red —
 * asíncronamente y **sin reintento**. Si esa descarga falla o pierde la carrera
 * contra el primer render (Metro reiniciando, la IP LAN vieja que el dev-client
 * cachea, un hipo de red), el slot se queda vacío PARA SIEMPRE: tab bar con
 * puros textos. De ahí que el síntoma sea intermitente y que "se arregle solo"
 * al relanzar. En un build Release no pasa: ahí el ImageSource ya es un archivo
 * del bundle.
 *
 * Fix: `useAssets` (expo-asset) descarga/resuelve los 12 PNG a `localUri`
 * (`file://…`) EN JS, y a la barra le entregamos `{ uri: <archivo local> }`. La
 * `UITabBar` deja de depender de una petición http propia. Funciona igual en
 * dev y en release (en release `localUri` ya apunta al recurso embebido), es
 * cambio solo de JS (viaja por OTA, sin recompilar) y **conserva los íconos
 * Phosphor** — decisión del dueño 2026-08-08 frente a la alternativa de migrar
 * a SF Symbols.
 *
 * Mientras `useAssets` resuelve (y si falla), se cae al `require` original: el
 * comportamiento de hoy, nunca peor. Android no necesita nada de esto — su
 * GlassTabBar dibuja componentes React de Phosphor, sin descargar nada.
 */
const ICON_SOURCES = {
  feed: {
    default: require('../../assets/tab-icons/house-line-regular.png'),
    selected: require('../../assets/tab-icons/house-line-fill.png'),
  },
  map: {
    // `map-pin-simple` (no la gota `map-pin`): mismo ícono que MapPinIcon y que
    // el tab de Android — decisión de Abraham 2026-08-16. Rasterizado con la
    // misma receta que el resto (path `d` de MapPinSimple.tsx → svg → qlmanage
    // + sips @1x/2x/3x); el tinte salvia del estado seleccionado lo sigue
    // poniendo `tintColor` + renderingMode="template", no el PNG.
    default: require('../../assets/tab-icons/map-pin-simple-regular.png'),
    selected: require('../../assets/tab-icons/map-pin-simple-fill.png'),
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

type IconKey = keyof typeof ICON_SOURCES;
type IconPair = { default: ImageSourcePropType; selected: ImageSourcePropType };

// El orden de la lista plana se DERIVA de ICON_SOURCES (no se escribe a mano)
// para que no pueda desincronizarse al agregar o mover un tab.
const ICON_KEYS = Object.keys(ICON_SOURCES) as IconKey[];
const ICON_MODULES = ICON_KEYS.flatMap((key) => [
  ICON_SOURCES[key].default,
  ICON_SOURCES[key].selected,
]);

function useLocalTabIcons(): Record<IconKey, IconPair> {
  const [assets, error] = useAssets(ICON_MODULES);

  if (error) {
    // No es fatal (abajo caemos al require original), pero silenciarlo dejaría
    // el síntoma "sin íconos" otra vez sin rastro en los logs — que es justo lo
    // que costó diagnosticar esto.
    console.warn('tab-icons: useAssets falló, se usa el require directo', error);
  }

  return useMemo(() => {
    const pairs = {} as Record<IconKey, IconPair>;
    ICON_KEYS.forEach((key, i) => {
      const fallback = ICON_SOURCES[key];
      pairs[key] = {
        default: to_local(fallback.default, assets?.[i * 2]?.localUri),
        selected: to_local(fallback.selected, assets?.[i * 2 + 1]?.localUri),
      };
    });
    return pairs;
  }, [assets]);
}

/**
 * Cambia SOLO la uri del source, conservando `width`/`height`/`scale` que RN ya
 * calculó para el módulo. Pasar un `{ uri }` pelón parece funcionar pero
 * **rompe el tamaño**: sin `scale`, iOS dibuja el PNG a su tamaño en píxeles
 * (un @3x sale 3× más grande, encima de las etiquetas) — visto en el smoke del
 * 2026-08-08 antes de este helper.
 */
function to_local(module_source: ImageSourcePropType, local_uri?: string | null): ImageSourcePropType {
  if (!local_uri) return module_source;
  const resolved = Image.resolveAssetSource(module_source);
  if (!resolved) return module_source;
  return { ...resolved, uri: local_uri };
}

export function IosNativeTabsLayout() {
  const { user } = useAuth();
  const router = useRouter();
  // `admin` es SUPERCONJUNTO de `agent` (#224) — ver nota en
  // AndroidTabsLayout.tsx; misma regla, mismo slot 4 compartido.
  const is_agent = user?.role === 'agent' || user?.role === 'admin';
  const icons = useLocalTabIcons();

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
