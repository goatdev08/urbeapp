/**
 * Pantalla "verifica tu correo" — ruta /verify-email (Expo Router). Fuera del
 * grupo `(protected)` a propósito (hermana de él en app/) — así el guard de
 * ProtectedLayout puede redirigir aquí sin crear un loop.
 * Subtarea 72.3 (verificación real de email): la EF `register` crea la
 * cuenta con `email_confirm:false`, register.tsx navega aquí tras el submit
 * (sin sesión, email por route param) y ProtectedLayout redirige aquí si una
 * sesión existente tiene `email_confirmed_at` sin resolver
 * (should_redirect_to_verify_email, deep-link-session.ts).
 *
 * El email a mostrar: route param (caso real post-registro, sin sesión)
 * con fallback a session.user.email (por si la pantalla se alcanza con
 * sesión activa). El reenvío usa `send_verification_email` (features/auth/api.ts)
 * — el mismo camino que register.tsx tras el submit, sin duplicar la llamada
 * a `supabase.auth.resend`.
 *
 * Deep link de vuelta (click en el correo): `useSessionFromDeepLink`
 * (hooks/useSessionFromDeepLink.ts) escucha la URL entrante, hace
 * `setSession` con los tokens del fragment y navega a '/'; si el enlace
 * expiró, muestra el mensaje inline. Parametrizado por `on_success` para que
 * 72.5 (reset-password) lo reutilice con su propia navegación.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/features/auth/context';
import { release_splash } from '@/lib/splash-gate';
import { send_verification_email } from '@/features/auth/api';
import { useSessionFromDeepLink } from '@/features/auth/hooks/useSessionFromDeepLink';
import { UrbeaLockup } from '@/components/UrbeaLockup';
import { brand, colors, fonts } from '@/theme/theme';

// Cooldown de reenvío: evita gastar el rate limit del mailer a golpes de tap.
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailScreen() {
  // #143.4: primera pantalla útil — soltar el splash nativo
  useEffect(() => { release_splash(); }, []);

  const { session, signOut } = useAuth();
  const router = useRouter();
  const { email: email_param } = useLocalSearchParams<{ email?: string }>();

  const [cooldown, set_cooldown] = useState(0);
  const [is_resending, set_is_resending] = useState(false);
  const [resend_message, set_resend_message] = useState<string | null>(null);

  // Cuenta regresiva de 1 en 1: un setTimeout por tick (no setInterval) —
  // evita el patrón "setState síncrono dentro de un efecto" que el linter de
  // React marca como error; el setState aquí ocurre async, dentro del callback.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => set_cooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Caso real post-registro: sin sesión, el email viaja por route param
  // (register.tsx). Si la pantalla se alcanza con sesión activa, cae a esta.
  const email = email_param ?? session?.user.email;

  const on_deep_link_success = useCallback(() => {
    router.replace('/');
  }, [router]);
  const { error_message: deep_link_error } = useSessionFromDeepLink(on_deep_link_success);

  const handle_resend = async () => {
    if (is_resending || cooldown > 0 || email === undefined) return;

    set_is_resending(true);
    set_resend_message(null);
    const sent = await send_verification_email(email);
    if (sent) {
      set_resend_message('Correo reenviado. Revisa tu bandeja de entrada.');
      set_cooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      // O1 (post-guardian): send_verification_email ahora devuelve boolean —
      // sin esto, un reenvío fallido igual pintaba "Correo reenviado" y
      // arrancaba el cooldown de 60s sobre un envío que nunca salió.
      set_resend_message('No pudimos reenviar el correo. Inténtalo de nuevo.');
    }
    set_is_resending(false);
  };

  const handle_sign_out = async () => {
    await signOut();
    router.replace('/login');
  };

  const resend_label =
    cooldown > 0 ? `Reenviar en ${cooldown}s` : is_resending ? 'Reenviando…' : 'Reenviar correo';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <UrbeaLockup size={95} direction="column" />
        <Text style={styles.title}>Verifica tu correo</Text>
        <Text style={styles.body}>
          {email !== undefined
            ? `Te enviamos un enlace de confirmación a ${email}. Ábrelo para activar tu cuenta.`
            : 'Te enviamos un enlace de confirmación a tu correo. Ábrelo para activar tu cuenta.'}
        </Text>

        {deep_link_error !== null && (
          <Text style={styles.resend_message} accessibilityRole="alert">
            {deep_link_error}
          </Text>
        )}

        {resend_message !== null && (
          <Text style={styles.resend_message} accessibilityRole="alert">
            {resend_message}
          </Text>
        )}

        <Pressable
          style={[styles.resend_button, (cooldown > 0 || is_resending) && styles.resend_button_disabled]}
          onPress={handle_resend}
          disabled={cooldown > 0 || is_resending}
          accessibilityRole="button"
          accessibilityLabel="Reenviar correo de verificación"
          accessibilityState={{ disabled: cooldown > 0 || is_resending, busy: is_resending }}
        >
          <Text style={styles.resend_text}>{resend_label}</Text>
        </Pressable>

        <Pressable
          onPress={handle_sign_out}
          accessibilityRole="button"
          accessibilityLabel="Cerrar sesión"
          hitSlop={8}
        >
          <Text style={styles.sign_out_text}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: brand.carnita },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  title: {
    fontFamily: fonts.logo,
    fontSize: 18,
    color: brand.green_deep,
    marginTop: 8,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: brand.ink,
    textAlign: 'center',
    lineHeight: 22,
  },
  resend_message: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.gray_3,
    textAlign: 'center',
  },
  resend_button: {
    marginTop: 8,
    backgroundColor: brand.green,
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resend_button_disabled: { backgroundColor: brand.carnita_2 },
  resend_text: { fontFamily: fonts.sans_semibold, fontSize: 16, color: brand.carnita },
  sign_out_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.gray_3,
    marginTop: 8,
    textDecorationLine: 'underline',
  },
});
