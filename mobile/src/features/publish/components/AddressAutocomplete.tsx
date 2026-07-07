/**
 * AddressAutocomplete.tsx — Campo de dirección con autocompletado de Google Places.
 *
 * Subtarea 8.4 — Integrate Google Places API for address autocomplete.
 *
 * API usada: Places API (New) — POST https://places.googleapis.com/v1/places:autocomplete
 *   Header: X-Goog-Api-Key, Content-Type: application/json
 *   Body:   { input, includedRegionCodes: ['mx'] }
 *   Docs:   https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
 *
 * Degradación sin key: el TextInput sigue funcionando como campo libre;
 *   no muestra sugerencias ni spamea errores.
 *
 * ponytail: debounce manual con useRef — sin lodash; fetch nativo sin librerías extra.
 *   Max 5 sugerencias, sin place details (lat/lng lo refina 8.5).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

// ---------------------------------------------------------------------------
// Tokens (alineados con step2 — paleta clara/gestión)
// ---------------------------------------------------------------------------

const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_BORDER_FOCUS = '#1A5E44'; // SALVIA
const COLOR_INPUT_BG = '#FFFFFF';
const COLOR_HINT = '#9CA3AF';
const COLOR_SUGGESTION_BG = '#FFFFFF';
const COLOR_SUGGESTION_DIVIDER = '#F3F4F6';

// ---------------------------------------------------------------------------
// Types (Places API New)
// ---------------------------------------------------------------------------

interface PlacePrediction {
  placeId: string;
  text: { text: string };
  structuredFormat?: {
    mainText: { text: string };
    secondaryText?: { text: string };
  };
}

interface AutocompleteResponse {
  suggestions?: { placePrediction: PlacePrediction }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLACES_AUTOCOMPLETE_URL =
  'https://places.googleapis.com/v1/places:autocomplete';
/** Place Details (New) — GET .../places/{placeId} con FieldMask `location`. */
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';
/** Text Search (New) — geocodifica direcciones escritas a mano (sin sugerencia). */
const PLACES_SEARCH_TEXT_URL =
  'https://places.googleapis.com/v1/places:searchText';
