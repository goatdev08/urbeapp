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
import React, { useEffect, useState } from 'react';
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
  Briefcase,
  Buildings,
  DotsThreeVertical,
  Megaphone,
  SignOut,
  Storefront,
  UserPlus,
  Users,
} from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, type_scale } from '@/theme/theme';
import { BackButton } from '@/components/BackButton';
import { useAuth } from '@/features/auth/context';
import { useAgencyRole } from '@/features/leads/hooks/useAgencyRole';
import { fetch_own_membership } from '@/features/agency/api';
import { useCanAdvertise } from '@/features/ads/hooks/useCanAdvertise';
import { useMyAds } from '@/features/ads/hooks/useMyAds';
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
  /**
   * true cuando la pantalla llegó EMPUJADA al Stack (/profile/[id]) y hay una
   * ruta a la cual regresar — muestra el BackButton flotante SIEMPRE, incluso
   * en el perfil propio (#147: tocar tu propio video en el feed empuja tu
   * perfil y sin esto quedabas sin regreso visible). El tab Perfil no lo pasa.
   */
  show_back?: boolean;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ProfileScreen({
  agent_id,
  is_own_profile,
  under_floating_tab_bar = false,
  show_back = false,
}: ProfileScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut, user } = useAuth();
  const { loading, error, data } = useAgentProfile(agent_id);
  const { loading: stats_loading, stats } = useAgentStats(agent_id);
  // Owner de agencia → opción "Invitar agentes" en el menú (tarea #34)
  const { isOwner } = useAgencyRole();
  // Capacidad de anunciante → opción "Mis anuncios" (subtarea 171.3). El gate
  // REAL de la ruta ya vive en app/(protected)/ads/_layout.tsx (un deep link
  // la alcanzaría igual sin ese Redirect); esto es solo el punto de entrada
  // visible, mismo patrón que isOwner/can_manage_members de abajo.
  const { can_advertise } = useCanAdvertise();
  // 212.5 / exploración 040: la entrada también se muestra si la org YA
  // tiene ≥1 anuncio propio, aunque `can_advertise` se haya apagado después
  // — mismo fallback que app/(protected)/ads/_layout.tsx (ver su docblock),
  // reusando useMyAds() en vez de una consulta nueva.
  const my_ads_for_menu = useMyAds();
  const show_ads_entry = can_advertise || my_ads_for_menu.ads.length > 0;
  const [menu_visible, set_menu_visible] = useState(false);

  // Owner O admin de agencia → opción "Miembros" (gestión de agentes, #71.6).
  // useAgencyRole() no distingue 'admin' (union type angosta, tarea #28.1,
  // previa a que el rol existiera — #71.2). Chequeo propio y liviano, sin
  // tocar ese hook (fuera del footprint de esta subtarea).
  const [can_manage_members, set_can_manage_members] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guard "sin usuario"; resetea estado, no deriva UI (patrón useMyProperties.ts).
      set_can_manage_members(false);
      return;
    }

    let ignore = false;
    const resolved_user_id = user.id;

    async function load_own_role(): Promise<void> {
      const membership = await fetch_own_membership(resolved_user_id);
      if (ignore) return;
      set_can_manage_members(
        membership?.member_role === 'owner' || membership?.member_role === 'admin',
      );
    }

    void load_own_role();

    return () => {
      ignore = true;
    };
  }, [user?.id]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handle_edit_profile() {
    router.push('/profile/edit');
  }

  function handle_saved() {
    // ⚠️ NO '/saved': ese tab está con href:null para agentes y expo-router
    // descarta el push en silencio (el botón no hacía nada). Ver el docblock
    // de app/(protected)/profile/saved.tsx.
    router.push('/profile/saved');
  }

  function handle_my_listings() {
    router.push('/profile/my-listings');
  }

  function handle_invite_agents() {
    router.push('/agency/invitations');
  }

  function handle_manage_members() {
    router.push('/agency/members');
  }

  function handle_my_ads() {
    router.push('/ads');
  }

  function handle_upgrade_to_agent() {
    router.push('/upgrade');
  }

  function handle_register_agency() {
    router.push('/agency/register');
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
  // "Miembros" para owner Y admin de agencia (#71.6 — gestión delegada §4.10).
  // ⚠️ 180.2: "Guardados" y "Editar perfil" YA NO están aquí — subieron a la
  // fila de acciones visible del header (ProfileActions). Duplicarlas en el
  // menú daría dos caminos al mismo destino sin ganar nada.
  // "Convertirme en agente" y "Registrar mi inmobiliaria" solo para
  // buscadores (#71.3 / #71.4) — un agent/admin no tiene nada que canjear,
  // solicitar o fundar. Son caminos DISTINTOS: el primero une la cuenta a
  // una inmobiliaria EXISTENTE; el segundo funda una NUEVA (pending_approval,
  // sin cambio de rol hasta 71.5).
  const menu_items: ProfileMenuItem[] = [
    { key: 'listings', label: 'Mis publicaciones', icon: Storefront, onPress: handle_my_listings },
    ...(show_ads_entry
      ? [{ key: 'ads', label: 'Mis anuncios', icon: Megaphone, onPress: handle_my_ads }]
      : []),
    ...(isOwner
      ? [{ key: 'invite', label: 'Invitar agentes', icon: UserPlus, onPress: handle_invite_agents }]
      : []),
    ...(can_manage_members
      ? [{ key: 'members', label: 'Miembros', icon: Users, onPress: handle_manage_members }]
      : []),
    ...(user?.role === 'user'
      ? [
          { key: 'upgrade', label: 'Convertirme en agente', icon: Briefcase, onPress: handle_upgrade_to_agent },
          { key: 'register_agency', label: 'Registrar mi inmobiliaria', icon: Buildings, onPress: handle_register_agency },
        ]
      : []),
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
      {/* Ruta empujada (/profile/[id]) → botón atrás flotante SIEMPRE — aun
          en el perfil propio (#147). En el tab Perfil no hay nada que popear. */}
      {show_back && <BackButton floating />}

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
        <ProfileHeader
          profile={data}
          stats={stats}
          loading={stats_loading}
          is_own_profile={is_own_profile}
          on_edit_profile={handle_edit_profile}
          on_saved={handle_saved}
        />

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
});
