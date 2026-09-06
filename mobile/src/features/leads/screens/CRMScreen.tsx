/**
 * CRMScreen — rediseño del CRM/pipeline de leads del agente (subtarea 267.7).
 *
 * Reescritura completa sobre los hooks del rediseño de datos (#266) y los
 * componentes de 267.5/267.6. Sustituye la versión FilterTabs+FlatList de
 * LeadCard client-side-filtered (15.7/75.6/75.5) — ver historial en git para
 * ese código; NO se repite aquí.
 *
 * Preview aprobado: mobile/design-previews/267-crm-santiago.html (sección 1 =
 * layout completo: header CRM/subtítulo + ☰ · segmentado Míos/Equipo ·
 * narrativa · embudo · 4 bandas por tendencia con "Ver los N restantes" · 4ª
 * banda "En silencio" colapsada por default (decisión de Abraham 2026-09-06).
 *
 * Estructura: UN solo FlatList (ListHeaderComponent = cabecera + segmentado +
 * NarrativeHeader + FunnelCard; `data` = filas aplanadas de las 4 bandas en
 * BAND_ORDER — header de banda, lead, ficha inline expandida, filas del radar
 * anónimo dentro de Calentando, botón "Ver los N restantes"). Aplanar en un
 * solo array (en vez de SectionList) hace trivial la regla "un solo lead
 * expandido a la vez" y el onEndReached de "la primera banda con hasMore".
 *
 * Búsqueda (D7, obligatorio): SIEMPRE server-side — `query` viaja como
 * `p_query` a los 4 `useCrmLeadsPage`, JAMÁS un filtro adicional en cliente.
 * La hoja ☰ (CrmSearchSheet) es mínima; el sheet completo de filtros es #271.
 *
 * Agente efectivo: `agent_id = selected_agent_id ?? user.id` — "Míos" fuerza
 * selected_agent_id=null (vuelve a "yo"); "Equipo" deja que AgentSelector lo
 * fije a un compañero puntual (chip "Todos" también fija null → mismo "yo",
 * conserva el patrón ya usado por AgentSelector/useAgencyRole, #28).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { List, MagnifyingGlass, Tray, X } from 'phosphor-react-native';
import { router } from 'expo-router';
// #241.3/#231: SafeAreaView de safe-area-context, NUNCA la de react-native.
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { UrbeaLoader } from '@/components/UrbeaLoader';
import { RefreshingChip } from '@/components/RefreshingChip';
import { useAuth } from '@/features/auth/context';
import { EmptyState } from '@/features/profile/components/EmptyState';
import { colors, fonts, floating_content_clearance, layout, radii, spacing, type_scale } from '@/theme/theme';

import { AgentSelector } from '../components/AgentSelector';
import { BandHeader } from '../components/BandHeader';
import { CrmLeadRow } from '../components/CrmLeadRow';
import { CrmSearchSheet } from '../components/CrmSearchSheet';
import { FunnelCard } from '../components/FunnelCard';
import { LeadInlineDetail } from '../components/LeadInlineDetail';
import { NarrativeHeader } from '../components/NarrativeHeader';
import { RadarAnonRow } from '../components/RadarAnonRow';
import { useAgencyAgents } from '../hooks/useAgencyAgents';
import { useAgencyRole } from '../hooks/useAgencyRole';
import { useCrmFunnel } from '../hooks/useCrmFunnel';
import { useCrmLeadsPage, type UseCrmLeadsPageState } from '../hooks/useCrmLeadsPage';
import { useCrmRadarAnon } from '../hooks/useCrmRadarAnon';
import { BAND_META, BAND_ORDER } from '../utils/crm_band_meta';
import type { CrmBand, CrmLeadRow as CrmLeadRowData, CrmRadarRow as CrmRadarRowData } from '../types';

// ─── Filas aplanadas del FlatList ───────────────────────────────────────────

type ListRow =
  | { key: string; kind: 'band_header'; band: CrmBand }
  | { key: string; kind: 'lead'; row: CrmLeadRowData }
  | { key: string; kind: 'detail'; row: CrmLeadRowData }
  | { key: string; kind: 'radar'; row: CrmRadarRowData }
  | { key: string; kind: 'load_more'; band: CrmBand; remaining: number };

/** Ruta de "publicar" ya existente en la app (tab central [+], app/(protected)/publish). */
const PUBLISH_ROUTE = '/publish/step1' as const;

