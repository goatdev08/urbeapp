/**
 * LeadExpandedView — vista expandida de un lead en modal bottom-sheet.
 *
 * Subtarea 15.4 — parte presentacional.
 *
 * Contenido:
 *   - Lead header: avatar, nombre y dirección de propiedad de origen.
 *   - Selector de estado: 7 opciones con etiqueta y badge; resalta estado actual.
 *   - Spinner / disabled durante is_updating.
 *   - Error inline si la EF rechaza.
 *
 * Fuera de alcance (subtarea 15.5):
 *   textarea de notas, botón "Ver propiedad", botón WhatsApp.
 *
 * ponytail: Modal nativo de RN — sin dependencia de bottom-sheet externa.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import { router } from 'expo-router';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { open_whatsapp } from '../../property-detail/utils/whatsapp';

import { ALL_LEAD_STATUSES, get_status_meta } from '../lead_status_meta';
import type { AgentLead, LeadStatus } from '../types';
import { useUpdateLeadStatus } from '../hooks/useUpdateLeadStatus';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LeadExpandedViewProps {
  lead: AgentLead;
  visible: boolean;
  /** Cierra el modal sin acción (tap en overlay, botón ×). */
  onClose: () => void;
  /**
   * Llamado por el hook tras éxito; el padre puede hacer refetch + cerrar.
   * onClose no se llama aquí — es responsabilidad del padre para sincronizar
   * el refetch antes de desmontar.
   */
  onSuccess: () => void;
  /**
   * Modo solo lectura: oculta el selector de estado y las notas editables.
   * Se activa cuando el owner de la agencia abre un lead de OTRO agente — puede
   * verlo (RLS lo permite) pero no editarlo (la EF `update-lead-status` solo
   * autoriza al agente dueño). Sin esto, cualquier cambio devolvería un error
   * UNAUTHORIZED_AGENT confuso. La seguridad real la imponen la EF y RLS; esto
   * es solo UX. Default false → comportamiento del agente sin cambios.
   */
  readOnly?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function get_initial(full_name: string | null): string {
  if (!full_name) return '?';
  return (full_name[0] ?? '?').toUpperCase();
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function LeadExpandedView({
  lead,
  visible,
  onClose,
  onSuccess,
  readOnly = false,
}: LeadExpandedViewProps): React.JSX.Element {
  const { update_status, is_updating, error } = useUpdateLeadStatus({ onSuccess });

  // ── Nota interna ─────────────────────────────────────────────────────────────
  const [note, set_note] = useState(lead.internal_notes ?? '');

  // Reset cuando cambia el lead (el modal abre un lead distinto)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza el input local (note) con lead cuando cambia lead.id.
    set_note(lead.internal_notes ?? '');
  }, [lead.id]);

  async function handle_status_select(new_status: LeadStatus): Promise<void> {
    if (readOnly) return; // el owner viendo un lead ajeno no puede editar
    if (is_updating) return;
    if (new_status === lead.status) return; // ya está en ese estado
    // EC-8: note omitido del body si vacío (el hook controla el spread condicional)
    const trimmed = note.trim();
    await update_status(lead.id, new_status, trimmed.length > 0 ? trimmed : undefined);
  }

  const display_name = lead.full_name ?? 'Usuario sin nombre';
  const current_meta = get_status_meta(lead.status);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={is_updating ? undefined : onClose}
      statusBarTranslucent
    >
      {/* Overlay: tap para cerrar (solo cuando no está actualizando) */}
      <TouchableWithoutFeedback
        onPress={is_updating ? undefined : onClose}
        accessibilityLabel="Cerrar detalle de lead"
      >
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      {/* Sheet — KAV sube el sheet cuando el teclado sube (iOS) */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.sheet}>

        {/* Handle decorativo */}
        <View style={styles.handle_wrap}>
          <View style={styles.handle} />
        </View>

        {/* Cabecera: avatar + nombre + propiedad de origen */}
        <View style={styles.lead_header}>

          {/* Avatar */}
          <View style={styles.avatar}>
            {lead.profile_photo_url !== null ? (
              <Image
                source={{ uri: lead.profile_photo_url }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.avatar_placeholder]}>
                <Text style={styles.avatar_initial}>{get_initial(lead.full_name)}</Text>
              </View>
            )}
          </View>

          {/* Nombre y propiedad */}
          <View style={styles.lead_info}>
            <Text style={styles.lead_name} numberOfLines={1}>
              {display_name}
            </Text>
            {lead.origin_property_address !== null && (
              <Text style={styles.lead_address} numberOfLines={1}>
                {lead.origin_property_address}
              </Text>
            )}
          </View>

          {/* Botón cerrar */}
          <Pressable
            onPress={onClose}
            disabled={is_updating}
            style={styles.close_btn}
            hitSlop={8}
            accessibilityLabel="Cerrar"
          >
            <Text style={styles.close_icon}>✕</Text>
          </Pressable>

        </View>

        {/* Divisor */}
        <View style={styles.divider} />

        {/* Sección de estado — read-only (owner viendo lead ajeno) o selector editable */}
        <Text style={styles.section_title}>{readOnly ? 'Estado' : 'Cambiar estado'}</Text>

        {readOnly ? (
          <View style={styles.readonly_status_wrap}>
            <View style={styles.status_row}>
              <View style={[styles.status_dot, { backgroundColor: current_meta.bg }]} />
              <View style={[styles.status_badge, { backgroundColor: current_meta.bg }]}>
                <Text style={[styles.status_badge_text, { color: current_meta.text }]}>
                  {current_meta.label}
                </Text>
              </View>
            </View>
            <Text style={styles.readonly_hint}>
              Solo lectura · este lead pertenece a otro agente de tu equipo
            </Text>
          </View>
        ) : (
        <>
        <ScrollView
          style={styles.status_list}
          contentContainerStyle={styles.status_list_content}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!is_updating}
        >
          {ALL_LEAD_STATUSES.map((s) => {
            const meta       = get_status_meta(s);
            const is_current = s === lead.status;
            const is_active  = !is_updating;

            return (
              <Pressable
                key={s}
                onPress={() => { void handle_status_select(s); }}
                disabled={!is_active}
                accessibilityRole="radio"
                accessibilityState={{ checked: is_current, disabled: !is_active }}
                accessibilityLabel={`Estado: ${meta.label}${is_current ? ', seleccionado' : ''}`}
                style={({ pressed }) => [
                  styles.status_row,
                  is_current && styles.status_row_current,
                  pressed && is_active && styles.status_row_pressed,
                ]}
              >
                {/* Dot de color del estado */}
                <View style={[styles.status_dot, { backgroundColor: meta.bg }]} />

                {/* Badge de etiqueta */}
                <View style={[styles.status_badge, { backgroundColor: meta.bg }]}>
                  <Text style={[styles.status_badge_text, { color: meta.text }]}>
                    {meta.label}
                  </Text>
                </View>

                {/* Indicador de estado actual o spinner */}
                {is_updating && is_current ? (
                  <ActivityIndicator size="small" color={colors.primary} style={styles.status_indicator} />
                ) : is_current ? (
                  <Text style={styles.status_check}>✓</Text>
                ) : null}

              </Pressable>
            );
          })}
        </ScrollView>

        {/* Spinner global mientras actualiza (sobre toda la lista) */}
        {is_updating && (
          <View style={styles.updating_row}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.updating_text}>Actualizando estado…</Text>
          </View>
        )}

        {/* Error inline */}
        {error !== null && (
          <View style={styles.error_row}>
            <Text style={styles.error_text}>{error}</Text>
          </View>
        )}
        </>
        )}

        {/* ── Notas internas ─────────────────────────────────────────────────── */}
        <View style={styles.divider_bottom} />
        <Text style={styles.section_title}>Notas internas</Text>
        <TextInput
          style={[styles.notes_input, readOnly && styles.notes_input_readonly]}
          value={readOnly ? (lead.internal_notes ?? '') : note}
          onChangeText={set_note}
          placeholder={readOnly ? 'Sin notas' : 'Añadir nota…'}
          placeholderTextColor={colors.gray_1}
          multiline
          numberOfLines={3}
          editable={!readOnly && !is_updating}
          textAlignVertical="top"
          accessibilityLabel="Notas internas del lead"
        />

        {/* ── Acciones: Ver propiedad + WhatsApp ─────────────────────────────── */}
        <View style={styles.action_row}>
          {lead.origin_property_id !== null && (
            <Pressable
              style={({ pressed }) => [
                styles.action_btn,
                styles.action_btn_property,
                pressed && styles.action_btn_pressed,
              ]}
              onPress={() => { router.push(`/property/${lead.origin_property_id}`); }}
              accessibilityRole="button"
              accessibilityLabel="Ver propiedad de origen"
            >
              <Text style={styles.action_btn_text_dark}>Ver propiedad</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.action_btn,
              styles.action_btn_wa,
              pressed && styles.action_btn_pressed,
              lead.phone === null && styles.action_btn_disabled,
            ]}
            onPress={() => { open_whatsapp(lead.phone, lead.origin_property_address ?? ''); }}
            disabled={lead.phone === null}
            accessibilityRole="button"
            accessibilityLabel="Contactar por WhatsApp"
          >
            <Text style={styles.action_btn_text_light}>WhatsApp</Text>
          </Pressable>
        </View>

      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

