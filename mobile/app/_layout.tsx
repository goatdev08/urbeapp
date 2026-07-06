import { Stack } from 'expo-router';
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

  // Espera a que las tres familias carguen antes de montar la app.
  // ponytail: null simple (sin splash-screen) — suficiente para la demo.
  if (!sg_loaded || !hg_loaded || !outfit_loaded) return null;

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
            }}
          />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