/** Primer token de un nombre completo — null si full_name es null (ver nota junto a top_cooling). */
function first_token(full_name: string | null): string | null {
  if (!full_name) return null;
  return full_name.trim().split(/\s+/)[0] ?? null;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function CRMScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // FIX5 (heredado de la versión anterior): `error` distingue "no pude saber
  // el rol" (RLS/red) de "no hay membresía" — se sigue avisando con reintento.
  const {
    canViewTeam,
    agencyId,
    error: role_error,
    refetch: refetch_role,
  } = useAgencyRole();
  const { agents } = useAgencyAgents(agencyId, canViewTeam);

  const [team_tab, set_team_tab] = useState<'mios' | 'equipo'>('mios');
  const [selected_agent_id, set_selected_agent_id] = useState<string | null>(null);
  const agent_id = selected_agent_id ?? user?.id ?? null;
  const is_read_only = agent_id !== (user?.id ?? null);

  const [query, set_query] = useState<string | null>(null);
  const [sheet_open, set_sheet_open] = useState(false);
  const [expanded_lead_id, set_expanded_lead_id] = useState<string | null>(null);
  const [silent_collapsed, set_silent_collapsed] = useState(BAND_META.silent.collapsed_by_default);
  // Sube a true en cuanto el primer pase de datos resuelve — evita que un
  // refetch (pull-to-refresh, refetch tras cambio de estado) vuelva a tapar
  // la pantalla entera con el loader inicial (RefreshingChip ya cubre eso).
  const [has_loaded_once, set_has_loaded_once] = useState(false);

  const funnel = useCrmFunnel(agent_id, 30);
  const hot = useCrmLeadsPage(agent_id, 'hot', query);
  const cooling = useCrmLeadsPage(agent_id, 'cooling', query);
  const warming = useCrmLeadsPage(agent_id, 'warming', query);
  const silent = useCrmLeadsPage(agent_id, 'silent', query);
  const radar = useCrmRadarAnon(agent_id, 5);

  const band_states: Record<CrmBand, UseCrmLeadsPageState> = useMemo(
    () => ({ hot, cooling, warming, silent }),
    [hot, cooling, warming, silent],
  );

  // Ajuste de estado durante el render (patrón React oficial "adjusting state
  // when props/state change") — no es un efecto: se resuelve ANTES del commit,
  // sin flash, y la guarda `!has_loaded_once` evita el loop (una vez true,
  // esta rama nunca vuelve a ejecutar set_has_loaded_once).
  const first_pass_done =
    !funnel.loading && !hot.loading && !cooling.loading && !warming.loading && !silent.loading;
  if (!has_loaded_once && first_pass_done) {
    set_has_loaded_once(true);
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handle_select_tab(tab: 'mios' | 'equipo'): void {
    set_team_tab(tab);
    if (tab === 'mios') set_selected_agent_id(null);
  }

  const handle_lead_changed = useCallback((): void => {
    void funnel.refetch();
    void hot.refetch();
    void cooling.refetch();
    void warming.refetch();
    void silent.refetch();
  }, [funnel, hot, cooling, warming, silent]);

  const handle_refresh = useCallback((): void => {
    void funnel.refetch();
    void hot.refetch();
    void cooling.refetch();
    void warming.refetch();
    void silent.refetch();
    void radar.refetch();
  }, [funnel, hot, cooling, warming, silent, radar]);

  const handle_row_press = useCallback((lead_id: string): void => {
    set_expanded_lead_id((current) => (current === lead_id ? null : lead_id));
  }, []);

  const handle_toggle_silent = useCallback((): void => {
    set_silent_collapsed((c) => !c);
  }, []);

  const handle_end_reached = useCallback((): void => {
    const band = BAND_ORDER.find((b) => band_states[b].hasMore);
    if (band) void band_states[band].loadMore();
  }, [band_states]);

  // ── Narrativa (counts = tamaño TOTAL conocido por banda: cargado + remaining) ──

  const counts: Record<CrmBand, number> = {
    hot: hot.data.length + (hot.remaining ?? 0),
    cooling: cooling.data.length + (cooling.remaining ?? 0),
    warming: warming.data.length + (warming.remaining ?? 0),
    silent: silent.data.length + (silent.remaining ?? 0),
  };

  const top_cooling = useMemo(() => {
    if (cooling.data.length === 0) return null;
    const coldest = cooling.data.reduce((min, r) => (r.delta < min.delta ? r : min));
    const name = first_token(coldest.full_name);
    // ponytail: sin nombre no hay narrativa segura que citar (no inventar
    // "Usuario" en la frase) — se omite el highlight, el subline cae al genérico.
    return name ? { first_name: name, delta: coldest.delta } : null;
  }, [cooling.data]);

  // ── Filas aplanadas ──────────────────────────────────────────────────────────

  const rows: ListRow[] = useMemo(() => {
    const out: ListRow[] = [];
    for (const band of BAND_ORDER) {
      const state = band_states[band];
      if (state.data.length === 0) continue; // banda vacía no se pinta
      out.push({ key: `header-${band}`, kind: 'band_header', band });

      if (band === 'silent' && silent_collapsed) continue; // filas ocultas, cabecera visible

      for (const row of state.data) {
        out.push({ key: `lead-${row.lead_id}`, kind: 'lead', row });
        if (expanded_lead_id === row.lead_id) {
          out.push({ key: `detail-${row.lead_id}`, kind: 'detail', row });
        }
      }

      if (band === 'warming') {
        for (const r of radar.data) {
          out.push({ key: `radar-${r.row_n}`, kind: 'radar', row: r });
        }
      }

      if ((state.remaining ?? 0) > 0) {
        out.push({ key: `more-${band}`, kind: 'load_more', band, remaining: state.remaining as number });
      }
    }
    return out;
  }, [band_states, silent_collapsed, expanded_lead_id, radar]);

  // ── Estados vacíos ───────────────────────────────────────────────────────────
  // El preview (sección 3) dibuja el bloque "0 leads" EN VEZ DE la narrativa,
  // no junto a ella — mostrar ambos duplicaría literalmente "Aún no hay señal
  // que leer" (narrativa Y título del EmptyState dicen lo mismo). Búsqueda sin
  // resultados: mismo criterio (la narrativa habla de los totales SIN
  // filtrar, contradice un "no encontramos a nadie" justo debajo).

  const all_bands_empty =
    hot.data.length === 0 && cooling.data.length === 0 && warming.data.length === 0 && silent.data.length === 0;

  const empty_state_kind: 'search' | 'no_signal' | null = !all_bands_empty
    ? null
    : query !== null
      ? 'search'
      : funnel.data?.vieron === 0
        ? 'no_signal'
        : null;

  // ── Render item ──────────────────────────────────────────────────────────────

  const render_item = useCallback(
    ({ item }: { item: ListRow }): React.ReactElement | null => {
      switch (item.kind) {
        case 'band_header': {
          const state = band_states[item.band];
          const count = state.data.length + (state.remaining ?? 0);
          return item.band === 'silent' ? (
            <BandHeader band={item.band} count={count} collapsed={silent_collapsed} onToggle={handle_toggle_silent} />
          ) : (
            <BandHeader band={item.band} count={count} />
          );
        }
        case 'lead':
          return (
            <CrmLeadRow
              row={item.row}
              onPress={() => handle_row_press(item.row.lead_id)}
              expanded={expanded_lead_id === item.row.lead_id}
            />
          );
        case 'detail':
          return <LeadInlineDetail lead={item.row} readOnly={is_read_only} onChanged={handle_lead_changed} />;
        case 'radar':
          return <RadarAnonRow row={item.row} />;
        case 'load_more':
          return (
            <Pressable
              onPress={() => void band_states[item.band].loadMore()}
              accessibilityRole="button"
              accessibilityLabel={`Ver los ${item.remaining} restantes`}
              style={styles.load_more}
            >
              <Text style={styles.load_more_text}>Ver los {item.remaining} restantes</Text>
            </Pressable>
          );
        default:
          return null;
      }
    },
    [band_states, expanded_lead_id, silent_collapsed, is_read_only, handle_row_press, handle_toggle_silent, handle_lead_changed],
  );

  // ── Cabecera de la lista ─────────────────────────────────────────────────────

  const list_header = (
    <>
      <View style={styles.header}>
        <View style={styles.header_top}>
          <View>
            <Text style={styles.title}>CRM</Text>
            <Text style={styles.subtitle}>{canViewTeam ? 'Leads de tu equipo' : 'Tus leads de contacto'}</Text>
          </View>
          <Pressable
            onPress={() => set_sheet_open(true)}
            accessibilityRole="button"
            accessibilityLabel="Buscar por nombre"
            hitSlop={8}
            style={styles.menu_btn}
          >
            <List size={20} color={colors.ink} weight="bold" />
          </Pressable>
        </View>

        {query !== null && (
          <Pressable
            onPress={() => set_query(null)}
            accessibilityRole="button"
            accessibilityLabel={`Quitar búsqueda: ${query}`}
            style={styles.query_chip}
          >
            <Text style={styles.query_chip_text}>{query}</Text>
            <X size={11} color={colors.primary_deep} weight="bold" />
          </Pressable>
        )}
      </View>

      {role_error && (
        <View style={styles.role_error_banner}>
          <Text style={styles.role_error_text}>
            No se pudo verificar tu rol en la agencia. Es posible que veas leads de tu equipo marcados
            como propios.
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

      {canViewTeam && (
        <View style={styles.segmented}>
          <Pressable
            onPress={() => handle_select_tab('mios')}
            accessibilityRole="button"
            accessibilityState={{ selected: team_tab === 'mios' }}
            style={[styles.seg, team_tab === 'mios' && styles.seg_active]}
          >
            <Text style={[styles.seg_text, team_tab === 'mios' && styles.seg_text_active]}>Míos</Text>
          </Pressable>
          <Pressable
            onPress={() => handle_select_tab('equipo')}
            accessibilityRole="button"
            accessibilityState={{ selected: team_tab === 'equipo' }}
            style={[styles.seg, team_tab === 'equipo' && styles.seg_active]}
          >
            <Text style={[styles.seg_text, team_tab === 'equipo' && styles.seg_text_active]}>Equipo</Text>
          </Pressable>
        </View>
      )}

      {canViewTeam && team_tab === 'equipo' && agents.length > 0 && (
        <View style={styles.agent_selector_wrap}>
          <AgentSelector agents={agents} selectedAgentId={selected_agent_id} onSelectAgent={set_selected_agent_id} />
        </View>
      )}

      <RefreshingChip visible={has_loaded_once && (funnel.loading || hot.loading || cooling.loading || warming.loading || silent.loading)} />

      {empty_state_kind === null && <NarrativeHeader counts={counts} top_cooling={top_cooling} />}

      {empty_state_kind === null && funnel.data !== null && (
        <View style={styles.funnel_wrap}>
          <FunnelCard funnel={funnel.data} />
        </View>
      )}
    </>
  );

  // ── Estado de carga inicial ──────────────────────────────────────────────────

  if (!has_loaded_once) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <UrbeaLoader size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Estado vacío ─────────────────────────────────────────────────────────────

  // ponytail: bandas vacías sin query y funnel.vieron>0 (empty_state_kind===null
  // con all_bands_empty true) — combinación no cubierta por el copy aprobado
  // (frame 4); la lista simplemente queda vacía sin mensaje propio, en vez de
  // inventar un 3er estado vacío que el producto no ha definido.
  const empty_component =
    empty_state_kind === 'search' ? (
      <EmptyState
        message="No encontramos a nadie con ese nombre"
        subtitle="Ajusta la búsqueda e inténtalo de nuevo."
        icon={MagnifyingGlass}
      />
    ) : empty_state_kind === 'no_signal' ? (
      <EmptyState
        message="Aún no hay señal que leer"
        subtitle="El radar se enciende cuando alguien ve, guarda o repite tus propiedades. Sube tu primer recorrido y en horas empiezas a ver quién está mirando."
        icon={Tray}
        cta_label="Subir una propiedad"
        onPressCta={() => router.push(PUBLISH_ROUTE)}
      />
    ) : null;

  // ── Render principal ─────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <FlatList<ListRow>
          style={styles.list}
          contentContainerStyle={[styles.list_content, { paddingBottom: insets.bottom + floating_content_clearance }]}
          data={rows}
          keyExtractor={(item) => item.key}
          renderItem={render_item}
          onEndReached={handle_end_reached}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={list_header}
          ListEmptyComponent={empty_component}
          // #241.3: bounces vive en la LISTA (ScrollViewProps), no en
          // RefreshControl — bounces=false mata el pull-to-refresh en iOS;
          // Android lo ignora.
          bounces={Platform.OS === 'ios'}
          refreshControl={
            <RefreshControl
              refreshing={has_loaded_once && (funnel.loading || hot.loading || cooling.loading || warming.loading || silent.loading)}
              onRefresh={handle_refresh}
              tintColor="transparent"
              colors={['transparent']}
              progressBackgroundColor="transparent"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      </View>

      <CrmSearchSheet
        visible={sheet_open}
        initialQuery={query}
        onClose={() => set_sheet_open(false)}
        onSubmit={set_query}
      />
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

  header: {
    paddingTop: spacing.s_24,
    paddingBottom: spacing.s_12,
  },
  header_top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
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
  menu_btn: {
    padding: spacing.s_8,
  },
  query_chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: spacing.s_12,
    paddingVertical: spacing.s_4,
    paddingHorizontal: spacing.s_12,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary_tint,
  },
  query_chip_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: colors.primary_deep,
  },

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
    marginBottom: spacing.s_12,
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

  segmented: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radii.r_12,
    backgroundColor: colors.paper_2,
    marginBottom: spacing.s_8,
  },
  seg: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.r_8,
  },
  seg_active: {
    backgroundColor: colors.primary_tint,
  },
  seg_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.gray_2,
  },
  seg_text_active: {
    color: colors.primary_deep,
  },

  agent_selector_wrap: {
    marginBottom: spacing.s_8,
  },

  funnel_wrap: {
    marginTop: spacing.s_4,
    marginBottom: spacing.s_16,
  },

  list: {
    flex: 1,
  },
  list_content: {
    flexGrow: 1,
  },

  load_more: {
    paddingVertical: spacing.s_12,
    alignItems: 'center',
  },
  load_more_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.primary,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s_24,
  },
});
