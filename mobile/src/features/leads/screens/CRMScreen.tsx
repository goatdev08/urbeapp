/**
 * CRMScreen — pantalla de leads/CRM para agentes.
 *
 * Subtarea 15.1 — scaffold con role guard.
 * Subtarea 15.7 — FilterTabs + FlatList de LeadCard + filtrado client-side.
 * Subtarea 15.8 — búsqueda client-side por full_name (compuesta con filtro de tab).
 *
 * Filtrado:
 *   all         → todos los leads
 *   new         → status === 'new'
 *   in_progress → status ∈ { contacted, in_progress, visit_scheduled }
 *   closed      → status ∈ { closed_won, closed_lost, discarded }
 *
 * Búsqueda:
 *   Si search no vacío → aplica sobre el resultado del filtro de tab.
 *   full_name null-safe: leads sin nombre no matchean cuando hay query.
 *
 * El mapeo de grupos es inline en esta pantalla (presentacional; sin utils/).
 *
 * Paleta: gestión clara (paper) — misma que MyListings / ProfileScreen.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  LayoutAnimation,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MagnifyingGlass, Tray } from 'phosphor-react-native';

import { FilterTabs } from '@/components/FilterTabs';
import { useAuth } from '@/features/auth/context';
import { EmptyState } from '@/features/profile/components/EmptyState';
import { colors, layout, radii, spacing, type_scale } from '@/theme/theme';
import { AgentSelector } from '../components/AgentSelector';
import { LeadCard } from '../components/LeadCard';
import { LeadExpandedView } from '../components/LeadExpandedView';
import { useAgencyAgents } from '../hooks/useAgencyAgents';
import { useAgencyRole } from '../hooks/useAgencyRole';
import { useAgentLeads } from '../hooks/useAgentLeads';
import type { AgentLead, LeadStatus } from '../types';

// ─── Tipos de filtro ──────────────────────────────────────────────────────────

type CrmFilter = 'all' | 'new' | 'in_progress' | 'closed';

// ─── Definición de tabs ───────────────────────────────────────────────────────

const CRM_TABS: { value: CrmFilter; label: string }[] = [
  { value: 'all',         label: 'Todos' },
  { value: 'new',         label: 'Nuevos' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'closed',      label: 'Cerrados' },
];

// ─── Mapeo de grupos (inline — no es lógica de negocio; es presentacional) ────

/** Statuses que caen en el grupo "En progreso". */
const IN_PROGRESS_STATUSES: LeadStatus[] = [
  'contacted',
  'in_progress',
  'visit_scheduled',
];

/** Statuses que caen en el grupo "Cerrados". */
const CLOSED_STATUSES: LeadStatus[] = [
  'closed_won',
  'closed_lost',
  'discarded',
];

