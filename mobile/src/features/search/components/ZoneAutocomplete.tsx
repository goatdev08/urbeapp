/**
 * ZoneAutocomplete.tsx — TextInput + dropdown de sugerencias de zona/colonia (#12.4).
 *
 * Contenedor del FilterSheet es un Modal RN (no bottom-sheet), así que el
 * dropdown se renderiza INLINE bajo el input (ScrollView normal) — no hace
 * falta portal ni overlay flotante para evitar conflictos de z-index.
 *
 * Props controladas: `value`/`onChange` para que 12.6 (FilterContext) lo
 * conecte directo sin tocar este componente. `value` es la zona EXACTA ya
 * seleccionada (o null); mientras el usuario teclea sin seleccionar, el texto
 * vive en el estado interno del hook (useZoneAutocomplete) y `onChange` solo
 * se invoca al seleccionar una sugerencia o al vaciar el campo.
 *
 * ponytail: mismo patrón visual/de debounce que AddressAutocomplete
 * (features/publish) pero con tokens de theme.ts en vez de colores hardcoded.
 */
import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { useZoneAutocomplete } from '../hooks/useZoneAutocomplete';

export interface ZoneAutocompleteProps {
  /** Zona exacta ya seleccionada, o null si no hay selección. */
  value: string | null;
  /** Se invoca con la zona exacta elegida, o null al vaciar el campo. */
  onChange: (zone: string | null) => void;
}

export function ZoneAutocomplete({ value, onChange }: ZoneAutocompleteProps): React.JSX.Element {
  const { query, set_query, suggestions, loading, error, select_zone } = useZoneAutocomplete();
  const [show_dropdown, set_show_dropdown] = React.useState(false);

  // Refleja el valor controlado externo (ej. reset del FilterContext en 12.6/12.7)
  // dentro del texto mostrado, sin pisar lo que el usuario está tecleando activamente.
  useEffect(() => {
    set_query(value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle_change_text = (text: string): void => {
    set_query(text);
    set_show_dropdown(true);
    if (text.trim() === '') onChange(null);
  };

  const handle_select = (zone: string): void => {
    select_zone(zone);
    onChange(zone);
    set_show_dropdown(false);
  };

  const show_suggestions = show_dropdown && !loading && suggestions.length > 0;
  const show_empty_hint = show_dropdown && !loading && query.trim() !== '' && suggestions.length === 0;

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={handle_change_text}
        onFocus={() => set_show_dropdown(true)}
        placeholder="Ej. Polanco, Roma Norte…"
        placeholderTextColor={colors.gray_1}
        autoCorrect={false}
        accessibilityLabel="Zona o colonia"
      />

      {loading ? <Text style={styles.hint}>Cargando zonas…</Text> : null}
      {error ? <Text style={styles.error_text}>{error}</Text> : null}
      {show_empty_hint ? <Text style={styles.hint}>Sin coincidencias</Text> : null}

      {show_suggestions ? (
        <ScrollView
          style={styles.dropdown}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {suggestions.map((zone, index) => (
            <TouchableOpacity
              key={zone}
              style={[
                styles.suggestion,
                index !== suggestions.length - 1 && styles.suggestion_border,
              ]}
              onPress={() => handle_select(zone)}
              accessibilityRole="button"
              accessibilityLabel={`Seleccionar zona ${zone}`}
            >
              <Text style={styles.suggestion_text}>{zone}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {},
  input: {
    borderWidth: 1,
    borderColor: colors.paper_3,
    borderRadius: radii.r_8,
    paddingHorizontal: spacing.s_12,
    paddingVertical: spacing.s_12,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.paper_2,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.gray_2,
    marginTop: spacing.s_8,
  },
  error_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.danger,
    marginTop: spacing.s_8,
  },
  dropdown: {
    maxHeight: 160,
    marginTop: spacing.s_8,
    borderWidth: 1,
    borderColor: colors.paper_3,
    borderRadius: radii.r_8,
    backgroundColor: colors.paper_2,
  },
  suggestion: {
    paddingHorizontal: spacing.s_12,
    paddingVertical: spacing.s_12,
  },
  suggestion_border: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paper_3,
  },
  suggestion_text: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.ink,
  },
});
