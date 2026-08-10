/**
 * /publish/step3 — Paso 3 del wizard de publicación (5 pasos, 73.3).
 * Detalles OBLIGATORIOS: precio, recámaras/baños/m² (opcionales dentro del
 * paso pero sin campo propio requerido), dirección + mapa, y el toggle de
 * visibilidad de precio (price_visible).
 *
 * Origen: subtarea 8.3/8.4/8.5/8.6 (creó este contenido como step2 viejo,
 * junto con descripción y amenidades). 73.3 lo divide:
 *   step3 = obligatorios (este archivo, price_visible nuevo)
 *   step4 = opcionales (descripción + amenidades, se mueven ahí)
 *
 * Validación del botón "Siguiente": validate_step3 completo
 * (price/address/lat/lng — price_visible es un toggle, nunca bloquea).
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { usePublishForm } from '@/features/publish/store/PublishFormContext';
import { validate_step3 } from '@/features/publish/validation';
import { AddressAutocomplete } from '@/features/publish/components/AddressAutocomplete';
import { MapPicker } from '@/features/publish/components/MapPicker';
import { NumericStepper } from '@/features/publish/components/NumericStepper';
import { PrimaryButton } from '@/components/PrimaryButton';

// ---------------------------------------------------------------------------
// Tokens (alineados con step1/step2)
// ---------------------------------------------------------------------------

const COLOR_BG = '#FAFAF8';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_INPUT_BG = '#FFFFFF';
const COLOR_HINT = '#9CA3AF';
const COLOR_ACCENT = '#1A5E44'; // SALVIA
const COLOR_ERROR = '#DC2626';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function Step3Screen() {
  // #143.6: barra de navegación por botones de Android tapaba el CTA
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, update } = usePublishForm();

  // Validación completa: price > 0, address, lat y lng presentes.
  const { valid, errors } = validate_step3(state);

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

  const handle_next = useCallback(() => {
    if (!valid) return;
    router.push('/publish/step4');
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

          {/* ── Visibilidad del precio (73.3, price_visible) ────────────── */}
          <View style={[styles.toggles_card, styles.section_gap]}>
            <View style={styles.toggle_row}>
              <View style={styles.toggle_label_col}>
                <Text style={styles.toggle_label}>Mostrar precio en el feed</Text>
                <Text style={styles.field_hint}>
                  Si lo ocultas, el precio solo se comparte por contacto directo.
                </Text>
              </View>
              <Switch
                value={state.price_visible}
                onValueChange={(value) => update({ price_visible: value })}
                trackColor={{ false: COLOR_BORDER, true: COLOR_ACCENT }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Mostrar precio en el feed"
              />
            </View>
          </View>

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

          {/* ── Dirección ─────────────────────────────────────────────── */}
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

          {/* ── Mapa ────────────────────────────────────────────────────────
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

          {/* Espacio final para que el contenido no quede bajo el botón */}
          <View style={styles.bottom_spacer} />
        </ScrollView>

        {/* ── Botón Siguiente (fijo al fondo) ───────────────────────────── */}
        <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
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

  // ── Toggles (price_visible) ─────────────────────────────────────────────
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
    gap: 12,
  },
  toggle_label_col: {
    flex: 1,
    gap: 2,
  },
  toggle_label: {
    fontSize: 15,
    color: COLOR_TEXT_PRIMARY,
    fontWeight: '500',
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
