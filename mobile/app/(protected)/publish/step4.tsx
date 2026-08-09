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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { usePublishForm } from '@/features/publish/store/PublishFormContext';
import { PrimaryButton } from '@/components/PrimaryButton';

// ---------------------------------------------------------------------------
// Tokens (alineados con step1/step2/step3)
// ---------------------------------------------------------------------------

const COLOR_BG = '#FAFAF8';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_INPUT_BG = '#FFFFFF';
const COLOR_HINT = '#9CA3AF';
const COLOR_ACCENT = '#1A5E44'; // SALVIA

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function Step4Screen() {
  const router = useRouter();
  const { state, update } = usePublishForm();

  const handle_description_change = useCallback(
    (text: string) => update({ description: text }),
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

          {/* ── Características (niche toggles) ─────────────────────── */}
          <Text style={[styles.section_label, styles.section_gap]}>
            Características
          </Text>
          <View style={styles.toggles_card}>
            <View style={styles.toggle_row}>
              <Text style={styles.toggle_label}>Acepta mascotas</Text>
              <Switch
                value={state.pet_friendly}
                onValueChange={(value) => update({ pet_friendly: value })}
                trackColor={{ false: COLOR_BORDER, true: COLOR_ACCENT }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Acepta mascotas"
              />
            </View>
            <View style={styles.toggle_divider} />
            <View style={styles.toggle_row}>
              <Text style={styles.toggle_label}>Sin aval / fiador</Text>
              <Switch
                value={state.allows_no_guarantor}
                onValueChange={(value) => update({ allows_no_guarantor: value })}
                trackColor={{ false: COLOR_BORDER, true: COLOR_ACCENT }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Sin aval o fiador"
              />
            </View>
            <View style={styles.toggle_divider} />
            <View style={styles.toggle_row}>
              <Text style={styles.toggle_label}>Apto estudiantes</Text>
              <Switch
                value={state.student_friendly}
                onValueChange={(value) => update({ student_friendly: value })}
                trackColor={{ false: COLOR_BORDER, true: COLOR_ACCENT }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Apto para estudiantes"
              />
            </View>
          </View>

          {/* Espacio final para que el contenido no quede bajo el botón */}
          <View style={styles.bottom_spacer} />
        </ScrollView>

        {/* ── Botón Siguiente (fijo al fondo) ───────────────────────────── */}
        <View style={styles.cta_area}>
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

  // ── Toggles niche ────────────────────────────────────────────────────────
  toggles_card: {
    backgroundColor: COLOR_INPUT_BG,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 12,
    overflow: 'hidden',
  },
  toggle_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  toggle_label: {
    fontSize: 15,
    color: COLOR_TEXT_PRIMARY,
    flex: 1,
  },
  toggle_divider: {
    height: 1,
    backgroundColor: COLOR_BORDER,
    marginHorizontal: 14,
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
