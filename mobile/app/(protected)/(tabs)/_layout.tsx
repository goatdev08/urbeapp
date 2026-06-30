/**
 * Tabs navigator — grupo (tabs) dentro de (protected).
 * Expo Router SDK 56: el grupo (tabs) es transparente a la URL,
 * por lo que `/` sigue resolviendo a (protected)/(tabs)/index.
 *
 * Tabs: Inicio + CRM (solo agentes) + Perfil (propio).
 * admin/ y publish/ siguen siendo rutas Stack fuera de tabs.
 *
 * ponytail: íconos inline como Text; @expo/vector-icons no está instalado.
 * Reemplazar con Ionicons cuando se añada al build nativo (tarea de branding #19).
 *
 * CRM tab: href=null oculta el tab de la barra para no-agentes.
 * La ruta crm.tsx añade un Redirect como segunda capa de seguridad.
 */
import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useAuth } from '@/features/auth/context';

function tab_icon(label: string) {
  return <Text style={{ fontSize: 20 }}>{label}</Text>;
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
        options={{
          title: 'Inicio',
          tabBarIcon: ({ focused }) => tab_icon(focused ? '🏠' : '🏠'),
        }}
      />
      <Tabs.Screen
        name="crm"
        options={{
          title: 'CRM',
          ...(is_agent ? {} : { href: null }),
          tabBarIcon: ({ focused }) => tab_icon(focused ? '📋' : '📋'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ focused }) => tab_icon(focused ? '👤' : '👤'),
        }}
      />
    </Tabs>
  );
}
