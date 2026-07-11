/**
 * Tabs navigator — grupo (tabs) dentro de (protected).
 * Expo Router SDK 56: el grupo (tabs) es transparente a la URL,
 * por lo que `/` sigue resolviendo a (protected)/(tabs)/index.
 *
 * Split por plataforma (#65.10, decisión del dueño 2026-07-11 4ª ronda):
 * iOS usa `NativeTabs` de expo-router (UITabBar 100% nativo — liquid glass y
 * lupa/morphing de selección genuinos de Apple); Android conserva la
 * GlassTabBar pill custom (#65.3-#65.9) TAL CUAL, sin tocar. "Cada
 * plataforma su mejor versión" — no es un fallback, es la vía elegida a
 * propósito por SO. Las MISMAS 6 rutas (index, map, publish, crm, saved,
 * profile) alimentan ambos navigators; solo cambia el componente que las
 * envuelve. El detalle de cada uno vive en su propio archivo (creció
 * demasiado para un solo _layout.tsx legible):
 *   - `@/components/AndroidTabsLayout` — `<Tabs tabBar={GlassTabBar}>`,
 *     FAB de publicar, slots/roles, íconos Phosphor por componente.
 *   - `@/components/IosNativeTabsLayout` — `<NativeTabs>`, íconos Phosphor
 *     rasterizados a PNG, [+] vía trigger `disabled` + listener de
 *     `tabPress`, slot 4 vía `hidden`.
 */
import { Platform } from 'react-native';

import { AndroidTabsLayout } from '@/components/AndroidTabsLayout';
import { IosNativeTabsLayout } from '@/components/IosNativeTabsLayout';

export default function TabsLayout() {
  return Platform.OS === 'ios' ? <IosNativeTabsLayout /> : <AndroidTabsLayout />;
}
