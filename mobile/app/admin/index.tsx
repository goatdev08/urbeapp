/**
 * /admin — Pantalla principal del panel de administración.
 * Lista de inmobiliarias con estados loading/error/vacío/lista.
 *
 * Subtarea 7.2 — Build agency list screen.
 *
 * Query inline (sin abstracción): RLS ya permite al admin SELECT directo
 * sobre agencies. No se necesita Edge Function para esta lectura.
 *
 * Estética: utilitaria/clara (NO el feed oscuro). Fondo blanco (#FAFAF8),
 * tipografía oscura, tarjetas con borde sutil.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabase/client';
import { PrimaryButton } from '@/components/PrimaryButton';
import type { Database } from '@/types/database';
import { agency_status_color, format_agency_status } from '@/features/admin/agency_status_labels';
import {
  useAdminQueueCounts,
  type AdminQueueCounts,
} from '@/features/admin/hooks/useAdminQueueCounts';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type AgencyRow = Pick<
  Database['public']['Tables']['agencies']['Row'],
  'id' | 'name' | 'slug' | 'status' | 'created_at'
>;

// ---------------------------------------------------------------------------
// Helpers de presentación
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Subcomponente: tarjeta de inmobiliaria
// ---------------------------------------------------------------------------

interface AgencyCardProps {
  item: AgencyRow;
  on_press: (id: string) => void;
}

function AgencyCard({ item, on_press }: AgencyCardProps): React.ReactElement {
  const badge_color = agency_status_color(item.status);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && styles.card_pressed,
      ]}
      onPress={() => on_press(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Ver detalle de ${item.name}`}
    >
      <View style={styles.card_header}>
        <Text style={styles.card_name} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={[styles.badge, { backgroundColor: badge_color + '22' }]}>
          <Text style={[styles.badge_text, { color: badge_color }]}>
            {format_agency_status(item.status)}
          </Text>
        </View>
      </View>
      <Text style={styles.card_slug} numberOfLines={1}>
        @{item.slug}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Subcomponente: fila de cola (217.2)
//
// Reusa el patrón visual ya existente en esta pantalla (antes solo la fila
// "Anuncios por revisar", ver git blame): tarjeta con borde sutil, texto +
// indicador a la derecha. Solo la fila con `on_press` navega (chevron
// visible); las demás son informativas — sus pantallas llegan en #218-#221.
// ---------------------------------------------------------------------------

interface QueueRowProps {
  label: string;
  count: number | undefined;
  /** true mientras carga O si el hook falló (todo-o-nada) — se muestra "—". */
  is_unresolved: boolean;
  on_press?: (() => void) | undefined;
  testID: string;
}

