/**
 * FormField — campo de formulario reutilizable con label, input y error inline.
 * Usado en la pantalla de login (y futura pantalla de cambio de contraseña).
 */
import React from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  type TextInputProps,
} from 'react-native';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string | undefined;
  /** Elemento opcional al lado derecho del input (p.ej. toggle de contraseña) */
  right_addon?: React.ReactNode | undefined;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function FormField({
  label,
  error,
  right_addon,
  style,
  ...input_props
}: FormFieldProps) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.input_row, error !== undefined && styles.input_error_border]}>
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor="#9CA3AF"
          {...input_props}
        />
        {right_addon !== undefined && (
          <View style={styles.addon}>{right_addon}</View>
        )}
      </View>
      {error !== undefined && error.length > 0 && (
        <Text style={styles.error_text} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
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
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
  },
  input_error_border: {
    borderColor: '#EF4444',
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  addon: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  error_text: {
    marginTop: 4,
    fontSize: 12,
    color: '#EF4444',
  },
});
