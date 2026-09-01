/**
 * /admin/requests — cola unificada de solicitudes (módulo 041-M4, tarea
 * #221, subtarea 221.4). TRES secciones independientes:
 *
 * (a) Solicitudes de agente — agent_applications status='pending'. Aprobar
 *     directo / rechazar con motivo obligatorio, vía
 *     resolve_agent_application (RPC pinneada de 221.2).
 * (b) Inmobiliarias por aprobar — agencies status='pending_approval'.
 *     Aprobar directo / rechazar con motivo INLINE (follow-up del
 *     coordinador: antes solo existía por Studio) vía
 *     resolve_agency_registration (RPC del backend), + un link "Ver
 *     detalle" que sigue apuntando a `/admin/agencies/[id]` (211.1/71.5 —
 *     token de invitación, miembros; esta pantalla NO lo duplica).
 * (c) Solicitudes de cuenta comercial — advertising_requests status
 *     'pending' (tabla nueva de 221.1). Aprobar directo / rechazar con
 *     motivo obligatorio, vía resolve_advertising_request (RPC pinneada).
 *     Aprobar enciende `can_advertise` en `set_org_advertising_atomic`
 *     (backend, fuera de este footprint) — esta pantalla solo dispara la
 *     RPC de resolución.
 *
 * Estética utilitaria/clara calcada de /admin/reports (220.4, la cola
 * hermana más reciente): tokens de theme.ts, modal de motivo reutilizado del
 * patrón RejectionReasonModal de /admin/ads.
 */
