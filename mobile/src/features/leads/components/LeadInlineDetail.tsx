/**
 * LeadInlineDetail — ficha expandida de un lead del CRM (subtarea 267.6),
 * renderizada INLINE dentro del renglón de la lista (nunca overlay absoluto
 * sobre scroll, #231; nunca `flex:1` sin altura, #113). Sustituye al Modal
 * bottom-sheet `LeadExpandedView` (se borra en 267.7).
 *
 * Spec visual: sección 4 de mobile/design-previews/267-crm-santiago.html
 * (aprobado). Bloques en el mismo orden que el preview: tarjeta de
 * propiedad de origen · "también sigue N más" · timeline "Lo que hizo" ·
 * barra de 4 tramos + "Siguiente: marcar como…" · caja "Mensaje sugerido" ·
 * WhatsApp/Agendar · nota interna.
 *
 * Datos: useCrmLeadDetail (origen/other_properties) + useLeadActivity
 * (timeline paginado) + useCrmSuggestedMessage (caja verde) + useLeadPhone
 * (WhatsApp) + useUpdateLeadStatus/useUpdateLeadNote (mutaciones). Ninguno
 * de los 4 hooks de lectura falla montando esta ficha si están en `loading`
 * o `error` — cada bloque se degrada a "nada"/"vacío" en vez de bloquear el
 * resto (mismo criterio D-SINFILA/D-SINMSG de los hooks: ausencia ≠ error).
 *
 * 🔴 ponytail (disparador c, CLAUDE.md §0 — techo con los datos reales):
 * `StatusPicker.current` exige un `LeadStatus` crudo, pero NINGUNA RPC
 * nueva del CRM (crm_leads_page, crm_lead_detail) expone el status crudo —
 * solo `status_projected` (proyección 8→4, migraciones 20260906100003:358-
 * 369 y 20260906100004:127-143). La proyección es 1:1 SOLO en 'nuevo'
 * (whatsapp_opened|new comparten el label "Nuevo" — cualquiera se ve
 * idéntico) y 'visita' (visit_scheduled es el ÚNICO status vigente que
 * proyecta ahí). 'contactado' (contacted|interested) y 'cerrado' (4
 * vigentes + legacy) son AMBIGUOS — no hay forma honesta de saber cuál
 * marcar como ✓ en el picker. `status_hint_for_projected` solo resuelve los
 * 2 casos exactos y devuelve null en los ambiguos: StatusPicker pinta la
 * etiqueta PROYECTADA en el badge y ningún ítem lleva ✓ — nunca se adivina
 * ni se muestra un estado falso. Techo: exponer el status crudo en
 * crm_leads_page (derivada hardening(267.6)) lo resuelve exacto sin tocar
 * StatusPicker.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { HouseLine } from 'phosphor-react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { format_price } from '@/lib/formatPrice';
import { open_whatsapp_text } from '../../property-detail/utils/whatsapp';

import { get_status_meta } from '../lead_status_meta';
import { AGENDAR_STATUS, crm_next_action } from '../utils/crm_next_status';
import { format_relative_time } from '../utils/relative_time';
import type { CrmLeadRow, LeadActivityEntry, LeadStatus, ProjectedStatus } from '../types';
import { useCrmLeadDetail } from '../hooks/useCrmLeadDetail';
import { useCrmSuggestedMessage } from '../hooks/useCrmSuggestedMessage';
import { useLeadActivity } from '../hooks/useLeadActivity';
import { useLeadPhone } from '../hooks/useLeadPhone';
import { useUpdateLeadNote } from '../hooks/useUpdateLeadNote';
import { useUpdateLeadStatus } from '../hooks/useUpdateLeadStatus';
import { StatusPicker } from './StatusPicker';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LeadInlineDetailProps {
  lead: CrmLeadRow;
  /** true = el lead pertenece a OTRO agente (owner/admin viendo el equipo, #28). */
  readOnly: boolean;
  /** Llamado tras un cambio de estado/nota exitoso — el padre refresca la página. */
  onChanged: () => void;
}

// ─── Barra de 4 tramos ─────────────────────────────────────────────────────────

const STAGES: { key: ProjectedStatus; label: string }[] = [
  { key: 'nuevo', label: 'Nuevo' },
  { key: 'contactado', label: 'Contactado' },
  { key: 'visita', label: 'Visita' },
  { key: 'cerrado', label: 'Cerrado' },
];

