/**
 * /publish/step4 — Paso 4 del wizard de publicación (5 pasos, 73.3).
 * Detalles OPCIONALES: descripción y amenidades (pet_friendly,
 * allows_no_guarantor, student_friendly).
 *
 * Origen: subtarea 8.3/8.6 (descripción y toggles vivían en el step2 viejo,
 * junto con los campos obligatorios). 73.3 los separa a este paso nuevo.
 *
 * validate_step4 siempre es válido — este paso no tiene campos obligatorios
 * propios, así que "Siguiente" nunca se deshabilita.
 */
import React, { useCallback } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { usePublishForm } from '@/features/publish/store/PublishFormContext';
import { PrimaryButton } from '@/components/PrimaryButton';
import { FilterChipGroup } from '@/components/FilterChipGroup';

// ---------------------------------------------------------------------------
// Características — chips seleccionables (tarea #167, reemplaza los 3 Switch).
// Los 3 campos siguen siendo booleanos en PublishFormState/DB; el chip es
// solo la presentación (checked ↔ seleccionado).
// ---------------------------------------------------------------------------

const CHARACTERISTIC_OPTIONS = [
  { value: 'pet_friendly', label: 'Acepta mascotas' },
  { value: 'allows_no_guarantor', label: 'Sin aval / fiador' },
  { value: 'student_friendly', label: 'Apto estudiantes' },
];

// ---------------------------------------------------------------------------
// Tokens (alineados con step1/step2/step3)
// ---------------------------------------------------------------------------

const COLOR_BG = '#FAFAF8';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_INPUT_BG = '#FFFFFF';
const COLOR_HINT = '#9CA3AF';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function Step4Screen() {
  // #143.6: barra de navegación por botones de Android tapaba el CTA
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, update } = usePublishForm();

  const handle_description_change = useCallback(
    (text: string) => update({ description: text }),
    [update],
  );

  // Chips seleccionados — deriva los 3 booleanos a un array de values.
  const selected_characteristics = [
    state.pet_friendly && 'pet_friendly',
    state.allows_no_guarantor && 'allows_no_guarantor',
    state.student_friendly && 'student_friendly',
  ].filter((v): v is string => Boolean(v));

  const handle_characteristics_change = useCallback(
    (next: string[]) => {
      update({
        pet_friendly: next.includes('pet_friendly'),
        allows_no_guarantor: next.includes('allows_no_guarantor'),
        student_friendly: next.includes('student_friendly'),
      });
    },
    [update],
  );

  const handle_next = useCallback(() => {
    // validate_step4 siempre es válido — no hay guard de disabled aquí.
    router.push('/publish/step5');
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scroll_content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Encabezado de pantalla ─────────────────────────────────── */}
          <View style={styles.page_header}>
            <Text style={styles.page_title}>Cuéntanos más</Text>
            <Text style={styles.page_subtitle}>
              Descripción y características — todo opcional.
            </Text>
          </View>

          {/* ── Descripción ───────────────────────────────────────────── */}
          <Text style={styles.section_label}>Descripción</Text>
          <TextInput
            style={[styles.text_input, styles.textarea]}
            value={state.description}
            onChangeText={handle_description_change}
            placeholder="Describe la propiedad: características, condición, amenidades…"
            placeholderTextColor={COLOR_HINT}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            returnKeyType="default"
            accessibilityLabel="Descripción de la propiedad"
          />
          <Text style={styles.field_hint}>Opcional</Text>

          {/* ── Características (chips seleccionables, #167) ────────────── */}
          <Text style={[styles.section_label, styles.section_gap]}>
            Características
          </Text>
          <FilterChipGroup
            options={CHARACTERISTIC_OPTIONS}
            selected={selected_characteristics}
            onChange={handle_characteristics_change}
          />

          {/* Espacio final para que el contenido no quede bajo el botón */}
          <View style={styles.bottom_spacer} />
        </ScrollView>

        {/* ── Botón Siguiente (fijo al fondo) ───────────────────────────── */}
        <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
          <PrimaryButton
            label="Siguiente"
            onPress={handle_next}
            surface="light"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR_BG,
  },
  flex: {
    flex: 1,
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
    marginBottom: 8,
  },
  section_gap: {
    marginTop: 24,
  },

  // ── Campo genérico ───────────────────────────────────────────────────────
  text_input: {
    backgroundColor: COLOR_INPUT_BG,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: COLOR_TEXT_PRIMARY,
  },
  textarea: {
    minHeight: 100,
    paddingTop: 14,
  },

  // ── Hint debajo del campo ────────────────────────────────────────────────
  field_hint: {
    fontSize: 12,
    color: COLOR_HINT,
    marginTop: 4,
  },

  // ── CTA ──────────────────────────────────────────────────────────────────
  cta_area: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLOR_BG,
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
  },
  bottom_spacer: {
    height: 16,
  },
});
