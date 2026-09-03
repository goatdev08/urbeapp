/**
 * /admin/revisions — cola de revisiones de ediciones (módulo 041-M1, tarea
 * #218, subtarea 218.2). Lista FIFO (el server ya ordena por created_at
 * ascendente, la más vieja primero — useAdminRevisions.ts) de
 * property_revisions activas (pending|needs_changes). Por revisión: la
 * propiedad (address del snapshot embebido) + el diff campo a campo SOLO de
 * las keys presentes en changed_fields (valor publicado → valor propuesto);
 * acciones Aprobar / Pedir cambios / Rechazar vía useModerateProperty.
 *
 * Estética utilitaria/clara calcada de mobile/app/admin/ads/index.tsx (el
 * lenguaje ya usado en el panel de administración) — la identidad visual no
 * trae mockup propio para esta pantalla.
 *
 * 🔴 Motivo OBLIGATORIO EN LA UI para Pedir cambios / Rechazar (decisión de
 * producto de Abraham, plan de 218.2) — la EF moderate-property lo deja
 * opcional; el botón de confirmar queda deshabilitado sin texto. Aprobar NO
 * pide motivo.
 *
 * Refresco: onSuccess → refetch (mismo patrón que ActiveAdsSection de
 * app/admin/ads/index.tsx con useModerateAd) — UNA sola instancia de
 * useModerateProperty a nivel de pantalla; is_submitting deshabilita TODAS
 * las tarjetas mientras una acción está en vuelo (mismo criterio que
 * ActiveAdsSection/disabled={is_moderating}).
 */
import React, { useCallback, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  useAdminRevisions,
  type AdminRevisionItem,
  type AdminRevisionPropertySnapshot,
} from '@/features/admin/hooks/useAdminRevisions';
import { useModerateProperty } from '@/features/admin/hooks/useModerateProperty';
import { format_price } from '@/lib/formatPrice';

// ---------------------------------------------------------------------------
// Etiquetas es-MX
// ---------------------------------------------------------------------------

/** Whitelist exacto de edit-property (types.ts:29-52) — ver useAdminRevisions.ts. */
const FIELD_LABELS: Record<string, string> = {
  operation_type: 'Operación',
  property_type: 'Tipo de propiedad',
  price: 'Precio',
  price_visible: 'Precio visible',
  bedrooms: 'Recámaras',
  bathrooms: 'Baños',
  square_meters: 'Metros cuadrados',
  built_square_meters: 'Metros construidos',
  half_bathrooms: 'Medios baños',
  currency: 'Moneda',
  address: 'Dirección',
  description: 'Descripción',
  pet_friendly: 'Acepta mascotas',
  allows_no_guarantor: 'Sin aval',
  student_friendly: 'Para estudiantes',
};

const OPERATION_TYPE_LABELS: Record<string, string> = {
  rent: 'Renta',
  sale: 'Venta',
  both: 'Renta y venta',
};

const STATUS_LABELS: Record<AdminRevisionItem['status'], string> = {
  pending: 'Pendiente',
  needs_changes: 'Cambios pedidos',
};

const STATUS_COLORS: Record<AdminRevisionItem['status'], string> = {
  pending: '#E5A020',
  needs_changes: '#9A7150',
};

/**
 * Formatea un valor del diff (viejo o nuevo) para mostrarlo. `currency` es la
 * divisa del LADO que se está formateando — el propuesto puede traer una
 * divisa distinta a la publicada si `changed_fields.currency` vino.
 */
