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
import { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabase/client';
import { PrimaryButton } from '@/components/PrimaryButton';
import type { Database } from '@/types/database';

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

/** Traduce el valor del enum agency_status a una etiqueta legible en ES. */
function format_status(status: AgencyRow['status']): string {
  const labels: Record<AgencyRow['status'], string> = {
    pending_approval: 'Pendiente',
    approved: 'Aprobada',
    active: 'Activa',
    suspended: 'Suspendida',
    rejected: 'Rechazada',
  };
  return labels[status] ?? status;
}

/** Color del badge de estado. */
function status_color(status: AgencyRow['status']): string {
  switch (status) {
    case 'active':
      return '#1A5E44';   // salvia
    case 'approved':
      return '#4A90D9';   // azul
    case 'pending_approval':
      return '#E5A020';   // ámbar
    case 'suspended':
    case 'rejected':
      return '#D94A4A';   // rojo
    default:
      return '#9CA3AF';   // gris
  }
}

// ---------------------------------------------------------------------------
// Subcomponente: tarjeta de inmobiliaria
// ---------------------------------------------------------------------------

interface AgencyCardProps {
  item: AgencyRow;
  on_press: (id: string) => void;
}

function AgencyCard({ item, on_press }: AgencyCardProps): React.ReactElement {
  const badge_color = status_color(item.status);

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
            {format_status(item.status)}
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
// Pantalla principal
// ---------------------------------------------------------------------------

export default function AdminAgencyListScreen(): React.ReactElement {
  const router = useRouter();

  const [agencies, set_agencies] = useState<AgencyRow[]>([]);
  const [is_loading, set_is_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

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

      <View style={styles.cta_wrapper}>
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
