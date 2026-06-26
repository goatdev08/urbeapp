/**
 * /admin/agencies/[id] — Detalle de inmobiliaria.
 *
 * Subtarea 7.7 — Build invitation code display screen with copy button
 * and agency members list.
 *
 * Muestra:
 * 1. Header con el nombre de la agencia.
 * 2. Bloque de credenciales de un solo uso — SOLO si plain_token /
 *    invite_action_link llegan por params (recién creada desde el form).
 *    Al volver desde la lista NO estarán: el token se guarda hasheado.
 * 3. Lista de miembros (agency_members JOIN users) con badge de rol y estado.
 *
 * Estética: utilitaria/clara — consistente con admin/index.tsx y create.tsx.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/types/database';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type MemberRole = Database['public']['Enums']['agency_member_role'];
type MemberStatus = Database['public']['Enums']['agency_member_status'];

interface MemberUser {
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface MemberRow {
  id: string;
  member_role: MemberRole;
  status: MemberStatus;
  joined_at: string;
  users: MemberUser | null;
}

// ---------------------------------------------------------------------------
// Helpers de presentación
// ---------------------------------------------------------------------------

function format_member_name(user: MemberUser | null): string {
  if (!user) return 'Usuario desconocido';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return full.length > 0 ? full : user.email;
}

function format_role(role: MemberRole): string {
  return role === 'owner' ? 'Propietario' : 'Agente';
}

function role_color(role: MemberRole): string {
  return role === 'owner' ? COLOR_SALVIA : '#4A90D9';
}

function format_date(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Subcomponente: fila de miembro
// ---------------------------------------------------------------------------

interface MemberItemProps {
  item: MemberRow;
}

function MemberItem({ item }: MemberItemProps): React.ReactElement {
  const name = format_member_name(item.users);
  const email = item.users?.email ?? '';
  const badge_color = role_color(item.member_role);

  return (
    <View style={styles.member_card}>
      <View style={styles.member_header}>
        <Text style={styles.member_name} numberOfLines={1}>
          {name}
        </Text>
        <View style={[styles.badge, { backgroundColor: badge_color + '22' }]}>
          <Text style={[styles.badge_text, { color: badge_color }]}>
            {format_role(item.member_role)}
          </Text>
        </View>
      </View>
      {email.length > 0 && (
        <Text style={styles.member_email} numberOfLines={1}>
          {email}
        </Text>
      )}
      <Text style={styles.member_date}>
        {item.status === 'active' ? 'Activo desde ' : 'Removido · '}
        {format_date(item.joined_at)}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Subcomponente: tarjeta copiable
// ---------------------------------------------------------------------------

interface CopyCardProps {
  label: string;
  value: string;
  monospace?: boolean;
  copied: boolean;
  on_copy: () => void;
}

function CopyCard({
  label,
  value,
  monospace = false,
  copied,
  on_copy,
}: CopyCardProps): React.ReactElement {
  return (
    <View style={styles.copy_card}>
      <Text style={styles.copy_label}>{label}</Text>
      <Text
        style={[styles.copy_value, monospace ? styles.copy_monospace : null]}
        selectable
        numberOfLines={monospace ? 1 : undefined}
      >
        {value}
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.copy_button,
          pressed && styles.copy_button_pressed,
          copied ? styles.copy_button_success : null,
        ]}
        onPress={on_copy}
        accessibilityRole="button"
        accessibilityLabel={`Copiar ${label}`}
      >
        <Text
          style={[
            styles.copy_button_text,
            copied ? styles.copy_button_text_success : null,
          ]}
        >
          {copied ? 'Copiado ✓' : 'Copiar'}
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

export default function AgencyDetailScreen(): React.ReactElement {
  const router = useRouter();
  const { id, plain_token, invite_action_link } = useLocalSearchParams<{
    id: string;
    plain_token?: string;
    invite_action_link?: string;
  }>();

  const has_credentials =
    (plain_token !== undefined && plain_token.length > 0) ||
    (invite_action_link !== undefined && invite_action_link.length > 0);

  const [agency_name, set_agency_name] = useState<string>('');
  const [members, set_members] = useState<MemberRow[]>([]);
  const [is_loading, set_is_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [copied_field, set_copied_field] = useState<'token' | 'link' | null>(
    null,
  );

  const copy_timeout_ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy_to_clipboard = useCallback(
    async (value: string, field: 'token' | 'link') => {
      await Clipboard.setStringAsync(value);
      set_copied_field(field);
      if (copy_timeout_ref.current !== null) {
        clearTimeout(copy_timeout_ref.current);
      }
      copy_timeout_ref.current = setTimeout(() => {
        set_copied_field(null);
      }, 2000);
    },
    [],
  );

  const load_data = useCallback(async () => {
    set_is_loading(true);
    set_error(null);

    const [agency_result, members_result] = await Promise.all([
      supabase.from('agencies').select('name').eq('id', id).single(),
      supabase
        .from('agency_members')
        .select('id, member_role, status, joined_at, users(first_name, last_name, email)')
        .eq('agency_id', id)
        .order('joined_at'),
    ]);

    if (agency_result.error !== null) {
      set_error('No se pudo cargar la inmobiliaria. Inténtalo de nuevo.');
      set_is_loading(false);
      return;
    }

    set_agency_name(agency_result.data.name);

    if (members_result.error !== null) {
      set_error('No se pudieron cargar los miembros. Inténtalo de nuevo.');
      set_is_loading(false);
      return;
    }

    // Supabase embeds users as a single object (many-to-one FK); cast to our interface.
    set_members((members_result.data ?? []) as unknown as MemberRow[]);
    set_is_loading(false);
  }, [id]);

  useEffect(() => {
    void load_data();
    return () => {
      if (copy_timeout_ref.current !== null) {
        clearTimeout(copy_timeout_ref.current);
      }
    };
  }, [load_data]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={styles.back_button}
        >
          <Text style={styles.back_text}>← Volver</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {agency_name.length > 0 ? agency_name : 'Inmobiliaria'}
        </Text>
      </View>

      {is_loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLOR_SALVIA} />
        </View>
      ) : error !== null ? (
        <View style={styles.center}>
          <Text style={styles.error_text}>{error}</Text>
          <Pressable
            style={styles.retry_button}
            onPress={() => void load_data()}
            accessibilityRole="button"
            accessibilityLabel="Reintentar carga"
          >
            <Text style={styles.retry_text}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list_content}
          ListHeaderComponent={
            <ListHeader
              has_credentials={has_credentials}
              plain_token={plain_token}
              invite_action_link={invite_action_link}
              copied_field={copied_field}
              members_count={members.length}
              on_copy_token={() => {
                if (plain_token !== undefined) {
                  void copy_to_clipboard(plain_token, 'token');
                }
              }}
              on_copy_link={() => {
                if (invite_action_link !== undefined) {
                  void copy_to_clipboard(invite_action_link, 'link');
                }
              }}
            />
          }
          renderItem={({ item }) => <MemberItem item={item} />}
          ListEmptyComponent={
            <View style={styles.empty_state}>
              <Text style={styles.empty_text}>
                Aún no hay miembros en esta inmobiliaria.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Subcomponente: encabezado de la lista (credenciales + título sección)
// Extraído para evitar recrearlo en cada render dentro del renderItem.
// ---------------------------------------------------------------------------

interface ListHeaderProps {
  has_credentials: boolean;
  plain_token: string | undefined;
  invite_action_link: string | undefined;
  copied_field: 'token' | 'link' | null;
  members_count: number;
  on_copy_token: () => void;
  on_copy_link: () => void;
}

function ListHeader({
  has_credentials,
  plain_token,
  invite_action_link,
  copied_field,
  members_count,
  on_copy_token,
  on_copy_link,
}: ListHeaderProps): React.ReactElement {
  return (
    <View>
      {has_credentials && (
        <View style={styles.credentials_block}>
          {/* Aviso de uso único */}
          <View style={styles.credentials_warning}>
            <Text style={styles.credentials_warning_text}>
              Estas credenciales se muestran UNA sola vez. El token se guarda
              hasheado y no estará disponible al volver a entrar desde la lista.
            </Text>
          </View>

          {plain_token !== undefined && plain_token.length > 0 && (
            <CopyCard
              label="Código de invitación"
              value={plain_token}
              monospace
              copied={copied_field === 'token'}
              on_copy={on_copy_token}
            />
          )}

          {invite_action_link !== undefined &&
            invite_action_link.length > 0 && (
              <CopyCard
                label="Link de invitación (propietario)"
                value={invite_action_link}
                copied={copied_field === 'link'}
                on_copy={on_copy_link}
              />
            )}
        </View>
      )}

      {/* Encabezado de la sección de miembros */}
      <Text style={styles.section_title}>
        Miembros{members_count > 0 ? ` (${members_count})` : ''}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos — utilitaria/clara (consistente con admin/index.tsx y create.tsx)
