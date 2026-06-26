/**
 * Wizard layout de publicación de propiedades (Expo Router SDK 56).
 * Subtarea 8.1 — Create wizard layout with step indicator and navigation.
 *
 * Estructura de rutas:
 *   app/(protected)/publish/_layout.tsx  ← este archivo
 *   app/(protected)/publish/step1.tsx    (implementado en 8.2)
 *   app/(protected)/publish/step2.tsx    (implementado en 8.3)
 *   app/(protected)/publish/step3.tsx    (implementado en 8.8)
 *
 * El grupo (protected) ya aplica el guard de autenticación (ProtectedLayout).
 * Este layout solo añade:
 *   1. PublishFormProvider — estado compartido entre los 3 pasos.
 *   2. WizardHeader        — StepIndicator persistente que lee la ruta activa.
 *   3. Stack               — navegación nativa entre pasos, sin header nativo.
 *
 * useSegments() en WizardHeader se actualiza reactivamente al cambiar de paso;
 * el último segmento es 'step1' | 'step2' | 'step3'.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useSegments } from 'expo-router';

import { PublishFormProvider } from '@/features/publish/store/PublishFormContext';
import { StepIndicator } from '@/components/StepIndicator';

// ---------------------------------------------------------------------------
// Mapa segmento → número de paso
// ---------------------------------------------------------------------------

const STEP_MAP: Record<string, number> = {
  step1: 1,
  step2: 2,
  step3: 3,
};

// ---------------------------------------------------------------------------
// WizardHeader — lee la ruta activa y renderiza StepIndicator
// ---------------------------------------------------------------------------

function WizardHeader() {
  const segments = useSegments();
  // segments ej.: ['(protected)', 'publish', 'step1']
  const last_segment = segments[segments.length - 1] ?? '';
  const current_step = STEP_MAP[last_segment] ?? 1;

  return <StepIndicator current={current_step} total={3} />;
}

// ---------------------------------------------------------------------------
// PublishWizardLayout
// ---------------------------------------------------------------------------

export default function PublishWizardLayout() {
  return (
    <PublishFormProvider>
      <View style={styles.root}>
        {/* Indicador de progreso persistente sobre todos los pasos */}
        <WizardHeader />

        {/* Stack de navegación entre pasos — sin header nativo */}
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </PublishFormProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
