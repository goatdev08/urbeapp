/**
 * /admin/reports — cola de reportes de propiedad (módulo 041-M2, tarea #220,
 * subtarea 220.4). Lista de propiedades reportadas (property_reports con
 * status='new', useAdminReports.ts) AGRUPADA POR PROPIEDAD: dirección +
 * status actual + los reportes individuales (motivo + texto libre) +
 * conteo. Acciones de resolución (220.3, useResolveReport) — Restaurar /
 * Pedir cambios / Mantener suspendida / Eliminar — SOLO aplican si la
 * propiedad está 'suspended' (el resto de estados solo se ve, sin botones
 * habilitados).
 *
 * Estética utilitaria/clara calcada de mobile/app/admin/revisions/index.tsx
 * (218.2, la cola hermana más reciente) — la identidad visual no trae
 * mockup propio para esta pantalla. A diferencia de esa pantalla, aquí se
 * usan los tokens de mobile/src/theme/theme.ts en vez de hex sueltos.
 *
 * Motivo obligatorio en la UI para Pedir cambios / Eliminar (mismo criterio
 * de producto que needs_changes/reject en /admin/revisions — el propietario
 * necesita saber por qué, y "eliminar" es irreversible para el consumo
 * público) — el botón de confirmar queda deshabilitado sin texto. Restaurar
 * y Mantener suspendida NO piden motivo.
 *
 * Refresco: onSuccess → refetch (mismo patrón que /admin/revisions) — UNA
 * sola instancia de useResolveReport a nivel de pantalla; is_submitting
 * deshabilita TODAS las tarjetas mientras una acción está en vuelo.
 */
import React, { useCallback, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UrbeaLoader } from '@/components/UrbeaLoader';
import { BackButton } from '@/components/BackButton';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  useAdminReports,
  type AdminReportQueueItem,
} from '@/features/admin/hooks/useAdminReports';
import {
  useResolveReport,
  type ResolveReportAction,
} from '@/features/admin/hooks/useResolveReport';
import { format_price } from '@/lib/formatPrice';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Etiquetas es-MX
// ---------------------------------------------------------------------------

/** property_report_reason — supabase/migrations/20260604000001_extensions_and_enums.sql:76-78 */
const REASON_LABELS: Record<string, string> = {
  not_exist_fraud: 'No existe / fraude',
  misleading: 'Información engañosa',
  false_price: 'Precio falso',
  wrong_address: 'Dirección incorrecta',
  inappropriate: 'Contenido inapropiado',
  duplicate: 'Publicación duplicada',
  other: 'Otro motivo',
};

const OPERATION_TYPE_LABELS: Record<string, string> = {
  rent: 'Renta',
  sale: 'Venta',
  both: 'Renta y venta',
};

/** Solo los status relevantes para esta cola — 'suspended' es el único que habilita acciones. */
const STATUS_LABELS: Record<string, string> = {
  suspended: 'Suspendida',
  active: 'Activa',
  needs_changes: 'Cambios pedidos',
  pending_review: 'En revisión',
};

const ACTION_LABELS: Record<ResolveReportAction, string> = {
  restore: 'Restaurar',
  request_changes: 'Pedir cambios',
  keep_suspended: 'Mantener suspendida',
  delete: 'Eliminar',
};

function format_reason(row: { reason: string; reason_text: string | null }): string {
  const label = REASON_LABELS[row.reason] ?? row.reason;
  return row.reason_text ? `${label} — ${row.reason_text}` : label;
}

// ---------------------------------------------------------------------------
// Tarjeta de propiedad reportada
// ---------------------------------------------------------------------------

interface ReportCardProps {
  item: AdminReportQueueItem;
  is_submitting: boolean;
  on_resolve: (property_id: string, action: ResolveReportAction, reason?: string) => void;
}