function QueueRow({
  label,
  count,
  is_unresolved,
  on_press,
  testID,
}: QueueRowProps): React.ReactElement {
  const indicator = is_unresolved ? (
    <Text style={styles.queue_count_placeholder}>—</Text>
  ) : count !== undefined && count > 0 ? (
    <View style={styles.queue_badge}>
      <Text style={styles.queue_badge_text}>{count}</Text>
    </View>
  ) : null;

  const content = (
    <>
      <Text style={styles.ads_entry_text}>{label}</Text>
      <View style={styles.queue_row_right}>
        {indicator}
        {on_press !== undefined && (
          <Text style={styles.ads_entry_chevron}>›</Text>
        )}
      </View>
    </>
  );

  if (on_press !== undefined) {
    return (
      <Pressable
        style={({ pressed }) => [styles.ads_entry, pressed && styles.card_pressed]}
        onPress={on_press}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={styles.ads_entry} testID={testID}>
      {content}
    </View>
  );
}

/** Las 5 colas del home admin (#217). Solo `ads_pending` navega (ruta real,
 * /admin/ads); el resto son informativas hasta #218-#221 (ponytail: sin
 * pantallas placeholder para rutas que aún no existen). */
const QUEUE_ROW_DEFS: readonly {
  key: keyof AdminQueueCounts;
  label: string;
  navigable: boolean;
  testID: string;
}[] = [
  { key: 'ads_pending', label: 'Anuncios por revisar', navigable: true, testID: 'admin-ads-entry' },
  { key: 'revisions_pending', label: 'Revisiones de ediciones', navigable: false, testID: 'admin-queue-revisions' },
  { key: 'reports_new', label: 'Reportes', navigable: false, testID: 'admin-queue-reports' },
  { key: 'agent_applications_pending', label: 'Solicitudes de agente', navigable: false, testID: 'admin-queue-agent-applications' },
  { key: 'agencies_pending', label: 'Inmobiliarias por aprobar', navigable: false, testID: 'admin-queue-agencies' },
];

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

export default function AdminAgencyListScreen(): React.ReactElement {
  // #143.6: CTA flotante bajo la barra de botones de Android
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [agencies, set_agencies] = useState<AgencyRow[]>([]);
  const [is_loading, set_is_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  // 217.2: contadores vivos de las 5 colas del panel — hook propio, no bloquea
  // la carga de la lista de inmobiliarias de abajo.
  const {
    counts: queue_counts,
    is_loading: queues_loading,
    error_message: queues_error_message,
    refetch: refetch_queues,
  } = useAdminQueueCounts();

  const load_agencies = useCallback(async () => {
    set_is_loading(true);
    set_error(null);

    const { data, error: query_error } = await supabase
      .from('agencies')
      .select('id, name, slug, status, created_at')
      .order('created_at', { ascending: false });

    if (query_error !== null) {
      set_error('No se pudieron cargar las inmobiliarias. Inténtalo de nuevo.');
      set_is_loading(false);
      return;
    }

    set_agencies(data ?? []);
    set_is_loading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: dispara la carga async (load_agencies maneja su propio loading/error).
    void load_agencies();
  }, [load_agencies]);

  const handle_agency_press = useCallback((id: string) => {
    router.push(`/admin/agencies/${id}`);
  }, [router]);

  const handle_create_press = useCallback(() => {
    router.push('/admin/agencies/create');
  }, [router]);

  // 208.3: entrada a la cola de moderación de anuncios.
  const handle_ads_press = useCallback(() => {
    router.push('/admin/ads');
  }, [router]);

  // ------ Estados de la pantalla ------

  if (is_loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Inmobiliarias</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator
            testID="loading-indicator"
            size="large"
            color="#5A8A5E"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (error !== null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Inmobiliarias</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.error_text} testID="error-message">
            {error}
          </Text>
          <Pressable
            style={styles.retry_button}
            onPress={() => void load_agencies()}
            accessibilityRole="button"
            accessibilityLabel="Reintentar carga"
          >
            <Text style={styles.retry_text}>Reintentar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Inmobiliarias</Text>
      </View>

      <Text style={styles.section_label}>Colas</Text>

      {queues_error_message !== null && (
        <View style={styles.queues_error_banner} testID="queues-error-banner">
          <Text style={styles.queues_error_text}>{queues_error_message}</Text>
          <Pressable
            onPress={refetch_queues}
            accessibilityRole="button"
            accessibilityLabel="Reintentar carga de contadores"
            testID="queues-retry"
          >
            <Text style={styles.queues_error_retry}>Reintentar</Text>
          </Pressable>
        </View>
      )}

      {QUEUE_ROW_DEFS.map((row) => (
        <QueueRow
          key={row.key}
          label={row.label}
          count={queue_counts?.[row.key]}
          is_unresolved={queues_loading || queues_error_message !== null}
          on_press={row.navigable ? handle_ads_press : undefined}
          testID={row.testID}
        />
      ))}

      <FlatList
        data={agencies}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <AgencyCard item={item} on_press={handle_agency_press} />
        )}
        contentContainerStyle={
          agencies.length === 0
            ? styles.list_empty_container
            : styles.list_content
        }
        ListEmptyComponent={
          <View style={styles.empty_state} testID="empty-state">
            <Text style={styles.empty_text}>
              Aún no hay inmobiliarias registradas.
            </Text>
          </View>
        }
        testID="agencies-list"
      />

      <View style={[styles.cta_wrapper, { paddingBottom: 16 + insets.bottom }]}>
        <PrimaryButton
          label="Crear inmobiliaria"
          onPress={handle_create_press}
          surface="light"
        />
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — utilitaria/clara
// ---------------------------------------------------------------------------

const COLOR_BG = '#FAFAF8';         // fondo papel claro (mismo que onboarding)
const COLOR_BORDER = '#E5E7EB';     // borde sutil
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_SALVIA = '#1A5E44';

const styles = StyleSheet.create({
  ads_entry: {
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E7E2D8',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ads_entry_text: { fontSize: 16, fontWeight: '600', color: '#17140F' },
  ads_entry_chevron: { fontSize: 22, color: '#9A7150' },

  // ── Sección de colas (217.2) ────────────────────────────────────────────
  section_label: {
    marginHorizontal: 20,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  queue_row_right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queue_count_placeholder: {
    fontSize: 14,
    color: '#9A968C',
  },
  queue_badge: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 13,
    backgroundColor: '#1A5E441A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queue_badge_text: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A5E44',
  },
  queues_error_banner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#FBEAEA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  queues_error_text: {
    flex: 1,
    fontSize: 13,
    color: '#D94A4A',
    marginRight: 12,
  },
  queues_error_retry: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A5E44',
  },

  container: {
    flex: 1,
    backgroundColor: COLOR_BG,
  },

  // ── Header ───────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_BORDER,
    backgroundColor: COLOR_BG,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLOR_TEXT_PRIMARY,
    letterSpacing: -0.3,
  },

  // ── Lista ─────────────────────────────────────────────────────────────────
  list_content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 100,   // espacio para el botón flotante
  },
  list_empty_container: {
    flexGrow: 1,
  },

  // ── Tarjeta de inmobiliaria ───────────────────────────────────────────────
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    padding: 16,
    marginBottom: 10,
  },
  card_pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  card_header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  card_name: {
    fontSize: 16,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    flex: 1,
    marginRight: 8,
  },
  card_slug: {
    fontSize: 13,
    color: COLOR_TEXT_SECONDARY,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badge_text: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Estado vacío ─────────────────────────────────────────────────────────
  empty_state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  empty_text: {
    fontSize: 16,
    color: COLOR_TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 24,
  },

  // ── Estado de error ───────────────────────────────────────────────────────
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  error_text: {
    fontSize: 15,
    color: '#D94A4A',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  retry_button: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLOR_SALVIA,
  },
  retry_text: {
    fontSize: 15,
    fontWeight: '600',
    color: COLOR_SALVIA,
  },

  // ── CTA fijo en la parte inferior ────────────────────────────────────────
  cta_wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: COLOR_BG,
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
  },
});