function format_field_value(key: string, value: unknown, currency: string): string {
  if (value === null || value === undefined) return '—';
  if (key === 'price') return format_price(value as number, currency);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (key === 'operation_type') return OPERATION_TYPE_LABELS[value as string] ?? String(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Diff campo a campo
// ---------------------------------------------------------------------------

function DiffRow({
  field_key,
  old_value,
  new_value,
}: {
  field_key: string;
  old_value: string;
  new_value: string;
}): React.ReactElement {
  return (
    <View style={styles.diff_row} testID={`diff-row-${field_key}`}>
      <Text style={styles.diff_label}>{FIELD_LABELS[field_key] ?? field_key}</Text>
      <View style={styles.diff_values}>
        <Text style={styles.diff_old} numberOfLines={2}>
          {old_value}
        </Text>
        <Text style={styles.diff_arrow}>→</Text>
        <Text style={styles.diff_new} numberOfLines={2}>
          {new_value}
        </Text>
      </View>
    </View>
  );
}

function RevisionDiff({ item }: { item: AdminRevisionItem }): React.ReactElement {
  // edit-property guarda el INPUT COMPLETO en changed_fields (verificado en el
  // smoke de 218.5), no solo lo que cambió — aquí se filtra al diff real:
  // fuera property_id (metadato, no campo editable) y fuera las keys cuyo valor
  // propuesto es idéntico al publicado.
  const keys = Object.keys(item.changed_fields).filter(
    (key) =>
      key !== 'property_id' &&
      !Object.is(
        item.changed_fields[key] ?? null,
        item.property[key as keyof AdminRevisionPropertySnapshot] ?? null
      )
  );
  const new_currency =
    (item.changed_fields.currency as string | undefined) ?? item.property.currency;

  return (
    <View style={styles.diff_container}>
      {keys.map((key) => {
        const old_raw = item.property[key as keyof AdminRevisionPropertySnapshot];
        const new_raw = item.changed_fields[key];
        return (
          <DiffRow
            key={key}
            field_key={key}
            old_value={format_field_value(key, old_raw, item.property.currency)}
            new_value={format_field_value(key, new_raw, new_currency)}
          />
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de revisión — diff + acciones
// ---------------------------------------------------------------------------

interface RevisionCardProps {
  item: AdminRevisionItem;
  is_submitting: boolean;
  on_moderate: (
    property_id: string,
    action: 'approve' | 'needs_changes' | 'reject',
    reason?: string,
  ) => void;
}

function RevisionCard({ item, is_submitting, on_moderate }: RevisionCardProps): React.ReactElement {
  const [reason, set_reason] = useState('');
  const can_confirm_with_reason = reason.trim().length > 0 && !is_submitting;

  return (
    <View style={styles.card} testID={`revision-${item.revision_id}`}>
      <View style={styles.card_header}>
        <Text style={styles.card_address} numberOfLines={2}>
          {item.property.address}
        </Text>
        <View
          style={[styles.status_badge, { backgroundColor: STATUS_COLORS[item.status] + '22' }]}
        >
          <Text style={[styles.status_badge_text, { color: STATUS_COLORS[item.status] }]}>
            {STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>

      {item.status === 'needs_changes' && item.rejection_reason !== null && (
        <Text style={styles.previous_reason} numberOfLines={3}>
          Motivo anterior: {item.rejection_reason}
        </Text>
      )}

      <RevisionDiff item={item} />

      <Text style={styles.section_label}>Motivo</Text>
      <TextInput
        style={styles.reason_input}
        value={reason}
        onChangeText={set_reason}
        placeholder="Obligatorio para pedir cambios o rechazar. El propietario lo verá."
        placeholderTextColor="#9CA3AF"
        multiline
        editable={!is_submitting}
        testID={`reason-input-${item.revision_id}`}
      />

      <Pressable
        style={[styles.approve_button, is_submitting && styles.button_disabled]}
        disabled={is_submitting}
        onPress={() => on_moderate(item.property_id, 'approve')}
        accessibilityRole="button"
        accessibilityLabel={`Aprobar la revisión de ${item.property.address}`}
        testID={`approve-${item.revision_id}`}
      >
        <Text style={styles.approve_text}>Aprobar</Text>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          style={[
            styles.secondary_button,
            styles.actions_flex,
            !can_confirm_with_reason && styles.button_disabled,
          ]}
          disabled={!can_confirm_with_reason}
          onPress={() => on_moderate(item.property_id, 'needs_changes', reason)}
          accessibilityRole="button"
          accessibilityLabel={`Pedir cambios en la revisión de ${item.property.address}`}
          testID={`needs-changes-${item.revision_id}`}
        >
          <Text style={styles.secondary_text}>Pedir cambios</Text>
        </Pressable>
        <Pressable
          style={[styles.reject_button, !can_confirm_with_reason && styles.button_disabled]}
          disabled={!can_confirm_with_reason}
          onPress={() => on_moderate(item.property_id, 'reject', reason)}
          accessibilityRole="button"
          accessibilityLabel={`Rechazar la revisión de ${item.property.address}`}
          testID={`reject-${item.revision_id}`}
        >
          <Text style={styles.reject_text}>Rechazar</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function AdminRevisionsScreen(): React.ReactElement {
  const { revisions, is_loading, error_message, refetch } = useAdminRevisions();
  const { moderate, is_submitting, error_message: moderate_error } = useModerateProperty({
    onSuccess: refetch,
  });

  const handle_moderate = useCallback(
    (property_id: string, action: 'approve' | 'needs_changes' | 'reject', reason?: string) => {
      void moderate(reason !== undefined ? { property_id, action, reason } : { property_id, action });
    },
    [moderate],
  );

  if (is_loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Revisiones de ediciones</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator testID="loading-indicator" size="large" color="#5A8A5E" />
        </View>
      </SafeAreaView>
    );
  }

  if (error_message !== null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Revisiones de ediciones</Text>
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

  const list = revisions ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, styles.header_row]}>
        <BackButton />
        <View style={styles.header_text}>
          <Text style={styles.title}>Revisiones de ediciones</Text>
          {list.length > 0 && (
            <Text style={styles.subtitle}>
              {list.length === 1 ? '1 pendiente' : `${list.length} pendientes`}
            </Text>
          )}
        </View>
      </View>

      {moderate_error !== null && (
        <Text style={styles.error_text} testID="moderate-error">
          {moderate_error}
        </Text>
      )}

      <FlatList
        data={list}
        keyExtractor={(item) => item.revision_id}
        renderItem={({ item }) => (
          <RevisionCard item={item} is_submitting={is_submitting} on_moderate={handle_moderate} />
        )}
        contentContainerStyle={
          list.length === 0 ? styles.list_empty_container : styles.list_content
        }
        ListEmptyComponent={
          <View style={styles.empty_state} testID="empty-state">
            <Text style={styles.empty_text}>No hay revisiones pendientes.</Text>
          </View>
        }
        testID="revisions-list"
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — calcados de mobile/app/admin/ads/index.tsx
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  // #241.3: back visible — antes solo se salía con el gesto/hardware back.
  header_row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  header_text: { flexShrink: 1 },
  title: { fontSize: 28, fontWeight: '700', color: '#17140F' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

  list_content: { paddingHorizontal: 20, paddingBottom: 32 },
  list_empty_container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty_state: { alignItems: 'center', paddingHorizontal: 32 },
  empty_text: { fontSize: 15, color: '#6B7280', textAlign: 'center' },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E7E2D8',
    padding: 16,
    marginBottom: 12,
  },
  card_header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  card_address: { flex: 1, fontSize: 16, fontWeight: '600', color: '#17140F', marginRight: 8 },
  previous_reason: { fontSize: 13, color: '#9A7150', marginTop: 6 },

  status_badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  status_badge_text: { fontSize: 12, fontWeight: '600' },

  diff_container: { marginTop: 14, gap: 10 },
  diff_row: {},
  diff_label: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  diff_values: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 8 },
  diff_old: { flex: 1, fontSize: 14, color: '#9A968C', textDecorationLine: 'line-through' },
  diff_arrow: { fontSize: 14, color: '#9A7150' },
  diff_new: { flex: 1, fontSize: 14, fontWeight: '600', color: '#17140F' },

  section_label: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginTop: 20, marginBottom: 8 },
  reason_input: {
    borderWidth: 1,
    borderColor: '#E7E2D8',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 12,
    minHeight: 72,
    fontSize: 15,
    color: '#17140F',
    textAlignVertical: 'top',
  },

  error_text: { fontSize: 14, color: '#D94A4A', marginTop: 12, textAlign: 'center' },

  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  actions_flex: { flex: 1 },
  reject_button: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D94A4A',
    paddingVertical: 14,
    alignItems: 'center',
  },
  reject_text: { fontSize: 15, fontWeight: '600', color: '#D94A4A' },
  approve_button: {
    marginTop: 20,
    borderRadius: 12,
    backgroundColor: '#5A8A5E',
    paddingVertical: 14,
    alignItems: 'center',
  },
  approve_text: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  button_disabled: { opacity: 0.4 },

  secondary_button: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#5A8A5E',
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondary_text: { fontSize: 15, fontWeight: '600', color: '#5A8A5E' },

  retry_button: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#5A8A5E',
  },
  retry_text: { fontSize: 15, fontWeight: '600', color: '#5A8A5E' },
});
