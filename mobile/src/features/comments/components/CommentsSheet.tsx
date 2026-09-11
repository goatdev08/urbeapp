/**
 * CommentsSheet — hoja de comentarios de una propiedad (subtarea 289.8, tarea
 * #289). Porta la dirección A (RECOMENDADA) del preview aprobado
 * mobile/design-previews/289-comentarios.html: Modal + KeyboardAvoidingView +
 * react-native-safe-area-context (NUNCA SafeAreaView de react-native —
 * edge-to-edge SDK 56), hoja al 60% de la pantalla, input anclado ("docked",
 * mismo patrón que ReportPropertySheet.tsx).
 *
 * Se abre desde el 4º botón de ActionButtons.tsx (CommentsAction) — ese
 * wrapper la monta SOLO cuando el usuario la abre (mismo motivo que
 * ReportAction/ReportProfileAction: los hooks de comments llaman useAuth
 * internamente, no hace falta invocarlos antes de que haga falta).
 *
 * Estados (preview §3): vacío, cargando (skeleton estático — sin shimmer,
 * ver ponytail abajo), error (con reintentar), "en revisión"/"oculto" son
 * chips de CommentCard (RLS decide quién los ve, no este componente), sin
 * sesión (CTA "Inicia sesión para comentar"), filtro rechazó (mensaje inline
 * bajo el input — es literalmente `usePostComment().error`, el copy exacto lo
 * fija el hook, no este componente).
 *
 * Acciones por comentario (preview §4): long-press → Alert nativo (sin
 * @gorhom/bottom-sheet ni menú custom — mismo criterio "cero dependencias
 * nuevas" del preview) con Reportar (todos menos el autor) / Ocultar-Restaurar
 * (solo can_hide) / Eliminar (solo el autor). Reportar reusa
 * ReportPropertySheet.tsx SIN modificarlo (mismos tipos de motivo — 1:1 con
 * property_report_reason, ver comments/types.ts).
 *
 * 🔴 UI_FUERA_DEL_MOCKUP — feedback tras Ocultar: EXCLUIDO de esta subtarea
 * por decisión de Abraham (derivada #291, producto(289.1)). Ocultar/Restaurar
 * solo actualiza la lista local (el chip cambia) — sin toast.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChatCircle, Lock, PaperPlaneTilt, X } from 'phosphor-react-native';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import { useAuth } from '@/features/auth/context';
import { ReportPropertySheet } from '@/features/property-detail/components/ReportPropertySheet';
import type { SubmitReportInput, SubmitReportResult } from '@/features/property-detail/hooks/useReportProperty';

import { useComments } from '../hooks/useComments';
import { usePostComment } from '../hooks/usePostComment';
import { useHideComment } from '../hooks/useHideComment';
import { useReportComment } from '../hooks/useReportComment';
import type { CommentItem } from '../types';
import { CommentCard } from './CommentCard';

const MAX_BODY_LENGTH = 500;

export interface CommentsSheetProps {
  visible: boolean;
  on_dismiss: () => void;
  property_id: string;
  /**
   * Total autoritativo (properties.comment_count, vía ActionButtons) — el
   * encabezado lo usa en vez de `items.length` (que solo cuenta lo YA
   * paginado, subcontaría antes de agotar `has_more`).
   */
  comment_count: number;
  /** ¿La sesión puede Ocultar/Restaurar comentarios ajenos? (ActionButtons calcula el techo, ver su docblock). */
  can_hide: boolean;
  /**
   * Callback opcional (289.10) — el caller (rail del feed) lo usa para subir
   * su contador local +1 sin refetch cuando se publica un comentario nuevo.
   * Aditivo: no rompe callers existentes que no lo pasan.
   */
  on_comment_posted?: () => void;
}

