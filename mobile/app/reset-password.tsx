/**
 * Pantalla "nueva contraseña" — ruta /reset-password (Expo Router).
 * Subtarea 72.5 (PRD §5.3).
 *
 * Se llega aquí desde el enlace del correo de recuperación (deep link
 * `urbea://reset-password`, ver `requestPasswordReset` en
 * features/auth/context.tsx). Pide la contraseña nueva + confirmación y
 * llama `updatePassword` (wrapper de supabase.auth.updateUser).
 *
 * BLOQUEANTE (72.3): el enganche del deep link — parsear el link entrante y
 * establecer la sesión de recuperación que Supabase adjunta (setSession /
 * exchangeCodeForSession antes de montar esta pantalla) — NO está
 * implementado todavía porque sin el SMTP de Resend configurado no hay forma
 * de generar ni recibir un enlace real para probarlo end-to-end. Al
 * destrabarse 72.3: enganchar un listener de `Linking` (o
 * `Linking.useURL()`) que capture `urbea://reset-password#access_token=...`
 * y llame `supabase.auth.setSession(...)` antes de que el usuario llegue a
 * este formulario — hoy `updatePassword` asume que esa sesión ya existe.
 */
import React, { useState } from 'react';
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
import { Link, useRouter } from 'expo-router';

import { useAuth } from '@/features/auth/context';
import { map_auth_error } from '@/features/auth/auth-errors';
import { FormField } from '@/features/auth/components/form-field';
import {
  is_reset_password_form_valid,
  validate_reset_password_form,
  type ResetPasswordFormErrors,
} from '@/features/auth/validation';
import { UrbeaLockup } from '@/components/UrbeaLockup';
import { brand, colors, fonts } from '@/theme/theme';

export default function ResetPasswordScreen() {
  const { updatePassword } = useAuth();
  const router = useRouter();

  const [password, set_password] = useState('');
  const [confirm, set_confirm] = useState('');
  const [show_password, set_show_password] = useState(false);
  const [touched, set_touched] = useState({ password: false, confirm: false });
  const [errors, set_errors] = useState<ResetPasswordFormErrors>({});
  const [is_submitting, set_is_submitting] = useState(false);
  const [general_error, set_general_error] = useState<string | null>(null);
  const [done, set_done] = useState(false);

  const validate = () => validate_reset_password_form({ password, confirm });

  const handle_blur = (field: 'password' | 'confirm') => {
    set_touched((prev) => ({ ...prev, [field]: true }));
    set_errors(validate());
  };

  const handle_submit = async () => {
    if (is_submitting) return;

    set_touched({ password: true, confirm: true });
    const form_errors = validate();
    set_errors(form_errors);
    if (!is_reset_password_form_valid(form_errors)) return;

    set_general_error(null);
    set_is_submitting(true);
    try {
      await updatePassword(password);
      set_done(true);
    } catch (err) {
      set_general_error(map_auth_error(err));
    } finally {
      set_is_submitting(false);
    }
  };

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
          <View style={styles.header}>
            <UrbeaLockup size={95} direction="column" />
            <Text style={styles.subtitle}>
              {done ? 'Contraseña actualizada' : 'Elige tu nueva contraseña'}
            </Text>
          </View>

          {done ? (
            <View style={styles.form}>
              <Text style={styles.confirmation_text}>
                Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión con ella.
              </Text>
              <Pressable
                style={styles.submit_button}
                onPress={() => router.replace('/login')}
                accessibilityRole="button"
                accessibilityLabel="Ir a iniciar sesión"
              >
                <Text style={styles.submit_text}>Ir a iniciar sesión</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              <FormField
                testID="reset-password-new"
                label="Contraseña nueva"
                value={password}
                onChangeText={set_password}
                onBlur={() => handle_blur('password')}
                secureTextEntry={!show_password}
                autoComplete="new-password"
                textContentType="newPassword"
                placeholder="Mínimo 6 caracteres"
                returnKeyType="next"
                error={touched.password ? errors.password?.message : undefined}
                editable={!is_submitting}
                right_addon={password_toggle}
              />

              <FormField
                testID="reset-password-confirm"
                label="Confirmar contraseña"
                value={confirm}
                onChangeText={set_confirm}
                onBlur={() => handle_blur('confirm')}
                secureTextEntry={!show_password}
                autoComplete="new-password"
                textContentType="newPassword"
                placeholder="Repite la contraseña"
                returnKeyType="done"
                onSubmitEditing={handle_submit}
                error={touched.confirm ? errors.confirm?.message : undefined}
                editable={!is_submitting}
              />

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
                style={[styles.submit_button, is_submitting && styles.submit_button_disabled]}
                onPress={handle_submit}
                disabled={is_submitting}
                accessibilityRole="button"
                accessibilityLabel="Guardar contraseña"
                accessibilityState={{ busy: is_submitting }}
              >
                {is_submitting ? (
                  <View style={styles.submit_loading_row}>
                    <ActivityIndicator testID="submit-spinner" size="small" color="#9CA3AF" />
                    <Text
                      style={[styles.submit_text, styles.submit_text_disabled, styles.submit_loading_label]}
                    >
                      Guardando…
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.submit_text}>Guardar contraseña</Text>
                )}
              </Pressable>

              <View style={styles.back_link_row}>
                <Link href="/login" style={styles.back_link} accessibilityRole="link">
                  Volver a iniciar sesión
                </Link>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: brand.carnita },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  header: { marginBottom: 40, alignItems: 'center', gap: 16 },
  subtitle: {
    fontFamily: fonts.logo,
    fontSize: 15,
    color: brand.green_deep,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  form: { width: '100%' },
  toggle_text: { fontFamily: fonts.sans_semibold, fontSize: 13, color: colors.gray_2 },
  confirmation_text: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: brand.ink,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  submit_button: {
    marginTop: 8,
    backgroundColor: brand.green,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit_button_disabled: { backgroundColor: brand.carnita_2 },
  submit_text: { fontFamily: fonts.sans_semibold, fontSize: 16, color: brand.carnita },
  submit_text_disabled: { color: colors.gray_2 },
  submit_loading_row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  submit_loading_label: { marginLeft: 8 },
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
  back_link_row: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  back_link: { fontFamily: fonts.sans_semibold, fontSize: 14, color: brand.green, textAlign: 'center' },
});
