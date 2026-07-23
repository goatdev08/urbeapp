/**
 * Tests fase RED — useMyProperties: merge de posterUrl firmado (89.2)
 * Archivo SUT: mobile/src/features/profile/hooks/useMyProperties.ts
 * Subtarea Taskmaster: 89.2 — Wiring: los 3 grids consumen posterUrl firmado
 *
 * OBJETIVO DEL RED:
 *   HOY useMyProperties NO llama a fetch_grid_posters (mobile/src/lib/gridPosters.ts,
 *   89.2 pieza 1) ni añade `posterUrl` a los items de "Mis publicaciones". Estos tests
 *   fallan por ASERCIÓN: fetch_grid_posters mockeado nunca se invoca (0 llamadas) y los
 *   items no traen `posterUrl` (undefined, no el valor esperado del Map).
 *
 * GREEN esperado (NO implementado aquí): tras resolver la query, el hook llama
 * fetch_grid_posters(supabase, ids_de_las_filas) UNA vez (batch) y mergea
 * posterUrl = map.get(id) ?? null en cada item.
 *
 * SEAM: el módulo '@/lib/gridPosters' se mockea completo (frontera del SUT) — no se
 * re-testea el invoke de la EF aquí (eso vive en gridPosters.test.ts).
 *
 * PATRÓN DE MOCK: @/features/auth/context (useAuth) y @/lib/supabase/client
 * mockeados — mismo estilo que useAgentStats.test.ts / usePropertiesGrid.test.tsx.
 * useMyProperties NO es DI (importa supabase directo), a diferencia de
 * useSavedProperties.
 *
 * No existía suite previa para este hook (foco exclusivo: merge de posterUrl).
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path / batch
 * - (M1) batch_una_sola_llamada_con_los_ids_de_las_filas_cargadas
 * - (M2) merge_asigna_posterurl_del_map_por_id
 *
 * ### Ramas no obvias
 * - (M3) id_sin_entrada_en_el_map_posterurl_null
 *
 * ### Boundary / error — fail-soft
 * - (M4) fail_soft_map_vacio_lista_se_muestra_igual
 *
 * ### Regresión
 * - (M5) shape_existente_se_conserva_junto_al_nuevo_posterurl
 */

import { renderHook, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — ANTES de importar el SUT
// ---------------------------------------------------------------------------

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

jest.mock('@/lib/gridPosters', () => ({
  fetch_grid_posters: jest.fn(),
}));

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useMyProperties } from '../hooks/useMyProperties';
import { fetch_grid_posters } from '@/lib/gridPosters';
import { useAuth } from '@/features/auth/context';

const mock_fetch_grid_posters = fetch_grid_posters as jest.MockedFunction<typeof fetch_grid_posters>;
const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const AGENT_USER_ID = 'agente-uuid-my-properties-89';

const POSTER_URL_A = 'https://videodelivery.net/stream-uid-aaa/thumbnails/thumbnail.jpg?token=sig-a';
const POSTER_URL_C = 'https://videodelivery.net/stream-uid-ccc/thumbnails/thumbnail.jpg?token=sig-c';

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

type VideoEmbed = { thumbnail_url: string | null; storage_path: string | null; position: number };
type PropertyRow = {
  id: string;
  price: number;
  operation_type: string;
  property_type: string;
  status: string;
  address: string;
  created_at: string;
  closed_reason: string | null;
  view_count: number;
  like_count: number;
  save_count: number;
  contact_count: number;
  property_videos: VideoEmbed[];
};

function make_property_row(id: string, overrides: Partial<PropertyRow> = {}): PropertyRow {
  return {
    id,
    price: 1800000,
    operation_type: 'sale',
    property_type: 'apartment',
    status: 'draft',
    address: `Calle My Properties Poster Test ${id}, CDMX`,
    created_at: '2026-02-01T00:00:00Z',
    closed_reason: null,
    view_count: 3,
    like_count: 1,
    save_count: 0,
    contact_count: 0,
    property_videos: [
      { thumbnail_url: `https://cdn.urbea.app/thumb-${id}.jpg`, storage_path: `path/${id}.mp4`, position: 0 },
    ],
    ...overrides,
  };
}

