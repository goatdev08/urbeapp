import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  SpaceGrotesk_600SemiBold,
  useFonts as useSpaceGrotesk,
} from '@expo-google-fonts/space-grotesk';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
  useFonts as useHankenGrotesk,
} from '@expo-google-fonts/hanken-grotesk';
import {
  Outfit_600SemiBold,
  useFonts as useOutfit,
} from '@expo-google-fonts/outfit';

import { AuthProvider } from '@/features/auth/context';

// Mantiene el splash nativo (isotipo sobre verde de marca, ver app.config.js)
// visible mientras cargan las fuentes — sin flash blanco de arranque.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Carga fuentes del design system (kit 003 — subtarea #16.3)
  const [sg_loaded] = useSpaceGrotesk({ SpaceGrotesk_600SemiBold });
  const [hg_loaded] = useHankenGrotesk({
    HankenGrotesk_400Regular,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
  });
  // Outfit: solo para el wordmark del logo final (#43.2) — login/branding.
  const [outfit_loaded] = useOutfit({ Outfit_600SemiBold });

  const fonts_loaded = sg_loaded && hg_loaded && outfit_loaded;

  // Suelta el splash nativo en cuanto las tres familias cargaron.
  useEffect(() => {
    if (fonts_loaded) void SplashScreen.hideAsync();
  }, [fonts_loaded]);

  // Mientras cargan, el splash nativo sigue en pantalla (preventAutoHideAsync).
  if (!fonts_loaded) return null;

  return (
    // GestureHandlerRootView requerido por react-native-gesture-handler (flex:1 preserva el layout)
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          {/* gestureEnabled + fullScreenGestureEnabled: swipe-back en iOS desde
              cualquier punto de la pantalla (no solo el borde) → volver al feed
              desde la carta de detalle con un gesto natural. Native-stack ignora
              fullScreenGestureEnabled en Android (no-op seguro). */}
          <Stack
            screenOptions={{
              headerShown: false,
              gestureEnabled: true,
              fullScreenGestureEnabled: true,
              // Transición intencional (150-300ms es el rango de micro-
              // interacción): las pantallas empujadas entran desde la derecha.
              animation: 'slide_from_right',
            }}
          />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
