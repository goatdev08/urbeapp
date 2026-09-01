/**
 * /notifications — centro de notificaciones in-app (módulo 041-M2, tarea
 * #219, subtarea 219.4). Lista (título, cuerpo, tiempo relativo, no-leída
 * resaltada) del hook useNotifications (219.3) — este archivo NO renegocia su
 * contrato, solo lo consume. Tap = mark_read(id) + router.push(deep_link) si
 * existe. Acción "Marcar todas como leídas" visible/habilitada solo con
 * no-leídas. Estados carga/error(Reintentar)/vacío.
 *
 * Único punto de entrada: la campana de ProfileScreen
 * (NotificationBellButton, DECISIÓN ABRAHAM 2026-08-25) — no hay tab nueva.
 *
 * Estética utilitaria/clara calcada de mobile/app/admin/revisions/index.tsx
 * (el lenguaje ya usado en el panel de administración) — la identidad visual
 * no trae mockup propio para esta pantalla.
 */
import React, { useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors, spacing, type_scale } from '@/theme/theme';
import { BackButton } from '@/components/BackButton';
import { useNotifications } from '@/features/notifications/hooks/useNotifications';
import { NotificationCard } from '@/features/notifications/components/NotificationCard';
import type { NotificationItem } from '@/features/notifications/types';

export default function NotificationsScreen(): React.ReactElement {
  const router = useRouter();
  const { notifications, unread_count, is_loading, error_message, refetch, mark_read, mark_all_read } =
    useNotifications();

  const handle_press_item = useCallback(
    (item: NotificationItem) => {
      if (item.read_at === null) void mark_read(item.id);
      if (item.deep_link !== null) router.push(item.deep_link);
    },
    [mark_read, router],
  );

  const handle_mark_all_read = useCallback(() => {
    void mark_all_read();
  }, [mark_all_read]);

  if (is_loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader unread_count={0} on_mark_all_read={handle_mark_all_read} />
        <View style={styles.center}>
          <ActivityIndicator testID="loading-indicator" size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error_message !== null) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader unread_count={0} on_mark_all_read={handle_mark_all_read} />
        <View style={styles.center}>
          <Text style={styles.error_text} testID="error-message">
            {error_message}
          </Text>
          <Pressable
            style={styles.retry_button}
            onPress={refetch}
            accessibilityRole="button"
            accessibilityLabel="Reintentar carga"
          >
            <Text style={styles.retry_text}>Reintentar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const list = notifications ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader unread_count={unread_count} on_mark_all_read={handle_mark_all_read} />
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <NotificationCard item={item} on_press={handle_press_item} />}
        contentContainerStyle={list.length === 0 ? styles.list_empty_container : styles.list_content}
        ListEmptyComponent={
          <View style={styles.empty_state} testID="empty-state">
            <Text style={styles.empty_text}>Aquí verás tus notificaciones cuando tengas alguna.</Text>
          </View>
        }
        testID="notifications-list"
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface ScreenHeaderProps {
  unread_count: number;
  on_mark_all_read: () => void;
}

function ScreenHeader({ unread_count, on_mark_all_read }: ScreenHeaderProps): React.ReactElement {
  return (
    <View style={styles.header}>
      <View style={styles.header_top}>
        <BackButton />
        <Text style={styles.title}>Notificaciones</Text>
        <View style={styles.header_spacer} />
      </View>
      {unread_count > 0 && (
        <Pressable
          style={styles.mark_all_button}
          onPress={on_mark_all_read}
          accessibilityRole="button"
          accessibilityLabel="Marcar todas como leídas"
          testID="mark-all-read"
        >
          <Text style={styles.mark_all_text}>Marcar todas como leídas</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos — calcados de mobile/app/admin/revisions/index.tsx, con tokens de theme.ts
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.s_20, paddingTop: spacing.s_16, paddingBottom: spacing.s_12 },
  header_top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  header_spacer: { width: 40 },
  title: { ...type_scale.h1, fontSize: 24, color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.s_32 },

  mark_all_button: { marginTop: spacing.s_12, alignSelf: 'flex-start' },
  mark_all_text: { ...type_scale.body, fontSize: 14, fontWeight: '600', color: colors.primary },

  list_content: { paddingHorizontal: spacing.s_20, paddingBottom: spacing.s_32 },
  list_empty_container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty_state: { alignItems: 'center', paddingHorizontal: spacing.s_32 },
  empty_text: { ...type_scale.body, fontSize: 15, color: colors.gray_2, textAlign: 'center' },

  error_text: { ...type_scale.body, fontSize: 14, color: colors.danger, textAlign: 'center', marginBottom: spacing.s_16 },
  retry_button: {
    paddingVertical: spacing.s_12 - 2,
    paddingHorizontal: spacing.s_24,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  retry_text: { ...type_scale.body, fontSize: 15, fontWeight: '600', color: colors.primary },
});