// Aumentado en 15.5 para acomodar textarea de notas + fila de botones
const SHEET_MAX_HEIGHT = 680;

const styles = StyleSheet.create({

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30,26,21,0.45)',
  },

  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: radii.r_24,
    borderTopRightRadius: radii.r_24,
    maxHeight: SHEET_MAX_HEIGHT,
    paddingBottom: spacing.s_32,
    // Sombra top (iOS)
    shadowColor: '#1E160C',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 16,
  },

  // ── Handle ──────────────────────────────────────────────────────────────────
  handle_wrap: {
    alignItems: 'center',
    paddingTop: spacing.s_12,
    paddingBottom: spacing.s_4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paper_3,
  },

  // ── Cabecera del lead ────────────────────────────────────────────────────────
  lead_header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    paddingHorizontal: spacing.s_16,
    paddingTop: spacing.s_8,
    paddingBottom: spacing.s_16,
  },

  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.r_pill,
    overflow: 'hidden',
    backgroundColor: colors.primary_tint,
    flexShrink: 0,
  },
  avatar_placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary_tint,
  },
  avatar_initial: {
    fontFamily: fonts.sans_bold,
    fontSize: 20,
    color: colors.primary_deep,
  },

  lead_info: {
    flex: 1,
    gap: 3,
  },
  lead_name: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    color: colors.ink,
    lineHeight: 20,
  },
  lead_address: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
    lineHeight: 16,
  },

  close_btn: {
    padding: spacing.s_4,
    flexShrink: 0,
  },
  close_icon: {
    fontSize: 16,
    color: colors.gray_2,
  },

  // ── Divisor ─────────────────────────────────────────────────────────────────
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.silver,
    marginHorizontal: spacing.s_16,
    marginBottom: spacing.s_12,
  },

  // ── Sección título ───────────────────────────────────────────────────────────
  section_title: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.gray_2,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.s_16,
    marginBottom: spacing.s_8,
  },

  // ── Lista de estados ─────────────────────────────────────────────────────────
  status_list: {
    maxHeight: 280,
  },
  status_list_content: {
    paddingHorizontal: spacing.s_12,
    gap: 4,
    paddingBottom: spacing.s_4,
  },

  status_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_8,
    borderRadius: radii.r_8,
  },
  status_row_current: {
    backgroundColor: colors.paper,
  },
  status_row_pressed: {
    backgroundColor: colors.paper_2,
  },

  status_dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  status_badge: {
    flex: 1,
    alignSelf: 'center',
    borderRadius: radii.r_pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignItems: 'flex-start',
  },
  status_badge_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
  },

  status_indicator: {
    marginLeft: 'auto',
    flexShrink: 0,
  },
  status_check: {
    fontSize: 16,
    color: colors.primary,
    fontFamily: fonts.sans_bold,
    marginLeft: 'auto',
    flexShrink: 0,
  },

  // ── Estado solo lectura (owner viendo lead ajeno) ────────────────────────────
  readonly_status_wrap: {
    paddingHorizontal: spacing.s_16,
    gap: spacing.s_8,
    marginBottom: spacing.s_4,
  },
  readonly_hint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
    lineHeight: 16,
  },

  // ── Actualizando ─────────────────────────────────────────────────────────────
  updating_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    paddingHorizontal: spacing.s_16,
    paddingTop: spacing.s_4,
  },
  updating_text: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.gray_2,
  },

  // ── Error ───────────────────────────────────────────────────────────────────
  error_row: {
    paddingHorizontal: spacing.s_16,
    paddingTop: spacing.s_8,
  },
  error_text: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
  },

  // ── Notas internas ───────────────────────────────────────────────────────────
  divider_bottom: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.silver,
    marginHorizontal: spacing.s_16,
    marginTop: spacing.s_8,
    marginBottom: spacing.s_12,
  },
  notes_input: {
    height: 72,                           // ponytail: altura fija ~3 líneas; scrollea internamente
    marginHorizontal: spacing.s_16,
    marginBottom: spacing.s_12,
    borderWidth: 1,
    borderColor: colors.paper_3,
    borderRadius: radii.r_8,
    paddingHorizontal: spacing.s_12,
    paddingVertical: spacing.s_8,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
    backgroundColor: colors.paper,
  },
  notes_input_readonly: {
    backgroundColor: colors.paper_2,
    color: colors.gray_2,
  },

  // ── Fila de acciones ─────────────────────────────────────────────────────────
  action_row: {
    flexDirection: 'row',
    gap: spacing.s_8,
    paddingHorizontal: spacing.s_16,
  },
  action_btn: {
    flex: 1,
    paddingVertical: spacing.s_12,
    borderRadius: radii.r_8,
    alignItems: 'center',
  },
  action_btn_property: {
    backgroundColor: colors.primary_tint,
  },
  action_btn_wa: {
    backgroundColor: colors.whatsapp,
  },
  action_btn_pressed: {
    opacity: 0.8,
  },
  action_btn_disabled: {
    opacity: 0.4,
  },
  action_btn_text_dark: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.primary_deep,
  },
  action_btn_text_light: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: '#FFFFFF',
  },
});
