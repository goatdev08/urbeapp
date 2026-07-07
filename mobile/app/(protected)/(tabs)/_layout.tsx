/**
 * Tabs navigator — grupo (tabs) dentro de (protected).
 * Expo Router SDK 56: el grupo (tabs) es transparente a la URL,
 * por lo que `/` sigue resolviendo a (protected)/(tabs)/index.
 *
 * Composición canónica del mockup (urbea-identidad-visual.html, .tabbar):
 * Feed · Mapa · [+] · Leads(CRM) · Perfil. Para mantener 5 slots simétricos
 * (y el [+] centrado en posición 3/5) en TODOS los roles, el 4º slot se
 * comparte: Leads para agentes, Guardados para no-agentes. El rol que no lo usa
 * en la barra lo abre desde el menú del perfil (href:null). Con 4 slots el [+]
 * quedaba corrido a la derecha — este es el fix.
 *
 * El botón central [+] (tab-fab del mockup: 48×48, radio 16, verde primario,
 * sobresale −16px con borde del fondo) no es una pantalla: empuja el wizard
 * de publicación. La ruta dummy publish.tsx existe solo para reservar el slot.
 *
 * La barra tiene dos variantes (mockup líneas 374-383): oscura translúcida
 * sobre el feed inmersivo, clara sobre el resto. Se aplica por pantalla vía
 * tabBarStyle/tints; el FAB detecta la variante con useSegments.
 *
 * Íconos: Phosphor bold (fill en la tab activa) — sistema único de la app (#43).
 *
 * CRM tab: href=null oculta el tab de la barra para no-agentes.
 * La ruta crm.tsx añade un Redirect como segunda capa de seguridad.
 */
import { Tabs, useRouter, useSegments } from 'expo-router';
import { BookmarkSimple, HouseLine, type Icon, MapPin, Plus, Ranking, UserCircle } from 'phosphor-react-native';
import { Pressable, StyleSheet, View, type ColorValue, type ViewStyle } from 'react-native';

import { colors, shadows } from '@/theme/theme';
import { useAuth } from '@/features/auth/context';

// weight=fill en la tab activa, bold en las inactivas (convención #43).
// color llega como ColorValue de React Navigation; los tints de la barra son
// siempre hex strings, así que se estrecha a string para el prop de phosphor.
function tab_icon(IconCmp: Icon) {
  return function render({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <IconCmp size={size} color={color as string} weight={focused ? 'fill' : 'bold'} />;
  };
}

// Variantes de barra según el mockup: el feed es inmersivo oscuro, el resto claro.
const bar_dark: ViewStyle = {
  backgroundColor: 'rgba(18,15,11,0.94)',
  borderTopColor: 'rgba(255,255,255,0.08)',
};
const bar_light: ViewStyle = {
  backgroundColor: colors.paper,
  borderTopColor: colors.paper_3,
};

/** Opciones de barra por pantalla — variante oscura (feed) o clara (gestión). */
const dark_bar_options = {
  tabBarStyle: bar_dark,
  tabBarActiveTintColor: colors.primary_soft,
  tabBarInactiveTintColor: colors.silver_dk,
} as const;
const light_bar_options = {
  tabBarStyle: bar_light,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.gray_2,
} as const;

/**
 * Botón central de publicar — tab-fab del mockup. No navega a la ruta dummy:
 * empuja el wizard de publicación encima de las tabs.
 * El borde imita el "notch" del mockup: toma el color del fondo de la barra
 * activa (ink_feed sobre el feed, paper en gestión), detectado con useSegments.
 */
function PublishTabButton() {
  const router = useRouter();
  const segments = useSegments();
  // En el feed (ruta index) el último segmento es el propio grupo '(tabs)'.
  const on_feed = segments[segments.length - 1] === '(tabs)';

  return (
    // Wrapper flex:1 — ocupa el slot completo de la barra (tabBarButton
    // reemplaza al botón default, que traía flex:1).
    <View style={styles.fab_slot}>
      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { borderColor: on_feed ? colors.ink_feed : colors.paper },
          pressed && styles.fab_pressed,
        ]}
        onPress={() => router.push('/publish/step1')}
        accessibilityRole="button"
        accessibilityLabel="Publicar propiedad"
      >
        <Plus size={25} color={colors.on_primary} weight="bold" />
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  const { user } = useAuth();
  // ponytail: href:null oculta el tab; omitir la prop = visible normal.
  // exactOptionalPropertyTypes exige no asignar undefined a href, por eso
  // se construye el objeto de opciones condicionalmente.
  const is_agent = user?.role === 'agent';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Congela las pantallas fuera de foco (react-native-screens):
        // el MapView y el CRM no re-renderizan mientras no se ven.
        freezeOnBlur: true,
        ...light_bar_options,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Feed', tabBarIcon: tab_icon(HouseLine), ...dark_bar_options }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: 'Mapa', tabBarIcon: tab_icon(MapPin) }}
      />
      <Tabs.Screen
        name="publish"
        options={{
          title: '',
          tabBarButton: PublishTabButton,
        }}
      />
      <Tabs.Screen
        name="crm"
        options={{
          title: 'Leads',
          ...(is_agent ? {} : { href: null }),
          tabBarIcon: tab_icon(Ranking),
        }}
      />
      {/* Guardados ocupa el 4º slot SOLO para no-agentes — el mismo lugar donde
          el agente ve Leads. Así ambos roles tienen 5 slots simétricos y el [+]
          queda centrado (posición 3/5). Para agentes sale de la barra
          (href:null) y se abre desde el menú del perfil (mockup p12). */}
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Guardados',
          ...(is_agent ? { href: null } : {}),
          tabBarIcon: tab_icon(BookmarkSimple),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Perfil', tabBarIcon: tab_icon(UserCircle) }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fab_slot: {
    flex: 1,
    alignItems: 'center',
  },
  // tab-fab del mockup: 48×48, radio 16, sobresale −16px, borde 3px del fondo.
  fab: {
    marginTop: -16,
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 3,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.primary,
  },
  fab_pressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.9,
  },
});
