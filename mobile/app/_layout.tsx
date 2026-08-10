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
import { release_splash, SPLASH_SAFETY_TIMEOUT_MS } from '@/lib/splash-gate';

// Mantiene el splash nativo (isotipo sobre verde de marca, ver app.config.js)
// visible mientras cargan las fuentes Y los servicios de arranque (#143.4):
// la liberación vive en splash-gate.ts y la disparan las pantallas de destino
// (login / LocationWall / LegalWall / feed con datos) — no las fuentes.
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

  // Techo de seguridad (#143.4): si ninguna pantalla libera el splash (deep
  // link a una ruta sin release explícito, servicio colgado), se suelta solo.
  useEffect(() => {
    const timer = setTimeout(release_splash, SPLASH_SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

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
