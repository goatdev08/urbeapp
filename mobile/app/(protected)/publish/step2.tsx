/**
 * /publish/step2 — Paso 2 del wizard de publicación.
 * Precio, detalles (recámaras, baños, m²) y descripción de la propiedad.
 *
 * Subtarea 8.3 — Build Step 2 base with price and property details inputs.
 *
 * ANCLAS PARA SUBTAREAS SIGUIENTES:
 *   8.4 → address autocomplete (busca el comentario "8.4: address autocomplete")
 *   8.5 → map picker            (busca el comentario "8.5: map picker")
 *   8.6 → niche toggles + validación final completa de step2
 *
 * Validación TEMPORAL del botón "Siguiente":
 *   Solo requiere price > 0.
 *   8.6 añadirá la comprobación de address/lat/lng (validate_step2 completo).
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
import { validate_step2 } from '@/features/publish/validation';
import { AddressAutocomplete } from '@/features/publish/components/AddressAutocomplete';
import { MapPicker } from '@/features/publish/components/MapPicker';
import { NumericStepper } from '@/features/publish/components/NumericStepper';
import { PrimaryButton } from '@/components/PrimaryButton';

// ---------------------------------------------------------------------------
// Tokens (alineados con step1 — paleta clara/gestión)
// ---------------------------------------------------------------------------

const COLOR_BG = '#FAFAF8';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_INPUT_BG = '#FFFFFF';
const COLOR_HINT = '#9CA3AF';
const COLOR_ACCENT = '#5A8A5E'; // SALVIA
const COLOR_ERROR = '#DC2626';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function Step2Screen() {
  const router = useRouter();
  const { state, update } = usePublishForm();

  // Validación completa (8.6): price > 0, address, lat y lng presentes.
  const { valid, errors } = validate_step2(state);

  // Mensajes de error deduplicados para mostrar al usuario.
  // lat y lng comparten el mismo texto — se colapsan en uno solo.
  const error_messages = (() => {
    const msgs: string[] = [];
    if (errors.price) msgs.push(errors.price);
    if (errors.address) msgs.push(errors.address);
    if (errors.lat || errors.lng) msgs.push('La ubicación en el mapa es requerida');
    return msgs;
  })();

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handle_price_change = useCallback(
    (text: string) => {
      // Acepta solo dígitos y un punto decimal; rechaza texto libre.
      const clean = text.replace(/[^0-9.]/g, '');
      const num = parseFloat(clean);
      update({ price: Number.isFinite(num) && num > 0 ? num : null });
    },
    [update],
  );

  const handle_bedrooms_change = useCallback(
    (next: number) => update({ bedrooms: next }),
    [update],
  );

  const handle_bathrooms_change = useCallback(
    (next: number) => update({ bathrooms: next }),
    [update],
  );

  const handle_sqm_change = useCallback(
    (text: string) => {
      const clean = text.replace(/[^0-9.]/g, '');
      const num = parseFloat(clean);
      update({ square_meters: Number.isFinite(num) && num > 0 ? num : null });
    },
    [update],
  );

  const handle_description_change = useCallback(
    (text: string) => update({ description: text }),
    [update],
  );

  const handle_next = useCallback(() => {
    if (!valid) return;
    router.push('/publish/step3');
  }, [valid, router]);

  // ── Valores controlados (string para los TextInput numéricos) ─────────────

  const price_text = state.price !== null ? String(state.price) : '';
  const sqm_text = state.square_meters !== null ? String(state.square_meters) : '';

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
            <Text style={styles.page_title}>Detalles de la propiedad</Text>
            <Text style={styles.page_subtitle}>
              Ingresa el precio y los datos principales.
            </Text>
          </View>

          {/* ── Precio ───────────────────────────────────────────────────── */}
          <Text style={styles.section_label}>Precio (MXN)</Text>
          <View style={styles.input_row}>
            <Text style={styles.currency_hint}>$</Text>
            <TextInput
              style={styles.price_input}
              value={price_text}
              onChangeText={handle_price_change}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={COLOR_HINT}
              returnKeyType="next"
              accessibilityLabel="Precio en pesos mexicanos"
            />
            <Text style={styles.currency_suffix}>MXN</Text>
          </View>
          {/* Hint de moneda contextual */}
          <Text style={styles.field_hint}>
            Precio mensual si es renta · total si es venta.
          </Text>

          {/* ── Recámaras ─────────────────────────────────────────────── */}
          <View style={[styles.stepper_row, styles.section_gap]}>
            <View style={styles.stepper_label_col}>
              <Text style={styles.section_label}>Recámaras</Text>
              <Text style={styles.field_hint}>Opcional</Text>
            </View>
            <NumericStepper
              value={state.bedrooms}
              min={0}
              max={20}
              onChange={handle_bedrooms_change}
              placeholder="0"
            />
          </View>

          {/* ── Baños ─────────────────────────────────────────────────── */}
          <View style={[styles.stepper_row, styles.section_gap]}>
            <View style={styles.stepper_label_col}>
              <Text style={styles.section_label}>Baños</Text>
              <Text style={styles.field_hint}>Opcional</Text>
            </View>
            <NumericStepper
              value={state.bathrooms}
              min={0}
              max={20}
              onChange={handle_bathrooms_change}
              placeholder="0"
            />
          </View>

          {/* ── Metros cuadrados ──────────────────────────────────────── */}
          <Text style={[styles.section_label, styles.section_gap]}>
            Superficie (m²)
          </Text>
          <TextInput
            style={styles.text_input}
            value={sqm_text}
            onChangeText={handle_sqm_change}
            keyboardType="numeric"
            placeholder="Ej. 85"
            placeholderTextColor={COLOR_HINT}
            returnKeyType="next"
            accessibilityLabel="Superficie en metros cuadrados"
          />
          <Text style={styles.field_hint}>Opcional</Text>

          {/* ── Descripción ───────────────────────────────────────────── */}
          <Text style={[styles.section_label, styles.section_gap]}>
            Descripción
          </Text>
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

          {/* ── 8.4: address autocomplete ─────────────────────────────── */}
          <Text style={[styles.section_label, styles.section_gap]}>
            Dirección
          </Text>
          <AddressAutocomplete
            value={state.address}
            onSelect={(address) => update({ address })}
            onPlaceSelected={(address, lat, lng) => update({ address, lat, lng })}
          />
          <Text style={styles.field_hint}>
            Escribe y selecciona de las sugerencias para fijar el pin, o ajústalo tocando el mapa.
          </Text>

          {/* ── 8.5: map picker ───────────────────────────────────────────
              Mapa interactivo — escribe update({ lat, lng }) solo al interactuar.
              Requiere dev build con módulo nativo de react-native-maps.
          ─────────────────────────────────────────────────────────────── */}
          <View style={styles.section_gap}>
            <MapPicker
              lat={state.lat}
              lng={state.lng}
              onLocationChange={(lat, lng) => update({ lat, lng })}
            />
          </View>

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
          {!valid && error_messages.length > 0 && (
            <View style={styles.errors_container}>
              <Text style={styles.errors_title}>Falta completar:</Text>
              {error_messages.map((msg) => (
                <Text key={msg} style={styles.error_item}>
                  {'•'} {msg}
                </Text>
              ))}
            </View>
          )}
          <PrimaryButton
            label="Siguiente"
            onPress={handle_next}
            surface="light"
            disabled={!valid}
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

  // ── Precio ───────────────────────────────────────────────────────────────
  input_row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLOR_INPUT_BG,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
  },
  currency_hint: {
    fontSize: 18,
    fontWeight: '600',
    color: COLOR_TEXT_SECONDARY,
    marginRight: 6,
  },
  price_input: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    padding: 0,
  },
  currency_suffix: {
    fontSize: 13,
    fontWeight: '500',
    color: COLOR_HINT,
    marginLeft: 6,
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

  // ── Stepper row ──────────────────────────────────────────────────────────
  stepper_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLOR_INPUT_BG,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  stepper_label_col: {
    gap: 2,
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

  // ── Errores sobre el botón ───────────────────────────────────────────────
  errors_container: {
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  errors_title: {
    fontSize: 12,
    fontWeight: '600',
    color: COLOR_ERROR,
    marginBottom: 4,
  },
  error_item: {
    fontSize: 12,
    color: COLOR_ERROR,
    lineHeight: 18,
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
