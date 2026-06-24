/**
 * OnboardingScreen — pantalla de bienvenida para capturar nombre y foto del agente.
 *
 * Jerarquía editorial (personality kit Urbea):
 *   eyebrow → título grande → subtítulo → campos
 *
 * Superficie: CLARA ("paper" #F6F2EB) — pantalla de gestión, estética híbrida.
 *
 * TODOs explícitos por subtarea:
 *   TODO 6.5 — upload de la imagen procesada a Supabase Storage al guardar.
 *   TODO 6.6 — validación de nombre (requerido, mín 2 chars), guardar en public.users
 *              y navegar a la home; PrimaryButton habilitado según validación.
 */
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AvatarPicker } from './components/AvatarPicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/features/auth/context';
import { processProfileImage } from '@/lib/imageUtils';
import { saveProfile } from '@/lib/profileService';

// ---------------------------------------------------------------------------
// Tokens visuales — paper/gestión (alineados con personality kit)
// ---------------------------------------------------------------------------

const COLOR_BG_PAPER = '#F6F2EB';
const COLOR_SALVIA = '#5A8A5E';
const COLOR_TEXT_HEADING = '#1A1A1A';
const COLOR_TEXT_BODY = '#4A4A4A';
const COLOR_TEXT_MUTED = '#6B7280';
const COLOR_INPUT_BORDER = '#D1C9BD';
const COLOR_INPUT_BG = '#FFFFFF';

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function OnboardingScreen() {
  // ── Auth context ────────────────────────────────────────────────────────
  const { user } = useAuth();

  // ── Estado del formulario ───────────────────────────────────────────────
  const [full_name, set_full_name] = useState('');
  const [avatar_uri, set_avatar_uri] = useState<string | undefined>(undefined);
  const [uploading, set_uploading] = useState(false);

  // ── Handlers ────────────────────────────────────────────────────────────

  /**
   * Recibe el uri crudo del AvatarPicker, lo comprime/redimensiona (6.4) y actualiza
   * el estado con el uri procesado (listo para preview y, en 6.5, para upload).
   * TODO 6.5 — disparar el upload a Supabase Storage aquí o al presionar "Continuar".
   */
  const handle_avatar_change = async (uri: string) => {
    try {
      const processed = await processProfileImage(uri);
      set_avatar_uri(processed.uri);
    } catch {
      // Si el procesamiento falla (caso raro), caer al uri crudo para no bloquear al usuario.
      set_avatar_uri(uri);
    }
  };

  /**
   * Guarda el perfil del agente (nombre + foto) y navega a la home.
   * 6.5 — upload del avatar a Supabase Storage + upsert user_preferences.
   * TODO 6.6 — validar nombre, llamar a supabase.from('users').update(...),
   *            luego router.replace('/') una vez completado.
   */
  const handle_continue = async () => {
    if (!user) return;

    set_uploading(true);
    try {
      await saveProfile({
        fullName: full_name,
        imageUri: avatar_uri ?? null,
        userId: user.id,
      });
      // TODO 6.6: router.replace('/') tras guardar perfil completo.
    } catch (err) {
      // TODO 6.6: mostrar error al usuario (toast o alerta).
      console.error('[OnboardingScreen] handle_continue error:', err);
    } finally {
      set_uploading(false);
    }
  };

  /**
   * Salta el onboarding sin configurar perfil.
   * TODO 6.6 — navegar a la home (router.replace('/')) o marcar onboarding_done.
   */
  const handle_skip = () => {
    // TODO 6.6: router.replace('/');
  };

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
          {/* ── Cabecera editorial ──────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>BIENVENIDO A URBEA</Text>
            <Text style={styles.title}>Tu perfil de{'\n'}agente</Text>
            <Text style={styles.subtitle}>
              Completa tu información para que los clientes puedan encontrarte.
            </Text>
          </View>

          {/* ── Foto de perfil ──────────────────────────────────────────── */}
          <AvatarPicker
            uri={avatar_uri}
            onChange={handle_avatar_change}
            uploading={uploading}
          />

          {/* ── Campo nombre ─────────────────────────────────────────────── */}
          <View style={styles.field_wrap}>
            <Text style={styles.field_label}>Nombre completo</Text>
            <TextInput
              style={styles.field_input}
              value={full_name}
              onChangeText={set_full_name}
              placeholder="Tu nombre y apellido"
              placeholderTextColor={COLOR_TEXT_MUTED}
              autoCapitalize="words"
              autoCorrect={false}
              autoComplete="name"
              textContentType="name"
              returnKeyType="done"
              accessibilityLabel="Nombre completo"
              accessibilityHint="Ingresa tu nombre y apellido"
            />
          </View>

          {/* ── CTAs ─────────────────────────────────────────────────────── */}
          <View style={styles.cta_group}>
            {/*
              TODO 6.6 — habilitar el botón cuando full_name.trim().length >= 2.
              Por ahora disabled=true como placeholder explícito.
            */}
            <PrimaryButton
              label="Continuar"
              onPress={handle_continue}
              surface="light"
              variant="primary"
              disabled={full_name.trim().length < 2}
            />

            <View style={styles.cta_gap} />

            <PrimaryButton
              label="Saltar por ahora"
              onPress={handle_skip}
              surface="light"
              variant="ghost"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — surface: light / paper
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLOR_BG_PAPER,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 40,
  },

  // ── Cabecera editorial ─────────────────────────────────────────────────
  header: {
    marginBottom: 36,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: COLOR_SALVIA,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  title: {
    fontSize: 38,
    fontWeight: '700',
    color: COLOR_TEXT_HEADING,
    lineHeight: 44,
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: COLOR_TEXT_BODY,
    lineHeight: 22,
    fontWeight: '400',
  },

  // ── Campo de nombre ────────────────────────────────────────────────────
  field_wrap: {
    marginBottom: 36,
  },
  field_label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLOR_TEXT_BODY,
    marginBottom: 8,
  },
  field_input: {
    height: 52,
    borderWidth: 1,
    borderColor: COLOR_INPUT_BORDER,
    borderRadius: 12,
    backgroundColor: COLOR_INPUT_BG,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLOR_TEXT_HEADING,
    // Sombra sutil para dar profundidad sobre el fondo paper
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },

  // ── CTAs ───────────────────────────────────────────────────────────────
  cta_group: {
    marginTop: 4,
  },
  cta_gap: {
    height: 12,
  },
});
