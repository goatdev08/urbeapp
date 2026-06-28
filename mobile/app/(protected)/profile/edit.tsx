/**
 * Ruta Stack — editar perfil de agente.
 *
 * Scaffold de UI (subtarea 22.1). Contiene el formulario completo pero
 * sin lógica de carga ni guardado:
 *   - 22.2 cargará los datos reales del perfil.
 *   - 22.3 implementará el guardado (Supabase + Storage).
 *   - 22.4 añadirá validación de campos.
 *
 * Navegación: Stack hijo de (protected)/profile/. El header nativo provee
 * el botón de retroceso; añadimos un link "Cancelar" a la derecha del header.
 *
 * AvatarPicker — reutilizado de onboarding. API:
 *   uri?: string        → URI de la imagen actual (undefined = placeholder)
 *   onChange?: (uri: string) => void  → callback cuando el usuario elige nueva foto
 *   uploading?: boolean → bloquea el picker durante upload
 *
 * ponytail: estado local vacío por ahora; no fetch, no save — solo UI.
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
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';

import { AvatarPicker } from '@/features/onboarding/components/AvatarPicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function EditProfileScreen() {
  const router = useRouter();

  // Estado local del formulario — datos reales se cargan en 22.2
  const [avatar_uri, set_avatar_uri] = useState<string | undefined>(undefined);
  const [full_name, set_full_name] = useState('');
  const [bio, set_bio] = useState('');

  // No-op por ahora — 22.3 implementará el guardado real
  function handle_save() {
    // TODO 22.3 — validar (22.4), subir avatar si cambió, persistir en Supabase
    console.log('[EditProfile] handle_save — pendiente 22.3');
  }

  return (
    <>
      {/* Header nativo: título centrado + link Cancelar a la derecha */}
      <Stack.Screen
        options={{
          title: 'Editar perfil',
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontFamily: 'HankenGrotesk_600SemiBold',
            color: colors.ink,
            fontSize: 17,
          },
          headerRight: () => (
            <Text
              onPress={() => router.back()}
              style={styles.cancel_link}
              accessibilityRole="button"
              accessibilityLabel="Cancelar edición"
            >
              Cancelar
            </Text>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scroll_content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar — centrado, margen superior s_32 */}
          <View style={styles.avatar_wrap}>
            <AvatarPicker
              uri={avatar_uri}
              onChange={set_avatar_uri}
              uploading={false}
            />
          </View>

          {/* Campo: Nombre completo */}
          <View style={styles.field}>
            <Text style={styles.label}>Nombre completo</Text>
            <TextInput
              style={styles.input}
              value={full_name}
              onChangeText={set_full_name}
              placeholder="Tu nombre como aparecerá en el perfil"
              placeholderTextColor={colors.gray_1}
              autoCapitalize="words"
              returnKeyType="next"
              accessibilityLabel="Nombre completo"
            />
          </View>

          {/* Campo: Bio */}
          <View style={styles.field}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.input_multiline]}
              value={bio}
              onChangeText={set_bio}
              placeholder="Cuéntale a los clientes sobre tu experiencia y especialidad"
              placeholderTextColor={colors.gray_1}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              returnKeyType="default"
              accessibilityLabel="Biografía profesional"
            />
          </View>

          {/* Botón Guardar */}
          <View style={styles.save_wrap}>
            <PrimaryButton
              label="Guardar"
              variant="primary"
              surface="light"
              onPress={handle_save}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Estilos — modo gestión-claro
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll_content: {
    paddingHorizontal: spacing.s_24,
    paddingBottom: spacing.s_32,
  },

  // ── Avatar ──────────────────────────────────────────────────────────────────
  avatar_wrap: {
    alignItems: 'center',
    marginTop: spacing.s_32,
    // AvatarPicker ya tiene marginBottom: 32 interno (container)
  },

  // ── Campos del formulario ────────────────────────────────────────────────────
  field: {
    marginBottom: spacing.s_16,
  },
  label: {
    ...type_scale.caption,
    color: colors.gray_3,
    marginBottom: spacing.s_8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.silver,
    borderRadius: radii.r_12,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
    ...type_scale.body,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  input_multiline: {
    height: 108,  // ~4 líneas a lineHeight 24 + padding
    paddingTop: spacing.s_12,
  },

  // ── Botón guardar ────────────────────────────────────────────────────────────
  save_wrap: {
    marginTop: spacing.s_24,
  },

  // ── Header cancel link ────────────────────────────────────────────────────────
  cancel_link: {
    ...type_scale.body,
    color: colors.primary,
    paddingRight: spacing.s_8,
  },
});