// ---------------------------------------------------------------------------

const COLOR_BG = '#FAFAF8';
const COLOR_BORDER = '#E5E7EB';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_SALVIA = '#5A8A5E';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR_BG,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_BORDER,
    backgroundColor: COLOR_BG,
  },
  back_button: {
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  back_text: {
    fontSize: 15,
    color: COLOR_SALVIA,
    fontWeight: '500',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLOR_TEXT_PRIMARY,
    letterSpacing: -0.3,
  },

  // ── Lista ─────────────────────────────────────────────────────────────────
  list_content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 48,
  },

  // ── Bloque de credenciales de un solo uso ─────────────────────────────────
  credentials_block: {
    marginBottom: 24,
  },
  credentials_warning: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 12,
    marginBottom: 12,
  },
  credentials_warning_text: {
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },

  // ── Tarjeta copiable ──────────────────────────────────────────────────────
  copy_card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    padding: 16,
    marginBottom: 10,
  },
  copy_label: {
    fontSize: 12,
    fontWeight: '700',
    color: COLOR_TEXT_SECONDARY,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  copy_value: {
    fontSize: 16,
    color: COLOR_TEXT_PRIMARY,
    lineHeight: 22,
    marginBottom: 12,
  },
  copy_monospace: {
    fontFamily: 'monospace',
    fontSize: 18,
    letterSpacing: 1.5,
    fontWeight: '600',
  },
  copy_button: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLOR_SALVIA,
  },
  copy_button_pressed: {
    opacity: 0.75,
  },
  copy_button_success: {
    backgroundColor: COLOR_SALVIA,
    borderColor: COLOR_SALVIA,
  },
  copy_button_text: {
    fontSize: 14,
    fontWeight: '600',
    color: COLOR_SALVIA,
  },
  copy_button_text_success: {
    color: '#FFFFFF',
  },

  // ── Sección de miembros ───────────────────────────────────────────────────
  section_title: {
    fontSize: 13,
    fontWeight: '700',
    color: COLOR_TEXT_SECONDARY,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 14,
  },

  // ── Tarjeta de miembro ────────────────────────────────────────────────────
  member_card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    padding: 14,
    marginBottom: 10,
  },
  member_header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  member_name: {
    fontSize: 15,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    flex: 1,
    marginRight: 8,
  },
  member_email: {
    fontSize: 13,
    color: COLOR_TEXT_SECONDARY,
    marginBottom: 4,
  },
  member_date: {
    fontSize: 12,
    color: COLOR_TEXT_SECONDARY,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badge_text: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Estado vacío ──────────────────────────────────────────────────────────
  empty_state: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  empty_text: {
    fontSize: 15,
    color: COLOR_TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Estado loading / error ────────────────────────────────────────────────
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  error_text: {
    fontSize: 15,
    color: '#D94A4A',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  retry_button: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLOR_SALVIA,
  },
  retry_text: {
    fontSize: 15,
    fontWeight: '600',
    color: COLOR_SALVIA,
  },
});
