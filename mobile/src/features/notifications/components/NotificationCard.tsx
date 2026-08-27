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

export function NotificationCard({ item, on_press }: NotificationCardProps) {
  const is_unread = item.read_at === null;

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
      {item.body !== null && (
        <Text style={styles.body} numberOfLines={2}>
          {item.body}
        </Text>
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
});