const ROW_A = make_property_row('my-prop-poster-uuid-aaa');
const ROW_B = make_property_row('my-prop-poster-uuid-bbb');
const ROW_C = make_property_row('my-prop-poster-uuid-ccc');

// ---------------------------------------------------------------------------
// Factory del mock de Supabase — cadena idéntica a useMyProperties.ts
// ---------------------------------------------------------------------------

function make_supabase_mock(opts: { rows?: PropertyRow[] } = {}) {
  const { rows = [ROW_A, ROW_B, ROW_C] } = opts;

  const mock_order = jest.fn().mockResolvedValue({ data: rows, error: null });
  const mock_is = jest.fn().mockReturnValue({ order: mock_order });
  const mock_eq = jest.fn().mockReturnValue({ is: mock_is });
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return { from: mock_from, functions: { invoke: jest.fn() }, _mock_from: mock_from };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
  mock_use_auth.mockReturnValue({

    user: { id: AGENT_USER_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
  mock_fetch_grid_posters.mockResolvedValue(
    new Map([
      [ROW_A.id, POSTER_URL_A],
      [ROW_C.id, POSTER_URL_C],
      // ROW_B queda AUSENTE del Map a propósito (EF la omitió) — cubre M3.
    ]),
  );
});

async function render_loaded_hook() {
  const rendered = await renderHook(() => useMyProperties());
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMyProperties — merge de posterUrl firmado (89.2)', () => {
  it('(M1) batch_una_sola_llamada_con_los_ids_de_las_filas_cargadas: fetch_grid_posters se llama 1 vez con [idA,idB,idC]', async () => {
    await render_loaded_hook();

    expect(mock_fetch_grid_posters).toHaveBeenCalledTimes(1);
    expect(mock_fetch_grid_posters).toHaveBeenCalledWith(
      expect.anything(),
      [ROW_A.id, ROW_B.id, ROW_C.id],
    );
  });

  it('(M2) merge_asigna_posterurl_del_map_por_id: item A y C traen posterUrl === valor del Map', async () => {
    const { result } = await render_loaded_hook();

    const item_a = result.current.data?.find((p) => p.id === ROW_A.id);
    const item_c = result.current.data?.find((p) => p.id === ROW_C.id);

    expect(item_a?.posterUrl).toBe(POSTER_URL_A);
    expect(item_c?.posterUrl).toBe(POSTER_URL_C);
  });

  it('(M3) id_sin_entrada_en_el_map_posterurl_null: item B (ausente del Map) → posterUrl null, sin afectar A/C', async () => {
    const { result } = await render_loaded_hook();

    const item_b = result.current.data?.find((p) => p.id === ROW_B.id);

    expect(item_b?.posterUrl).toBeNull();
    expect(result.current.data).toHaveLength(3);
  });

  it('(M4) fail_soft_map_vacio_lista_se_muestra_igual: fetch_grid_posters Map vacío → todos posterUrl null, misma longitud, loading=false, error=null', async () => {
    mock_fetch_grid_posters.mockResolvedValue(new Map());

    const { result } = await render_loaded_hook();

    expect(result.current.data).toHaveLength(3);
    expect(result.current.data?.every((p) => p.posterUrl === null)).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(M5) shape_existente_se_conserva_junto_al_nuevo_posterurl: id/price/status/created_at/contadores/video_count/thumbnail_url intactos + posterUrl mergeado', async () => {
    const { result } = await render_loaded_hook();

    const item_a = result.current.data?.find((p) => p.id === ROW_A.id);

    expect(item_a).toMatchObject({
      id: ROW_A.id,
      price: ROW_A.price,
      operation_type: ROW_A.operation_type,
      property_type: ROW_A.property_type,
      status: ROW_A.status,
      address: ROW_A.address,
      created_at: ROW_A.created_at,
      closed_reason: ROW_A.closed_reason,
      view_count: ROW_A.view_count,
      like_count: ROW_A.like_count,
      save_count: ROW_A.save_count,
      contact_count: ROW_A.contact_count,
      video_count: ROW_A.property_videos.length,
      thumbnail_url: ROW_A.property_videos[0]!.thumbnail_url,
      posterUrl: POSTER_URL_A,
    });
  });
});
