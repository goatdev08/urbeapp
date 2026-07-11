/**
 * AndroidTabsLayout.tsx — navigator de tabs para Android (#65.10, split por
 * plataforma).
 *
 * Contenido migrado tal cual desde `app/(protected)/(tabs)/_layout.tsx`
 * (pre-#65.10, ver historial de #65.3-#65.9): `<Tabs tabBar={GlassTabBar}>`
 * con la pill "liquid glass" custom, el FAB de publicar, el slot 4
 * compartido Leads/Guardados por rol, e íconos Phosphor (fill activo /
 * regular inactivo). NO se tocó nada de esta lógica en el split — decisión
 * del dueño (2026-07-11, 4ª ronda): Android conserva la GlassTabBar pill tal
 * cual quedó pulida en 65.7-65.9. Solo cambió el punto de entrada: antes era
 * el default export de `_layout.tsx`, ahora es este componente nombrado que
 * `_layout.tsx` invoca cuando `Platform.OS !== 'ios'`.
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
 * Íconos: Phosphor fill en la tab activa, regular en las inactivas (trazo
 * fino a propósito para la estética glass — ajuste sobre la convención #43,
 * decidido en el intake de la exploración 035).
 *
 * CRM tab: href=null oculta el tab de la barra para no-agentes.
 * La ruta crm.tsx añade un Redirect como segunda capa de seguridad.
 */
import { Tabs, useRouter, useSegments } from 'expo-router';
import { BookmarkSimple, HouseLine, type Icon, MapPin, Plus, Ranking, UserCircle } from 'phosphor-react-native';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { colors, shadows } from '@/theme/theme';
import { useAuth } from '@/features/auth/context';
import { GlassTabBar } from '@/components/GlassTabBar';

// weight=fill en la tab activa, regular en las inactivas (trazo fino, estética
// glass — ajuste sobre la convención #43 decidido en la exploración 035).
// color llega como ColorValue de React Navigation; GlassTabBar siempre pasa
// un hex string, así que se estrecha a string para el prop de phosphor.
function tab_icon(IconCmp: Icon) {
  return function render({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <IconCmp size={size} color={color as string} weight={focused ? 'fill' : 'regular'} />;
  };
}

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

export function AndroidTabsLayout() {
  const { user } = useAuth();
  // ponytail: href:null oculta el tab; omitir la prop = visible normal.
  // exactOptionalPropertyTypes exige no asignar undefined a href, por eso
  // se construye el objeto de opciones condicionalmente.
  const is_agent = user?.role === 'agent';

  return (
    <Tabs
      tabBar={GlassTabBar}
      screenOptions={{
        headerShown: false,
        // Congela las pantallas fuera de foco (react-native-screens):
        // el MapView y el CRM no re-renderizan mientras no se ven.
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Feed', tabBarIcon: tab_icon(HouseLine) }}
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
