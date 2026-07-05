/**
 * Tabs navigator — grupo (tabs) dentro de (protected).
 * Expo Router SDK 56: el grupo (tabs) es transparente a la URL,
 * por lo que `/` sigue resolviendo a (protected)/(tabs)/index.
 *
 * Tabs: Inicio + Guardados + Mapa + CRM (solo agentes) + Perfil (propio).
 * admin/ y publish/ siguen siendo rutas Stack fuera de tabs.
 *
 * Íconos: Phosphor bold (fill en la tab activa) — sistema único de la app (#43).
 *
 * CRM tab: href=null oculta el tab de la barra para no-agentes.
 * La ruta crm.tsx añade un Redirect como segunda capa de seguridad.
 */
import { Tabs } from 'expo-router';
import { Bookmarks, HouseLine, type Icon, MapPin, Ranking, UserCircle } from 'phosphor-react-native';
import type { ColorValue } from 'react-native';

import { useAuth } from '@/features/auth/context';

// weight=fill en la tab activa, bold en las inactivas (convención #43).
// color llega como ColorValue de React Navigation; los tints de la barra son
// siempre hex strings, así que se estrecha a string para el prop de phosphor.
function tab_icon(IconCmp: Icon) {
  return function render({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <IconCmp size={size} color={color as string} weight={focused ? 'fill' : 'bold'} />;
  };
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
        tabBarActiveTintColor: '#1a1a1a',
        tabBarInactiveTintColor: '#999',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Inicio', tabBarIcon: tab_icon(HouseLine) }}
      />
      <Tabs.Screen
        name="saved"
        options={{ title: 'Guardados', tabBarIcon: tab_icon(Bookmarks) }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: 'Mapa', tabBarIcon: tab_icon(MapPin) }}
      />
      <Tabs.Screen
        name="crm"
        options={{
          title: 'CRM',
          ...(is_agent ? {} : { href: null }),
          tabBarIcon: tab_icon(Ranking),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Perfil', tabBarIcon: tab_icon(UserCircle) }}
      />
    </Tabs>
  );
}
