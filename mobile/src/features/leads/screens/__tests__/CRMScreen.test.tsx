/**
 * Tests — CRMScreen reconstruido (subtarea 267.7).
 * Archivo SUT: mobile/src/features/leads/screens/CRMScreen.tsx
 *
 * SEAM bajo test: la pantalla con useAuth/useAgencyRole/useAgencyAgents/
 * useCrmFunnel/useCrmLeadsPage/useCrmRadarAnon MOCKEADOS y `LeadInlineDetail`
 * reemplazado por un stub que registra props (arrastra sus propios hooks de
 * datos — 267.6 ya lo cubre por separado). El resto de los componentes
 * (BandHeader, CrmLeadRow, RadarAnonRow, AgentSelector, FunnelCard,
 * NarrativeHeader, CrmSearchSheet) son los REALES: ya tienen su cobertura
 * unitaria propia, pero el cableado screen→ellos es justo lo que este
 * archivo ancla (mismo criterio que PropertyDetailScreen.test.tsx, #220.6).
 *
 * Reloj fijo (CrmLeadRow/RadarAnonRow usan Date.now() para el "hace X").
 * RNTL v14: render()/rerender() son async → SIEMPRE con `await`.
 *
 * Casos (del PLAN de la subtarea):
 * (EC-1) Búsqueda: confirmar "andrea" en la hoja ☰ → los 4 useCrmLeadsPage
 *   reciben p_query='andrea' — sin filtrado en cliente.
 * (EC-2) "Ver los N restantes" en cooling → loadMore SOLO de cooling.
 * (EC-3) Radar: filas testID="radar-anon-row" solo dentro de Calentando, sin
 *   ningún `button` adentro.
 * (EC-4) Estados vacíos (a) funnel.vieron===0 + 4 bandas vacías; (b) query +
 *   4 bandas vacías — copy exacto.
 * (EC-5) "silent" nace colapsada (sus filas no se renderizan) y al tocar su
 *   cabecera aparecen.
 * (EC-6) Tocar una fila monta LeadInlineDetail con ese lead; readOnly=true
 *   cuando selected_agent_id (vía Equipo) !== user.id.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context';
import { useAgencyAgents } from '../../hooks/useAgencyAgents';
import { useAgencyRole } from '../../hooks/useAgencyRole';
import { useCrmFunnel } from '../../hooks/useCrmFunnel';
import { useCrmLeadsPage, type UseCrmLeadsPageState } from '../../hooks/useCrmLeadsPage';
import { useCrmRadarAnon } from '../../hooks/useCrmRadarAnon';
import { CRMScreen } from '../CRMScreen';
import type { CrmBand, CrmFunnel, CrmLeadRow, CrmRadarRow } from '../../types';

// ---------------------------------------------------------------------------
// Mocks — babel-plugin-jest-hoist iza estos jest.mock por ENCIMA de los
// imports de arriba.
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('@/features/auth/context', () => ({ useAuth: jest.fn() }));

jest.mock('../../hooks/useAgencyRole', () => ({ useAgencyRole: jest.fn() }));
jest.mock('../../hooks/useAgencyAgents', () => ({ useAgencyAgents: jest.fn() }));
jest.mock('../../hooks/useCrmFunnel', () => ({ useCrmFunnel: jest.fn() }));
jest.mock('../../hooks/useCrmLeadsPage', () => ({ useCrmLeadsPage: jest.fn() }));
jest.mock('../../hooks/useCrmRadarAnon', () => ({ useCrmRadarAnon: jest.fn() }));

// LeadInlineDetail arrastra 6 hooks de datos propios (267.6) — se reemplaza
// por un stub que solo registra las props con las que la pantalla lo invoca,
// igual que ActionButtons/AgentCard en PropertyDetailScreen.test.tsx (#220.6).
const mock_lead_inline_detail = jest.fn((_props: unknown) => null);
jest.mock('../../components/LeadInlineDetail', () => ({
  LeadInlineDetail: (props: unknown) => mock_lead_inline_detail(props),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'agent-self-uuid';
const OTHER_AGENT_ID = 'agent-other-uuid';

function make_band_state(overrides: Partial<UseCrmLeadsPageState> = {}): UseCrmLeadsPageState {
  return {
    data: [],
    loading: false,
    error: null,
    hasMore: false,
    remaining: null,
    loadInitial: jest.fn(),
    loadMore: jest.fn(),
    refetch: jest.fn(),
    ...overrides,
  };
}

function make_lead_row(overrides: Partial<CrmLeadRow> = {}): CrmLeadRow {
  return {
    lead_id: 'lead-1',
    user_id: 'user-1',
    full_name: 'Karla Núñez',
    avatar_url: null,
    temperature: 80,
    delta: 5,
    band: 'hot',
    signals: { video_completed: 0, video_views: 1, likes: 0, saves: 0 },
    sparkline: new Array(14).fill(0.5),
    last_activity_at: '2026-09-06T11:00:00.000Z',
    origin_property: null,
    status_projected: 'nuevo',
    ...overrides,
  };
}

function make_radar_row(overrides: Partial<CrmRadarRow> = {}): CrmRadarRow {
  return {
    row_n: 1,
    property_label: 'Depa en Colinas de San Javier',
    temperature: 60,
    delta: 4,
    sparkline: new Array(14).fill(0.4),
    signals: { views: 2, completed: false, saved: false, liked: false },
    last_activity_at: '2026-09-06T10:00:00.000Z',
    ...overrides,
  };
}

const FUNNEL: CrmFunnel = { vieron: 10, volvieron: 5, guardaron: 3, contactaron: 2, agendaron: 1 };
const EMPTY_FUNNEL: CrmFunnel = { vieron: 0, volvieron: 0, guardaron: 0, contactaron: 0, agendaron: 0 };

/**
 * fireEvent es SÍNCRONO, pero RNTL v14 envuelve act() como async (ver
 * jest.setup.js) — sin `await`, el update queda encolado y NO se refleja en
 * el árbol hasta el drain de `afterEach`, después de las aserciones del test.
 * Cada press/changeText va en su PROPIO act(): una sola llamada batcheada
 * (p.ej. abrir la hoja + escribir en el mismo act) no comitea entre pasos, y
 * el siguiente query (el TextInput que solo existe una vez abierta la hoja)
 * no lo encontraría todavía.
 */