function ReportCard({ item, is_submitting, on_resolve }: ReportCardProps): React.ReactElement {
  const [reason, set_reason] = useState('');
  const can_act = item.property.status === 'suspended' && !is_submitting;
  const can_confirm_with_reason = can_act && reason.trim().length > 0;

  return (
    <View style={styles.card} testID={`report-${item.property_id}`}>
      <View style={styles.card_header}>
        <Text style={styles.card_address} numberOfLines={2}>
          {item.property.address}
        </Text>
        <View style={styles.status_badge}>
          <Text style={styles.status_badge_text}>
            {STATUS_LABELS[item.property.status] ?? item.property.status}
          </Text>
        </View>
      </View>

      <Text style={styles.card_meta}>
        {OPERATION_TYPE_LABELS[item.property.operation_type] ?? item.property.operation_type}
        {' · '}
        {item.property.property_type}
        {' · '}
        {format_price(item.property.price)}
      </Text>

      <Text style={styles.section_label}>
        {item.report_count === 1 ? '1 reporte' : `${item.report_count} reportes`}
      </Text>
      <View style={styles.reports_list}>
        {item.reports.map((report) => (
          <Text key={report.report_id} style={styles.report_row}>
            • {format_reason(report)}
          </Text>
        ))}
      </View>

      {!can_act && item.property.status !== 'suspended' && (
        <Text style={styles.not_actionable_text}>
          Solo se puede resolver una propiedad suspendida.
        </Text>
      )}

      <Text style={styles.section_label}>Motivo</Text>
      <TextInput
        style={styles.reason_input}
        value={reason}
        onChangeText={set_reason}
        placeholder="Obligatorio para pedir cambios o eliminar. El propietario lo verá."
        placeholderTextColor={colors.gray_1}
        multiline
        editable={can_act}
        testID={`reason-input-${item.property_id}`}
      />

      <View style={styles.actions_row}>
        <Pressable
          style={[styles.primary_button, !can_act && styles.button_disabled]}
          disabled={!can_act}
          onPress={() => on_resolve(item.property_id, 'restore')}
          accessibilityRole="button"
          accessibilityLabel={`Restaurar ${item.property.address}`}
          testID={`restore-${item.property_id}`}
        >
          <Text style={styles.primary_text}>{ACTION_LABELS.restore}</Text>
        </Pressable>
        <Pressable
          style={[styles.secondary_button, !can_act && styles.button_disabled]}
          disabled={!can_act}
          onPress={() => on_resolve(item.property_id, 'keep_suspended')}
          accessibilityRole="button"
          accessibilityLabel={`Mantener suspendida ${item.property.address}`}
          testID={`keep-suspended-${item.property_id}`}
        >
          <Text style={styles.secondary_text}>{ACTION_LABELS.keep_suspended}</Text>
        </Pressable>
      </View>
      <View style={styles.actions_row}>
        <Pressable
          style={[styles.secondary_button, !can_confirm_with_reason && styles.button_disabled]}
          disabled={!can_confirm_with_reason}
          onPress={() => on_resolve(item.property_id, 'request_changes', reason)}
          accessibilityRole="button"
          accessibilityLabel={`Pedir cambios en ${item.property.address}`}
          testID={`request-changes-${item.property_id}`}
        >
          <Text style={styles.secondary_text}>{ACTION_LABELS.request_changes}</Text>
        </Pressable>
        <Pressable
          style={[styles.danger_button, !can_confirm_with_reason && styles.button_disabled]}
          disabled={!can_confirm_with_reason}
          onPress={() => on_resolve(item.property_id, 'delete', reason)}
          accessibilityRole="button"
          accessibilityLabel={`Eliminar ${item.property.address}`}
          testID={`delete-${item.property_id}`}
        >
          <Text style={styles.danger_text}>{ACTION_LABELS.delete}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function AdminReportsScreen(): React.ReactElement {
  const { reports, is_loading, error_message, refetch } = useAdminReports();
  const { resolve, is_submitting, error_message: resolve_error } = useResolveReport({
    onSuccess: refetch,
  });

  const handle_resolve = useCallback(
    (property_id: string, action: ResolveReportAction, reason?: string) => {
      void resolve(reason !== undefined ? { property_id, action, reason } : { property_id, action });
    },
    [resolve],
  );

  if (is_loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Reportes</Text>
        </View>
        <View style={styles.center}>
          <UrbeaLoader testID="loading-indicator" size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error_message !== null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Reportes</Text>
        </View>
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

  const list = reports ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, styles.header_row]}>
        <BackButton />
        <View>
          <Text style={styles.title}>Reportes</Text>
          {list.length > 0 && (
            <Text style={styles.subtitle}>
              {list.length === 1 ? '1 propiedad reportada' : `${list.length} propiedades reportadas`}
            </Text>
          )}
        </View>
      </View>

      {resolve_error !== null && (
        <Text style={styles.error_text} testID="resolve-error">
          {resolve_error}
        </Text>
      )}

      <FlatList
        data={list}
        keyExtractor={(item) => item.property_id}
        renderItem={({ item }) => (
          <ReportCard item={item} is_submitting={is_submitting} on_resolve={handle_resolve} />
        )}
        contentContainerStyle={
          list.length === 0 ? styles.list_empty_container : styles.list_content
        }
        ListEmptyComponent={
          <View style={styles.empty_state} testID="empty-state">
            <Text style={styles.empty_text}>No hay reportes pendientes.</Text>
          </View>
        }
        testID="reports-list"
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — tokens de theme.ts, calcados del layout de /admin/revisions
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.s_20, paddingTop: spacing.s_16, paddingBottom: spacing.s_12 },
  // #241.3: back visible — antes solo se salía con el gesto/hardware back.
  header_row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { ...type_scale.h1, color: colors.ink },
  subtitle: { fontSize: 14, color: colors.gray_2, marginTop: spacing.s_4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.s_32 },

  list_content: { paddingHorizontal: spacing.s_20, paddingBottom: spacing.s_32 },
  list_empty_container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty_state: { alignItems: 'center', paddingHorizontal: spacing.s_32 },
  empty_text: { fontSize: 15, color: colors.gray_2, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.paper_3,
    padding: spacing.s_16,
    marginBottom: spacing.s_12,
  },
  card_header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  card_address: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.ink, marginRight: spacing.s_8 },
  card_meta: { fontSize: 13, color: colors.gray_2, marginTop: spacing.s_4 },

  status_badge: {
    borderRadius: radii.r_pill,
    paddingHorizontal: spacing.s_12,
    paddingVertical: 3,
    backgroundColor: colors.accent_tint,
  },
  status_badge_text: { fontSize: 12, fontWeight: '600', color: colors.accent_deep },

  section_label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray_2,
    marginTop: spacing.s_16,
    marginBottom: spacing.s_8,
  },
  reports_list: { gap: spacing.s_4 },
  report_row: { fontSize: 14, color: colors.ink },
  not_actionable_text: { fontSize: 13, color: colors.gray_2, marginTop: spacing.s_12 },

  reason_input: {
    borderWidth: 1,
    borderColor: colors.paper_3,
    borderRadius: radii.r_12,
    backgroundColor: colors.surface,
    padding: spacing.s_12,
    minHeight: 64,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },

  error_text: { fontSize: 14, color: colors.danger, marginTop: spacing.s_12, textAlign: 'center' },

  actions_row: { flexDirection: 'row', gap: spacing.s_12, marginTop: spacing.s_12 },
  primary_button: {
    flex: 1,
    borderRadius: radii.r_12,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primary_text: { fontSize: 15, fontWeight: '600', color: colors.on_primary },
  secondary_button: {
    flex: 1,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondary_text: { fontSize: 15, fontWeight: '600', color: colors.primary },
  danger_button: {
    flex: 1,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: 14,
    alignItems: 'center',
  },
  danger_text: { fontSize: 15, fontWeight: '600', color: colors.danger },
  button_disabled: { opacity: 0.4 },

  retry_button: {
    marginTop: spacing.s_12,
    paddingVertical: 10,
    paddingHorizontal: spacing.s_24,
    borderRadius: radii.r_pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  retry_text: { fontSize: 15, fontWeight: '600', color: colors.primary },
});
