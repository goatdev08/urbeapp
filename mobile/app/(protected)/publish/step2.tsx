/**
 * /publish/step2 — Paso 2 del wizard de publicación (5 pasos, 73.3).
 * Selección de tipo de propiedad (SOLO — antes vivía junto a operation_type
 * en el step1 viejo de la subtarea 8.2; 73.3 lo separa).
 *
 * El layout padre (_layout.tsx) ya provee:
 *   - PublishFormProvider  (contexto compartido entre los 5 pasos)
 *   - WizardHeader         (StepIndicator persistente, se actualiza reactivamente)
 *   - Stack headerShown:false
 *
 * Este screen solo es responsable de:
 *   1. Mostrar las opciones de tipo de propiedad como cards seleccionables.
 *   2. Escribir al contexto via update().
 *   3. Validar con validate_step2 y navegar a step3 si es válido.
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
import { validate_step2 } from '@/features/publish/validation';
import { SelectionCard } from '@/features/publish/components/SelectionCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import type { PropertyType } from '@/features/publish/store/types';

// ---------------------------------------------------------------------------
// Opciones — valores de DB con etiquetas en español
// ---------------------------------------------------------------------------

const PROPERTY_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: 'casa', label: 'Casa' },
  { value: 'departamento', label: 'Departamento' },
  { value: 'local', label: 'Local' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'terreno', label: 'Terreno' },
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function Step2Screen() {
  // #143.6: barra de navegación por botones de Android tapaba el CTA
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, update } = usePublishForm();

  // Derivado reactivo: el botón se habilita cuando hay property_type.
  const { valid } = validate_step2(state);

  const handle_property_press = useCallback(
    (value: PropertyType) => {
      update({ property_type: value });
    },
    [update],
  );

  const handle_next = useCallback(() => {
    if (!valid) return;
    router.push('/publish/step3');
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
          <Text style={styles.page_title}>¿Qué tipo de propiedad es?</Text>
          <Text style={styles.page_subtitle}>
            Selecciona el tipo de propiedad.
          </Text>
        </View>

        {/* ── Sección: Tipo de propiedad ────────────────────────────── */}
        <Text style={styles.section_label}>Tipo de propiedad</Text>
        {/* Grid de 2 columnas con wrap; 5 ítems → 2+2+1 */}
        <View style={styles.grid_group}>
          {PROPERTY_OPTIONS.map(({ value, label }) => (
            <View key={value} style={styles.grid_item}>
              <SelectionCard
                label={label}
                selected={state.property_type === value}
                onPress={() => handle_property_press(value)}
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

  // ── Grid de 2 columnas (propiedad) ───────────────────────────────────────
  grid_group: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  grid_item: {
    // ~50% del ancho disponible menos el gap
    width: '48%',
  },

  // ── Botón ────────────────────────────────────────────────────────────────
  cta_area: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLOR_BG,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
});
