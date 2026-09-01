/**
 * CRMScreen — pantalla de leads/CRM para agentes.
 *
 * Subtarea 15.1 — scaffold con role guard.
 * Subtarea 15.7 — FilterTabs + FlatList de LeadCard + filtrado client-side.
 * Subtarea 15.8 — búsqueda client-side por full_name (compuesta con filtro de tab).
 * Subtarea 75.5/75.6 — canViewTeam (owner Y admin ven el equipo, no solo owner)
 *   + sección superior fija de leads en seguimiento (is_follow_up, §19.9).
 * Corrección code review (rama tarea/75-crm-estados-scoring):
 *   - FIX1: onFollowUpChange (refetch) al LeadExpandedView — el toggle de
 *     seguimiento ya no reusa onSuccess (que cierra el sheet).
 *   - FIX4: la sección "En seguimiento" ahora RESPETA el tab activo (antes lo
 *     ignoraba, mostrando leads de otro grupo bajo el tab equivocado) y está
 *     capada a FOLLOW_UP_SECTION_CAP tarjetas (antes montaba todas fuera de
 *     la virtualización del FlatList).
 *   - FIX5: se muestra un aviso + reintento si useAgencyRole().error es true
 *     (antes se degradaba en silencio a "Tus leads de contacto").
 *
 * Filtrado (#75.1: lead_status se extendió a 11 valores — 7 legacy + 4
 * vigentes; los grupos cubren ambos para que un lead viejo no se muestre
 * mal):
 *   all         → todos los leads
 *   new         → status ∈ { whatsapp_opened, new(legacy) }
 *   in_progress → status ∈ { contacted, interested, in_progress(legacy), visit_scheduled }
 *   closed      → status ∈ { closed_won_rent, closed_won_sale, closed_won(legacy), closed_lost, discarded }
 *
 * Búsqueda:
 *   Si search no vacío → aplica sobre el resultado del filtro de tab (y sobre
 *   la sección de seguimiento, que también respeta el tab — ver más abajo).
 *   full_name null-safe: leads sin nombre no matchean cuando hay query.
 *
 * Sección "En seguimiento" (75.6, §19.9; alcance corregido en FIX4): fija
 * arriba de la lista, agrupa los leads con is_follow_up=true DENTRO del tab
 * de estado activo (antes ignoraba el tab — un lead "Contactado" en
 * seguimiento aparecía incluso viendo el tab "Cerrados"), capada a las
 * primeras FOLLOW_UP_SECTION_CAP tarjetas para no montar decenas de LeadCard
 * fuera de la virtualización del FlatList. Solo las tarjetas EFECTIVAMENTE
 * mostradas en la sección se excluyen de la lista principal de abajo — un
 * lead en seguimiento más allá del cap sigue apareciendo ahí, no desaparece.
 *
 * El mapeo de grupos es inline en esta pantalla (presentacional; sin utils/).
 *
 * Estadísticas de actividad (#112, decisión del dueño: fuera puntaje/temperatura):
 * useLeadStats se llama UNA sola vez aquí con TODOS los lead_ids visibles
 * (batch, evita N+1 — LeadCard/LeadExpandedView reciben `stats` ya resuelto
 * por prop, sin fetch propio). `lead_ids` va memoizado (useMemo sobre
 * `leads`, cuya referencia solo cambia con un fetch real) para no disparar
 * un refetch de estadísticas en cada render.
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
import { BookmarkSimple, MagnifyingGlass, Tray } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterTabs } from '@/components/FilterTabs';
import { useAuth } from '@/features/auth/context';
import { EmptyState } from '@/features/profile/components/EmptyState';
import { colors, fonts, floating_content_clearance, layout, radii, spacing, type_scale } from '@/theme/theme';
import { AgentSelector } from '../components/AgentSelector';
import { LeadCard } from '../components/LeadCard';
import { LeadExpandedView } from '../components/LeadExpandedView';
import { useAgencyAgents } from '../hooks/useAgencyAgents';
import { useAgencyRole } from '../hooks/useAgencyRole';
import { useAgentLeads } from '../hooks/useAgentLeads';
import { useLeadStats } from '../hooks/useLeadStats';
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
// #75.1: cada grupo incluye su equivalente legacy para que un lead viejo
// (aún sin re-clasificar) no caiga en el grupo equivocado.

/** Statuses que caen en el grupo "Nuevos". */
const NEW_STATUSES: LeadStatus[] = [
  'whatsapp_opened',
  'new', // legacy
];

/** Statuses que caen en el grupo "En progreso". */
const IN_PROGRESS_STATUSES: LeadStatus[] = [
  'contacted',
  'interested',
  'visit_scheduled',
  'in_progress', // legacy
];

