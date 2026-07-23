/**
 * Tests fase RED — usePropertiesGrid: merge de posterUrl firmado (89.2)
 * Archivo SUT: mobile/src/features/profile/hooks/usePropertiesGrid.ts
 * Subtarea Taskmaster: 89.2 — Wiring: los 3 grids consumen posterUrl firmado
 *
 * OBJETIVO DEL RED:
 *   HOY usePropertiesGrid NO llama a fetch_grid_posters (mobile/src/lib/gridPosters.ts,
 *   89.2 pieza 1) ni añade `posterUrl` a los items del grid. Estos tests fallan por
 *   ASERCIÓN: fetch_grid_posters mockeado nunca se invoca (0 llamadas) y los items no
 *   traen `posterUrl` (undefined, no el valor esperado del Map).
 *
 * GREEN esperado (NO implementado aquí): tras resolver la query, el hook llama
 * fetch_grid_posters(supabase, ids_de_las_filas) UNA vez (batch) y mergea
 * posterUrl = map.get(id) ?? null en cada item.
 *
 * SEAM: el módulo '@/lib/gridPosters' se mockea completo (frontera del SUT) — no se
 * re-testea el invoke de la EF aquí (eso vive en gridPosters.test.ts).
 *
 * Archivo separado de usePropertiesGrid.test.tsx (55.2, suscripción a
 * onPropertyDeleted) para no interferir con esa suite ya en verde.
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
// Mock del cliente Supabase — ANTES de importar el SUT
// ---------------------------------------------------------------------------

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// Mock del helper compartido (89.2 pieza 1) — frontera del SUT bajo test.
jest.mock('@/lib/gridPosters', () => ({
  fetch_grid_posters: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { usePropertiesGrid } from '../hooks/usePropertiesGrid';
import { fetch_grid_posters } from '@/lib/gridPosters';

const mock_fetch_grid_posters = fetch_grid_posters as jest.MockedFunction<typeof fetch_grid_posters>;

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const OWNER_USER_ID = 'agente-uuid-poster-grid-89';

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
  published_at: string;
  property_videos: VideoEmbed[];
};

function make_property_row(id: string, overrides: Partial<PropertyRow> = {}): PropertyRow {
  return {
    id,
    price: 2500000,
    operation_type: 'sale',
    property_type: 'house',
    status: 'active',
    address: `Calle Poster Grid Test ${id}, GDL`,
    published_at: '2026-01-01T00:00:00Z',
    property_videos: [
      { thumbnail_url: `https://cdn.urbea.app/thumb-${id}.jpg`, storage_path: `path/${id}.mp4`, position: 0 },
    ],
    ...overrides,
  };
}

const ROW_A = make_property_row('poster-grid-uuid-aaa');
const ROW_B = make_property_row('poster-grid-uuid-bbb');
const ROW_C = make_property_row('poster-grid-uuid-ccc');

// ---------------------------------------------------------------------------
// Factory del mock de Supabase — cadena idéntica a usePropertiesGrid.ts
// ---------------------------------------------------------------------------

function make_supabase_mock(opts: { rows?: PropertyRow[] } = {}) {
  const { rows = [ROW_A, ROW_B, ROW_C] } = opts;

  const mock_order = jest.fn().mockResolvedValue({ data: rows, error: null });
  const mock_is = jest.fn().mockReturnValue({ order: mock_order });
  const mock_in = jest.fn().mockReturnValue({ is: mock_is });
  const mock_eq = jest.fn().mockReturnValue({ in: mock_in });
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
  mock_fetch_grid_posters.mockResolvedValue(
    new Map([
      [ROW_A.id, POSTER_URL_A],
      [ROW_C.id, POSTER_URL_C],
      // ROW_B queda AUSENTE del Map a propósito (EF la omitió) — cubre M3.
    ]),
  );
});

async function render_loaded_hook() {
  const rendered = await renderHook(() => usePropertiesGrid(OWNER_USER_ID));
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePropertiesGrid — merge de posterUrl firmado (89.2)', () => {
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

  it('(M5) shape_existente_se_conserva_junto_al_nuevo_posterurl: id/price/status/address/published_at/thumbnail_url intactos + posterUrl mergeado', async () => {
    const { result } = await render_loaded_hook();

    const item_a = result.current.data?.find((p) => p.id === ROW_A.id);

    expect(item_a).toMatchObject({
      id: ROW_A.id,
      price: ROW_A.price,
      operation_type: ROW_A.operation_type,
      property_type: ROW_A.property_type,
      status: ROW_A.status,
      address: ROW_A.address,
      published_at: ROW_A.published_at,
      thumbnail_url: ROW_A.property_videos[0]!.thumbnail_url,
      posterUrl: POSTER_URL_A,
    });
  });
});