/** Ver el comentario ponytail de cabecera — resuelve exacto solo 'nuevo'/'visita'. */
function status_hint_for_projected(projected: ProjectedStatus): LeadStatus | null {
  if (projected === 'nuevo') return 'whatsapp_opened';
  if (projected === 'visita') return 'visit_scheduled';
  return null; // ambiguo — el picker pinta la etiqueta proyectada y ningún ✓
}

/** Texto de una entrada del timeline "Lo que hizo" — switch mínimo con
 * fallback al `kind` crudo (events_raw.event_type admite valores futuros). */
function describe_activity(entry: LeadActivityEntry): string {
  switch (entry.kind) {
    case 'like':
      return 'Le dio like a tu propiedad';
    case 'save':
      return 'Guardó tu propiedad';
    case 'video_view':
      return 'Vio tu video';
    case 'video_completed':
      return 'Terminó de ver tu video';
    case 'contact_repeat':
      return 'Volvió a contactarte';
    case 'zone_search':
      return 'Buscó en tu zona';
    case 'status_change': {
      const new_status = entry.detail.new_status;
      if (typeof new_status === 'string') {
        return `Cambió de estado a ${get_status_meta(new_status as LeadStatus).label}`;
      }
      return 'Cambió de estado';
    }
    default:
      return entry.kind;
  }
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function LeadInlineDetail({ lead, readOnly, onChanged }: LeadInlineDetailProps): React.JSX.Element {
  const { data: detail } = useCrmLeadDetail(lead.lead_id);
  const { data: activity, hasMore, loadMore } = useLeadActivity(lead.lead_id);
  const { message } = useCrmSuggestedMessage(lead.lead_id);
  const { phone } = useLeadPhone(lead.lead_id);
  const { update_status, is_updating: status_updating, error: status_error } = useUpdateLeadStatus({
    onSuccess: onChanged,
  });
  const { update_note, is_updating: note_updating, error: note_error } = useUpdateLeadNote({
    onSuccess: onChanged,
  });

  const [is_status_open, set_is_status_open] = useState(false);
  const [note, set_note] = useState('');

  const busy = status_updating || note_updating;
  const next_action = crm_next_action(lead.status_projected);
  const current_stage_index = STAGES.findIndex((s) => s.key === lead.status_projected);
  const show_agendar = lead.status_projected === 'nuevo' || lead.status_projected === 'contactado';

  function toggle_status_picker(): void {
    if (readOnly) return;
    set_is_status_open((open) => !open);
  }

  async function handle_primary_press(): Promise<void> {
    if (readOnly || busy) return;
    if (next_action.kind === 'set') {
      await update_status(lead.lead_id, next_action.status);
      return;
    }
    toggle_status_picker();
  }

  async function handle_status_select(new_status: LeadStatus): Promise<void> {
    if (readOnly || busy) return;
    set_is_status_open(false);
    await update_status(lead.lead_id, new_status);
  }

  async function handle_agendar(): Promise<void> {
    if (readOnly || busy) return;
    await update_status(lead.lead_id, AGENDAR_STATUS);
  }

  async function handle_save_note(): Promise<void> {
    if (readOnly || busy) return;
    const trimmed = note.trim();
    if (trimmed.length === 0) return;
    await update_note(lead.lead_id, trimmed);
    set_note('');
  }

  function handle_whatsapp(): void {
    open_whatsapp_text(phone, message ?? '');
  }

  return (
    <View style={styles.container}>
      {readOnly && (
        <View style={styles.readonly_banner}>
          <Text style={styles.readonly_banner_text}>
            Solo lectura · este lead pertenece a otro agente
          </Text>
        </View>
      )}

      {/* Propiedad de origen */}
      {detail?.origin_property != null && (
        <View style={styles.origin_card}>
          <View style={styles.origin_thumb}>
            {detail.origin_property.thumbnail_url !== null ? (
              <Image
                source={{ uri: detail.origin_property.thumbnail_url }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : (
              <HouseLine size={16} color={colors.gray_2} />
            )}
          </View>
          <View style={styles.origin_info}>
            <Text style={styles.origin_addr} numberOfLines={1}>
              {detail.origin_property.address}
            </Text>
            <Text style={styles.origin_price}>{format_price(detail.origin_property.price)}</Text>
          </View>
          <Pressable
            onPress={() => router.push(`/property/${detail.origin_property!.property_id}`)}
            accessibilityRole="button"
            accessibilityLabel="Ver propiedad de origen"
            style={styles.origin_cta}
          >
            <Text style={styles.origin_cta_text}>Ver</Text>
          </Pressable>
        </View>
      )}

      {detail !== null && detail.other_properties > 0 && (
        <Text style={styles.cross_props}>
          También sigue <Text style={styles.bold}>{detail.other_properties}</Text> propiedades tuyas más
        </Text>
      )}

      {/* Lo que hizo */}
      <Text style={styles.eyebrow}>Lo que hizo</Text>
      {activity.length === 0 ? (
        <Text style={styles.empty_text}>Sin actividad registrada todavía.</Text>
      ) : (
        <View style={styles.timeline}>
          {activity.map((entry, idx) => (
            <View key={`${entry.occurred_at}-${idx}`} style={styles.timeline_row}>
              <View style={styles.timeline_dot} />
              <Text style={styles.timeline_time}>{format_relative_time(entry.occurred_at)}</Text>
              <Text style={styles.timeline_text} numberOfLines={1}>
                {describe_activity(entry)}
              </Text>
            </View>
          ))}
        </View>
      )}
      {hasMore && (
        <Pressable
          onPress={() => {
            void loadMore();
          }}
          accessibilityRole="button"
          accessibilityLabel="Ver más actividad"
        >
          <Text style={styles.load_more_text}>Ver más</Text>
        </Pressable>
      )}

      {/* Estado */}
      <Text style={styles.eyebrow}>Estado</Text>
      <View style={styles.status_bar}>
        {STAGES.map((stage, idx) => {
          const is_reached = idx <= current_stage_index;
          return (
            <View key={stage.key} style={styles.status_seg}>
              <View style={[styles.status_fill, is_reached && styles.status_fill_done]} />
              <Text style={[styles.status_label, is_reached && styles.status_label_active]}>
                {stage.label}
              </Text>
            </View>
          );
        })}
      </View>

      {!readOnly && next_action.kind === 'set' && (
        <Text style={styles.next_line}>
          Siguiente: marcar como <Text style={styles.bold}>{next_action.label}</Text>
        </Text>
      )}

      {!readOnly && (
        <Pressable
          onPress={() => {
            void handle_primary_press();
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={
            next_action.kind === 'open_picker'
              ? { expanded: is_status_open, disabled: busy }
              : { disabled: busy }
          }
          accessibilityLabel={
            next_action.kind === 'set' ? `Marcar como ${next_action.label}` : next_action.label
          }
          style={styles.primary_btn}
        >
          <Text style={styles.primary_btn_text}>
            {next_action.kind === 'set' ? `Marcar como ${next_action.label} →` : next_action.label}
          </Text>
        </Pressable>
      )}

      {!readOnly && (
        <Pressable
          onPress={toggle_status_picker}
          accessibilityRole="button"
          accessibilityLabel="Ver los 8 estados vigentes"
        >
          <Text style={styles.more_states_link}>Ver los 8 estados vigentes · más…</Text>
        </Pressable>
      )}

      {!readOnly && is_status_open && (
        <StatusPicker
          current={status_hint_for_projected(lead.status_projected)}
          current_label={STAGES.find((t) => t.key === lead.status_projected)?.label}
          open
          onToggle={toggle_status_picker}
          onSelect={(s) => {
            void handle_status_select(s);
          }}
          disabled={busy}
        />
      )}

      {status_error !== null && <Text style={styles.error_text}>{status_error}</Text>}

      {/* Mensaje sugerido */}
      {message !== null && (
        <View style={styles.msg_box}>
          <Text style={styles.msg_eyebrow}>Mensaje sugerido</Text>
          <Text style={styles.msg_text}>{message}</Text>
        </View>
      )}

      {/* Acciones */}
      <View style={styles.action_row}>
        <Pressable
          onPress={handle_whatsapp}
          disabled={phone === null}
          accessibilityRole="button"
          accessibilityState={{ disabled: phone === null }}
          accessibilityLabel="Contactar por WhatsApp"
          style={[styles.action_btn, styles.action_btn_wa, phone === null && styles.action_btn_disabled]}
        >
          <Text style={styles.action_btn_text_light}>WhatsApp</Text>
        </Pressable>

        {show_agendar && (
          <Pressable
            onPress={() => {
              void handle_agendar();
            }}
            disabled={readOnly || busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: readOnly || busy }}
            accessibilityLabel="Agendar visita"
            style={[
              styles.action_btn,
              styles.action_btn_agendar,
              (readOnly || busy) && styles.action_btn_disabled,
            ]}
          >
            <Text style={styles.action_btn_text_dark}>Agendar</Text>
          </Pressable>
        )}
      </View>

      {/* Nota interna */}
      {readOnly ? (
        <Text style={styles.note_disabled_text}>Notas deshabilitadas en solo lectura</Text>
      ) : (
        <>
          {/* ponytail: sin KeyboardAvoidingView — el padre de esta ficha es el FlatList
              de CrmLeadRow (#231), no un ScrollView propio de este componente; el
              teclado empuja la lista completa al enfocar el input. */}
          <TextInput
            style={styles.note_input}
            value={note}
            onChangeText={set_note}
            placeholder="Agregar nota interna"
            placeholderTextColor={colors.gray_1}
            multiline
            editable={!busy}
            accessibilityLabel="Nota interna del lead"
          />
          {note.trim().length > 0 && (
            <Pressable
              onPress={() => {
                void handle_save_note();
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Guardar nota"
            >
              <Text style={styles.save_note_text}>{note_updating ? 'Guardando…' : 'Guardar nota'}</Text>
            </Pressable>
          )}
          {note_error !== null && <Text style={styles.error_text}>{note_error}</Text>}
        </>
      )}
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.s_12,
    gap: spacing.s_8,
  },

  readonly_banner: {
    backgroundColor: colors.accent_tint,
    borderRadius: radii.r_8,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_12,
  },
  readonly_banner_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: colors.accent_deep,
  },

  bold: {
    fontFamily: fonts.sans_semibold,
  },

  // ── Propiedad de origen ──────────────────────────────────────────────────────
  origin_card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    backgroundColor: colors.paper,
    borderRadius: radii.r_8,
    padding: spacing.s_8,
  },
  origin_thumb: {
    width: 38,
    height: 38,
    borderRadius: radii.r_8,
    backgroundColor: colors.paper_2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  origin_info: {
    flex: 1,
    minWidth: 0,
  },
  origin_addr: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.ink,
  },
  origin_price: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.gray_2,
  },
  origin_cta: {
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_12,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary_tint,
  },
  origin_cta_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: colors.primary_deep,
  },

  cross_props: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
  },

  // ── Lo que hizo ──────────────────────────────────────────────────────────────
  eyebrow: {
    fontFamily: fonts.mono_medium,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.gray_2,
  },
  empty_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
  },
  timeline: {
    gap: spacing.s_4,
  },
  timeline_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
  },
  timeline_dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.temp_hot,
    flexShrink: 0,
  },
  timeline_time: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.gray_2,
    flexShrink: 0,
  },
  timeline_text: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink,
  },
  load_more_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: colors.primary,
  },

  // ── Estado ───────────────────────────────────────────────────────────────────
  status_bar: {
    flexDirection: 'row',
    gap: spacing.s_4,
  },
  status_seg: {
    flex: 1,
    gap: 3,
  },
  status_fill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.paper_3,
  },
  status_fill_done: {
    backgroundColor: colors.primary,
  },
  status_label: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.gray_2,
  },
  status_label_active: {
    fontFamily: fonts.mono_medium,
    color: colors.ink,
  },
  next_line: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
  },

  primary_btn: {
    backgroundColor: colors.primary,
    borderRadius: radii.r_pill,
    paddingVertical: spacing.s_8,
    alignItems: 'center',
  },
  primary_btn_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.on_primary,
  },
  more_states_link: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gray_2,
    textDecorationLine: 'underline',
  },

  error_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.danger,
  },

  // ── Mensaje sugerido ──────────────────────────────────────────────────────────
  msg_box: {
    backgroundColor: colors.primary_tint,
    borderRadius: radii.r_8,
    padding: spacing.s_8,
    gap: 2,
  },
  msg_eyebrow: {
    fontFamily: fonts.mono_medium,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.primary_deep,
  },
  msg_text: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.primary_deep,
    lineHeight: 18,
  },

  // ── Acciones ─────────────────────────────────────────────────────────────────
  action_row: {
    flexDirection: 'row',
    gap: spacing.s_8,
  },
  action_btn: {
    flex: 1,
    paddingVertical: spacing.s_12,
    borderRadius: radii.r_8,
    alignItems: 'center',
  },
  action_btn_wa: {
    backgroundColor: colors.whatsapp,
  },
  action_btn_agendar: {
    backgroundColor: colors.primary_tint,
  },
  action_btn_disabled: {
    opacity: 0.4,
  },
  action_btn_text_light: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.on_primary,
  },
  action_btn_text_dark: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.primary_deep,
  },

  // ── Nota interna ─────────────────────────────────────────────────────────────
  note_input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.paper_3,
    borderRadius: radii.r_8,
    paddingHorizontal: spacing.s_12,
    paddingVertical: spacing.s_8,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink,
    backgroundColor: colors.paper,
    textAlignVertical: 'top',
  },
  note_disabled_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
    opacity: 0.7,
  },
  save_note_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: colors.primary,
    alignSelf: 'flex-end',
  },
});