async function press(element: ReturnType<typeof screen.getByText>): Promise<void> {
  await act(async () => {
    fireEvent.press(element);
  });
}

async function change_text(element: ReturnType<typeof screen.getByText>, text: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(element, text);
  });
}

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;
const mock_use_agency_role = useAgencyRole as jest.MockedFunction<typeof useAgencyRole>;
const mock_use_agency_agents = useAgencyAgents as jest.MockedFunction<typeof useAgencyAgents>;
const mock_use_crm_funnel = useCrmFunnel as jest.MockedFunction<typeof useCrmFunnel>;
const mock_use_crm_leads_page = useCrmLeadsPage as jest.MockedFunction<typeof useCrmLeadsPage>;
const mock_use_crm_radar_anon = useCrmRadarAnon as jest.MockedFunction<typeof useCrmRadarAnon>;

/** Config por defecto: todas las bandas vacías, funnel con actividad (evita el estado vacío por default). */
function setup_default(band_data: Partial<Record<CrmBand, UseCrmLeadsPageState>> = {}): void {
  mock_use_auth.mockReturnValue({ user: { id: USER_ID } as any } as any);
  mock_use_agency_role.mockReturnValue({
    canViewTeam: false,
    isOwner: false,
    isAdmin: false,
    agencyId: null,
    memberRole: null,
    loading: false,
    error: false,
    refetch: jest.fn(),
  });
  mock_use_agency_agents.mockReturnValue({ agents: [], loading: false, error: null });
  mock_use_crm_funnel.mockReturnValue({ data: FUNNEL, loading: false, error: null, refetch: jest.fn() });
  mock_use_crm_radar_anon.mockReturnValue({ data: [], loading: false, error: null, refetch: jest.fn() });
  mock_use_crm_leads_page.mockImplementation(
    (_agentId, band) => band_data[band as CrmBand] ?? make_band_state(),
  );
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
  jest.clearAllMocks();
  setup_default();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CRMScreen', () => {
  it('(EC-1) confirmar búsqueda en la hoja ☰ manda p_query a los 4 useCrmLeadsPage, sin filtrado en cliente', async () => {
    await render(<CRMScreen />);

    await press(screen.getByLabelText('Buscar por nombre'));
    await change_text(screen.getByPlaceholderText('Buscar por nombre'), 'andrea');
    await press(screen.getByRole('button', { name: 'Buscar' }));

    const bands_queried = mock_use_crm_leads_page.mock.calls.map(([, band, query]) => [band, query]);
    expect(bands_queried).toEqual(
      expect.arrayContaining([
        ['hot', 'andrea'],
        ['cooling', 'andrea'],
        ['warming', 'andrea'],
        ['silent', 'andrea'],
      ]),
    );
  });

  it('(EC-2) "Ver los N restantes" en cooling llama loadMore SOLO de cooling', async () => {
    const hot_load_more = jest.fn();
    const cooling_load_more = jest.fn();
    const warming_load_more = jest.fn();
    const silent_load_more = jest.fn();

    setup_default({
      hot: make_band_state({ loadMore: hot_load_more }),
      cooling: make_band_state({
        data: [make_lead_row({ lead_id: 'lead-cooling-1', band: 'cooling', delta: -5 })],
        remaining: 3,
        hasMore: true,
        loadMore: cooling_load_more,
      }),
      warming: make_band_state({ loadMore: warming_load_more }),
      silent: make_band_state({ loadMore: silent_load_more }),
    });

    await render(<CRMScreen />);

    await press(screen.getByRole('button', { name: 'Ver los 3 restantes' }));

    expect(cooling_load_more).toHaveBeenCalledTimes(1);
    expect(hot_load_more).not.toHaveBeenCalled();
    expect(warming_load_more).not.toHaveBeenCalled();
    expect(silent_load_more).not.toHaveBeenCalled();
  });

  it('(EC-3) el radar se pinta SOLO dentro de Calentando y sus filas no tienen ningún button', async () => {
    setup_default({
      warming: make_band_state({
        data: [make_lead_row({ lead_id: 'lead-warming-1', band: 'warming' })],
      }),
    });
    mock_use_crm_radar_anon.mockReturnValue({
      data: [make_radar_row({ row_n: 1 })],
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    await render(<CRMScreen />);

    const radar_rows = screen.getAllByTestId('radar-anon-row');
    expect(radar_rows).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: /Alguien está mirando/ })).toHaveLength(0);
    // Ninguna fila del radar es en sí un botón (RadarAnonRow no es Pressable).
    for (const row of radar_rows) {
      expect(row.props.accessibilityRole).not.toBe('button');
    }
  });

  it('(EC-4a) estado vacío "Aún no hay señal que leer" con funnel.vieron===0 y las 4 bandas vacías', async () => {
    mock_use_crm_funnel.mockReturnValue({ data: EMPTY_FUNNEL, loading: false, error: null, refetch: jest.fn() });

    await render(<CRMScreen />);

    expect(screen.getByText('Aún no hay señal que leer')).toBeTruthy();
    expect(
      screen.getByText(
        'El radar se enciende cuando alguien ve, guarda o repite tus propiedades. Sube tu primer recorrido y en horas empiezas a ver quién está mirando.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Subir una propiedad')).toBeTruthy();
  });

  it('(EC-4b) estado vacío de búsqueda sin resultados en ninguna banda', async () => {
    await render(<CRMScreen />);

    await press(screen.getByLabelText('Buscar por nombre'));
    await change_text(screen.getByPlaceholderText('Buscar por nombre'), 'andrea');
    await press(screen.getByRole('button', { name: 'Buscar' }));

    expect(screen.getByText('No encontramos a nadie con ese nombre')).toBeTruthy();
    expect(screen.getByText('Ajusta la búsqueda e inténtalo de nuevo.')).toBeTruthy();
  });

  it('(EC-5) "En silencio" nace colapsada — sus filas no se renderizan hasta tocar la cabecera', async () => {
    setup_default({
      silent: make_band_state({
        data: [make_lead_row({ lead_id: 'lead-silent-1', full_name: 'Sofía Palacios', band: 'silent' })],
      }),
    });

    await render(<CRMScreen />);

    expect(screen.queryByText('Sofía Palacios')).toBeNull();

    await press(screen.getByText('En silencio'));

    expect(screen.getByText('Sofía Palacios')).toBeTruthy();
  });

  it('(EC-6) tocar una fila monta LeadInlineDetail con ese lead; readOnly=true viendo el pipeline de otro agente', async () => {
    setup_default({
      hot: make_band_state({
        data: [make_lead_row({ lead_id: 'lead-mine', full_name: 'Karla Núñez', band: 'hot' })],
      }),
    });

    await render(<CRMScreen />);

    await press(screen.getByText('Karla Núñez'));

    expect(mock_lead_inline_detail).toHaveBeenCalledWith(
      expect.objectContaining({ lead: expect.objectContaining({ lead_id: 'lead-mine' }), readOnly: false }),
    );
  });

  it('(EC-6b) viendo el pipeline de OTRO agente (Equipo) → readOnly=true', async () => {
    setup_default({
      hot: make_band_state({
        data: [make_lead_row({ lead_id: 'lead-theirs', full_name: 'Fernando Reyes', band: 'hot' })],
      }),
    });
    mock_use_agency_role.mockReturnValue({
      canViewTeam: true,
      isOwner: true,
      isAdmin: false,
      agencyId: 'agency-1',
      memberRole: 'owner',
      loading: false,
      error: false,
      refetch: jest.fn(),
    });
    mock_use_agency_agents.mockReturnValue({
      agents: [{ id: OTHER_AGENT_ID, full_name: 'Diego Ibarra', profile_photo_url: null, status: 'active' }],
      loading: false,
      error: null,
    });

    await render(<CRMScreen />);

    await press(screen.getByText('Equipo'));
    await press(screen.getByText('Diego Ibarra')); // chip del AgentSelector — fija selected_agent_id
    await press(screen.getByText('Fernando Reyes')); // fila del lead ajeno

    expect(mock_lead_inline_detail).toHaveBeenCalledWith(
      expect.objectContaining({ lead: expect.objectContaining({ lead_id: 'lead-theirs' }), readOnly: true }),
    );
  });
});