/** Aplica el filtro seleccionado sobre el array completo de leads. */
function apply_filter(leads: AgentLead[], filter: CrmFilter): AgentLead[] {
  if (filter === 'all')         return leads;
  if (filter === 'new')         return leads.filter((l) => l.status === 'new');
  if (filter === 'in_progress') return leads.filter((l) => IN_PROGRESS_STATUSES.includes(l.status));
  // 'closed'
  return leads.filter((l) => CLOSED_STATUSES.includes(l.status));
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function CRMScreen(): React.ReactElement {
  const { user } = useAuth();
  const { isOwner, agencyId } = useAgencyRole();
  const { agents } = useAgencyAgents(agencyId, isOwner);
  const [selected_agent_id, set_selected_agent_id] = useState<string | null>(null);
  const { leads, loading, error, refetch } = useAgentLeads(selected_agent_id);
  const [filter, set_filter] = useState<CrmFilter>('all');
  const [search, set_search] = useState('');
  const [selected_lead, set_selected_lead] = useState<AgentLead | null>(null);

  const filtered_leads = useMemo(() => {
    const by_tab = apply_filter(leads, filter);
    const q = search.trim().toLowerCase();
    if (!q) return by_tab;
    // ponytail: null-safe — leads sin full_name no matchean cuando hay query
    return by_tab.filter((l) => l.full_name?.toLowerCase().includes(q) ?? false);
  }, [leads, filter, search]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handle_lead_press(lead: AgentLead): void {
    set_selected_lead(lead);
  }

  const handle_expanded_close = useCallback((): void => {
    set_selected_lead(null);
  }, []);

  const handle_expanded_success = useCallback((): void => {
    refetch();
    set_selected_lead(null);
  }, [refetch]);

  // ── Estado de carga inicial ──────────────────────────────────────────────────

  if (loading && leads.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Estado de error ──────────────────────────────────────────────────────────

  if (error !== null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.error_text}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render principal ─────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Cabecera */}
        <View style={styles.header}>
          <Text style={styles.title}>CRM</Text>
          <Text style={styles.subtitle}>
            {isOwner ? 'Leads de tu equipo' : 'Tus leads de contacto'}
          </Text>
        </View>

        {/* Búsqueda por nombre */}
        <View style={styles.search_row}>
          <TextInput
            style={styles.search_input}
            placeholder="Buscar por nombre..."
            placeholderTextColor={colors.gray_1}
            value={search}
            onChangeText={set_search}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <Pressable
              onPress={() => set_search('')}
              style={styles.search_clear}
              hitSlop={8}
            >
              <Text style={styles.search_clear_text}>✕</Text>
            </Pressable>
          )}
        </View>

        {/* Selector de agente (solo owner con agentes en su agencia) */}
        {isOwner && agents.length > 0 && (
          <View style={styles.agent_selector_wrap}>
            <AgentSelector
              agents={agents}
              selectedAgentId={selected_agent_id}
              onSelectAgent={set_selected_agent_id}
            />
          </View>
        )}

        {/* Tabs de filtro */}
        <View style={styles.tabs_wrap}>
          <FilterTabs<CrmFilter>
            tabs={CRM_TABS}
            value={filter}
            onChange={(next) => {
              // Transición suave al reacomodar la lista filtrada.
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              set_filter(next);
            }}
          />
        </View>

        {/* Lista de leads */}
        <FlatList<AgentLead>
          style={styles.list}
          contentContainerStyle={styles.list_content}
          data={filtered_leads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <LeadCard lead={item} onPress={handle_lead_press} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            // ponytail: dos casos — agente sin leads vs. filtro/búsqueda sin resultados
            leads.length === 0
              ? <EmptyState
                  message="Aún no tienes leads"
                  subtitle="Los leads aparecen cuando un usuario contacta sobre una propiedad."
                  icon={Tray}
                />
              : <EmptyState
                  message="Sin resultados"
                  subtitle="Prueba con otro filtro o búsqueda."
                  icon={MagnifyingGlass}
                />
          }
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />

      </View>

      {/* Vista expandida del lead (modal bottom-sheet) */}
      {selected_lead !== null && (
        <LeadExpandedView
          lead={selected_lead}
          visible={selected_lead !== null}
          onClose={handle_expanded_close}
          onSuccess={handle_expanded_success}
          // Solo lectura si el lead pertenece a OTRO agente (owner viendo el
          // pipeline del equipo). La EF solo autoriza al agente dueño a editar;
          // sin este gate el cambio de estado devolvería UNAUTHORIZED_AGENT.
          readOnly={selected_lead.agent_id !== user?.id}
        />
      )}

    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  container: {
    flex: 1,
    paddingHorizontal: layout.screen_inset,
  },

  // ── Cabecera ────────────────────────────────────────────────────────────────
  header: {
    paddingTop: spacing.s_24,
    paddingBottom: spacing.s_16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.silver,
  },
  title: {
    ...type_scale.h1,
    color: colors.ink,
  },
  subtitle: {
    ...type_scale.body,
    color: colors.gray_2,
    marginTop: spacing.s_4,
  },

  // ── Búsqueda ─────────────────────────────────────────────────────────────────
  search_row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper_2,
    borderRadius: radii.r_8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.silver,
    marginTop: spacing.s_12,
    paddingHorizontal: spacing.s_12,
  },
  search_input: {
    flex: 1,
    ...type_scale.body,
    color: colors.ink,
    paddingVertical: spacing.s_12,
  },
  search_clear: {
    paddingLeft: spacing.s_8,
    paddingVertical: spacing.s_12,
  },
  search_clear_text: {
    ...type_scale.body,
    color: colors.gray_2,
  },

  // ── Selector de agente (owner) ─────────────────────────────────────────────
  agent_selector_wrap: {
    marginTop: spacing.s_12,
  },

  // ── Tabs ────────────────────────────────────────────────────────────────────
  tabs_wrap: {
    paddingTop: spacing.s_12,
    paddingBottom: spacing.s_4,
  },

  // ── Lista ───────────────────────────────────────────────────────────────────
  list: {
    flex: 1,
  },
  list_content: {
    paddingTop: spacing.s_8,
    paddingBottom: spacing.s_32,
    flexGrow: 1,
  },
  separator: {
    height: spacing.s_8,
  },

  // ── Centro (loading / error) ─────────────────────────────────────────────────
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s_24,
  },
  error_text: {
    ...type_scale.body,
    color: colors.gray_2,
    textAlign: 'center',
  },
});
