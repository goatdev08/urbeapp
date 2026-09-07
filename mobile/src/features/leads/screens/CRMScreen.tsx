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
 * Búsqueda + filtros (D7, obligatorio): SIEMPRE server-side — `query`,
 * `status` y `followUp` viajan como `p_query`/`p_status`/`p_follow_up` a los
 * 4 `useCrmLeadsPage`, JAMÁS un filtro adicional en cliente. La hoja ☰
 * (CrmFilterSheet, #271.3) cubre los 3: búsqueda por nombre, estado
 * (multi-select de los 4 proyectados) y "En seguimiento". El indicador de
 * filtros activos (chips bajo el header, "×" para quitar cada uno) evita el
 * bug de #115 (lista corta sin explicación visible de por qué).
 *
 * Agente efectivo: `agent_id = selected_agent_id ?? user.id` — "Míos" fuerza
 * selected_agent_id=null (vuelve a "yo"); dentro de "Equipo",
 * selected_agent_id fija el drill-down a un agente puntual (ver abajo).
 *
 * ── Segmento "Equipo" — vista de agencia (subtarea 269.6, preview aprobado
 * mobile/design-previews/269-crm-equipo.html) ──────────────────────────────
 * "Equipo" YA NO reusa el mismo FlatList de bandas con un AgentSelector de
 * chips arriba (269.5 y anteriores) — decisión de Abraham 2026-09-07: ahora
 * tiene 2 sub-estados, ambos gobernados por `selected_agent_id`:
 *   - `selected_agent_id === null` → overview de agencia (useCrmAgencyOverview):
 *     narrativa de agencia, banda "Sin gestor" (UnmanagedLeadRow + ASIGNAR →
 *     AssignLeadSheet → useReassignLead) y banda "Tus agentes" (AgencyAgentRow
 *     con badge; tap = drill-down).
 *   - `selected_agent_id !== null` (tap en una fila de "Tus agentes") → la
 *     MISMA lista de bandas por tendencia de siempre, agente=selected_agent_id,
 *     con cabecera "← Equipo" en vez del header/segmentado normal.
 * `is_read_only` (#31 UI): ya NO es `agent_id !== user.id` — un owner/admin
 * ACTIVO edita la ficha de CUALQUIER agente de su agencia; solo un lector sin
 * ese rol (viewer/agente raso viendo algo que no es suyo) sigue en solo-lectura.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CaretLeft, Flame, List, MagnifyingGlass, Tray, Users, X } from 'phosphor-react-native';
import { router } from 'expo-router';
// #241.3/#231: SafeAreaView de safe-area-context, NUNCA la de react-native.
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { UrbeaLoader } from '@/components/UrbeaLoader';
import { RefreshingChip } from '@/components/RefreshingChip';
import { useAuth } from '@/features/auth/context';
import { EmptyState } from '@/features/profile/components/EmptyState';
import { colors, fonts, floating_content_clearance, layout, radii, spacing, type_scale } from '@/theme/theme';

import { AgencyAgentRow } from '../components/AgencyAgentRow';
import { AssignLeadSheet } from '../components/AssignLeadSheet';
import { BandHeader } from '../components/BandHeader';
import { CrmLeadRow } from '../components/CrmLeadRow';
import { CrmFilterSheet, PROJECTED_STATUS_OPTIONS, type CrmFilters } from '../components/CrmFilterSheet';
import { FunnelCard } from '../components/FunnelCard';
import { LeadInlineDetail } from '../components/LeadInlineDetail';
import { NarrativeHeader } from '../components/NarrativeHeader';
import { RadarAnonRow } from '../components/RadarAnonRow';
import { UnmanagedLeadRow } from '../components/UnmanagedLeadRow';
import { useAgencyAgents } from '../hooks/useAgencyAgents';
import { useAgencyRole } from '../hooks/useAgencyRole';
import { useCrmAgencyOverview } from '../hooks/useCrmAgencyOverview';
import { useCrmFunnel } from '../hooks/useCrmFunnel';
import { useCrmLeadsPage, type UseCrmLeadsPageState } from '../hooks/useCrmLeadsPage';
import { useCrmRadarAnon } from '../hooks/useCrmRadarAnon';
import { useReassignLead } from '../hooks/useReassignLead';
import { BAND_META, BAND_ORDER } from '../utils/crm_band_meta';
import type {
  CrmBand,
  CrmLeadRow as CrmLeadRowData,
  CrmRadarRow as CrmRadarRowData,
  ProjectedStatus,
  UnmanagedLeadRow as UnmanagedLeadRowData,
} from '../types';

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

/**
 * Narrativa de cabecera del overview de agencia (269.6, sección 1 del
 * preview). 🪶 ponytail (disparador c, CLAUDE.md §0 — techo con los datos
 * reales): el preview sugiere "N leads calientes llevan horas sin que los
 * toquen" pero `crm_agency_overview` (269.1) NO expone conteos hot/cooling
 * agregados de agencia — esa RPC solo trae untouched_count/response_hours/
 * avg_temperature/flag por agente y el bloque "unmanaged". La narrativa aquí
 * se construye SOLO con esos 2 datos reales: cuántos leads no tienen gestor
 * y, si alguno tiene flag='pierde_leads', quién es el peor caso (mismo
 * agente que `crm_agency_overview` ya marca, sin llamada extra). Techo:
 * agregar hot/cooling por agencia a la RPC (derivada hardening(269.1)) lo
 * habilita sin tocar esta función.
 */
function build_agency_narrative(
  unmanaged_count: number,
  worst_agent: { name: string; untouched_count: number } | null,
): { headline: string; highlight: string | null; subline: string | null; subline_highlight: string | null } {
  if (unmanaged_count === 0) {
    return {
      headline: 'Todo tiene gestor.',
      highlight: null,
      subline: 'No hay leads sin asignar en este momento.',
      subline_highlight: null,
    };
  }
  const headline = `${unmanaged_count} ${unmanaged_count === 1 ? 'lead no tiene' : 'leads no tienen'} gestor.`;
  const highlight = `${unmanaged_count}`;
  if (!worst_agent) {
    return { headline, highlight, subline: null, subline_highlight: null };
  }
  return {
    headline,
    highlight,
    subline: `Y ${worst_agent.name} es quien más leads sin tocar tiene: ${worst_agent.untouched_count}.`,
    subline_highlight: worst_agent.name,
  };
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function CRMScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // FIX5 (heredado de la versión anterior): `error` distingue "no pude saber
  // el rol" (RLS/red) de "no hay membresía" — se sigue avisando con reintento.
  const {
    isOwner,
    isAdmin,
    canViewTeam,
    agencyId,
    error: role_error,
    refetch: refetch_role,
  } = useAgencyRole();
  const { agents } = useAgencyAgents(agencyId, canViewTeam);

  const [team_tab, set_team_tab] = useState<'mios' | 'equipo'>('mios');
  const [selected_agent_id, set_selected_agent_id] = useState<string | null>(null);
  const agent_id = selected_agent_id ?? user?.id ?? null;
  // #31 UI (269.6): owner/admin ACTIVO edita la ficha de CUALQUIER agente de
  // su agencia (ya no solo la propia) — viewer/agente raso siguen readOnly.
  const is_read_only = !(agent_id === (user?.id ?? null) || isOwner || isAdmin);

  const [query, set_query] = useState<string | null>(null);
  const [status_filter, set_status_filter] = useState<ProjectedStatus[] | null>(null);
  const [follow_up_filter, set_follow_up_filter] = useState<boolean | null>(null);
  const [sheet_open, set_sheet_open] = useState(false);
  const [expanded_lead_id, set_expanded_lead_id] = useState<string | null>(null);
  const [silent_collapsed, set_silent_collapsed] = useState(BAND_META.silent.collapsed_by_default);
  // Lead con la hoja ASIGNAR abierta (banda "Sin gestor" del overview de
  // agencia, 269.6) — null = hoja cerrada.
  const [assign_target, set_assign_target] = useState<UnmanagedLeadRowData | null>(null);
  // Sube a true en cuanto el primer pase de datos resuelve — evita que un
  // refetch (pull-to-refresh, refetch tras cambio de estado) vuelva a tapar
  // la pantalla entera con el loader inicial (RefreshingChip ya cubre eso).
  const [has_loaded_once, set_has_loaded_once] = useState(false);

  const funnel = useCrmFunnel(agent_id, 30);
  const hot = useCrmLeadsPage(agent_id, 'hot', query, status_filter, follow_up_filter);
  const cooling = useCrmLeadsPage(agent_id, 'cooling', query, status_filter, follow_up_filter);
  const warming = useCrmLeadsPage(agent_id, 'warming', query, status_filter, follow_up_filter);
  const silent = useCrmLeadsPage(agent_id, 'silent', query, status_filter, follow_up_filter);
  const radar = useCrmRadarAnon(agent_id, 5);

  // Overview de agencia (segmento Equipo, sub-estado selected_agent_id===null,
  // 269.5/269.6) — corre siempre que hay agencia (igual que funnel/hot/etc.
  // corren siempre independientemente del tab activo, patrón ya existente).
  const agency_overview = useCrmAgencyOverview(agencyId);
  // Sin `on_changed` en las opciones: el refetch lo dispara directo
  // `onAssigned` de AssignLeadSheet (abajo) — más corto y observable sin
  // depender de la clausura interna del hook.
  const reassign_lead = useReassignLead();

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
    // Cualquier cambio de tab vuelve al overview de agencia (269.6) — un
    // drill-down solo se alcanza tocando una fila de "Tus agentes".
    set_selected_agent_id(null);
  }

  /** Tap en una fila de "Tus agentes" — drill-down a los leads de ese agente. */
  const handle_drilldown = useCallback((agent_id_to_view: string): void => {
    set_selected_agent_id(agent_id_to_view);
  }, []);

  /** Cabecera "← Equipo" del drill-down — vuelve al overview de agencia. */
  const handle_back_to_equipo = useCallback((): void => {
    set_selected_agent_id(null);
  }, []);

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

  // Indicador de filtros activos (chips bajo el header, cada uno con su
  // propio "×" para quitar SOLO ese filtro) — extiende el patrón que ya
  // tenía `query_chip` a status/followUp; sin esto el agente ve su lista
  // corta y no sabe por qué (bug de #115 en la hoja de búsqueda vieja).
  const active_filter_chips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (query !== null) {
      chips.push({ key: 'query', label: query, onRemove: () => set_query(null) });
    }
    if (status_filter !== null && status_filter.length > 0) {
      const label = status_filter
        .map((s) => PROJECTED_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s)
        .join(', ');
      chips.push({ key: 'status', label, onRemove: () => set_status_filter(null) });
    }
    if (follow_up_filter === true) {
      chips.push({ key: 'follow_up', label: 'En seguimiento', onRemove: () => set_follow_up_filter(null) });
    }
    return chips;
  }, [query, status_filter, follow_up_filter]);

  const handle_apply_filters = useCallback((filters: CrmFilters): void => {
    set_query(filters.query);
    set_status_filter(filters.status);
    set_follow_up_filter(filters.followUp);
  }, []);

  const top_cooling = useMemo(() => {
    if (cooling.data.length === 0) return null;
    const coldest = cooling.data.reduce((min, r) => (r.delta < min.delta ? r : min));
    const name = first_token(coldest.full_name);
    // ponytail: sin nombre no hay narrativa segura que citar (no inventar
    // "Usuario" en la frase) — se omite el highlight, el subline cae al genérico.
    return name ? { first_name: name, delta: coldest.delta } : null;
  }, [cooling.data]);

  // ── Narrativa de agencia (segmento Equipo, overview) — ver build_agency_narrative ──

  const worst_agent = useMemo(() => {
    const losers = agency_overview.agents.filter((a) => a.flag === 'pierde_leads');
    if (losers.length === 0) return null;
    const worst = losers.reduce((max, a) => (a.untouched_count > max.untouched_count ? a : max));
    // ponytail: mismo criterio que top_cooling — sin nombre no hay narrativa segura que citar.
    return worst.agent_name ? { name: worst.agent_name, untouched_count: worst.untouched_count } : null;
  }, [agency_overview.agents]);

  const agency_narrative = useMemo(
    () => build_agency_narrative(agency_overview.unmanaged.length, worst_agent),
    [agency_overview.unmanaged.length, worst_agent],
  );

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
  // Equipo con drill-down (selected_agent_id!==null): cabecera "← Equipo" en
  // vez del header normal + segmentado (sección 5 del preview 269.6).
  const in_drilldown = team_tab === 'equipo' && selected_agent_id !== null;
  const drilldown_agent = in_drilldown
    ? (agency_overview.agents.find((a) => a.agent_id === selected_agent_id) ?? null)
    : null;

  const list_header = (
    <>
      {in_drilldown ? (
        <View style={styles.back_header_wrap}>
          <Pressable
            onPress={handle_back_to_equipo}
            accessibilityRole="button"
            accessibilityLabel="Volver a Equipo"
            hitSlop={8}
            style={styles.back_btn}
          >
            <CaretLeft size={16} color={colors.ink} weight="bold" />
          </Pressable>
          <Text style={styles.back_title}>← Equipo</Text>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.header_top}>
            <View>
              <Text style={styles.title}>CRM</Text>
              <Text style={styles.subtitle}>{canViewTeam ? 'Leads de tu equipo' : 'Tus leads de contacto'}</Text>
            </View>
            <Pressable
              onPress={() => set_sheet_open(true)}
              accessibilityRole="button"
              accessibilityLabel="Filtros"
              hitSlop={8}
              style={styles.menu_btn}
            >
              <List size={20} color={colors.ink} weight="bold" />
            </Pressable>
          </View>

          {active_filter_chips.length > 0 && (
            <View style={styles.active_filters_row}>
              {active_filter_chips.map((chip) => (
                <Pressable
                  key={chip.key}
                  onPress={chip.onRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Quitar filtro: ${chip.label}`}
                  style={styles.query_chip}
                >
                  <Text style={styles.query_chip_text}>{chip.label}</Text>
                  <X size={11} color={colors.primary_deep} weight="bold" />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {in_drilldown && (
        <View style={styles.back_agent_block}>
          <Text style={styles.back_agent_name}>{drilldown_agent?.agent_name ?? 'Agente'}</Text>
          {drilldown_agent && (
            <Text style={styles.back_agent_sub}>
              {drilldown_agent.untouched_count} sin tocar · {drilldown_agent.avg_temperature ?? '—'}° promedio
            </Text>
          )}
        </View>
      )}

      {!in_drilldown && role_error && (
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

      {!in_drilldown && canViewTeam && (
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

      <RefreshingChip visible={has_loaded_once && (funnel.loading || hot.loading || cooling.loading || warming.loading || silent.loading)} />

      {empty_state_kind === null && <NarrativeHeader counts={counts} top_cooling={top_cooling} />}

      {empty_state_kind === null && funnel.data !== null && (
        <View style={styles.funnel_wrap}>
          <FunnelCard funnel={funnel.data} />
        </View>
      )}
    </>
  );

  // ── Overview de agencia (segmento Equipo, sin drill-down, 269.5/269.6) ────────
  // Sub-estado independiente del FlatList de bandas de abajo — otro shape de
  // datos (AgencyAgentRow/UnmanagedLeadRow, no CrmLeadRow), otro hook
  // (useCrmAgencyOverview, no useCrmLeadsPage) y volumen chico (agentes por
  // agencia) — ponytail: ScrollView simple, sin la maquinaria de aplanado de
  // filas del FlatList de abajo (esa SÍ la necesita virtualizar cientos de
  // leads; una banda de agentes no).
  if (team_tab === 'equipo' && selected_agent_id === null) {
    const overview_first_pass =
      agency_overview.loading && agency_overview.agents.length === 0 && agency_overview.unmanaged.length === 0;

    if (overview_first_pass) {
      return (
        <SafeAreaView style={styles.safe}>
          <View style={styles.center}>
            <UrbeaLoader size="large" color={colors.primary} />
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <ScrollView
            contentContainerStyle={[styles.list_content, { paddingBottom: insets.bottom + floating_content_clearance }]}
            refreshControl={
              <RefreshControl
                refreshing={agency_overview.loading}
                onRefresh={() => void agency_overview.refetch()}
                tintColor="transparent"
                colors={['transparent']}
                progressBackgroundColor="transparent"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <View style={styles.header_top}>
                <View>
                  <Text style={styles.title}>Equipo</Text>
                  <Text style={styles.subtitle}>Vista de agencia</Text>
                </View>
              </View>
            </View>

            <View style={styles.segmented}>
              <Pressable
                onPress={() => handle_select_tab('mios')}
                accessibilityRole="button"
                accessibilityState={{ selected: false }}
                style={styles.seg}
              >
                <Text style={styles.seg_text}>Míos</Text>
              </Pressable>
              <Pressable
                onPress={() => handle_select_tab('equipo')}
                accessibilityRole="button"
                accessibilityState={{ selected: true }}
                style={[styles.seg, styles.seg_active]}
              >
                <Text style={[styles.seg_text, styles.seg_text_active]}>Equipo</Text>
              </Pressable>
            </View>

            {agency_overview.error && (
              <View style={styles.role_error_banner}>
                <Text style={styles.role_error_text}>{agency_overview.error}</Text>
                <Pressable
                  onPress={() => void agency_overview.refetch()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Reintentar cargar el equipo"
                >
                  <Text style={styles.role_error_retry}>Reintentar</Text>
                </Pressable>
              </View>
            )}

            <NarrativeHeader narrative={agency_narrative} />

            {agency_overview.unmanaged.length > 0 && (
              <View style={styles.agency_band}>
                <View style={styles.agency_band_head}>
                  <View style={[styles.agency_band_icon, { backgroundColor: colors.temp_hot }]}>
                    <Flame size={11} color="#FDFBF6" weight="fill" />
                  </View>
                  <Text style={styles.agency_band_name}>Sin gestor</Text>
                  <Text style={styles.agency_band_count}>{agency_overview.unmanaged.length}</Text>
                </View>
                <Text style={styles.agency_band_subtitle}>Nadie de tu equipo los está atendiendo</Text>
                {agency_overview.unmanaged.map((u) => (
                  <UnmanagedLeadRow key={u.lead_id} row={u} onPressAssign={() => set_assign_target(u)} />
                ))}
              </View>
            )}

            <View style={styles.agency_band}>
              <View style={styles.agency_band_head}>
                <View style={[styles.agency_band_icon, { backgroundColor: colors.primary }]}>
                  <Users size={11} color="#FDFBF6" weight="fill" />
                </View>
                <Text style={styles.agency_band_name}>Tus agentes</Text>
                <Text style={styles.agency_band_count}>{agency_overview.agents.length}</Text>
              </View>
              {agency_overview.agents.length > 0 && (
                <Text style={styles.agency_band_footnote}>
                  &quot;Responde en&quot; mide cuándo el agente marca contactado, no cuándo escribe de verdad
                </Text>
              )}

              {agency_overview.agents.length === 0 ? (
                <EmptyState
                  message="Aún no tienes agentes en tu equipo"
                  subtitle="En cuanto invites al primero, verás aquí sus leads sin tocar, su tiempo de respuesta y su temperatura promedio."
                  icon={Users}
                />
              ) : (
                agency_overview.agents.map((a) => (
                  <AgencyAgentRow key={a.agent_id} row={a} onPress={() => handle_drilldown(a.agent_id)} />
                ))
              )}
            </View>
          </ScrollView>
        </View>

        <AssignLeadSheet
          visible={assign_target !== null}
          lead={assign_target}
          agents={agents}
          reassign={reassign_lead.reassign}
          onClose={() => set_assign_target(null)}
          onAssigned={() => void agency_overview.refetch()}
        />
      </SafeAreaView>
    );
  }

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

      <CrmFilterSheet
        visible={sheet_open}
        initialFilters={{ query, status: status_filter, followUp: follow_up_filter }}
        onClose={() => set_sheet_open(false)}
        onSubmit={handle_apply_filters}
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
  active_filters_row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s_8,
    marginTop: spacing.s_12,
  },
  query_chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
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

  // ── Cabecera "← Equipo" del drill-down (269.6) ──────────────────────────────
  back_header_wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    paddingTop: spacing.s_24,
  },
  back_btn: {
    width: 32,
    height: 32,
    borderRadius: radii.r_8,
    backgroundColor: colors.paper_2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back_title: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.gray_2,
  },
  back_agent_block: {
    marginTop: spacing.s_4,
    marginBottom: spacing.s_12,
  },
  back_agent_name: {
    ...type_scale.h1,
    color: colors.ink,
  },
  back_agent_sub: {
    marginTop: 2,
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.gray_2,
  },

  // ── Overview de agencia (segmento Equipo, 269.6) ────────────────────────────
  agency_band: {
    marginTop: spacing.s_16,
  },
  agency_band_head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
  },
  agency_band_icon: {
    width: 19,
    height: 19,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  agency_band_name: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.ink,
  },
  agency_band_count: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.gray_2,
  },
  agency_band_subtitle: {
    marginTop: 2,
    marginLeft: 19 + spacing.s_8,
    fontFamily: fonts.outfit_light,
    fontSize: 11,
    color: colors.gray_2,
  },
  agency_band_footnote: {
    marginTop: 2,
    marginLeft: 19 + spacing.s_8,
    fontFamily: fonts.outfit_light,
    fontSize: 9.5,
    color: colors.gray_2,
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