/** Mínimo de caracteres para intentar geocodificar texto libre en el blur. */
const MIN_GEOCODE_LEN = 8;
const DEBOUNCE_MS = 300;
const MAX_SUGGESTIONS = 5;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AddressAutocompleteProps {
  value: string;
  onSelect: (address: string) => void;
  /** Invocado cada vez que el texto cambia (aunque no haya sugerencia seleccionada) */
  onChangeText?: (text: string) => void;
  /**
   * Invocado al seleccionar una sugerencia y resolver sus coordenadas exactas
   * (Place Details). Permite mover el pin del mapa a la dirección elegida.
   * No se invoca si la resolución de coords falla (degrada al pin manual).
   */
  onPlaceSelected?: (address: string, lat: number, lng: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddressAutocomplete({
  value,
  onSelect,
  onChangeText,
  onPlaceSelected,
}: AddressAutocompleteProps) {
  const api_key = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';
  const has_key = api_key.length > 0;

  const [suggestions, set_suggestions] = useState<PlacePrediction[]>([]);
  const [loading, set_loading] = useState(false);
  const [focused, set_focused] = useState(false);
  const debounce_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevents stale responses from overwriting newer ones
  const request_id_ref = useRef(0);
  // Último texto cuyas coords ya se resolvieron (sugerencia o geocode de blur) —
  // evita re-geocodificar el mismo texto y pisar un ajuste manual del pin.
  const resolved_text_ref = useRef<string | null>(null);
  // Valor más reciente del input — el geocode de blur corre con delay y debe leer
  // el texto final (p. ej. tras seleccionar una sugerencia), no el del closure.
  const value_ref = useRef(value);
  useEffect(() => {
    value_ref.current = value;
  });

  // ── Fetch autocomplete suggestions ────────────────────────────────────────

  const fetch_suggestions = useCallback(
    async (input: string) => {
      if (!has_key || input.trim().length < 3) {
        set_suggestions([]);
        return;
      }

      const current_id = ++request_id_ref.current;
      set_loading(true);

      try {
        const res = await fetch(PLACES_AUTOCOMPLETE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': api_key,
          },
          body: JSON.stringify({
            input,
            includedRegionCodes: ['mx'],
          }),
        });

        if (!res.ok) {
          // ponytail: log discreto — no dialogs, no crashea
          if (__DEV__) {
            console.warn('[AddressAutocomplete] API error', res.status);
          }
          return;
        }

        const data: AutocompleteResponse = await res.json();
        const raw = data.suggestions ?? [];
        const parsed = raw
          .slice(0, MAX_SUGGESTIONS)
          .map((s) => s.placePrediction);

        // Sólo actualizar si esta respuesta corresponde al request más reciente
        if (current_id === request_id_ref.current) {
          set_suggestions(parsed);
        }
      } catch {
        // Red no disponible — silencioso en prod, aviso en dev
        if (__DEV__) {
          console.warn('[AddressAutocomplete] fetch error');
        }
      } finally {
        if (current_id === request_id_ref.current) {
          set_loading(false);
        }
      }
    },
    [api_key, has_key],
  );

  // ── Debounced handler ──────────────────────────────────────────────────────

  const handle_change_text = useCallback(
    (text: string) => {
      onChangeText?.(text);
      onSelect(text); // actualiza address en el form aunque no sea sugerencia

      if (debounce_ref.current) clearTimeout(debounce_ref.current);
      debounce_ref.current = setTimeout(() => {
        void fetch_suggestions(text);
      }, DEBOUNCE_MS);
    },
    [fetch_suggestions, onChangeText, onSelect],
  );

  // ── Suggestion press ───────────────────────────────────────────────────────

  const handle_suggestion_press = useCallback(
    (prediction: PlacePrediction) => {
      const address = prediction.text.text;
      onSelect(address);
      set_suggestions([]);

      // Resuelve las coordenadas exactas de la dirección (Place Details New)
      // para mover el pin del mapa. Si falla, degrada al pin manual: no lanza.
      if (!has_key || !onPlaceSelected) return;
      void (async () => {
        try {
          const res = await fetch(
            `${PLACES_DETAILS_URL}/${prediction.placeId}`,
            {
              method: 'GET',
              headers: {
                'X-Goog-Api-Key': api_key,
                'X-Goog-FieldMask': 'location',
              },
            },
          );
          if (!res.ok) return;
          const data: { location?: { latitude: number; longitude: number } } =
            await res.json();
          const loc = data.location;
          if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
            resolved_text_ref.current = address;
            onPlaceSelected(address, loc.latitude, loc.longitude);
          }
        } catch {
          if (__DEV__) console.warn('[AddressAutocomplete] place details error');
        }
      })();
    },
    [onSelect, onPlaceSelected, has_key, api_key],
  );

  // ── Geocode de respaldo (blur) ─────────────────────────────────────────────
  // Cubre la dirección ESCRITA A MANO sin tocar sugerencia: sin esto, el pin
  // queda donde el usuario toque el mapa (default CDMX) aunque la dirección
  // diga otra ciudad — bug real observado en producción. La dirección manda;
  // el pin se puede refinar tocando/arrastrando después (el mismo texto no se
  // re-geocodifica gracias a resolved_text_ref).
  const geocode_typed_address = useCallback(
    async (text: string) => {
      const query = text.trim();
      if (!has_key || !onPlaceSelected) return;
      if (query.length < MIN_GEOCODE_LEN) return;
      if (query === resolved_text_ref.current) return;

      try {
        const res = await fetch(PLACES_SEARCH_TEXT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': api_key,
            'X-Goog-FieldMask': 'places.location',
          },
          body: JSON.stringify({ textQuery: query, regionCode: 'MX' }),
        });
        if (!res.ok) return;
        const data: { places?: { location?: { latitude: number; longitude: number } }[] } =
          await res.json();
        const loc = data.places?.[0]?.location;
        if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
          resolved_text_ref.current = query;
          onPlaceSelected(query, loc.latitude, loc.longitude);
        }
      } catch {
        if (__DEV__) console.warn('[AddressAutocomplete] geocode error');
      }
    },
    [has_key, api_key, onPlaceSelected],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const show_dropdown =
    focused && suggestions.length > 0 && has_key;

  return (
    <View style={styles.container}>
      {/* Input */}
      <View
        style={[
          styles.input_wrapper,
          focused && styles.input_wrapper_focused,
        ]}
      >
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={handle_change_text}
          onFocus={() => set_focused(true)}
          onBlur={() => {
            // Pequeño delay para que handle_suggestion_press procese antes del blur
            setTimeout(() => set_focused(false), 150);
            // Geocode de respaldo para texto escrito a mano — corre después de que
            // una posible selección de sugerencia haya actualizado el form.
            setTimeout(() => {
              void geocode_typed_address(value_ref.current);
            }, 300);
          }}
          placeholder="Ej. Colonia Del Valle, Ciudad de México"
          placeholderTextColor={COLOR_HINT}
          returnKeyType="done"
          autoCorrect={false}
          accessibilityLabel="Dirección de la propiedad"
        />
        {loading && (
          <ActivityIndicator
            size="small"
            color={COLOR_BORDER_FOCUS}
            style={styles.spinner}
          />
        )}
      </View>

      {/* Dropdown de sugerencias */}
      {show_dropdown && (
        <View style={styles.dropdown}>
          {suggestions.map((prediction, index) => {
            const main =
              prediction.structuredFormat?.mainText.text ??
              prediction.text.text;
            const secondary =
              prediction.structuredFormat?.secondaryText?.text;
            const is_last = index === suggestions.length - 1;

            return (
              <TouchableOpacity
                key={prediction.placeId}
                style={[styles.suggestion, !is_last && styles.suggestion_border]}
                onPress={() => handle_suggestion_press(prediction)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Seleccionar ${main}`}
              >
                <Text style={styles.suggestion_main} numberOfLines={1}>
                  {main}
                </Text>
                {secondary ? (
                  <Text style={styles.suggestion_secondary} numberOfLines={1}>
                    {secondary}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    // ponytail: position relativo — el dropdown empuja el layout (más seguro que
    //   position: absolute en ScrollView; 8.5 refina si el mapa queda tapado).
    zIndex: 10,
  },

  // ── Input wrapper ──────────────────────────────────────────────────────────
  input_wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLOR_INPUT_BG,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
  },
  input_wrapper_focused: {
    borderColor: COLOR_BORDER_FOCUS,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLOR_TEXT_PRIMARY,
    padding: 0,
  },
  spinner: {
    marginLeft: 8,
  },

  // ── Dropdown ───────────────────────────────────────────────────────────────
  dropdown: {
    backgroundColor: COLOR_SUGGESTION_BG,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden',
    // Sombra sutil para distinguir del fondo
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  suggestion: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: COLOR_SUGGESTION_BG,
  },
  suggestion_border: {
    borderBottomWidth: 1,
    borderBottomColor: COLOR_SUGGESTION_DIVIDER,
  },
  suggestion_main: {
    fontSize: 14,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
  },
  suggestion_secondary: {
    fontSize: 12,
    color: COLOR_TEXT_SECONDARY,
    marginTop: 2,
  },
});