/** Statuses que caen en el grupo "Cerrados". */
const CLOSED_STATUSES: LeadStatus[] = [
  'closed_won_rent',
  'closed_won_sale',
  'closed_lost',
  'discarded',
  'closed_won', // legacy
];

/** Aplica el filtro seleccionado sobre el array completo de leads. */
function apply_filter(leads: AgentLead[], filter: CrmFilter): AgentLead[] {
  if (filter === 'all')         return leads;
  if (filter === 'new')         return leads.filter((l) => NEW_STATUSES.includes(l.status));
  if (filter === 'in_progress') return leads.filter((l) => IN_PROGRESS_STATUSES.includes(l.status));
  // 'closed'
  return leads.filter((l) => CLOSED_STATUSES.includes(l.status));
}

/** FIX4 (code review) — tope de tarjetas en la sección fija "En seguimiento";
 * evita montar decenas de LeadCard de golpe fuera de la virtualización del
 * FlatList (ListHeaderComponent no virtualiza). */
const FOLLOW_UP_SECTION_CAP = 5;

// ─── Componente ───────────────────────────────────────────────────────────────

export function CRMScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  // FIX5 (code review): `error` distingue "no pude saber el rol" (RLS/red) de
  // "no hay membresía" — antes se ignoraba y ambos casos degradaban en
  // silencio a la vista de agente individual, escondiendo que RLS sigue
  // devolviendo los leads de TODO el equipo (mal etiquetados como propios).
  const {
    canViewTeam,
    agencyId,
    loading: role_loading,
    error: role_error,
    refetch: refetch_role,
  } = useAgencyRole();
  const { agents } = useAgencyAgents(agencyId, canViewTeam);
  const [selected_agent_id, set_selected_agent_id] = useState<string | null>(null);
  // #226: el alcance del agregado se pasa EXPLÍCITO — el hook ya no delega a
  // RLS (para un admin de plataforma, "RLS decide" significaba "todo").
  const { leads, loading, error, refetch } = useAgentLeads(selected_agent_id, 'score', {
    loading: role_loading,
    canViewTeam,
    agencyId,
  });
  const [filter, set_filter] = useState<CrmFilter>('all');
  const [search, set_search] = useState('');
  const [selected_lead, set_selected_lead] = useState<AgentLead | null>(null);

  // Estadísticas de actividad (#112) — batch ÚNICO para todos los leads
  // visibles, nunca uno por tarjeta. `leads` referencia estable entre
  // renders (solo cambia con un fetch real de useAgentLeads) → lead_ids
  // memoizado no dispara refetch de estadísticas en cada render.
  const lead_ids = useMemo(() => leads.map((l) => l.id), [leads]);
  const { statsByLeadId } = useLeadStats(lead_ids);

  const search_query = search.trim().toLowerCase();
  // ponytail: null-safe — leads sin full_name no matchean cuando hay query
  const matches_search = useCallback(
    (l: AgentLead) => (search_query ? (l.full_name?.toLowerCase().includes(search_query) ?? false) : true),
    [search_query],
  );

  // Sección fija "En seguimiento" (75.6, §19.9; FIX4): respeta el tab de
  // estado activo (antes lo ignoraba) y el buscador. `_all` es el conjunto
  // completo (para saber cuántos hay realmente); `follow_up_leads` es el
  // subconjunto EFECTIVAMENTE mostrado en la sección (capado).
  const follow_up_leads_all = useMemo(
    () => apply_filter(leads, filter).filter((l) => l.is_follow_up && matches_search(l)),
    [leads, filter, matches_search],
  );
  const follow_up_leads = useMemo(
    () => follow_up_leads_all.slice(0, FOLLOW_UP_SECTION_CAP),
    [follow_up_leads_all],
  );
  // IDs realmente renderizados en la sección fija — solo esos se excluyen de
  // la lista principal (FIX4: un lead en seguimiento más allá del cap sigue
  // visible ahí abajo en vez de desaparecer del tab por completo).
  const follow_up_ids_shown = useMemo(
    () => new Set(follow_up_leads.map((l) => l.id)),
    [follow_up_leads],
  );

  const filtered_leads = useMemo(() => {
    const by_tab = apply_filter(leads, filter).filter(matches_search);
    // Excluye los que ya se muestran arriba en la sección de seguimiento —
    // cada lead visible aparece en un solo lugar, sin duplicados.
    return by_tab.filter((l) => !follow_up_ids_shown.has(l.id));
  }, [leads, filter, matches_search, follow_up_ids_shown]);

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
            {canViewTeam ? 'Leads de tu equipo' : 'Tus leads de contacto'}
          </Text>
        </View>

        {/* FIX5 (code review): aviso + reintento cuando no se pudo verificar el
            rol de agencia — RLS puede seguir devolviendo leads del equipo
            aunque el selector/subtítulo hayan degradado a la vista de agente. */}
        {role_error && (
          <View style={styles.role_error_banner}>
            <Text style={styles.role_error_text}>
              No se pudo verificar tu rol en la agencia. Es posible que veas leads de tu
              equipo marcados como propios.
            </Text>
            <Pressable
              onPress={refetch_role}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Reintentar verificación de rol"
            >
              <Text style={styles.role_error_retry}>Reintentar</Text>
            </Pressable>
          </View>
        )}

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

        {/* Selector de agente (owner o admin con agentes en su agencia) */}
        {canViewTeam && agents.length > 0 && (
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
          contentContainerStyle={[
            styles.list_content,
            // #65.6: GlassTabBar (Android) flota (position:absolute) sobre esta
            // pantalla y ya no reserva alto — sin este despeje el último lead
            // queda tapado tras la barra al hacer scroll hasta el fondo.
            // #65.11: floating_content_clearance resuelve por plataforma — en
            // iOS (NativeTabs, barra nativa anclada) insets.bottom ya incluye
            // el alto de la barra, solo hace falta un margen chico.
            { paddingBottom: insets.bottom + floating_content_clearance },
          ]}
          data={filtered_leads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <LeadCard lead={item} onPress={handle_lead_press} stats={statsByLeadId[item.id]} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListHeaderComponent={
            // Sección fija "En seguimiento" (75.6, §19.9; FIX4) — respeta el
            // tab de estado activo, capada a FOLLOW_UP_SECTION_CAP tarjetas.
            follow_up_leads.length > 0 ? (
              <View style={styles.follow_up_section}>
                <View style={styles.follow_up_title_row}>
                  <BookmarkSimple size={14} weight="fill" color={colors.accent_deep} />
                  <Text style={styles.follow_up_title}>En seguimiento</Text>
                </View>
                {follow_up_leads.map((lead) => (
                  <View key={lead.id} style={styles.follow_up_item}>
                    <LeadCard lead={lead} onPress={handle_lead_press} stats={statsByLeadId[lead.id]} />
                  </View>
                ))}
                {follow_up_leads_all.length > FOLLOW_UP_SECTION_CAP && (
                  <Text style={styles.follow_up_more}>
                    +{follow_up_leads_all.length - FOLLOW_UP_SECTION_CAP} más en la lista de abajo
                  </Text>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            // ponytail: tres casos — agente sin leads / sin resultados con nada
            // arriba / sin resultados pero ya hay leads en la sección de seguimiento
            leads.length === 0
              ? <EmptyState
                  message="Aún no tienes leads"
                  subtitle="Los leads aparecen cuando un usuario contacta sobre una propiedad."
                  icon={Tray}
                />
              : follow_up_leads.length > 0
                ? null // ya se muestran arriba en la sección fija — no hay "sin resultados" que reportar
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
          // FIX1 (code review): el toggle "en seguimiento" refresca la lista
          // SIN cerrar el sheet (a diferencia de onSuccess) — refetch de
          // useAgentLeads ya es estable (useCallback), se pasa directo.
          onFollowUpChange={refetch}
          // Solo lectura si el lead pertenece a OTRO agente (owner viendo el
          // pipeline del equipo). La EF solo autoriza al agente dueño a editar;
          // sin este gate el cambio de estado devolvería UNAUTHORIZED_AGENT.
          readOnly={selected_lead.agent_id !== user?.id}
          stats={statsByLeadId[selected_lead.id]}
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

  // ── Aviso de rol no verificado (FIX5) ────────────────────────────────────────
  role_error_banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    backgroundColor: colors.paper_2,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    borderRadius: radii.r_8,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_12,
    marginTop: spacing.s_12,
  },
  role_error_text: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 16,
  },
  role_error_retry: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: colors.primary,
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
    // paddingBottom real se aplica inline (insets.bottom + floating_content_clearance, #65.6/#65.11)
    flexGrow: 1,
  },
  separator: {
    height: spacing.s_8,
  },

  // ── Sección fija "En seguimiento" (75.6) ────────────────────────────────────
  follow_up_section: {
    marginBottom: spacing.s_16,
  },
  follow_up_title_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.s_8,
  },
  follow_up_title: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.accent_deep,
  },
  follow_up_item: {
    marginBottom: spacing.s_8,
  },
  follow_up_more: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gray_2,
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
