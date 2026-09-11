/**
 * CommentCard — tarjeta de un comentario dentro de CommentsSheet (subtarea
 * 289.8, tarea #289). Porta la dirección A del preview aprobado
 * (mobile/design-previews/289-comentarios.html, `.dirA .c-card`): avatar de
 * iniciales 32px, nombre en Hanken, hora relativa, chip de estado.
 *
 * Chips SOLO al propio autor (enunciado de la subtarea 289.8: "«En revisión»
 * (held_for_review, solo autor) y «Ocultado por moderación» (hidden, solo
 * autor)") — comparación cliente `comment.user_id === current_user_id`. RLS
 * (comments_select, migración 20260910100001) ya evita que un tercero
 * cualquiera reciba la fila; esta comparación adicional cubre al GESTOR, que
 * sí puede recibir comentarios ajenos en cualquier status (ve "todo lo
 * no-deleted") pero no debe ver el chip de un comentario que no es suyo.
 *
 * Autor null (usuario eliminado/anonimizado, PRD §26): texto en cursiva +
 * ícono genérico — el body del comentario se conserva.
 *
 * ponytail: sin foto de perfil real (solo iniciales) — el preview aprobado
 * (dirA) tampoco dibuja fotos en ninguna tarjeta; techo = lo que el preview
 * porta. Si se pide foto real más adelante, mismo patrón de useR2Urls que
 * AgentCard.tsx.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EyeSlash, UserCircle } from 'phosphor-react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { format_relative_time } from '@/features/leads/utils/relative_time';

import type { CommentItem } from '../types';

// ponytail: duplicada a propósito (mismo criterio que AgentCard.get_initials —
// ProfileHeader/AgentCard no la exportan; extraer a shared utils si aparece
// un 4º consumidor).
function get_initials(full_name: string | null): string {
  if (!full_name) return 'U';
  const parts = full_name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export interface CommentCardProps {
  comment: CommentItem;
  /** Sesión actual — gatea los chips de estado (solo el propio autor los ve). null = sin sesión. */
  current_user_id: string | null;
  /** Long-press → menú de acciones (Reportar/Ocultar/Restaurar/Eliminar), armado por el padre. */
  on_long_press: (comment: CommentItem) => void;
}

export function CommentCard({
  comment,
  current_user_id,
  on_long_press,
}: CommentCardProps): React.JSX.Element {
  const is_deleted_author = comment.author === null;
  const display_name = is_deleted_author ? 'Usuario eliminado' : (comment.author!.full_name ?? 'Usuario');
  const initials = get_initials(is_deleted_author ? null : comment.author!.full_name);
  const is_own = current_user_id !== null && current_user_id === comment.user_id;

  return (
    <Pressable
      onLongPress={() => on_long_press(comment)}
      style={[styles.card, comment.status === 'hidden' && styles.card_hidden]}
      accessibilityLabel={`Comentario de ${display_name}`}
    >
      <View style={styles.avatar}>
        {is_deleted_author ? (
          <UserCircle size={16} color={colors.gray_2} weight="bold" />
        ) : (
          <Text style={styles.avatar_text}>{initials}</Text>
        )}
      </View>

      <View style={styles.body_wrap}>
        <View style={styles.name_row}>
          <Text
            style={[styles.name, is_deleted_author && styles.name_deleted]}
            numberOfLines={1}
          >
            {display_name}
          </Text>
          <Text style={styles.time}>{format_relative_time(comment.created_at)}</Text>
        </View>

        {is_own && comment.status === 'held_for_review' && (
          <View style={[styles.chip, styles.chip_review]}>
            <Text style={styles.chip_review_text}>En revisión</Text>
          </View>
        )}
        {is_own && comment.status === 'hidden' && (
          <View style={[styles.chip, styles.chip_hidden]}>
            <EyeSlash size={9} color={colors.gray_3} weight="bold" />
            <Text style={styles.chip_hidden_text}>Ocultado por moderación</Text>
          </View>
        )}

        <Text style={styles.body}>{comment.body}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.s_8 + 1,
    paddingHorizontal: spacing.s_20,
    paddingVertical: spacing.s_8 + 2,
  },
  card_hidden: {
    opacity: 0.55,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radii.r_pill,
    backgroundColor: colors.paper_2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatar_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 12,
    color: colors.gray_2,
  },
  body_wrap: {
    flex: 1,
    minWidth: 0,
  },
  name_row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.s_4 + 2,
    flexWrap: 'wrap',
  },
  name: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12.5,
    color: colors.ink,
  },
  name_deleted: {
    color: colors.gray_2,
    fontStyle: 'italic',
  },
  time: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.gray_2,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_4,
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.r_pill,
    marginTop: spacing.s_4,
  },
  chip_review: {
    backgroundColor: '#F3E8CC',
  },
  chip_review_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 9.5,
    color: colors.temp_cooling,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  chip_hidden: {
    backgroundColor: colors.paper_3,
  },
  chip_hidden_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 9.5,
    color: colors.gray_3,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