import React, { useCallback, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import {
  useAdminAgentApplications,
  useAdminPendingAgencies,
  useAdminAdvertisingRequests,
  type AdminAgentApplication,
  type AdminPendingAgency,
  type AdminAdvertisingRequest,
} from '@/features/admin/hooks/useAdminRequestsQueues';
import {
  useResolveAgentApplication,
  useResolveAdvertisingRequest,
  useResolveAgencyRegistration,
} from '@/features/admin/hooks/useResolveRequest';
import { ADVERTISER_CATEGORY_LABELS } from '@/features/admin/components/advertiser-category-select';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Helpers de presentación
// ---------------------------------------------------------------------------

function format_date(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function format_applicant_name(applicant: AdminAgentApplication['applicant']): string {
  if (applicant === null) return 'Usuario desconocido';
  const full = [applicant.first_name, applicant.last_name].filter(Boolean).join(' ');
  return full.length > 0 ? full : applicant.email;
}

const APPLICATION_TYPE_LABELS: Record<AdminAgentApplication['application_type'], string> = {
  independent: 'Agente independiente',
  under_agency: 'Bajo inmobiliaria',
};

// ---------------------------------------------------------------------------
// Modal de motivo — rechazo (compartido entre las dos colas mutables)
// ---------------------------------------------------------------------------

function RejectionReasonModal({
  title,
  is_submitting,
  error_message,
  on_confirm,
  on_close,
}: {
  title: string;
  is_submitting: boolean;
  error_message: string | null;
  on_confirm: (reason: string) => void;
  on_close: () => void;
}): React.ReactElement {
  const [reason, set_reason] = useState('');
  const can_confirm = reason.trim().length > 0 && !is_submitting;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={on_close}>
      <View style={styles.modal_backdrop}>
        <View style={styles.modal_card}>
          <Text style={styles.modal_title}>{title}</Text>
          <TextInput
            style={styles.reason_input}
            value={reason}
            onChangeText={set_reason}
            placeholder="Motivo obligatorio. El solicitante lo verá."
            placeholderTextColor={colors.gray_1}
            multiline
            editable={!is_submitting}
            testID="rejection-reason-input"
          />
          {error_message !== null && (
            <Text style={styles.error_text} testID="rejection-reason-error">
              {error_message}
            </Text>
          )}
          <View style={styles.modal_actions}>
            <Pressable
              style={styles.secondary_button}
              onPress={on_close}
              disabled={is_submitting}
              accessibilityRole="button"
              accessibilityLabel="Cancelar"
            >
              <Text style={styles.secondary_text}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[styles.danger_button, !can_confirm && styles.button_disabled]}
              disabled={!can_confirm}
              onPress={() => on_confirm(reason)}
              accessibilityRole="button"
              accessibilityLabel="Confirmar rechazo"
              testID="rejection-reason-confirm"
            >
              <Text style={styles.danger_text}>Rechazar</Text>
            </Pressable>
          </View>
          {is_submitting && <ActivityIndicator color={colors.primary} style={styles.modal_spinner} />}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// (a) Sección: solicitudes de agente
// ---------------------------------------------------------------------------

function AgentApplicationsSection(): React.ReactElement {
  const { items, is_loading, error_message, refetch } = useAdminAgentApplications();
  const { resolve, is_submitting, error_message: resolve_error } = useResolveAgentApplication({
    onSuccess: refetch,
  });
  const [reject_target, set_reject_target] = useState<AdminAgentApplication | null>(null);

  const handle_approve = useCallback(
    (id: string) => void resolve({ application_id: id, approve: true }),
    [resolve],
  );
  const handle_reject_confirm = useCallback(
    (reason: string) => {
      if (reject_target === null) return;
      void resolve({ application_id: reject_target.id, approve: false, reason }).then((res) => {
        if (res.ok) set_reject_target(null);
      });
    },
    [reject_target, resolve],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.section_title}>Solicitudes de agente</Text>

      {is_loading ? (
        <ActivityIndicator testID="agent-applications-loading" color={colors.primary} style={styles.section_center} />
      ) : error_message !== null ? (
        <SectionError message={error_message} on_retry={refetch} testID="agent-applications-error" />
      ) : items !== null && items.length === 0 ? (
        <Text style={styles.empty_text} testID="agent-applications-empty">
          No hay solicitudes de agente pendientes.
        </Text>
      ) : (
        (items ?? []).map((item) => (
          <View key={item.id} style={styles.card} testID={`agent-application-${item.id}`}>
            <Text style={styles.card_title}>{format_applicant_name(item.applicant)}</Text>
            <Text style={styles.card_meta}>
              {APPLICATION_TYPE_LABELS[item.application_type]}
              {item.agency !== null ? ` · ${item.agency.name}` : ''}
            </Text>
            {item.reason !== null && item.reason.length > 0 && (
              <Text style={styles.card_body}>{item.reason}</Text>
            )}
            <Text style={styles.card_date}>{format_date(item.created_at)}</Text>

            <View style={styles.actions_row}>
              <Pressable
                style={[styles.primary_button, is_submitting && styles.button_disabled]}
                disabled={is_submitting}
                onPress={() => handle_approve(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Aprobar la solicitud de ${format_applicant_name(item.applicant)}`}
                testID={`approve-agent-application-${item.id}`}
              >
                <Text style={styles.primary_text}>Aprobar</Text>
              </Pressable>
              <Pressable
                style={[styles.secondary_button, is_submitting && styles.button_disabled]}
                disabled={is_submitting}
                onPress={() => set_reject_target(item)}
                accessibilityRole="button"
                accessibilityLabel={`Rechazar la solicitud de ${format_applicant_name(item.applicant)}`}
                testID={`reject-agent-application-${item.id}`}
              >
                <Text style={styles.secondary_text}>Rechazar</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}

      {reject_target !== null && (
        <RejectionReasonModal
          title={`Rechazar solicitud de ${format_applicant_name(reject_target.applicant)}`}
          is_submitting={is_submitting}
          error_message={resolve_error}
          on_confirm={handle_reject_confirm}
          on_close={() => set_reject_target(null)}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// (b) Sección: inmobiliarias por aprobar — SOLO lectura, link al detalle
// ---------------------------------------------------------------------------

function PendingAgenciesSection(): React.ReactElement {
  const { items, is_loading, error_message, refetch } = useAdminPendingAgencies();
  const { resolve, is_submitting, error_message: resolve_error } = useResolveAgencyRegistration({
    onSuccess: refetch,
  });
  const router = useRouter();
  const [reject_target, set_reject_target] = useState<AdminPendingAgency | null>(null);

  const handle_view_detail = useCallback(
    (item: AdminPendingAgency) => router.push(`/admin/agencies/${item.id}`),
    [router],
  );
  const handle_approve = useCallback(
    (id: string) => void resolve({ agency_id: id, approve: true }),
    [resolve],
  );
  const handle_reject_confirm = useCallback(
    (reason: string) => {
      if (reject_target === null) return;
      void resolve({ agency_id: reject_target.id, approve: false, reason }).then((res) => {
        if (res.ok) set_reject_target(null);
      });
    },
    [reject_target, resolve],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.section_title}>Inmobiliarias por aprobar</Text>

      {is_loading ? (
        <ActivityIndicator testID="pending-agencies-loading" color={colors.primary} style={styles.section_center} />
      ) : error_message !== null ? (
        <SectionError message={error_message} on_retry={refetch} testID="pending-agencies-error" />
      ) : items !== null && items.length === 0 ? (
        <Text style={styles.empty_text} testID="pending-agencies-empty">
          No hay inmobiliarias esperando aprobación.
        </Text>
      ) : (
        (items ?? []).map((item) => (
          <View key={item.id} style={styles.card} testID={`pending-agency-${item.id}`}>
            <Text style={styles.card_title}>{item.name}</Text>
            <Text style={styles.card_meta}>@{item.slug}</Text>
            {item.contact_name !== null && (
              <Text style={styles.card_body}>{item.contact_name}</Text>
            )}
            <Text style={styles.card_date}>{format_date(item.created_at)}</Text>

            <Pressable
              style={styles.link_row}
              onPress={() => handle_view_detail(item)}
              accessibilityRole="button"
              accessibilityLabel={`Ver el detalle de ${item.name}`}
              testID={`view-agency-detail-${item.id}`}
            >
              <Text style={styles.link_text}>Ver detalle</Text>
            </Pressable>

            <View style={styles.actions_row}>
              <Pressable
                style={[styles.primary_button, is_submitting && styles.button_disabled]}
                disabled={is_submitting}
                onPress={() => handle_approve(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Aprobar el registro de ${item.name}`}
                testID={`approve-agency-${item.id}`}
              >
                <Text style={styles.primary_text}>Aprobar</Text>
              </Pressable>
              <Pressable
                style={[styles.secondary_button, is_submitting && styles.button_disabled]}
                disabled={is_submitting}
                onPress={() => set_reject_target(item)}
                accessibilityRole="button"
                accessibilityLabel={`Rechazar el registro de ${item.name}`}
                testID={`reject-agency-${item.id}`}
              >
                <Text style={styles.secondary_text}>Rechazar</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}

      {reject_target !== null && (
        <RejectionReasonModal
          title={`Rechazar el registro de ${reject_target.name}`}
          is_submitting={is_submitting}
          error_message={resolve_error}
          on_confirm={handle_reject_confirm}
          on_close={() => set_reject_target(null)}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// (c) Sección: solicitudes de cuenta comercial
// ---------------------------------------------------------------------------

function AdvertisingRequestsSection(): React.ReactElement {
  const { items, is_loading, error_message, refetch } = useAdminAdvertisingRequests();
  const { resolve, is_submitting, error_message: resolve_error } = useResolveAdvertisingRequest({
    onSuccess: refetch,
  });
  const [reject_target, set_reject_target] = useState<AdminAdvertisingRequest | null>(null);

  const handle_approve = useCallback(
    (id: string) => void resolve({ request_id: id, approve: true }),
    [resolve],
  );
  const handle_reject_confirm = useCallback(
    (reason: string) => {
      if (reject_target === null) return;
      void resolve({ request_id: reject_target.id, approve: false, reason }).then((res) => {
        if (res.ok) set_reject_target(null);
      });
    },
    [reject_target, resolve],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.section_title}>Solicitudes de cuenta comercial</Text>

      {is_loading ? (
        <ActivityIndicator testID="advertising-requests-loading" color={colors.primary} style={styles.section_center} />
      ) : error_message !== null ? (
        <SectionError message={error_message} on_retry={refetch} testID="advertising-requests-error" />
      ) : items !== null && items.length === 0 ? (
        <Text style={styles.empty_text} testID="advertising-requests-empty">
          No hay solicitudes de cuenta comercial pendientes.
        </Text>
      ) : (
        (items ?? []).map((item) => (
          <View key={item.id} style={styles.card} testID={`advertising-request-${item.id}`}>
            <Text style={styles.card_title}>{item.agency?.name ?? 'Organización desconocida'}</Text>
            <Text style={styles.card_meta}>
              {ADVERTISER_CATEGORY_LABELS[item.proposed_category] ?? item.proposed_category}
            </Text>
            <Text style={styles.card_date}>{format_date(item.created_at)}</Text>

            <View style={styles.actions_row}>
              <Pressable
                style={[styles.primary_button, is_submitting && styles.button_disabled]}
                disabled={is_submitting}
                onPress={() => handle_approve(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Aprobar la cuenta comercial de ${item.agency?.name ?? 'la organización'}`}
                testID={`approve-advertising-request-${item.id}`}
              >
                <Text style={styles.primary_text}>Aprobar</Text>
              </Pressable>
              <Pressable
                style={[styles.secondary_button, is_submitting && styles.button_disabled]}
                disabled={is_submitting}
                onPress={() => set_reject_target(item)}
                accessibilityRole="button"
                accessibilityLabel={`Rechazar la cuenta comercial de ${item.agency?.name ?? 'la organización'}`}
                testID={`reject-advertising-request-${item.id}`}
              >
                <Text style={styles.secondary_text}>Rechazar</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}

      {reject_target !== null && (
        <RejectionReasonModal
          title={`Rechazar cuenta comercial de ${reject_target.agency?.name ?? 'la organización'}`}
          is_submitting={is_submitting}
          error_message={resolve_error}
          on_confirm={handle_reject_confirm}
          on_close={() => set_reject_target(null)}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Error de sección — reintentar (compartido)
// ---------------------------------------------------------------------------

function SectionError({
  message,
  on_retry,
  testID,
}: {
  message: string;
  on_retry: () => void;
  testID: string;
}): React.ReactElement {
  return (
    <View style={styles.section_center} testID={testID}>
      <Text style={styles.error_text}>{message}</Text>
      <Pressable
        style={styles.retry_button}
        onPress={on_retry}
        accessibilityRole="button"
        accessibilityLabel="Reintentar carga"
      >
        <Text style={styles.retry_text}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function AdminRequestsScreen(): React.ReactElement {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Solicitudes</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll_content}>
        <AgentApplicationsSection />
        <PendingAgenciesSection />
        <AdvertisingRequestsSection />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — tokens de theme.ts, calcados del layout de /admin/reports
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.s_20, paddingTop: spacing.s_16, paddingBottom: spacing.s_12 },
  title: { ...type_scale.h1, color: colors.ink },
  scroll_content: { paddingHorizontal: spacing.s_20, paddingBottom: spacing.s_40 },

  section: { marginBottom: spacing.s_24 },
  section_title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray_2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.s_12,
  },
  section_center: { alignItems: 'center', paddingVertical: spacing.s_16, gap: spacing.s_8 },

  empty_text: { fontSize: 14, color: colors.gray_2 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.paper_3,
    padding: spacing.s_16,
    marginBottom: spacing.s_12,
  },
  card_title: { fontSize: 16, fontWeight: '600', color: colors.ink },
  card_meta: { fontSize: 13, color: colors.gray_2, marginTop: spacing.s_4 },
  card_body: { fontSize: 14, color: colors.ink, marginTop: spacing.s_8 },
  card_date: { fontSize: 12, color: colors.gray_2, marginTop: spacing.s_8 },

  link_row: { marginTop: spacing.s_12 },
  link_text: { fontSize: 13, fontWeight: '600', color: colors.primary },

  actions_row: { flexDirection: 'row', gap: spacing.s_12, marginTop: spacing.s_12 },
  primary_button: {
    flex: 1,
    borderRadius: radii.r_12,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primary_text: { fontSize: 14, fontWeight: '600', color: colors.on_primary },
  secondary_button: {
    flex: 1,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondary_text: { fontSize: 14, fontWeight: '600', color: colors.primary },
  danger_button: {
    flex: 1,
    borderRadius: radii.r_12,
    backgroundColor: colors.danger,
    paddingVertical: 12,
    alignItems: 'center',
  },
  danger_text: { fontSize: 14, fontWeight: '600', color: colors.on_primary },
  button_disabled: { opacity: 0.4 },

  retry_button: {
    paddingVertical: 8,
    paddingHorizontal: spacing.s_20,
    borderRadius: radii.r_pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  retry_text: { fontSize: 14, fontWeight: '600', color: colors.primary },
  error_text: { fontSize: 14, color: colors.danger, textAlign: 'center' },

  modal_backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23,20,15,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s_24,
  },
  modal_card: {
    width: '100%',
    backgroundColor: colors.paper,
    borderRadius: radii.r_16,
    padding: spacing.s_20,
    gap: spacing.s_12,
  },
  modal_title: { fontSize: 17, fontWeight: '700', color: colors.ink },
  modal_actions: { flexDirection: 'row', gap: spacing.s_12 },
  modal_spinner: { marginTop: spacing.s_4 },
  reason_input: {
    borderWidth: 1,
    borderColor: colors.paper_3,
    borderRadius: radii.r_12,
    backgroundColor: colors.surface,
    padding: spacing.s_12,
    minHeight: 72,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
});
