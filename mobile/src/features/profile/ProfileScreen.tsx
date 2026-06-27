/**
 * ProfileScreen — ensamblaje compartido de la pantalla de perfil de agente.
 *
 * Reutilizado por:
 *   - (protected)/(tabs)/profile.tsx  → perfil propio (is_own_profile=true)
 *   - (protected)/profile/[id].tsx    → perfil ajeno (is_own_profile varía)
 *
 * Contiene:
 *   1. ProfileHeader con datos del agente (useAgentProfile).
 *   2. Botones de acción (solo is_own_profile=true): Editar perfil + Cerrar sesión.
 *   3. PropertiesGrid con EmptyState cableado.
 *
 * Scroll: ScrollView en el padre; PropertiesGrid lleva scrollEnabled=false.
 *
 * Subtarea 16.6.
 */
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, type_scale } from '@/theme/theme';
import { useAuth } from '@/features/auth/context';
import { useAgentProfile } from './hooks/useAgentProfile';
import { ProfileHeader } from './components/ProfileHeader';
import { PropertiesGrid } from './components/PropertiesGrid';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProfileScreenProps {
  /** ID del agente cuyo perfil se muestra. */
  agent_id: string;
  /** true cuando el usuario autenticado está viendo su propio perfil. */
  is_own_profile: boolean;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ProfileScreen({ agent_id, is_own_profile }: ProfileScreenProps) {
  const router = useRouter();
  const { signOut } = useAuth();
  const { loading, error, data } = useAgentProfile(agent_id);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handle_edit_profile() {
    // TODO #22: navegar a la pantalla de edición de perfil
    Alert.alert('Editar perfil', 'Próximamente (tarea #22)');
  }

  async function handle_sign_out() {
    Alert.alert(
      'Cerrar sesión',
      '¿Estás seguro de que quieres cerrar sesión?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar sesión',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            // El guard de auth en (protected)/_layout redirige automáticamente.
          },
        },
      ],
    );
  }

  function handle_press_property(property_id: string) {
    // TODO: ruta de detalle de propiedad (otra tarea — /property/[id] no existe aún)
    Alert.alert('Propiedad', `Detalle de propiedad ${property_id} (próximamente)`);
  }

  // ── Estados de carga / error ───────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || data === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.error_text}>
          {error ?? 'No se pudo cargar el perfil'}
        </Text>
      </View>
    );
  }

  // ── Render principal ───────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scroll_content}
      showsVerticalScrollIndicator={false}
    >
      {/* Cabecera del agente */}
      <ProfileHeader profile={data} />

      {/* Botones de acción — solo en perfil propio */}
      {is_own_profile && (
        <View style={styles.actions}>
          <PrimaryButton
            label="Editar perfil"
            variant="ghost"
            surface="light"
            onPress={handle_edit_profile}
          />
          <PrimaryButton
            label="Cerrar sesión"
            variant="ghost"
            surface="light"
            onPress={() => { void handle_sign_out(); }}
          />
        </View>
      )}

      {/* Separador visual entre header/acciones y la grilla */}
      <View style={styles.divider} />

      {/* Grilla de propiedades */}
      <PropertiesGrid
        owner_user_id={agent_id}
        is_own_profile={is_own_profile}
        onPressProperty={handle_press_property}
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll_content: {
    flexGrow: 1,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
    padding: spacing.s_24,
  },
  error_text: {
    ...type_scale.body,
    color: colors.gray_2,
    textAlign: 'center',
  },

  actions: {
    paddingHorizontal: spacing.s_24,
    paddingBottom: spacing.s_16,
    gap: spacing.s_12,
  },

  divider: {
    height: 1,
    backgroundColor: colors.paper_3,
    marginHorizontal: spacing.s_16,
    marginBottom: spacing.s_16,
  },
});
