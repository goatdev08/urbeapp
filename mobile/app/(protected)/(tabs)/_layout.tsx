/**
 * Tabs navigator — grupo (tabs) dentro de (protected).
 * Expo Router SDK 56: el grupo (tabs) es transparente a la URL,
 * por lo que `/` sigue resolviendo a (protected)/(tabs)/index.
 *
 * Tabs iniciales: Inicio + Perfil (propio).
 * admin/ y publish/ siguen siendo rutas Stack fuera de tabs.
 *
 * ponytail: íconos inline como Text; @expo/vector-icons no está instalado.
 * Reemplazar con Ionicons cuando se añada al build nativo (tarea de branding #19).
 */
import { Tabs } from 'expo-router';
import { Text } from 'react-native';

function tab_icon(label: string) {
  return <Text style={{ fontSize: 20 }}>{label}</Text>;
}

export default function TabsLayout() {
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
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ focused }) => tab_icon(focused ? '👤' : '👤'),
        }}
      />
    </Tabs>
  );
}
