/**
 * /publish/step1 — Paso 1 del wizard de publicación (5 pasos, 73.3).
 * Selección de tipo de operación (SOLO — property_type se movió a step2).
 *
 * Origen: subtarea 8.2 (creó este screen con operación+propiedad juntos).
 * 73.3 lo divide: step1 = operación, step2 = propiedad.
 *
 * El layout padre (_layout.tsx) ya provee:
 *   - PublishFormProvider  (contexto compartido entre los 5 pasos)
 *   - WizardHeader         (StepIndicator persistente, se actualiza reactivamente)
 *   - Stack headerShown:false
 *
 * Este screen solo es responsable de:
 *   1. Mostrar las opciones de operación como cards seleccionables.
 *   2. Escribir al contexto via update().
 *   3. Validar con validate_step1 y navegar a step2 si es válido.
 */
import React, { useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { usePublishForm } from '@/features/publish/store/PublishFormContext';
import { validate_step1 } from '@/features/publish/validation';
import { SelectionCard } from '@/features/publish/components/SelectionCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import type { OperationType } from '@/features/publish/store/types';

// ---------------------------------------------------------------------------
// Opciones — valores de DB con etiquetas en español
// ---------------------------------------------------------------------------

const OPERATION_OPTIONS: { value: OperationType; label: string }[] = [
  { value: 'rent', label: 'Renta' },
  { value: 'sale', label: 'Venta' },
  { value: 'both', label: 'Ambos' },
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function Step1Screen() {
  // #143.6: barra de navegación por botones de Android tapaba el CTA
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, update } = usePublishForm();

  // Derivado reactivo: el botón se habilita cuando hay operation_type.
  const { valid } = validate_step1(state);

  const handle_operation_press = useCallback(
    (value: OperationType) => {
      update({ operation_type: value });
    },
    [update],
  );

  const handle_next = useCallback(() => {
    if (!valid) return;
    router.push('/publish/step2');
  }, [valid, router]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scroll_content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Encabezado de pantalla ─────────────────────────────────── */}
        <View style={styles.page_header}>
          <Text style={styles.page_title}>¿Qué vas a publicar?</Text>
          <Text style={styles.page_subtitle}>
            Selecciona el tipo de operación.
          </Text>
        </View>

        {/* ── Sección: Tipo de operación ─────────────────────────────── */}
        <Text style={styles.section_label}>Tipo de operación</Text>
        {/* ponytail: row en vez de grid — solo 3 opciones siempre caben en una fila */}
        <View style={styles.row_group}>
          {OPERATION_OPTIONS.map(({ value, label }) => (
            <View key={value} style={styles.row_item}>
              <SelectionCard
                label={label}
                selected={state.operation_type === value}
                onPress={() => handle_operation_press(value)}
              />
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── Botón Siguiente (fijo al fondo) ───────────────────────────── */}
      <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
        <PrimaryButton
          label="Siguiente"
          onPress={handle_next}
          surface="light"
          disabled={!valid}
        />
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — utilitaria/clara (#FAFAF8), consistente con la app
// ---------------------------------------------------------------------------

const COLOR_BG = '#FAFAF8';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR_BG,
  },
  scroll: {
    flex: 1,
  },
  scroll_content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },

  // ── Encabezado ──────────────────────────────────────────────────────────
  page_header: {
    marginBottom: 28,
  },
  page_title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLOR_TEXT_PRIMARY,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  page_subtitle: {
    fontSize: 14,
    color: COLOR_TEXT_SECONDARY,
    lineHeight: 20,
  },

  // ── Sección label ────────────────────────────────────────────────────────
  section_label: {
    fontSize: 12,
    fontWeight: '700',
    color: COLOR_TEXT_SECONDARY,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // ── Fila de 3 (operación) ────────────────────────────────────────────────
  row_group: {
    flexDirection: 'row',
    gap: 10,
  },
  row_item: {
    flex: 1,
  },

  // ── Botón ────────────────────────────────────────────────────────────────
  cta_area: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLOR_BG,
    // Sombra ligera para separar del scroll
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
});
