/**
 * LeadExpandedView — vista expandida de un lead en modal bottom-sheet.
 *
 * Subtarea 15.4 — parte presentacional.
 * Subtarea 75.6 (§19.7/§19.8) — toggle "en seguimiento" + timeline de solo
 *   lectura del embudo (useLeadStatusHistory).
 * Corrección code review (rama tarea/75-crm-estados-scoring):
 *   - FIX1: el toggle "en seguimiento" ya NO comparte instancia de hook con
 *     "Guardar nota" (esa compartía onSuccess cerraba el sheet y tiraba la
 *     nota sin guardar). Instancia propia + estado local optimista.
 *   - FIX2: el contenido (estado/notas/historial) ahora vive en un
 *     ScrollView acotado por SHEET_MAX_HEIGHT; "Ver propiedad"/"WhatsApp"
 *     quedan FIJOS fuera del scroll — siempre visibles.
 *   - FIX3: el badge del estado actual se muestra SIEMPRE arriba del picker
 *     (antes solo en readOnly) — cubre leads legacy fuera de ALL_LEAD_STATUSES.
 *
 * Contenido:
 *   - Lead header (fijo): avatar, nombre, dirección de propiedad de origen y
 *     toggle de "en seguimiento" (bookmark).
 *   - Aviso de solo lectura (#112, FIJO justo debajo del header): antes vivía
 *     enterrado como texto gris chico dentro del contenido scrolleable, tan
 *     poco visible que el dueño reportó "no me aparece ninguna opción" al
 *     abrir el lead de otro agente — la pantalla parecía rota. Los permisos
 *     NO se amplían (decisión del dueño); esto solo lo explica mejor, como
 *     banner con ícono, mismo lenguaje que role_error_banner de CRMScreen.
 *   - Actividad (#112): ActionStatsBar — reemplaza el puntaje/temperatura de
 *     la 75.6 por los 4 hechos tangibles (like/video completo/guardó/volvió
 *     a ver) + última actividad. `stats` llega ya resuelto por prop (batch
 *     de CRMScreen vía useLeadStats) — sin fetch propio aquí.
 *   - Selector de estado: 8 opciones vigentes con etiqueta y badge; badge del
 *     estado actual SIEMPRE visible arriba (aunque sea legacy). El backend no
 *     impone transiciones (75.1), así que el picker no valida ninguna.
 *   - Spinner / disabled durante is_updating.
 *   - Error inline si la EF rechaza — SIEMPRE en español (los hooks ya lo
 *     garantizan, esta vista solo lo muestra).
 *   - Timeline: historial de cambios de estado (lead_status_history),
 *     más reciente primero, capado a HISTORY_DISPLAY_CAP entradas.
 *
 * ponytail: Modal nativo de RN — sin dependencia de bottom-sheet externa.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { BookmarkSimple, CaretDown, Info } from 'phosphor-react-native';

import { router } from 'expo-router';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { open_whatsapp } from '../../property-detail/utils/whatsapp';

import { ALL_LEAD_STATUSES, get_status_meta } from '../lead_status_meta';
import type { AgentLead, LeadStats, LeadStatus } from '../types';
import { useUpdateLeadStatus } from '../hooks/useUpdateLeadStatus';
import { useUpdateLeadNote } from '../hooks/useUpdateLeadNote';
import { useLeadStatusHistory } from '../hooks/useLeadStatusHistory';
import { format_relative_time } from '../utils/relative_time';
import { ActionStatsBar } from './ActionStatsBar';

// ─── Constantes ───────────────────────────────────────────────────────────────

/** FIX2 — el timeline muestra solo las entradas más recientes; el historial
 * completo sigue en DB, esto es un vistazo rápido dentro del sheet acotado. */
