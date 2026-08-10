/**
 * Pantalla de login — ruta /login (Expo Router).
 *
 * Subtarea 2.3: UI + validación de formulario.
 * Subtarea 2.4: conectar handle_submit a useAuth().signIn
 *   y manejar errores del backend (credenciales incorrectas, red, etc.).
 * Subtarea 2.5 (pendiente): protección de rutas — redirigir si ya hay sesión.
 *
 * Nota de implementación — stale closure / RNTL:
 * En el entorno de tests (RNTL v14 + React 19) los fireEvent.changeText() sin
 * await dentro de un act() externo no garantizan que el estado React esté
 * actualizado antes de que se dispare fireEvent.press(). Se usan refs para
 * rastrear los valores actuales de email/password de forma SIEMPRE SINCRÓNICA,
 * independientemente del ciclo de render.
 */
import React, { useEffect, useRef, useState } from 'react';
import { release_splash } from '@/lib/splash-gate';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, Redirect, useRouter } from 'expo-router';

import { useAuth } from '@/features/auth/context';
import { map_auth_error } from '@/features/auth/auth-errors';
import { FormField } from '@/features/auth/components/form-field';
import {
  is_form_valid,
  validate_login_form,
  type LoginFormErrors,
} from '@/features/auth/validation';
import { APPLE_OAUTH_ENABLED, GOOGLE_OAUTH_ENABLED } from '@/features/auth/feature-flags';
import { useGoogleOAuth } from '@/features/auth/hooks/useGoogleOAuth';
import { UrbeaLockup } from '@/components/UrbeaLockup';
import { brand, colors, fonts } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Login social Apple (72.4) — sigue detrás de flag, ver feature-flags.ts
// (gate de release iOS, App Store Review Guideline 4.8). Sin credenciales de
// Apple todavía, así que el handler es un stub explícito: si algún día se
// llegara a invocar por error (flag prendido antes de tiempo), falla ruidoso
// en vez de fingir que el login funcionó. Google ya no usa este stub — tiene
// implementación real vía useGoogleOAuth (ver abajo).
// ---------------------------------------------------------------------------

