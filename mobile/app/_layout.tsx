import { Stack } from 'expo-router';
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

import { AuthProvider } from '@/features/auth/context';

export default function RootLayout() {
  // Carga fuentes del design system (kit 003 — subtarea #16.3)
  const [sg_loaded] = useSpaceGrotesk({ SpaceGrotesk_600SemiBold });
  const [hg_loaded] = useHankenGrotesk({
    HankenGrotesk_400Regular,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
  });

  // Espera a que ambas familias carguen antes de montar la app.
  // ponytail: null simple (sin splash-screen) — suficiente para la demo.
  if (!sg_loaded || !hg_loaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