const HISTORY_DISPLAY_CAP = 5;

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
   * FIX1 (code review) — llamado tras un toggle de "en seguimiento" exitoso.
   * A diferencia de onSuccess, NO debe cerrar el sheet: el toggle es una
   * acción rápida que el agente hace sin salir del detalle, muchas veces con
   * una nota sin guardar en curso. El padre solo debe refrescar la lista
   * subyacente (p.ej. pasar `refetch` de useAgentLeads). Default: no-op.
   */
  onFollowUpChange?: () => void;
  /**
   * Modo solo lectura: oculta el selector de estado y las notas editables.
   * Se activa cuando el owner de la agencia abre un lead de OTRO agente — puede
   * verlo (RLS lo permite) pero no editarlo (la EF `update-lead-status` solo
   * autoriza al agente dueño). Sin esto, cualquier cambio devolvería un error
   * UNAUTHORIZED_AGENT confuso. La seguridad real la imponen la EF y RLS; esto
   * es solo UX. Default false → comportamiento del agente sin cambios.
   */
  readOnly?: boolean;
  /**
   * Estadísticas tangibles de actividad (#112) — undefined = el usuario aún
   * no dio like a la propiedad de origen (ver ActionStatsBar/useLeadStats).
   * Resuelto por el padre en batch, esta vista NO hace fetch propio.
   */
  stats?: LeadStats | undefined;
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
  onFollowUpChange = () => {},
  readOnly = false,
  stats,
}: LeadExpandedViewProps): React.JSX.Element {
  const { update_status, is_updating, error } = useUpdateLeadStatus({ onSuccess });
  const {
    update_note,
    is_updating: is_saving_note,
    error: note_error,
  } = useUpdateLeadNote({ onSuccess });

  // FIX1 (code review) — instancia INDEPENDIENTE del hook de notas para el
  // toggle "en seguimiento". Comparte la misma EF (update-lead-note) pero con
  // su propio onSuccess (onFollowUpChange, NO cierra el sheet). Si el toggle
  // reusara la instancia de "Guardar nota", su onSuccess (que sí cierra el
  // sheet vía onSuccess del padre) se disparía al tocar el bookmark y tiraría
  // cualquier nota sin guardar en el textarea.
  const follow_up_hook = useUpdateLeadNote({ onSuccess: onFollowUpChange });

  const { history, loading: history_loading, error: history_error } = useLeadStatusHistory(lead.id);

  // ── Nota interna ─────────────────────────────────────────────────────────────
  const [note, set_note] = useState(lead.internal_notes ?? '');

  // FIX1 — estado LOCAL optimista de "en seguimiento". El sheet permanece
  // abierto tras el toggle, así que `lead.is_follow_up` (prop) nunca se
  // actualiza mientras el modal sigue montado (el padre no re-sincroniza
  // `selected_lead` en cada refetch) — sin este estado local el ícono del
  // bookmark quedaría congelado en el valor con el que se abrió el lead.
  const [is_follow_up, set_is_follow_up] = useState(lead.is_follow_up);

  // Desplegable de estados (#117, pedido del dueño: una lista que se despliega
  // en vez de 8 botones sueltos). Cerrado por defecto: los 8 estados ocupaban
  // casi todo el alto del sheet y empujaban notas e historial fuera de vista.
  const [is_status_open, set_is_status_open] = useState(false);

  // Reset cuando cambia el lead (el modal abre un lead distinto). Deliberado:
  // solo debe re-sincronizar en el cambio de lead.id, NO en cada cambio de
  // internal_notes/is_follow_up (eso pisaría lo que el agente esté editando
  // localmente) — de ahí los deps incompletos a propósito.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza note/is_follow_up (estado local) con lead cuando cambia lead.id.
    set_note(lead.internal_notes ?? '');
    set_is_follow_up(lead.is_follow_up);
    set_is_status_open(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver comentario arriba: solo lead.id dispara el resync.
  }, [lead.id]);

  /** Abre/cierra la lista de estados (#117). No-op en readOnly. */
  function toggle_status_list(): void {
    if (readOnly) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    set_is_status_open((open) => !open);
  }

  async function handle_status_select(new_status: LeadStatus): Promise<void> {
    if (readOnly) return; // el owner viendo un lead ajeno no puede editar
    if (is_updating || follow_up_hook.is_updating) return;
    // Se cierra SIEMPRE, incluso al re-elegir el estado actual (que sale por el
    // return de abajo): tocar una opción siempre colapsa la lista.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    set_is_status_open(false);
    if (new_status === lead.status) return; // ya está en ese estado
    // EC-8: note omitido del body si vacío (el hook controla el spread condicional)
    const trimmed = note.trim();
    await update_status(lead.id, new_status, trimmed.length > 0 ? trimmed : undefined);
  }

  // Botón "Guardar nota" — camino ADICIONAL al envío de nota vía cambio de
  // estado (arriba); no lo reemplaza (retrocompat #15).
  const note_has_changes = note.trim() !== (lead.internal_notes ?? '');

  async function handle_save_note(): Promise<void> {
    if (readOnly) return;
    if (is_saving_note || is_updating || follow_up_hook.is_updating) return;
    await update_note(lead.id, note.trim());
  }

  // Toggle "en seguimiento" (75.6, §19.7 + FIX1) — solo is_follow_up en el
  // body, sin tocar la nota. Optimista: refleja el cambio de inmediato (sin
  // esperar la EF ni cerrar el sheet) y revierte si la EF rechaza.
  async function handle_toggle_follow_up(): Promise<void> {
    if (readOnly) return;
    if (is_saving_note || is_updating || follow_up_hook.is_updating) return;
    const next = !is_follow_up;
    set_is_follow_up(next);
    await follow_up_hook.update_note(lead.id, undefined, next);
    if (follow_up_hook.error !== null) {
      set_is_follow_up(!next); // la EF rechazó el cambio — revierte el ícono
    }
  }

  const display_name = lead.full_name ?? 'Usuario sin nombre';
  const current_meta = get_status_meta(lead.status);
  const visible_history = history.slice(0, HISTORY_DISPLAY_CAP);
  const any_note_action_busy = is_saving_note || is_updating || follow_up_hook.is_updating;

  // #143.6: el Modal es translúcido (edge-to-edge) — con la navegación por
  // BOTONES de Android (~48dp) el paddingBottom fijo dejaba "Ver propiedad"/
  // "WhatsApp" TAPADOS por la barra del sistema. insets.bottom refleja la barra
  // real (gestos ≈ 24, botones ≈ 48, iOS home indicator ≈ 34). El maxHeight
  // fijo (680) además desbordaba pantallas cortas → se acota al 88% de la
  // ventana real.
  const insets = useSafeAreaInsets();
  const { height: window_height } = useWindowDimensions();
  const sheet_adaptive_style = {
    maxHeight: Math.min(SHEET_MAX_HEIGHT, window_height * 0.88),
    paddingBottom: insets.bottom + spacing.s_16,
  };

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
      <View style={[styles.sheet, sheet_adaptive_style]}>

        {/* Handle decorativo */}
        <View style={styles.handle_wrap}>
          <View style={styles.handle} />
        </View>

        {/* Cabecera (FIJA, fuera del scroll — FIX2): avatar + nombre +
            propiedad de origen + toggle de "en seguimiento" */}
        <View style={styles.lead_header}>

          {/* Avatar */}
          <View style={styles.avatar}>
            {lead.profile_photo_url !== null ? (
              <Image
                source={{ uri: lead.profile_photo_url }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
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

          {/* Toggle "en seguimiento" (75.6 + FIX1) — oculto en readOnly */}
          {!readOnly && (
            <Pressable
              onPress={() => { void handle_toggle_follow_up(); }}
              disabled={any_note_action_busy}
              style={({ pressed }) => [
                styles.follow_up_btn,
                is_follow_up && styles.follow_up_btn_active,
                follow_up_hook.is_updating && styles.follow_up_btn_busy,
                pressed && styles.action_btn_pressed,
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: is_follow_up, disabled: any_note_action_busy }}
              accessibilityLabel={is_follow_up ? 'Quitar de seguimiento' : 'Marcar en seguimiento'}
            >
              <BookmarkSimple
                size={18}
                weight={is_follow_up ? 'fill' : 'regular'}
                color={is_follow_up ? colors.accent_deep : colors.gray_2}
              />
            </Pressable>
          )}

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

        {/* Aviso de solo lectura (#112) — FIJO, justo debajo del header, con
            ícono: antes era un texto gris enterrado en el scroll (el dueño
            reportó "no me aparece ninguna opción"). Permisos sin cambios —
            solo se explica mejor. */}
        {readOnly && (
          <View style={styles.readonly_banner}>
            <Info size={16} color={colors.accent_deep} weight="fill" />
            <Text style={styles.readonly_banner_text}>
              Solo lectura · este lead pertenece a otro agente de tu equipo
            </Text>
          </View>
        )}

        {/* Error del toggle "en seguimiento" — separado del error de nota/estado */}
        {follow_up_hook.error !== null && (
          <View style={styles.error_row}>
            <Text style={styles.error_text}>{follow_up_hook.error}</Text>
          </View>
        )}

        {/* Divisor */}
        <View style={styles.divider} />

        {/* ── Contenido scrollable (FIX2): estado, notas, historial ──────────
            El sheet tiene maxHeight fijo (SHEET_MAX_HEIGHT); este bloque es el
            ÚNICO que scrollea (flex:1 dentro de un contenedor con maxHeight)
            para que "Ver propiedad"/"WhatsApp" — fuera de este ScrollView, más
            abajo — SIEMPRE queden visibles sin importar cuánto crezcan las
            notas o el historial. El picker de estados dejó de tener su propio
            ScrollView interno: dos ScrollView verticales anidados producen
            scroll conflictivo; ahora el scroll lo controla únicamente este
            contenedor. */}
        <ScrollView
          style={styles.scroll_content}
          contentContainerStyle={styles.scroll_content_container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* Actividad (#112) — barra de acciones tangible, reemplaza el
              puntaje/temperatura de la 75.6. */}
          <Text style={styles.section_title}>Actividad</Text>
          <View style={styles.stats_wrap}>
            <ActionStatsBar stats={stats} />
          </View>
          <View style={styles.divider_bottom} />

          {/* Sección de estado — título varía en readOnly, badge SIEMPRE visible */}
          <Text style={styles.section_title}>{readOnly ? 'Estado' : 'Cambiar estado'}</Text>

          {/* Disparador del desplegable (#117) — es TAMBIÉN el badge del estado
              actual, que sigue SIEMPRE visible (FIX3): un lead legacy
              (in_progress/closed_won) no aparece en ALL_LEAD_STATUSES, así que
              sin esto no habría NINGÚN indicador del estado actual. En readOnly
              no es tappable y no lleva caret — se ve como la etiqueta que es.
              El aviso de solo lectura vive en el banner fijo debajo del header. */}
          <View style={styles.current_status_wrap}>
            <Pressable
              onPress={toggle_status_list}
              disabled={readOnly || is_updating || follow_up_hook.is_updating}
              accessibilityRole={readOnly ? 'text' : 'button'}
              accessibilityState={readOnly ? undefined : { expanded: is_status_open }}
              accessibilityLabel={
                readOnly
                  ? `Estado: ${current_meta.label}`
                  : `Estado actual: ${current_meta.label}. ${is_status_open ? 'Cerrar' : 'Abrir'} la lista de estados`
              }
              style={({ pressed }) => [
                styles.status_trigger,
                pressed && !readOnly && styles.status_row_pressed,
              ]}
            >
              <View style={[styles.status_dot, { backgroundColor: current_meta.bg }]} />
              <View style={[styles.status_badge, { backgroundColor: current_meta.bg }]}>
                <Text style={[styles.status_badge_text, { color: current_meta.text }]}>
                  {current_meta.label}
                </Text>
              </View>

              {/* Empuja el caret al extremo derecho sin tocar el badge. */}
              <View style={styles.status_trigger_spacer} />

              {!readOnly && (
                is_updating ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <CaretDown
                    size={16}
                    weight="bold"
                    color={colors.gray_2}
                    style={{ transform: [{ rotate: is_status_open ? '180deg' : '0deg' }] }}
                  />
                )
              )}
            </Pressable>
          </View>

          {/* La lista solo se monta al desplegarse (#117): 8 filas ocupaban casi
              todo el sheet y empujaban notas e historial fuera de vista. */}
          {!readOnly && is_status_open && (
          <>
          <View style={styles.status_list_content}>
            {ALL_LEAD_STATUSES.map((s) => {
              const meta       = get_status_meta(s);
              const is_current = s === lead.status;
              const is_active  = !is_updating && !follow_up_hook.is_updating;

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
          </View>
          </>
          )}

          {/* ⚠️ Spinner y error van FUERA del desplegable: al elegir un estado la
              lista se cierra de inmediato, así que dentro quedarían invisibles
              justo cuando importan (mientras guarda, y si la EF falla). */}
          {!readOnly && is_updating && (
            <View style={styles.updating_row}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.updating_text}>Actualizando estado…</Text>
            </View>
          )}

          {!readOnly && error !== null && (
            <View style={styles.error_row}>
              <Text style={styles.error_text}>{error}</Text>
            </View>
          )}

          {/* ── Notas internas ─────────────────────────────────────────────── */}
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
            editable={!readOnly && !any_note_action_busy}
            textAlignVertical="top"
            accessibilityLabel="Notas internas del lead"
          />

          {/* Botón "Guardar nota" — visible solo si hay cambios sin guardar;
              oculto en readOnly (owner viendo lead ajeno, consistente con #28) */}
          {!readOnly && note_has_changes && (
            <View style={styles.save_note_row}>
              <Pressable
                onPress={() => { void handle_save_note(); }}
                disabled={any_note_action_busy}
                style={({ pressed }) => [
                  styles.save_note_btn,
                  any_note_action_busy && styles.save_note_btn_disabled,
                  pressed && !any_note_action_busy && styles.action_btn_pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Guardar nota"
              >
                <Text style={styles.save_note_btn_text}>
                  {is_saving_note ? 'Guardando…' : 'Guardar nota'}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Error inline de la nota — separado del error de status */}
          {note_error !== null && (
            <View style={styles.error_row}>
              <Text style={styles.error_text}>{note_error}</Text>
            </View>
          )}

          {/* ── Historial del lead (75.6, §19.8) — capado (FIX2) ─────────────── */}
          <View style={styles.divider_bottom} />
          <Text style={styles.section_title}>Historial</Text>
          {history_loading && history.length === 0 ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.history_loading} />
          ) : history_error !== null ? (
            <Text style={[styles.error_text, styles.history_error]}>{history_error}</Text>
          ) : history.length === 0 ? (
            <Text style={styles.history_empty}>Sin cambios registrados todavía.</Text>
          ) : (
            <View style={styles.history_list}>
              {visible_history.map((entry) => {
                const entry_meta = get_status_meta(entry.new_status);
                return (
                  <View key={entry.id} style={styles.history_row}>
                    <View style={[styles.status_dot, { backgroundColor: entry_meta.bg }]} />
                    <Text style={styles.history_status} numberOfLines={1}>
                      {entry_meta.label}
                    </Text>
                    <Text style={styles.history_date}>{format_relative_time(entry.changed_at)}</Text>
                  </View>
                );
              })}
              {history.length > HISTORY_DISPLAY_CAP && (
                <Text style={styles.history_more}>
                  +{history.length - HISTORY_DISPLAY_CAP} cambios más antiguos
                </Text>
              )}
            </View>
          )}

        </ScrollView>

        {/* ── Acciones: Ver propiedad + WhatsApp — FIJAS fuera del scroll
            (FIX2): es la acción principal del CRM, nunca debe quedar
            recortada ni requerir scroll para encontrarla. ─────────────────── */}
        <View style={styles.action_row_wrap}>
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
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.r_24,
    borderTopRightRadius: radii.r_24,
    // maxHeight y paddingBottom REALES viven en sheet_adaptive_style (#143.6):
    // dependen de insets + tamaño de ventana, no pueden ser estáticos.
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

  // ── Toggle "en seguimiento" (75.6) ───────────────────────────────────────────
  follow_up_btn: {
    padding: spacing.s_4,
    borderRadius: radii.r_pill,
    flexShrink: 0,
  },
  follow_up_btn_active: {
    backgroundColor: colors.accent_tint,
  },
  follow_up_btn_busy: {
    opacity: 0.4,
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

  // ── Contenido scrollable (FIX2; corregido en #113) ─────────────────────────
  // 🔴 flexShrink, NO `flex: 1`. `styles.sheet` NO tiene altura definida (solo
  // `maxHeight`) y su padre (KeyboardAvoidingView) tampoco, así que la altura
  // del sheet la determina su contenido. `flex: 1` implica `flexBasis: 0`: el
  // contenido del ScrollView deja de contar para esa altura y, como no hay
  // espacio libre que repartir, Yoga le asigna **altura 0** — el sheet salía
  // con la cabecera y los botones y NADA en medio (ni estado, ni notas, ni
  // historial). Con `flexShrink: 1` la base es `auto`: el contenido sí cuenta,
  // el sheet crece hasta `maxHeight` y el sobrante se le resta SOLO a este
  // bloque (los demás hijos son flexShrink: 0 por defecto en RN), que entonces
  // scrollea. Los tests con RNTL no ven layout: esto solo se caza en pantalla.
  scroll_content: {
    flexShrink: 1,
  },
  scroll_content_container: {
    paddingBottom: spacing.s_8,
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

  // ── Aviso de solo lectura (#112) — FIJO debajo del header ────────────────────
  readonly_banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    backgroundColor: colors.accent_tint,
    borderRadius: radii.r_8,
    marginHorizontal: spacing.s_16,
    marginBottom: spacing.s_12,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_12,
  },
  readonly_banner_text: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: colors.accent_deep,
    lineHeight: 16,
  },

  // ── Actividad (#112) — ActionStatsBar ────────────────────────────────────────
  stats_wrap: {
    paddingHorizontal: spacing.s_16,
    marginBottom: spacing.s_4,
  },

  // ── Badge del estado actual — SIEMPRE visible (FIX3) ─────────────────────────
  current_status_wrap: {
    paddingHorizontal: spacing.s_16,
    gap: spacing.s_8,
    marginBottom: spacing.s_4,
  },

  // ── Disparador del desplegable de estados (#117) ───────────────────────────
  // Se ve como un campo select: borde suave, el badge del estado a la izquierda
  // y el caret a la derecha. En readOnly se renderiza igual pero sin caret y sin
  // onPress, así que lee como etiqueta, no como control.
  status_trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_8,
    borderRadius: radii.r_8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.silver,
    backgroundColor: colors.paper,
  },
  status_trigger_spacer: {
    flex: 1,
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

  // ── Botón "Guardar nota" ──────────────────────────────────────────────────────
  save_note_row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.s_16,
    marginBottom: spacing.s_12,
  },
  save_note_btn: {
    backgroundColor: colors.primary,
    borderRadius: radii.r_pill,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_16,
  },
  save_note_btn_disabled: {
    opacity: 0.5,
  },
  save_note_btn_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.on_primary,
  },

  // ── Historial (75.6) ──────────────────────────────────────────────────────────
  history_loading: {
    marginBottom: spacing.s_12,
  },
  history_error: {
    paddingHorizontal: spacing.s_16,
    marginBottom: spacing.s_12,
  },
  history_empty: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.gray_2,
    paddingHorizontal: spacing.s_16,
    marginBottom: spacing.s_12,
  },
  history_list: {
    paddingHorizontal: spacing.s_16,
    marginBottom: spacing.s_12,
    gap: spacing.s_8,
  },
  history_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
  },
  history_status: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.ink,
  },
  history_date: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
  },
  history_more: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gray_2,
    marginTop: 2,
  },

  // ── Fila de acciones (FIJA fuera del scroll, FIX2) ───────────────────────────
  action_row_wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.silver,
    paddingTop: spacing.s_12,
  },
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
    color: colors.on_primary,
  },
});
