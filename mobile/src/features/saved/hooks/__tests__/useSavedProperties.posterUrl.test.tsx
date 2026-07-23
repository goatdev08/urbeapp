/**
 * Tests fase RED — useSavedProperties: merge de posterUrl firmado (89.2)
 * Archivo SUT: mobile/src/features/saved/hooks/useSavedProperties.ts
 * Subtarea Taskmaster: 89.2 — Wiring: los 3 grids consumen posterUrl firmado
 *
 * OBJETIVO DEL RED:
 *   HOY useSavedProperties NO llama a fetch_grid_posters (mobile/src/lib/gridPosters.ts,
 *   89.2 pieza 1) ni añade `posterUrl` a los items de "Guardados". Estos tests fallan
 *   por ASERCIÓN: fetch_grid_posters mockeado nunca se invoca (0 llamadas) y los items
 *   no traen `posterUrl` (undefined, no el valor esperado del Map).
 *
 * GREEN esperado (NO implementado aquí): tras resolver la query (y descartar filas con
 * properties=null), el hook llama fetch_grid_posters(supabase, ids_de_las_filas_validas)
 * UNA vez (batch) y mergea posterUrl = map.get(id) ?? null en cada item.
 *
 * SEAM: el módulo '@/lib/gridPosters' se mockea completo (frontera del SUT) — no se
 * re-testea el invoke de la EF aquí (eso vive en gridPosters.test.ts).
 *
 * PATRÓN DE MOCK: useSavedProperties es DI (deps.supabase) — mismo estilo que
 * useSavedProperties.test.tsx (13.6/55.2). Archivo separado de ese para no interferir
 * con esa suite ya en verde.
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
import { useAuth } from '@/features/auth/context';

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/gridPosters', () => ({
  fetch_grid_posters: jest.fn(),
}));

import { useSavedProperties } from '../useSavedProperties';
import { fetch_grid_posters } from '@/lib/gridPosters';

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;
const mock_fetch_grid_posters = fetch_grid_posters as jest.MockedFunction<typeof fetch_grid_posters>;

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-guardados-poster-uuid-89';

const POSTER_URL_1 = 'https://videodelivery.net/stream-uid-guardada-1/thumbnails/thumbnail.jpg?token=sig-1';
const POSTER_URL_3 = 'https://videodelivery.net/stream-uid-guardada-3/thumbnails/thumbnail.jpg?token=sig-3';

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

type VideoEmbed = { thumbnail_url: string | null; position: number };
type PropertyEmbed = {
  id: string;
  price: number;
  operation_type: string;
  property_type: string;
  status: string;
  address: string;
  property_videos: VideoEmbed[];
};
type SaveRow = { properties: PropertyEmbed | null };

function make_property_embed(id: string, overrides: Partial<PropertyEmbed> = {}): PropertyEmbed {
  return {
    id,
    price: 12000,
    operation_type: 'rent',
    property_type: 'apartment',
    status: 'active',
    address: `Av. Guardados Poster Test ${id}, GDL`,
    property_videos: [{ thumbnail_url: `https://cdn.urbea.app/thumb-${id}.jpg`, position: 0 }],
    ...overrides,
  };
}

const PROPERTY_1 = make_property_embed('saved-poster-uuid-001');
const PROPERTY_2 = make_property_embed('saved-poster-uuid-002');
const PROPERTY_3 = make_property_embed('saved-poster-uuid-003');

const ROWS: SaveRow[] = [{ properties: PROPERTY_1 }, { properties: PROPERTY_2 }, { properties: PROPERTY_3 }];

// ---------------------------------------------------------------------------
// Factory del mock de Supabase — cadena idéntica a useSavedProperties.ts
// ---------------------------------------------------------------------------

function make_supabase_mock(opts: { rows?: SaveRow[] } = {}) {
  const { rows = ROWS } = opts;

  const mock_order = jest.fn().mockResolvedValue({ data: rows, error: null });
  const mock_select = jest.fn().mockReturnValue({ order: mock_order });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return { from: mock_from, functions: { invoke: jest.fn() }, _mock_from: mock_from };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_auth.mockReturnValue({

    user: { id: TEST_USER_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
  mock_fetch_grid_posters.mockResolvedValue(
    new Map([
      [PROPERTY_1.id, POSTER_URL_1],
      [PROPERTY_3.id, POSTER_URL_3],
      // PROPERTY_2 queda AUSENTE del Map a propósito (EF la omitió) — cubre M3.
    ]),
  );
});

async function render_loaded_hook() {
  const mock = make_supabase_mock();
  const rendered = await renderHook(() => useSavedProperties({ supabase: mock }));
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSavedProperties — merge de posterUrl firmado (89.2)', () => {
  it('(M1) batch_una_sola_llamada_con_los_ids_de_las_filas_cargadas: fetch_grid_posters se llama 1 vez con [id1,id2,id3]', async () => {
    await render_loaded_hook();

    expect(mock_fetch_grid_posters).toHaveBeenCalledTimes(1);
    expect(mock_fetch_grid_posters).toHaveBeenCalledWith(
      expect.anything(),
      [PROPERTY_1.id, PROPERTY_2.id, PROPERTY_3.id],
    );
  });

  it('(M2) merge_asigna_posterurl_del_map_por_id: item 1 y 3 traen posterUrl === valor del Map', async () => {
    const { result } = await render_loaded_hook();

    const item_1 = result.current.properties.find((p) => p.id === PROPERTY_1.id);
    const item_3 = result.current.properties.find((p) => p.id === PROPERTY_3.id);

    expect(item_1?.posterUrl).toBe(POSTER_URL_1);
    expect(item_3?.posterUrl).toBe(POSTER_URL_3);
  });

  it('(M3) id_sin_entrada_en_el_map_posterurl_null: item 2 (ausente del Map) → posterUrl null, sin afectar 1/3', async () => {
    const { result } = await render_loaded_hook();

    const item_2 = result.current.properties.find((p) => p.id === PROPERTY_2.id);

    expect(item_2?.posterUrl).toBeNull();
    expect(result.current.properties).toHaveLength(3);
  });

  it('(M4) fail_soft_map_vacio_lista_se_muestra_igual: fetch_grid_posters Map vacío → todos posterUrl null, misma longitud, loading=false, error=null', async () => {
    mock_fetch_grid_posters.mockResolvedValue(new Map());

    const { result } = await render_loaded_hook();

    expect(result.current.properties).toHaveLength(3);
    expect(result.current.properties.every((p) => p.posterUrl === null)).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(M5) shape_existente_se_conserva_junto_al_nuevo_posterurl: id/price/status/address/thumbnail_url intactos + posterUrl mergeado', async () => {
    const { result } = await render_loaded_hook();

    const item_1 = result.current.properties.find((p) => p.id === PROPERTY_1.id);

    expect(item_1).toMatchObject({
      id: PROPERTY_1.id,
      price: PROPERTY_1.price,
      operation_type: PROPERTY_1.operation_type,
      property_type: PROPERTY_1.property_type,
      status: PROPERTY_1.status,
      address: PROPERTY_1.address,
      thumbnail_url: PROPERTY_1.property_videos[0]!.thumbnail_url,
      posterUrl: POSTER_URL_1,
    });
  });
});
