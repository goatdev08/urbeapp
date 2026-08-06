/**
 * Ruta Stack — gestión de agentes de la inmobiliaria (owner/admin), subtarea 71.6.
 *
 * Lista los miembros de la agencia del caller y permite suspender / reactivar
 * / dar de baja a cada uno vía la EF `manage-agency-member` (backend ya en
 * GREEN — ver supabase/functions/manage-agency-member/{types.ts,handler.ts}).
 * El cambio de agencia (RPC `switch_agency_atomic`) NO tiene UI aquí — es para
 * flujos futuros, fuera del alcance de esta subtarea.
 *
 * Guard: mismo patrón que agency/invitations.tsx (spinner mientras carga,
 * Redirect si no corresponde) — pero owner Y admin pasan (matriz PRD §4.10:
 * el admin también gestiona agency_members, solo el owner queda intocable).
 * El servidor es la 2ª capa: aunque el guard fallara, la EF igual rechaza con
 * NOT_AUTHORIZED/CANNOT_MANAGE_OWNER.
 *
 * Entrada: botón "Miembros" del menú del perfil propio (ProfileScreen.tsx),
 * visible para owner/admin — análogo a "Invitar agentes".
 *
 * La fila del owner nunca muestra acciones (el server la protege igual con
 * CANNOT_MANAGE_OWNER si un admin la tocara vía otra vía) — evita que el
 * usuario dispare una acción que el backend rechazará de todos modos.
 *
 * `remove` es destructivo (baja terminal) → confirmación con Alert.alert,
 * mismo patrón que "Cerrar sesión" en ProfileScreen.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { UserCircle } from 'phosphor-react-native';

import { colors, radii, spacing, type_scale } from '@/theme/theme';
import { useAuth } from '@/features/auth/context';
import {
  fetch_agency_members,
  fetch_own_membership,
  manage_agency_member,
  type AgencyMemberRow,
  type MemberAction,
} from '@/features/agency/api';

// ---------------------------------------------------------------------------
// Mensajes / etiquetas
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHORIZED: 'No tienes permiso para gestionar a este miembro.',
  CANNOT_MANAGE_OWNER: 'No puedes gestionar al dueño de la inmobiliaria.',
  MEMBER_NOT_FOUND: 'Ese miembro ya no está disponible.',
  INVALID_TRANSITION: 'Ese cambio de estado ya no es válido — la lista se actualizó.',
};

// Fuera del Record<string,string> a propósito: bajo noUncheckedIndexedAccess
// cualquier lectura por índice (incl. ERROR_MESSAGES.UNKNOWN) tipa
// `string | undefined`; una constante aparte sí tipa `string` (patrón
// SUBMIT_FALLBACK_MESSAGE de agency/register.tsx).
const UNKNOWN_ERROR_MESSAGE =
  'No se pudo completar la acción. Revisa tu conexión e inténtalo de nuevo.';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  agent: 'Agente',
  viewer: 'Observador',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Activo',
  suspended: 'Suspendido',
  removed: 'Dado de baja',
};

const STATUS_COLOR: Record<string, string> = {
  active: colors.primary,
  suspended: colors.accent,
  removed: colors.gray_2,
};

// Orden de despliegue: dueño primero, luego admin/agent/viewer, alfabético por nombre.
const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, agent: 2, viewer: 3 };

function sort_members(rows: AgencyMemberRow[]): AgencyMemberRow[] {
  return [...rows].sort((a, b) => {
    const rank_diff = (ROLE_RANK[a.member_role] ?? 9) - (ROLE_RANK[b.member_role] ?? 9);
    if (rank_diff !== 0) return rank_diff;
    if (a.full_name === null && b.full_name === null) return 0;
    if (a.full_name === null) return 1;
    if (b.full_name === null) return -1;
    return a.full_name.localeCompare(b.full_name);
  });
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function AgencyMembersScreen() {
  const { user } = useAuth();

  // ── Guard de rol (owner o admin) ─────────────────────────────────────────
  const [role_loading, set_role_loading] = useState(true);
  const [can_manage, set_can_manage] = useState(false);

  // ── Listado ───────────────────────────────────────────────────────────────
  const [members, set_members] = useState<AgencyMemberRow[]>([]);
  const [list_loading, set_list_loading] = useState(true);
  const [list_error, set_list_error] = useState(false);

  // ── Acción en curso ───────────────────────────────────────────────────────
  const [acting_id, set_acting_id] = useState<string | null>(null);
  const [action_error, set_action_error] = useState<string | null>(null);

  // tick fuerza un re-fetch tras una acción exitosa sin cambiar user.id —
  // mismo patrón que useMyProperties.ts (refetch). Async function DECLARADA
  // dentro del efecto (no useCallback externo) — react-hooks/set-state-in-effect
  // exige que las setState directas del guard vivan en el cuerpo del efecto.
  const [tick, set_tick] = useState(0);
  const reload = useCallback(() => set_tick((t) => t + 1), []);

  useEffect(() => {
    if (!user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guard "sin usuario"; resetea estado, no deriva UI (patrón useMyProperties.ts).
      set_role_loading(false);
      set_list_loading(false);
      return;
    }

    let ignore = false;
    const resolved_user_id = user.id;

    async function load(): Promise<void> {
      const own = await fetch_own_membership(resolved_user_id);
      if (ignore) return;
      set_can_manage(own?.member_role === 'owner' || own?.member_role === 'admin');
      set_role_loading(false);

      set_list_loading(true);
      const rows = await fetch_agency_members();
      if (ignore) return;

      if (rows === null) {
        set_list_error(true);
        set_members([]);
      } else {
        set_list_error(false);
        set_members(sort_members(rows));
      }
      set_list_loading(false);
    }

    void load();

    return () => {
      ignore = true;
    };
  }, [user?.id, tick]);

  // ── Guard: spinner mientras se resuelve el rol, Redirect si no aplica ──────
  if (role_loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!can_manage) {
    return <Redirect href="/(protected)/(tabs)/profile" />;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function run_action(member: AgencyMemberRow, action: MemberAction): Promise<void> {
    set_action_error(null);
    set_acting_id(member.id);
    const result = await manage_agency_member(member.id, action);
    set_acting_id(null);

    if (!result.ok) {
      set_action_error(ERROR_MESSAGES[result.code ?? ''] ?? UNKNOWN_ERROR_MESSAGE);
      return;
    }
    reload(); // refresca la lista con el estado real del servidor
  }

  function confirm_remove(member: AgencyMemberRow): void {
    Alert.alert(
      'Dar de baja',
      `¿Seguro que quieres dar de baja a ${member.full_name ?? 'este miembro'}? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Dar de baja',
          style: 'destructive',
          onPress: () => { void run_action(member, 'remove'); },
        },
      ],
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: 'minimal',
          title: 'Miembros',
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontFamily: 'HankenGrotesk_600SemiBold',
            color: colors.ink,
            fontSize: 17,
          },
        }}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scroll_content}>
        {action_error !== null && (
          <View style={styles.error_box}>
            <Text style={styles.error_text}>{action_error}</Text>
          </View>
        )}

        {list_loading && (
          <View style={styles.center_inline}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}

        {!list_loading && list_error && (
          <Text style={styles.empty_text}>No se pudo cargar la lista de miembros.</Text>
        )}

        {!list_loading && !list_error && members.length === 0 && (
          <Text style={styles.empty_text}>Tu inmobiliaria todavía no tiene miembros.</Text>
        )}

        {!list_loading && !list_error && members.map((member) => (
          <MemberCard
            key={member.id}
            member={member}
            busy={acting_id === member.id}
            onSuspend={() => { void run_action(member, 'suspend'); }}
            onReactivate={() => { void run_action(member, 'reactivate'); }}
            onRemove={() => confirm_remove(member)}
          />
        ))}
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// MemberCard — fila de miembro con acciones (owner nunca muestra acciones)
// ---------------------------------------------------------------------------

interface MemberCardProps {
  member: AgencyMemberRow;
  busy: boolean;
  onSuspend: () => void;
  onReactivate: () => void;
  onRemove: () => void;
}

function MemberCard({ member, busy, onSuspend, onReactivate, onRemove }: MemberCardProps) {
  const is_owner_row = member.member_role === 'owner';
  const show_actions = !is_owner_row && member.status !== 'removed';

  return (
    <View style={styles.card}>
      <View style={styles.card_row}>
        {member.profile_photo_url !== null ? (
          <Image source={{ uri: member.profile_photo_url }} style={styles.avatar} />
        ) : (
          <UserCircle size={40} color={colors.gray_1} weight="fill" />
        )}

        <View style={styles.card_info}>
          <Text style={styles.name} numberOfLines={1}>
            {member.full_name ?? 'Sin nombre'}
          </Text>
          <Text style={styles.role}>{ROLE_LABEL[member.member_role] ?? member.member_role}</Text>
        </View>

        <View style={[styles.status_pill, { borderColor: STATUS_COLOR[member.status] ?? colors.gray_2 }]}>
          <Text style={[styles.status_text, { color: STATUS_COLOR[member.status] ?? colors.gray_2 }]}>
            {STATUS_LABEL[member.status] ?? member.status}
          </Text>
        </View>
      </View>

      {busy && (
        <View style={styles.actions}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}

      {!busy && show_actions && (
        <View style={styles.actions}>
          {member.status === 'active' && (
            <Pressable
              style={styles.action_btn}
              onPress={onSuspend}
              accessibilityRole="button"
              accessibilityLabel={`Suspender a ${member.full_name ?? 'miembro'}`}
            >
              <Text style={styles.action_text}>Suspender</Text>
            </Pressable>
          )}
          {member.status === 'suspended' && (
            <Pressable
              style={styles.action_btn}
              onPress={onReactivate}
              accessibilityRole="button"
              accessibilityLabel={`Reactivar a ${member.full_name ?? 'miembro'}`}
            >
              <Text style={styles.action_text}>Reactivar</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.action_btn, styles.action_btn_destructive]}
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Dar de baja a ${member.full_name ?? 'miembro'}`}
          >
            <Text style={[styles.action_text, styles.action_text_destructive]}>Dar de baja</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos — modo gestión-claro (mismo registro que agency/invitations.tsx)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  center_inline: {
    paddingVertical: spacing.s_40,
    alignItems: 'center',
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll_content: {
    padding: spacing.s_20,
    paddingBottom: spacing.s_40,
    gap: spacing.s_12,
  },

  error_box: {
    backgroundColor: colors.danger + '14',
    borderRadius: radii.r_8,
    borderWidth: 1,
    borderColor: colors.danger + '44',
    padding: spacing.s_12,
  },
  error_text: {
    ...type_scale.caption,
    color: colors.danger,
  },

  empty_text: {
    ...type_scale.body,
    color: colors.gray_3,
    textAlign: 'center',
    paddingVertical: spacing.s_40,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.paper_3,
    padding: spacing.s_16,
    gap: spacing.s_12,
  },
  card_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radii.r_pill,
  },
  card_info: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...type_scale.body,
    color: colors.ink,
    fontFamily: 'HankenGrotesk_600SemiBold',
  },
  role: {
    ...type_scale.caption,
    color: colors.gray_2,
    textTransform: 'none',
    letterSpacing: 0,
  },

  status_pill: {
    borderRadius: radii.r_pill,
    borderWidth: 1,
    paddingHorizontal: spacing.s_8,
    paddingVertical: 4,
  },
  status_text: {
    ...type_scale.caption,
    letterSpacing: 0.4,
    fontSize: 11,
  },

  actions: {
    flexDirection: 'row',
    gap: spacing.s_8,
  },
  action_btn: {
    flex: 1,
    borderRadius: radii.r_8,
    borderWidth: 1,
    borderColor: colors.paper_3,
    paddingVertical: spacing.s_8,
    alignItems: 'center',
  },
  action_btn_destructive: {
    borderColor: colors.danger + '55',
  },
  action_text: {
    ...type_scale.caption,
    color: colors.ink,
    textTransform: 'none',
    letterSpacing: 0,
  },
  action_text_destructive: {
    color: colors.danger,
  },
});
