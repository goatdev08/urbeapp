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
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { CompactStepper } from '@/features/publish/components/CompactStepper';
import { MapPicker } from '@/features/publish/components/MapPicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import type { Currency } from '@/features/publish/store/types';

// ---------------------------------------------------------------------------
// Formateo de precio con separador de miles (quick fix 2026-08-15) — el
// usuario solo teclea dígitos; se muestran agrupados (1,000 / 1,000,000) y el
// state guarda el número limpio.
// ---------------------------------------------------------------------------

function format_price_digits(digits: string): string {
  if (!digits) return '';
  return Number(digits).toLocaleString('en-US');
}

const CURRENCY_OPTIONS: Currency[] = ['MXN', 'USD'];

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

  // Quick fix 2026-08-15: los errores solo se PINTAN (borde rojo + mensaje por
  // campo) después de que el usuario intenta avanzar sin completar algo — no
  // al escribir/perder foco. Se resetea si vuelve a intentar y ya es válido.
  const [attempted_submit, set_attempted_submit] = useState(false);
  const show_errors = attempted_submit && !valid;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handle_price_change = useCallback(
    (text: string) => {
      // Solo dígitos — el separador de miles se agrega al mostrar, no lo teclea el usuario.
      const digits = text.replace(/[^0-9]/g, '');
      const num = digits ? Number(digits) : NaN;
      update({ price: Number.isFinite(num) && num > 0 ? num : null });
    },
    [update],
  );

  const handle_currency_change = useCallback(
    (next: Currency) => update({ currency: next }),
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

  const handle_half_bathrooms_change = useCallback(
    (next: number) => update({ half_bathrooms: next }),
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

  const handle_built_sqm_change = useCallback(
    (text: string) => {
      const clean = text.replace(/[^0-9.]/g, '');
      const num = parseFloat(clean);
      update({ built_square_meters: Number.isFinite(num) && num > 0 ? num : null });
    },
    [update],
  );

  const handle_next = useCallback(() => {
    if (!valid) {
      set_attempted_submit(true);
      return;
    }
    router.push('/publish/step4');
  }, [valid, router]);

  // ── Valores controlados (string para los TextInput numéricos) ─────────────

  const price_text = state.price !== null ? format_price_digits(String(state.price)) : '';
  const sqm_text = state.square_meters !== null ? String(state.square_meters) : '';
  const built_sqm_text =
    state.built_square_meters !== null ? String(state.built_square_meters) : '';

  return (
    <View style={styles.container}>
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
          <Text style={styles.section_label}>Precio</Text>
          <View style={styles.price_row}>
            <View
              style={[
                styles.input_row,
                styles.price_input_row,
                show_errors && errors.price && styles.input_row_error,
              ]}
            >
              <Text style={styles.currency_hint}>$</Text>
              <TextInput
                style={styles.price_input}
                value={price_text}
                onChangeText={handle_price_change}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={COLOR_HINT}
                returnKeyType="next"
                accessibilityLabel="Precio"
              />
            </View>
            {/* Selector de moneda — quick fix 2026-08-15, solo etiqueta (sin conversión) */}
            <View style={styles.currency_toggle}>
              {CURRENCY_OPTIONS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => handle_currency_change(c)}
                  style={[
                    styles.currency_option,
                    state.currency === c && styles.currency_option_active,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: state.currency === c }}
                  accessibilityLabel={`Moneda ${c}`}
                >
                  <Text
                    style={[
                      styles.currency_option_text,
                      state.currency === c && styles.currency_option_text_active,
                    ]}
                  >
                    {c}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {show_errors && errors.price ? (
            <Text style={styles.field_error}>{errors.price}</Text>
          ) : (
            <Text style={styles.field_hint}>
              Precio mensual si es renta · total si es venta.
            </Text>
          )}

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
          {/* Comparte CompactStepper con baños/medios baños para que la
              caja tenga el mismo tamaño; el segundo hueco del row queda
              vacío (mismo grid de 2 columnas, gap:10) en vez de estirar
              la caja de recámaras a todo el ancho. */}
          <View style={[styles.dimensions_row, styles.section_gap]}>
            <CompactStepper
              label="Recámaras"
              value={state.bedrooms}
              min={0}
              max={20}
              onChange={handle_bedrooms_change}
            />
            <View style={styles.dimension_col} />
          </View>

          {/* ── Baños + medios baños ─────────────────────────────────────── */}
          <View style={[styles.dimensions_row, styles.section_gap]}>
            <CompactStepper
              label="Baños"
              value={state.bathrooms}
              min={0}
              max={20}
              onChange={handle_bathrooms_change}
            />
            <CompactStepper
              label="Medios baños"
              value={state.half_bathrooms}
              min={0}
              max={5}
              onChange={handle_half_bathrooms_change}
            />
          </View>

          {/* ── Superficie: terreno + construida lado a lado ────────────── */}
          <View style={[styles.dimensions_row, styles.section_gap]}>
            <View style={styles.dimension_col}>
              <Text style={styles.section_label}>Terreno (m²)</Text>
              <TextInput
                style={styles.text_input}
                value={sqm_text}
                onChangeText={handle_sqm_change}
                keyboardType="numeric"
                placeholder="Ej. 85"
                placeholderTextColor={COLOR_HINT}
                returnKeyType="next"
                accessibilityLabel="Superficie de terreno en metros cuadrados"
              />
              <Text style={styles.field_hint}>Opcional</Text>
            </View>
            <View style={styles.dimension_col}>
              <Text style={styles.section_label}>Construida (m²)</Text>
              <TextInput
                style={styles.text_input}
                value={built_sqm_text}
                onChangeText={handle_built_sqm_change}
                keyboardType="numeric"
                placeholder="Ej. 65"
                placeholderTextColor={COLOR_HINT}
                returnKeyType="next"
                accessibilityLabel="Superficie construida en metros cuadrados"
              />
              <Text style={styles.field_hint}>Opcional</Text>
            </View>
          </View>

          {/* ── Dirección ─────────────────────────────────────────────── */}
          <Text style={[styles.section_label, styles.section_gap]}>
            Dirección
          </Text>
          <AddressAutocomplete
            value={state.address}
            onSelect={(address) => update({ address })}
            onPlaceSelected={(address, lat, lng) => update({ address, lat, lng })}
          />
          {show_errors && errors.address ? (
            <Text style={styles.field_error}>{errors.address}</Text>
          ) : (
            <Text style={styles.field_hint}>
              Escribe y selecciona de las sugerencias para fijar el pin, o ajusta el mapa.
            </Text>
          )}

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
          {show_errors && (errors.lat || errors.lng) && (
            <Text style={styles.field_error}>La ubicación en el mapa es requerida</Text>
          )}

          {/* Espacio final para que el contenido no quede bajo el botón */}
          <View style={styles.bottom_spacer} />
        </ScrollView>

        {/* ── Botón Siguiente (fijo al fondo) ───────────────────────────── */}
        <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
          <PrimaryButton label="Siguiente" onPress={handle_next} surface="light" />
        </View>
      </KeyboardAvoidingView>
    </View>
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
  price_row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
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
  price_input_row: {
    flex: 1,
  },
  input_row_error: {
    borderColor: COLOR_ERROR,
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

  // ── Selector de moneda (quick fix 2026-08-15) ─────────────────────────────
  currency_toggle: {
    flexDirection: 'row',
    height: 52,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 12,
    overflow: 'hidden',
  },
  currency_option: {
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currency_option_active: {
    backgroundColor: COLOR_ACCENT,
  },
  currency_option_text: {
    fontSize: 13,
    fontWeight: '600',
    color: COLOR_TEXT_SECONDARY,
  },
  currency_option_text_active: {
    color: '#FFFFFF',
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

  // ── Fila de 2 columnas (baños/medios baños, terreno/construida) ──────────
  dimensions_row: {
    flexDirection: 'row',
    gap: 10,
  },
  dimension_col: {
    flex: 1,
  },

  // ── Hint / error debajo del campo ─────────────────────────────────────────
  field_hint: {
    fontSize: 12,
    color: COLOR_HINT,
    marginTop: 4,
  },
  field_error: {
    fontSize: 12,
    color: COLOR_ERROR,
    marginTop: 4,
    fontWeight: '500',
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
