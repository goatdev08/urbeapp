/**
 * NotificationCard — fila del centro de notificaciones (módulo 041-M2, tarea
 * #219, subtarea 219.4). Presentacional puro: título, cuerpo, tiempo
 * relativo (format_relative_time, REUSADO de leads — mismo helper que
 * LeadCard/LeadExpandedView, ver mobile/src/features/leads/utils/relative_time.ts),
 * no-leída resaltada (tinte + punto de acento + título en semibold).
 *
 * Estética utilitaria/clara calcada de las tarjetas del panel admin
 * (mobile/app/admin/revisions/index.tsx, mobile/app/admin/index.tsx) — la
 * identidad visual no trae mockup propio para esta pantalla.
 *
 * on_press es responsabilidad del padre: mark_read(id) + router.push(deep_link)
 * si existe (esta tarjeta no conoce el ruteo).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, type_scale } from '@/theme/theme';
import { format_relative_time } from '@/features/leads/utils/relative_time';
import type { NotificationItem } from '../types';

interface NotificationCardProps {
  item: NotificationItem;
  on_press: (item: NotificationItem) => void;
}

/**
 * #240 — El motivo del rechazo deja de ser la cola de una frase larga.
 *
 * #234/#237 lo pusieron en el `body` porque esta tarjeta era la única
 * superficie que lo mostraba y solo pintaba `title` y `body`. Funcionó, pero se
 * leía mal: el body abre con la dirección de la propiedad o el título del
 * anuncio (90+ caracteres) y el motivo quedaba al final, detrás de una elipsis
 * o, en el mejor de los casos, escondido en la última línea.
 *
 * Se lee de `data.rejection_reason`, NO del texto del body: (a) es el dato
 * estructurado, no una cadena que haya que interpretar, y (b) las
 * notificaciones ANTERIORES a #237 ya lo traían ahí, así que las viejas
 * también ganan el bloque. El sufijo que #237 pega al body se retira aquí para
 * no decir lo mismo dos veces; se compara contra la forma EXACTA que compone la
 * base (' Motivo: ' + motivo), sin parsear nada.
 */
const REASON_PREFIX = ' Motivo: ';

function read_rejection_reason(data: Record<string, unknown>): string | null {
  const raw = data.rejection_reason;
  // El mismo criterio del guard de la base (~ '\S'): un motivo en blanco no es
  // un motivo. Aquí sí sirve trim(), porque solo decide si se pinta el bloque.
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

function strip_reason_suffix(body: string | null, reason: string | null): string | null {
  if (body === null || reason === null) return body;
  const suffix = REASON_PREFIX + reason;
  return body.endsWith(suffix) ? body.slice(0, -suffix.length) : body;
}

export function NotificationCard({ item, on_press }: NotificationCardProps) {
  const is_unread = item.read_at === null;
  const rejection_reason = read_rejection_reason(item.data);
  const base_body = strip_reason_suffix(item.body, rejection_reason);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        is_unread && styles.card_unread,
        pressed && styles.card_pressed,
      ]}
      onPress={() => on_press(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${is_unread ? ', sin leer' : ''}`}
      testID={`notification-${item.id}`}
    >
      <View style={styles.header_row}>
        <View style={styles.title_row}>
          {is_unread && <View style={styles.unread_dot} testID={`notification-unread-dot-${item.id}`} />}
          <Text style={[styles.title, is_unread && styles.title_unread]} numberOfLines={2}>
            {item.title}
          </Text>
        </View>
        <Text style={styles.time}>{format_relative_time(item.created_at)}</Text>
      </View>
      {base_body !== null && (
        <Text style={styles.body} numberOfLines={3}>
          {base_body}
        </Text>
      )}

      {rejection_reason !== null && (
        <View style={styles.reason_block} testID={`notification-reason-${item.id}`}>
          <Text style={styles.reason_label}>Motivo</Text>
          <Text style={styles.reason_text} numberOfLines={4}>
            {rejection_reason}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.paper_3,
    padding: spacing.s_16,
    marginBottom: spacing.s_12,
  },
  card_unread: {
    backgroundColor: colors.primary_tint,
    borderColor: colors.primary_soft,
  },
  card_pressed: {
    opacity: 0.85,
  },
  header_row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title_row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.s_8,
  },
  unread_dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginRight: spacing.s_8,
  },
  title: {
    ...type_scale.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
    flexShrink: 1,
  },
  title_unread: {
    fontWeight: '700',
  },
  time: {
    ...type_scale.caption,
    textTransform: 'none',
    letterSpacing: 0,
    fontSize: 12,
    color: colors.gray_1,
  },
  body: {
    ...type_scale.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.gray_2,
    marginTop: spacing.s_4,
  },
  // Bloque del motivo: arcilla, no rojo. La mala noticia ya la dio el título;
  // el motivo es la parte accionable —qué corregir—, así que se lee como una
  // anotación del revisor y no como una segunda alarma.
  reason_block: {
    marginTop: spacing.s_8,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_12,
    backgroundColor: colors.accent_tint,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderTopRightRadius: radii.r_8,
    borderBottomRightRadius: radii.r_8,
  },
  reason_label: {
    ...type_scale.caption,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.accent_deep,
    marginBottom: spacing.s_4,
  },
  reason_text: {
    ...type_scale.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
});
