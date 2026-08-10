/**
 * SelectField — campo tipo "select" para listas cerradas (estado, municipio…).
 *
 * Reutiliza la apariencia de FormField (mismo look que el resto del
 * formulario) pero abre un modal con lista + buscador en vez de mostrar el
 * teclado — el Picker nativo de RN no trae buscador y difiere mucho entre
 * iOS/Android; con listas de hasta ~570 filas (municipios de Oaxaca) un
 * Modal + FlatList virtualizado es el mínimo que aguanta ese volumen sin
 * trabarse en un ScrollView normal.
 *
 * ponytail: sin dependencia de picker/select — Modal + FlatList (ambos ya
 * usados en el repo, ver FilterSheet.tsx) son suficientes.
 */
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretDown, MagnifyingGlass, X } from 'phosphor-react-native';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface SelectOption {
  id: string;
  label: string;
}

interface SelectFieldProps {
  testID?: string;
  label: string;
  placeholder: string;
  /** id de la opción seleccionada, o '' si no hay ninguna. */
  value: string;
  options: SelectOption[];
  onSelect: (id: string) => void;
  error?: string | undefined;
  disabled?: boolean;
  /** true mientras `options` todavía se está cargando. */
  loading?: boolean;
}

/** Compara ignorando mayúsculas y acentos — mismo criterio que ZoneAutocomplete. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function SelectField({
  testID,
  label,
  placeholder,
  value,
  options,
  onSelect,
  error,
  disabled = false,
  loading = false,
}: SelectFieldProps): React.JSX.Element {
  // #143.6: barra de botones de Android tapaba las últimas opciones del sheet
  const insets = useSafeAreaInsets();
  const [open, set_open] = useState(false);
  const [query, set_query] = useState('');

  const selected = options.find((option) => option.id === value);

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed === '') return options;
    const normalized_query = normalize(trimmed);
    return options.filter((option) => normalize(option.label).includes(normalized_query));
  }, [options, query]);

  const handle_open = (): void => {
    if (disabled) return;
    set_query('');
    set_open(true);
  };

  const handle_close = (): void => set_open(false);

  const handle_select = (id: string): void => {
    onSelect(id);
    set_open(false);
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        testID={testID}
        onPress={handle_open}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={[
          styles.input_row,
          error !== undefined && styles.input_error_border,
          disabled && styles.input_disabled,
        ]}
      >
        <Text
          style={[styles.value_text, selected === undefined && styles.placeholder_text]}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </Text>
        <CaretDown size={16} color="#6B7280" weight="bold" />
      </Pressable>
      {error !== undefined && error.length > 0 && (
        <Text style={styles.error_text} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={handle_close}
        statusBarTranslucent
      >
        <TouchableWithoutFeedback onPress={handle_close} accessibilityLabel={`Cerrar ${label}`}>
          <View style={styles.overlay} />
        </TouchableWithoutFeedback>

        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheet_header}>
            <Text style={styles.sheet_title}>{label}</Text>
            <Pressable
              onPress={handle_close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
            >
              <X size={20} color="#111827" weight="bold" />
            </Pressable>
          </View>

          <View style={styles.search_row}>
            <MagnifyingGlass size={16} color="#9CA3AF" />
            <TextInput
              style={styles.search_input}
              value={query}
              onChangeText={set_query}
              placeholder="Buscar…"
              placeholderTextColor="#9CA3AF"
              autoCorrect={false}
              autoFocus
              accessibilityLabel={`Buscar en ${label}`}
            />
          </View>

          {loading ? (
            <ActivityIndicator style={styles.loading} size="small" color="#6B7280" />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={<Text style={styles.empty_text}>Sin resultados</Text>}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handle_select(item.id)}
                  style={styles.option_row}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <Text style={styles.option_text}>{item.label}</Text>
                </Pressable>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos — mismos valores que FormField.tsx para que ambos campos luzcan
// coherentes uno junto al otro dentro del mismo formulario.
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  input_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input_error_border: {
    borderColor: '#EF4444',
  },
  input_disabled: {
    opacity: 0.6,
  },
  value_text: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  placeholder_text: {
    color: '#9CA3AF',
  },
  error_text: {
    marginTop: 4,
    fontSize: 12,
    color: '#EF4444',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30,26,21,0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    // #143.6: paddingBottom real vive inline (insets.bottom + 16)
  },
  sheet_header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  sheet_title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
  },
  search_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
  },
  search_input: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },
  list: {
    paddingHorizontal: 20,
  },
  loading: {
    paddingVertical: 24,
  },
  empty_text: {
    paddingVertical: 24,
    textAlign: 'center',
    fontSize: 14,
    color: '#6B7280',
  },
  option_row: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  option_text: {
    fontSize: 15,
    color: '#111827',
  },
});