function handle_social_login_stub(provider: 'Apple'): never {
  throw new Error(
    `Falta configurar el proveedor de ${provider} (credenciales pendientes — ver subtarea 72.4).`
  );
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function LoginScreen() {
  // #143.4: primera pantalla útil — soltar el splash nativo
  useEffect(() => { release_splash(); }, []);

  const { signIn, session, isLoading } = useAuth();
  const router = useRouter();
  const { sign_in_with_google, error_message: google_error_message } = useGoogleOAuth();

  // Estado del formulario
  const [email, set_email] = useState('');
  const [password, set_password] = useState('');
  const [show_password, set_show_password] = useState(false);
  const [errors, set_errors] = useState<LoginFormErrors>({});
  const [touched, set_touched] = useState({ email: false, password: false });
  const [is_submitting, set_is_submitting] = useState(false);
  const [general_error, set_general_error] = useState<string | null>(null);

  // Refs que reflejan siempre el valor más reciente de email/password.
  // Se actualizan de forma sincrónica en los handlers de cambio de texto,
  // lo que resuelve el problema de stale closures cuando handle_submit se
  // ejecuta antes de que React haya refrescado el estado.
  const email_ref = useRef('');
  const password_ref = useRef('');

  // ---------------------------------------------------------------------------
  // Rebote: si ya hay sesión activa (y no estamos cargando), ir a la home.
  // Usamos <Redirect> declarativo (Expo Router SDK 56) para evitar el parpadeo.
  // Mientras isLoading=true no decidimos nada — evita redirect prematuro.
  // ---------------------------------------------------------------------------

  if (!isLoading && session !== null) {
    return <Redirect href="/" />;
  }

  // ---------------------------------------------------------------------------
  // Handlers de cambio de texto
  // ---------------------------------------------------------------------------

  const handle_email_change = (text: string) => {
    email_ref.current = text;
    set_email(text);
  };

  const handle_password_change = (text: string) => {
    password_ref.current = text;
    set_password(text);
  };

  // ---------------------------------------------------------------------------
  // Validación reactiva al perder foco
  // ---------------------------------------------------------------------------

  const handle_email_blur = () => {
    set_touched((prev) => ({ ...prev, email: true }));
    set_errors((prev) => ({
      ...prev,
      ...validate_login_form({ email: email_ref.current, password: password_ref.current }),
    }));
  };

  const handle_password_blur = () => {
    set_touched((prev) => ({ ...prev, password: true }));
    set_errors((prev) => ({
      ...prev,
      ...validate_login_form({ email: email_ref.current, password: password_ref.current }),
    }));
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handle_submit = async () => {
    // Evitar doble submit PRIMERO: si ya hay una llamada en vuelo, ignorar sin
    // tocar ningún estado (evita enqueue de state updates en tests con act dangling).
    if (is_submitting) {
      return;
    }

    // Usar refs para obtener los valores MÁS RECIENTES aunque el estado React
    // todavía no se haya re-renderizado (problema de stale closures en tests).
    const current_email = email_ref.current;
    const current_password = password_ref.current;

    // Marcar todos los campos como tocados para mostrar errores inline
    set_touched({ email: true, password: true });

    const form_errors = validate_login_form({ email: current_email, password: current_password });
    set_errors(form_errors);

    if (!is_form_valid(form_errors)) {
      return;
    }

    set_general_error(null);
    set_is_submitting(true);
    try {
      await signIn(current_email.trim(), current_password);
      router.replace('/');
    } catch (err) {
      set_general_error(map_auth_error(err));
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
          {/* Lockup del logo final (#43.2) — hero vertical: mark verde grande
              + wordmark URBEA debajo, centrado. */}
          <View style={styles.header}>
            <UrbeaLockup size={95} direction="column" />
            <Text style={styles.subtitle}>Inicia sesión para continuar</Text>
          </View>

          {/* Formulario */}
          <View style={styles.form}>
            <FormField
              testID="login-email"
              label="Correo electrónico"
              value={email}
              onChangeText={handle_email_change}
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
              testID="login-password"
              label="Contraseña"
              value={password}
              onChangeText={handle_password_change}
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

            {/* Recuperación de contraseña (§5.3, 72.5) — la pantalla existe y
                valida, pero el envío real de correo depende del SMTP de 72.3. */}
            <Link href="/forgot-password" style={styles.forgot_password_link} accessibilityRole="link">
              ¿Olvidaste tu contraseña?
            </Link>

            {general_error !== null && (
              <View
                style={styles.error_banner}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                <Text style={styles.error_banner_text}>{general_error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.submit_button, !can_submit && styles.submit_button_disabled]}
              onPress={handle_submit}
              disabled={is_submitting}
              accessibilityRole="button"
              accessibilityLabel="Iniciar sesión"
              accessibilityState={{ disabled: !can_submit, busy: is_submitting }}
            >
              {is_submitting ? (
                <View style={styles.submit_loading_row}>
                  <ActivityIndicator
                    testID="submit-spinner"
                    size="small"
                    color="#9CA3AF"
                  />
                  <Text style={[styles.submit_text, styles.submit_text_disabled, styles.submit_loading_label]}>
                    Iniciando sesión…
                  </Text>
                </View>
              ) : (
                <Text style={[styles.submit_text, !can_submit && styles.submit_text_disabled]}>
                  Iniciar sesión
                </Text>
              )}
            </Pressable>

            {/* Login social (72.4) — oculto hasta que existan credenciales de
                proveedor; ver feature-flags.ts. */}
            {(GOOGLE_OAUTH_ENABLED || APPLE_OAUTH_ENABLED) && (
              <View style={styles.social_block}>
                <View style={styles.divider_row}>
                  <View style={styles.divider_line} />
                  <Text style={styles.divider_text}>o continúa con</Text>
                  <View style={styles.divider_line} />
                </View>

                {GOOGLE_OAUTH_ENABLED && (
                  <>
                    {google_error_message !== null && (
                      <View
                        style={styles.error_banner}
                        accessible
                        accessibilityRole="alert"
                        accessibilityLiveRegion="assertive"
                      >
                        <Text style={styles.error_banner_text}>{google_error_message}</Text>
                      </View>
                    )}
                    <Pressable
                      style={styles.social_button}
                      onPress={sign_in_with_google}
                      accessibilityRole="button"
                      accessibilityLabel="Continuar con Google"
                    >
                      <Text style={styles.social_button_text}>Continuar con Google</Text>
                    </Pressable>
                  </>
                )}

                {APPLE_OAUTH_ENABLED && (
                  <Pressable
                    style={styles.social_button}
                    onPress={() => handle_social_login_stub('Apple')}
                    accessibilityRole="button"
                    accessibilityLabel="Continuar con Apple"
                  >
                    <Text style={styles.social_button_text}>Continuar con Apple</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* CTA de registro — /register abre el registro libre por default;
                el flujo de agente con código vive como modo secundario ahí. */}
            <View style={styles.register_link_row}>
              <Text style={styles.register_link_text}>¿No tienes cuenta? </Text>
              <Link href="/register" style={styles.register_link} accessibilityRole="link">
                Regístrate
              </Link>
            </View>
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
    backgroundColor: brand.carnita, // carnita del logo final (#43.2)
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
    gap: 16,
  },
  subtitle: {
    fontFamily: fonts.logo, // misma fuente que el wordmark URBEA (Outfit)
    fontSize: 15,
    color: brand.green_deep,
    letterSpacing: 0.3,
  },
  form: {
    width: '100%',
  },
  toggle_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.gray_2,
  },
  social_block: {
    marginTop: 24,
  },
  divider_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  divider_line: {
    flex: 1,
    height: 1,
    backgroundColor: brand.carnita_2,
  },
  divider_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_3,
  },
  social_button: {
    borderWidth: 1,
    borderColor: brand.carnita_2,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  social_button_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    color: brand.ink,
  },
  forgot_password_link: {
    alignSelf: 'flex-end',
    marginTop: -8,
    marginBottom: 16,
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: brand.green,
  },
  submit_button: {
    marginTop: 8,
    backgroundColor: brand.green, // verde del logo final
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit_button_disabled: {
    backgroundColor: brand.carnita_2,
  },
  submit_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 16,
    color: brand.carnita,
  },
  submit_text_disabled: {
    color: colors.gray_2,
  },
  submit_loading_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit_loading_label: {
    marginLeft: 8,
  },
  error_banner: {
    marginBottom: 12,
    backgroundColor: colors.accent_tint,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  error_banner_text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.danger,
    textAlign: 'center',
  },
  register_link_row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  register_link_text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.gray_3,
  },
  register_link: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: brand.green,
  },
});
