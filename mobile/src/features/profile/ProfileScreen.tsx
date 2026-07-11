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
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bookmarks,
  DotsThreeVertical,
  PencilSimple,
  SignOut,
  Storefront,
  UserPlus,
} from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, type_scale } from '@/theme/theme';
import { BackButton } from '@/components/BackButton';
import { useAuth } from '@/features/auth/context';
import { useAgencyRole } from '@/features/leads/hooks/useAgencyRole';
import { useAgentProfile } from './hooks/useAgentProfile';
import { useAgentStats } from './hooks/useAgentStats';
import { ProfileHeader } from './components/ProfileHeader';
import { ProfileMenu, type ProfileMenuItem } from './components/ProfileMenu';
import { PropertiesGrid } from './components/PropertiesGrid';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProfileScreenProps {
  /** ID del agente cuyo perfil se muestra. */
  agent_id: string;
  /** true cuando el usuario autenticado está viendo su propio perfil. */
  is_own_profile: boolean;
  /**
   * true cuando esta pantalla se renderiza dentro de (tabs) (tab "Perfil"),
   * bajo la GlassTabBar flotante — reenviado a PropertiesGrid (#65.6).
   * La ruta empujada /profile/[id] (Stack, sin tab bar) no lo pasa.
   */
  under_floating_tab_bar?: boolean;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ProfileScreen({ agent_id, is_own_profile, under_floating_tab_bar = false }: ProfileScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { loading, error, data } = useAgentProfile(agent_id);
  const { loading: stats_loading, stats } = useAgentStats(agent_id);
  // Owner de agencia → opción "Invitar agentes" en el menú (tarea #34)
  const { isOwner } = useAgencyRole();
  const [menu_visible, set_menu_visible] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handle_edit_profile() {
    router.push('/profile/edit');
  }

  function handle_my_listings() {
    router.push('/profile/my-listings');
  }

  function handle_invite_agents() {
    router.push('/agency/invitations');
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
    router.push(`/property/${property_id}`);
  }

  // Items del menú "⋯" — orden: navegación primero, cerrar sesión al final.
  // "Invitar agentes" solo para owners de agencia (#34).
  // "Guardados" vive aquí desde que salió de la tab bar (composición del mockup).
  const menu_items: ProfileMenuItem[] = [
    { key: 'saved', label: 'Guardados', icon: Bookmarks, onPress: () => router.push('/saved') },
    { key: 'listings', label: 'Mis publicaciones', icon: Storefront, onPress: handle_my_listings },
    ...(isOwner
      ? [{ key: 'invite', label: 'Invitar agentes', icon: UserPlus, onPress: handle_invite_agents }]
      : []),
    { key: 'edit', label: 'Editar perfil', icon: PencilSimple, onPress: handle_edit_profile },
    {
      key: 'signout',
      label: 'Cerrar sesión',
      icon: SignOut,
      destructive: true,
      onPress: () => { void handle_sign_out(); },
    },
  ];

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
    <View style={styles.scroll}>
      {/* Perfil ajeno (ruta empujada /profile/[id]) → botón atrás flotante.
          En el perfil propio (tab) no hay atrás; ahí va el menú "⋯". */}
      {!is_own_profile && <BackButton floating />}

      {/* Botón "⋯" flotante arriba-derecha — abre el menú de acciones.
          Solo en perfil propio (las acciones son del dueño de la cuenta). */}
      {is_own_profile && (
        <Pressable
          style={[styles.menu_btn, { top: insets.top + spacing.s_8 }]}
          onPress={() => set_menu_visible(true)}
          accessibilityRole="button"
          accessibilityLabel="Abrir menú de perfil"
          hitSlop={8}
        >
          <DotsThreeVertical size={24} color={colors.ink} weight="bold" />
        </Pressable>
      )}

      <ScrollView
        style={styles.scroll_inner}
        contentContainerStyle={[styles.scroll_content, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Cabecera del agente */}
        <ProfileHeader profile={data} stats={stats} loading={stats_loading} />

        {/* Separador visual entre header y la grilla */}
        <View style={styles.divider} />

        {/* Grilla de propiedades */}
        <PropertiesGrid
          owner_user_id={agent_id}
          is_own_profile={is_own_profile}
          onPressProperty={handle_press_property}
          under_floating_tab_bar={under_floating_tab_bar}
        />
      </ScrollView>

      {/* Menú de acciones del perfil (bottom-sheet) */}
      {is_own_profile && (
        <ProfileMenu
          visible={menu_visible}
          onClose={() => set_menu_visible(false)}
          items={menu_items}
        />
      )}
    </View>
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
  scroll_inner: {
    flex: 1,
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

  menu_btn: {
    position: 'absolute',
    right: spacing.s_16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper_2,
  },

  divider: {
    height: 1,
    backgroundColor: colors.paper_3,
    marginHorizontal: spacing.s_16,
    marginBottom: spacing.s_16,
  },
});
