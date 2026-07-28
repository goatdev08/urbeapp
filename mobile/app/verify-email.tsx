/**
 * Pantalla "verifica tu correo" — ruta /verify-email (Expo Router).
 * Subtarea 72.3 (verificación real de email, PRD — apagar mailer_autoconfirm
 * + Resend SMTP).
 *
 * ⚠️ NO enganchada a la navegación todavía. Hoy `mailer_autoconfirm=true` en
 * el proyecto remoto (memoria `remote_auth_autoconfirm_enabled`) — signUp
 * entrega sesión directa y NADIE queda con `email_confirmed_at: null`, así
 * que no existe ningún caso real que necesite este gate. La pantalla queda
 * lista para cuando 72.3 apague autoconfirm y configure el SMTP de Resend.
 *
 * Dónde enganchar (al destrabarse 72.3): un guard análogo a
 * `LegalGateBoundary` (features/auth/components/legal-gate-boundary.tsx),
 * montado en `features/auth/protected-layout.tsx` ANTES del `<Stack>`
 * protegido — si `session.user.email_confirmed_at === null`, redirigir aquí
 * en vez de dejar pasar al feed. `session.user.email_confirmed_at` ya viene
 * en el objeto `Session` de supabase-js (v2), no requiere columna nueva.
 *
 * BLOQUEANTE (72.3): el reenvío (`supabase.auth.resend`) y el flujo completo
 * no se pueden probar end-to-end hasta que exista el SMTP real — con el
 * mailer default de Supabase el rate limit es demasiado bajo para iterar.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '@/features/auth/context';
import { map_auth_error } from '@/features/auth/auth-errors';
import { supabase } from '@/lib/supabase/client';
import { UrbeaLockup } from '@/components/UrbeaLockup';
import { brand, colors, fonts } from '@/theme/theme';

// Cooldown de reenvío: evita gastar el rate limit del mailer a golpes de tap.
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailScreen() {
  const { session, signOut } = useAuth();
  const router = useRouter();

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

  const email = session?.user.email;

  const handle_resend = async () => {
    if (is_resending || cooldown > 0 || email === undefined) return;

    set_is_resending(true);
    set_resend_message(null);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      set_resend_message('Correo reenviado. Revisa tu bandeja de entrada.');
      set_cooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      set_resend_message(map_auth_error(err));
    } finally {
      set_is_resending(false);
    }
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
