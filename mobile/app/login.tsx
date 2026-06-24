/**
 * Pantalla de login — ruta /login (Expo Router).
 *
 * Subtarea 2.3: UI + validación de formulario.
 * Subtarea 2.4 (pendiente): conectar handle_submit a useAuth().signIn
 *   y manejar errores del backend (credenciales incorrectas, red, etc.).
 * Subtarea 2.5 (pendiente): protección de rutas — redirigir si ya hay sesión.
 */
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField } from '@/features/auth/components/form-field';
import {
  is_form_valid,
  validate_login_form,
  type LoginFormErrors,
} from '@/features/auth/validation';

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function LoginScreen() {
  // Estado del formulario
  const [email, set_email] = useState('');
  const [password, set_password] = useState('');
  const [show_password, set_show_password] = useState(false);
  const [errors, set_errors] = useState<LoginFormErrors>({});
  const [touched, set_touched] = useState({ email: false, password: false });
  const [is_submitting, set_is_submitting] = useState(false);

  // ---------------------------------------------------------------------------
  // Validación reactiva al perder foco
  // ---------------------------------------------------------------------------

  const handle_email_blur = () => {
    set_touched((prev) => ({ ...prev, email: true }));
    set_errors((prev) => ({
      ...prev,
      ...validate_login_form({ email, password }),
    }));
  };

  const handle_password_blur = () => {
    set_touched((prev) => ({ ...prev, password: true }));
    set_errors((prev) => ({
      ...prev,
      ...validate_login_form({ email, password }),
    }));
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handle_submit = async () => {
    // Marcar todos los campos como tocados para mostrar errores
    set_touched({ email: true, password: true });

    const form_errors = validate_login_form({ email, password });
    set_errors(form_errors);

    if (!is_form_valid(form_errors)) {
      return;
    }

    set_is_submitting(true);
    try {
      // TODO (subtarea 2.4): llamar useAuth().signIn(email.trim(), password)
      // y manejar AuthApiError (credenciales inválidas, email no confirmado, etc.)
      // Ejemplo:
      //   await signIn(email.trim(), password);
      //   router.replace('/');
    } finally {
      set_is_submitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const toggle_password_label = show_password ? 'Ocultar' : 'Mostrar';

  const password_toggle = (
    <Pressable
      onPress={() => set_show_password((v) => !v)}
      accessibilityRole="button"
      accessibilityLabel={`${toggle_password_label} contraseña`}
      hitSlop={8}
    >
      <Text style={styles.toggle_text}>{toggle_password_label}</Text>
    </Pressable>
  );

  const form_errors = validate_login_form({ email, password });
  const can_submit = is_form_valid(form_errors) && !is_submitting;

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Branding mínimo neutro — diseño visual en pausa hasta tarea #19 */}
          <View style={styles.header}>
            <Text style={styles.brand}>Urbea</Text>
            <Text style={styles.subtitle}>Inicia sesión para continuar</Text>
          </View>

          {/* Formulario */}
          <View style={styles.form}>
            <FormField
              label="Correo electrónico"
              value={email}
              onChangeText={set_email}
              onBlur={handle_email_blur}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              placeholder="tu@correo.com"
              returnKeyType="next"
              error={touched.email ? errors.email?.message : undefined}
              editable={!is_submitting}
            />

            <FormField
              label="Contraseña"
              value={password}
              onChangeText={set_password}
              onBlur={handle_password_blur}
              secureTextEntry={!show_password}
              autoComplete="current-password"
              textContentType="password"
              placeholder="Mínimo 6 caracteres"
              returnKeyType="done"
              onSubmitEditing={handle_submit}
              error={touched.password ? errors.password?.message : undefined}
              editable={!is_submitting}
              right_addon={password_toggle}
            />

            <Pressable
              style={[styles.submit_button, !can_submit && styles.submit_button_disabled]}
              onPress={handle_submit}
              disabled={!can_submit}
              accessibilityRole="button"
              accessibilityLabel="Iniciar sesión"
              accessibilityState={{ disabled: !can_submit, busy: is_submitting }}
            >
              <Text style={[styles.submit_text, !can_submit && styles.submit_text_disabled]}>
                {is_submitting ? 'Iniciando sesión…' : 'Iniciar sesión'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  header: {
    marginBottom: 40,
    alignItems: 'center',
  },
  brand: {
    fontSize: 32,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
  },
  form: {
    width: '100%',
  },
  toggle_text: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  submit_button: {
    marginTop: 8,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit_button_disabled: {
    backgroundColor: '#D1D5DB',
  },
  submit_text: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  submit_text_disabled: {
    color: '#9CA3AF',
  },
});
