/**
 * Wizard layout de publicación de propiedades (Expo Router SDK 56).
 * Subtarea 8.1 — Create wizard layout with step indicator and navigation.
 *
 * Estructura de rutas:
 *   app/(protected)/publish/_layout.tsx  ← este archivo
 *   app/(protected)/publish/step1.tsx
 *   app/(protected)/publish/step2.tsx
 *   app/(protected)/publish/step3.tsx
 *
 * 17.8 — edit mode:
 *   Cuando se navega con params.propertyId, se activa modo edición:
 *   FormPrefiller carga la propiedad y pre-llena el PublishFormContext.
 *
 * El grupo (protected) ya aplica el guard de autenticación (ProtectedLayout).
 * Este layout añade:
 *   1. PublishFormProvider — estado compartido entre los 3 pasos.
 *   2. WizardHeader        — StepIndicator persistente que lee la ruta activa.
 *   3. Stack               — navegación nativa entre pasos, sin header nativo.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useSegments, useLocalSearchParams } from 'expo-router';

import { PublishFormProvider, usePublishForm } from '@/features/publish/store/PublishFormContext';
import { useLoadProperty } from '@/features/publish/hooks/useLoadProperty';
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
// FormPrefiller — carga la propiedad en edit mode y pre-llena el contexto
// Solo se monta cuando hay propertyId (renderizado condicional en el padre).
// ponytail: componente hijo dentro del Provider para poder llamar usePublishForm.
// ---------------------------------------------------------------------------

function FormPrefiller({ property_id }: { property_id: string }) {
  const { update } = usePublishForm();
  const { formState, loading } = useLoadProperty(property_id);

  useEffect(() => {
    if (formState && !loading) {
      update(formState);
    }
  }, [formState, loading, update]);

  return null;
}

// ---------------------------------------------------------------------------
// PublishWizardLayout
// ---------------------------------------------------------------------------

export default function PublishWizardLayout() {
  const params = useLocalSearchParams<{ propertyId?: string }>();
  const property_id = params.propertyId ?? null;

  return (
    <PublishFormProvider>
      <View style={styles.root}>
        {/* Pre-llena el form en edit mode (sin render visible) */}
        {property_id !== null && <FormPrefiller property_id={property_id} />}

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
