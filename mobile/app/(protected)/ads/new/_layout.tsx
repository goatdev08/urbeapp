/**
 * /ads/new/_layout.tsx — layout del wizard de alta de anuncio (subtarea 169.9).
 *
 * Cuelga del gate de capacidad ya construido en 169.8
 * (app/(protected)/ads/_layout.tsx — <Slot/> solo se monta con
 * can_advertise=true). Este layout calca la estructura del wizard de
 * publicación de propiedad (app/(protected)/publish/_layout.tsx, 8.1/73.3):
 *
 *   1. AdFormProvider — estado compartido entre los 5 pasos.
 *   2. WizardHeader    — StepIndicator persistente que lee la ruta activa.
 *   3. Stack           — navegación nativa entre pasos, sin header nativo.
 *
 * Techo de alcance (CLAUDE.md §8): sin mockup propio para "ads" (verificado
 * por el analista) — layout calcado del wizard de publicación, lenguaje
 * visual de theme.ts (identidad vigente, no los hex sueltos que
 * app/(protected)/publish/step*.tsx arrastra de antes de que theme.ts
 * existiera).
 *
 * 5 pasos: creativo (video) → título → CTA → zonas → resumen/enviar.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useSegments, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdFormProvider, useAdForm } from '@/features/ads/store/AdFormContext';
import { StepIndicator } from '@/components/StepIndicator';
import { BackButton } from '@/components/BackButton';
import { colors, spacing } from '@/theme/theme';

const TOTAL_STEPS = 5;

const STEP_MAP: Record<string, number> = {
  step1: 1,
  step2: 2,
  step3: 3,
  step4: 4,
  step5: 5,
};

function WizardHeader() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const segments = useSegments();
  // segments ej.: ['(protected)', 'ads', 'new', 'step1']
  const last_segment = segments[segments.length - 1] ?? '';
  const current_step = STEP_MAP[last_segment] ?? 1;

  // Mismo criterio que publish/_layout.tsx: en step1 el stack anidado no
  // burbujea el back al padre (gate de ads/), así que salimos explícitamente
  // hacia donde el usuario entró (perfil, típicamente).
  function handle_back() {
    if (current_step > 1) {
      router.back();
      return;
    }
    const parent = navigation.getParent();
    if (parent?.canGoBack()) parent.goBack();
    else if (router.canGoBack()) router.back();
  }

  return (
    <View style={[styles.wizard_header, { paddingTop: insets.top + spacing.s_8 }]}>
      <BackButton onPress={handle_back} />
      <View style={styles.wizard_indicator}>
        <StepIndicator current={current_step} total={TOTAL_STEPS} />
      </View>
      <View style={styles.wizard_spacer} />
    </View>
  );
}

// Resetea el form al salir del wizard — mismo criterio defensivo que
// CleanupOnUnmount en publish/_layout.tsx (el Provider vive dentro de este
// _layout y se desmonta al salir, así que reentrar = estado INITIAL nuevo).
function CleanupOnUnmount() {
  const { reset } = useAdForm();
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);
  return null;
}

export default function AdWizardLayout() {
  return (
    <AdFormProvider>
      <View style={styles.root}>
        <CleanupOnUnmount />
        <WizardHeader />
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </AdFormProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  wizard_header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    paddingHorizontal: spacing.s_16,
    paddingBottom: spacing.s_8,
  },
  wizard_indicator: {
    flex: 1,
  },
  wizard_spacer: {
    width: 40, // gemelo del BackButton (40x40) → centra el StepIndicator
  },
});