export function CommentsSheet({
  visible,
  on_dismiss,
  property_id,
  comment_count,
  can_hide,
  on_comment_posted,
}: CommentsSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const comments = useComments(property_id);
  const hide_comment = useHideComment();
  const report_comment = useReportComment();
  const [report_target_id, set_report_target_id] = useState<string | null>(null);
  const [body, set_body] = useState('');

  const post_comment = usePostComment(property_id, {
    on_posted: (posted) => {
      comments.prepend({
        id: posted.id,
        property_id: posted.property_id,
        user_id: posted.user_id,
        body: posted.body,
        status: posted.status,
        created_at: posted.created_at,
        author: user
          ? {
              full_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
              profile_photo_url: user.avatar_url,
            }
          : null,
      });
      on_comment_posted?.();
    },
  });

  const handle_send = async (): Promise<void> => {
    if (body.trim().length === 0 || post_comment.posting) return;
    const posted = await post_comment.post(body);
    if (posted !== null) set_body('');
  };

  const handle_long_press = (comment: CommentItem): void => {
    const is_author = user !== null && user.id === comment.user_id;
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];

    if (!is_author) {
      buttons.push({ text: 'Reportar', onPress: () => set_report_target_id(comment.id) });
    }
    if (can_hide) {
      const next_status = comment.status === 'hidden' ? 'visible' : 'hidden';
      buttons.push({
        text: comment.status === 'hidden' ? 'Restaurar' : 'Ocultar',
        onPress: () => {
          void hide_comment.set_status(comment.id, next_status).then((ok) => {
            if (ok) comments.update(comment.id, { status: next_status });
          });
        },
      });
    }
    if (is_author) {
      buttons.push({
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          void hide_comment.set_status(comment.id, 'deleted').then((ok) => {
            if (ok) comments.remove(comment.id);
          });
        },
      });
    }
    if (buttons.length === 0) return;
    buttons.push({ text: 'Cancelar', style: 'cancel' });
    Alert.alert('Comentario', undefined, buttons);
  };

  const handle_report_submit = (input: SubmitReportInput): Promise<SubmitReportResult> => {
    if (report_target_id === null) return Promise.resolve({ ok: false });
    return report_comment.report(report_target_id, input.reason, input.reason_text);
  };

  const show_skeleton = comments.loading && comments.items.length === 0;
  const show_error = !comments.loading && comments.error !== null && comments.items.length === 0;
  const show_empty =
    !comments.loading && comments.error === null && comments.items.length === 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={on_dismiss} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={on_dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kb_wrap}
        >
          {/* onPress vacío para detener la propagación al overlay (tap-fuera cierra) */}
          <Pressable
            style={[styles.sheet, { paddingBottom: insets.bottom }]}
            onPress={() => undefined}
          >
            <View style={styles.handle} />

            <View style={styles.header}>
              <Text style={styles.header_title}>
                Comentarios <Text style={styles.header_count}>· {comment_count}</Text>
              </Text>
              <Pressable
                onPress={on_dismiss}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Cerrar"
              >
                <X size={18} color={colors.ink} weight="bold" />
              </Pressable>
            </View>

            <View style={styles.list_wrap}>
              {show_skeleton && (
                <View style={styles.skeleton_wrap} testID="comments-skeleton">
                  <ActivityIndicator color={colors.primary} />
                </View>
              )}

              {show_error && (
                <View style={styles.state_block}>
                  <Text style={styles.state_title}>No se pudieron cargar los comentarios</Text>
                  <Text style={styles.state_sub}>{comments.error}</Text>
                  <Pressable
                    onPress={() => void comments.refetch()}
                    accessibilityRole="button"
                    accessibilityLabel="Reintentar"
                  >
                    <Text style={styles.retry}>Reintentar</Text>
                  </Pressable>
                </View>
              )}

              {show_empty && (
                <View style={styles.state_block}>
                  <ChatCircle size={22} color={colors.primary} weight="bold" />
                  <Text style={styles.state_title}>Sé el primero en comentar</Text>
                  <Text style={styles.state_sub}>Comparte tu opinión sobre esta propiedad.</Text>
                </View>
              )}

              {!show_skeleton && !show_error && !show_empty && (
                <FlatList
                  data={comments.items}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <CommentCard
                      comment={item}
                      current_user_id={user?.id ?? null}
                      on_long_press={handle_long_press}
                    />
                  )}
                  onEndReached={() => {
                    if (comments.has_more) void comments.load_more();
                  }}
                  onEndReachedThreshold={0.4}
                  showsVerticalScrollIndicator={false}
                />
              )}
            </View>

            {user === null ? (
              <View style={styles.login_row}>
                <Lock size={16} color={colors.gray_2} weight="bold" />
                <Text style={styles.login_text}>Inicia sesión para comentar</Text>
                <Pressable
                  onPress={() => {
                    on_dismiss();
                    router.push('/login');
                  }}
                  style={styles.login_btn}
                  accessibilityRole="button"
                  accessibilityLabel="Entrar"
                >
                  <Text style={styles.login_btn_text}>Entrar</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.input_bar}>
                <View style={styles.input_row}>
                  <TextInput
                    style={styles.input_field}
                    value={body}
                    onChangeText={set_body}
                    placeholder="Escribe un comentario…"
                    placeholderTextColor={colors.gray_2}
                    maxLength={MAX_BODY_LENGTH}
                    editable={!post_comment.posting}
                    multiline
                    accessibilityLabel="Escribe un comentario"
                  />
                  <Text style={styles.counter}>
                    {body.length}/{MAX_BODY_LENGTH}
                  </Text>
                  <Pressable
                    onPress={() => void handle_send()}
                    disabled={body.trim().length === 0 || post_comment.posting}
                    style={[
                      styles.send_btn,
                      (body.trim().length === 0 || post_comment.posting) && styles.send_btn_disabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Publicar"
                  >
                    <PaperPlaneTilt size={15} color="#FFFFFF" weight="fill" />
                  </Pressable>
                </View>
                {post_comment.error !== null && (
                  <Text style={styles.input_error}>{post_comment.error}</Text>
                )}
              </View>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>

      <ReportPropertySheet
        visible={report_target_id !== null}
        on_dismiss={() => set_report_target_id(null)}
        on_submit={handle_report_submit}
        is_submitting={report_comment.reporting}
        error_message={report_comment.error}
        title="Reportar comentario"
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(23, 20, 15, 0.42)',
    justifyContent: 'flex-end',
  },
  kb_wrap: {
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '60%',
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.r_24,
    borderTopRightRadius: radii.r_24,
    ...shadows.md,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radii.r_pill,
    backgroundColor: colors.paper_3,
    alignSelf: 'center',
    marginTop: spacing.s_8 + 2,
    marginBottom: spacing.s_4 + 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.s_20,
    paddingBottom: spacing.s_12,
    borderBottomWidth: 1,
    borderBottomColor: colors.paper_3,
  },
  header_title: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.ink,
  },
  header_count: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.gray_2,
  },
  list_wrap: {
    flex: 1,
    paddingTop: 2,
  },
  skeleton_wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  state_block: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s_24,
    gap: spacing.s_8,
  },
  state_title: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.ink,
    textAlign: 'center',
  },
  state_sub: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.gray_2,
    textAlign: 'center',
  },
  retry: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12.5,
    color: colors.primary,
    marginTop: spacing.s_4,
  },
  login_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8 + 2,
    paddingHorizontal: spacing.s_20,
    paddingVertical: spacing.s_12 + 2,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
    backgroundColor: colors.paper_2,
  },
  login_text: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 12.5,
    color: colors.gray_3,
  },
  login_btn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.s_16 - 2,
    paddingVertical: spacing.s_8,
    borderRadius: radii.r_8,
  },
  login_btn_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 11.5,
    color: '#FFFFFF',
  },
  input_bar: {
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
    paddingHorizontal: spacing.s_20,
    paddingVertical: spacing.s_8 + 2,
    backgroundColor: colors.surface,
  },
  input_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8 + 2,
  },
  input_field: {
    flex: 1,
    backgroundColor: colors.paper_2,
    borderRadius: radii.r_12,
    paddingHorizontal: spacing.s_12,
    paddingVertical: spacing.s_8 + 1,
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.ink,
    maxHeight: 80,
  },
  counter: {
    fontFamily: fonts.mono,
    fontSize: 9.5,
    color: colors.gray_2,
  },
  send_btn: {
    width: 34,
    height: 34,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send_btn_disabled: {
    backgroundColor: colors.gray_1,
  },
  input_error: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.danger,
    marginTop: spacing.s_8,
  },
});
