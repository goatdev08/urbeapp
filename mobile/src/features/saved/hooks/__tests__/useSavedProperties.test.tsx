/**
 * Tests fase RED — useSavedProperties hook
 * Archivo SUT: mobile/src/features/saved/hooks/useSavedProperties.ts
 * Subtarea Taskmaster: 13.6 — pantalla "Guardados" (hook crítico TDD)
 *
 * SUT: useSavedProperties(deps?) → { properties: GridProperty[]; loading: boolean; error: string | null; refetch: () => Promise<void> }
 *
 * Contrato del hook (a implementar en GREEN):
 *   - Query: supabase.from('saves').select(<embed properties+property_videos>).order('created_at', { ascending: false })
 *   - RLS filtra por user_id automáticamente (policy saves_select). NO filtrar user_id en el select.
 *   - Sin sesión → no consulta (from no se llama), properties: [], loading: false, error: null.
 *   - BUG1 FIX: saves NO tiene deleted_at (DELETE duro — migración 0006). Sin filtro deleted_at.
 *   - Transform: row.properties → GridProperty. thumbnail_url = video de menor position; null-safe si no hay videos.
 *   - Filas con row.properties === null → descartadas (degradación silenciosa).
 *
 * PATRÓN DE MOCK (igual que usePropertyActions.test.tsx):
 *   - useAuth mockeado via jest.mock.
 *   - supabase inyectado como dep: useSavedProperties({ supabase: mock }).
 *   - Cadena: from('saves').select(...).order('created_at', { ascending: false }) → Promise<{data, error}>.
 *
 * EDGE CASES CUBIERTOS (11 casos):
 *
 * ### Happy path
 * - (EC-1)  propiedades_guardadas_transformadas_a_GridProperty
 * - (EC-2)  orden_created_at_desc
 *
 * ### Edge cases del PRD / spec
 * - (EC-3)  lista_vacia_properties_array_vacio_sin_error
 * - (EC-4a) thumbnail_video_menor_position
 * - (EC-4b) thumbnail_null_safe_sin_videos
 * - (EC-4c) thumbnail_null_safe_thumbnail_url_nulo_en_video
 *
 * ### Ramas de reglas no obvias
 * - (EC-5)  fila_con_properties_null_se_descarta
 * - (EC-9)  sin_sesion_no_consulta_from_saves
 *
 * ### Boundary / error
 * - (EC-6)  loading_false_al_terminar_carga
 * - (EC-7)  error_query_expone_error_string_properties_vacias_loading_false
 * - (EC-8)  refetch_vuelve_a_ejecutar_query
 *
 * ---------------------------------------------------------------------------
 * EXTENSIÓN — Subtarea 55.2: suscripción a onPropertyDeleted
 * ---------------------------------------------------------------------------
 *
 * OBJETIVO DEL RED (55.2):
 *   HOY useSavedProperties NO se suscribe a onPropertyDeleted
 *   (mobile/src/lib/propertyEvents.ts, subtarea 55.1, ya implementada y real).
 *   Los tests del bloque "suscripción a onPropertyDeleted" fallan por ASERCIÓN:
 *   el id "borrado" emitido con emitPropertyDeleted sigue presente en
 *   `properties` porque el hook no tiene el useEffect de suscripción todavía.
 *
 * GREEN esperado (NO implementado aquí):
 *   useEffect(() => onPropertyDeleted((id) =>
 *     set_properties(prev => prev.filter(p => p.id !== id))
 *   ), [])
 *
 * '@/lib/propertyEvents' NUNCA se mockea (punto de integración real): el test
 * emite con emitPropertyDeleted(id) real y verifica que el hook, suscrito vía
 * onPropertyDeleted real, quita el id. EC-4-55.2 (cleanup en unmount) usa
 * jest.spyOn sobre onPropertyDeleted con mockImplementation que DELEGA a la
 * implementación real y envuelve el unsubscribe devuelto en un jest.fn.
 *
 * EDGE CASES CUBIERTOS (4 casos, EC-1-55.2..EC-4-55.2):
 *
 * ### Happy path
 * - (EC-1-55.2) id_borrado_desaparece_de_properties_tras_emitPropertyDeleted
 *
 * ### Edge cases del plan (55.2)
 * - (EC-2-55.2) otros_items_conservan_identidad_y_thumbnail
 * - (EC-3-55.2) emitir_id_inexistente_no_afecta_los_items_restantes
 *
 * ### Boundary / error
 * - (EC-4-55.2) desmontar_limpia_la_suscripcion_unsubscribe_invocado
 */

// ---------------------------------------------------------------------------
// Mock de useAuth — ANTES de cualquier import del SUT
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { renderHook, act } from '@testing-library/react-native';
import { useAuth } from '@/features/auth/context';
import { useSavedProperties } from '../useSavedProperties';

import * as property_events from '@/lib/propertyEvents';
import { emitPropertyDeleted } from '@/lib/propertyEvents';

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-guardados-uuid-13';

// ---------------------------------------------------------------------------
// Tipos de datos de prueba
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

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

const PROPERTY_ROW_1: PropertyEmbed = {
  id: 'prop-guardada-uuid-001',
  price: 15000,
  operation_type: 'rent',
  property_type: 'apartment',
  status: 'active',
  address: 'Av. Chapultepec 100, Col. Juárez, CDMX',
  property_videos: [
    { thumbnail_url: 'https://cdn.urbea.app/thumb-001.jpg', position: 2 },
    { thumbnail_url: 'https://cdn.urbea.app/thumb-002.jpg', position: 1 },
  ],
};

const PROPERTY_ROW_2: PropertyEmbed = {
  id: 'prop-guardada-uuid-002',
  price: 2500000,
  operation_type: 'sale',
  property_type: 'house',
  status: 'active',
  address: 'Calle Morelos 55, Centro, GDL',
  property_videos: [],
};

const SAVE_ROW_1: SaveRow = { properties: PROPERTY_ROW_1 };
const SAVE_ROW_2: SaveRow = { properties: PROPERTY_ROW_2 };

// ---------------------------------------------------------------------------
// Helper — cast tipado del mock de useAuth
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
//
// Cadena que el hook ejecuta:
//   supabase.from('saves').select('...').order('created_at', { ascending: false })
//   → Promise<{ data: SaveRow[] | null; error: { message: string } | null }>
// ---------------------------------------------------------------------------

function make_supabase_mock(opts: {
  query_result?: { data: SaveRow[] | null; error: { message: string } | null };
} = {}) {
  const {
    query_result = { data: [SAVE_ROW_1, SAVE_ROW_2], error: null },
  } = opts;

  const mock_order = jest.fn().mockResolvedValue(query_result);
  const mock_select = jest.fn().mockReturnValue({ order: mock_order });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    // Expuestos para aserciones directas
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_order: mock_order,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSavedProperties', () => {

  // ── (EC-1) Happy path — transformación a GridProperty ──────────────────────
  //
  // Verifica que:
  //   a) from('saves') se llama (la query se ejecuta)
  //   b) cada fila se transforma a GridProperty con los campos correctos

  it('(EC-1) propiedades_guardadas_transformadas_a_GridProperty: from("saves") se llama y cada save row se mapea a GridProperty con id/price/operation_type/property_type/status/address correctos', async () => {
    const mock = make_supabase_mock();
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    // La query debe ejecutarse contra 'saves'
    expect(mock._mock_from).toHaveBeenCalledWith('saves');

    // Deben llegar 2 propiedades transformadas
    expect(result.current.properties).toHaveLength(2);

    const prop1 = result.current.properties[0]!;
    expect(prop1.id).toBe(PROPERTY_ROW_1.id);
    expect(prop1.price).toBe(PROPERTY_ROW_1.price);
    expect(prop1.operation_type).toBe(PROPERTY_ROW_1.operation_type);
    expect(prop1.property_type).toBe(PROPERTY_ROW_1.property_type);
    expect(prop1.status).toBe(PROPERTY_ROW_1.status);
    expect(prop1.address).toBe(PROPERTY_ROW_1.address);
  });

  // ── (EC-2) Orden por created_at DESC ─────────────────────────────────────────

  it('(EC-2) orden_created_at_desc: el hook llama .order("created_at", { ascending: false }) exactamente con esos argumentos', async () => {
    const mock = make_supabase_mock();
    await renderHook(() => useSavedProperties({ supabase: mock }));

    expect(mock._mock_order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  // ── (EC-3) Lista vacía ────────────────────────────────────────────────────────

  it('(EC-3) lista_vacia_properties_array_vacio_sin_error: cuando no hay saves, properties=[] y error=null sin lanzar excepción', async () => {
    const mock = make_supabase_mock({ query_result: { data: [], error: null } });
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    expect(result.current.properties).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-4a) Thumbnail — video de menor position ───────────────────────────────

  it('(EC-4a) thumbnail_video_menor_position: thumbnail_url proviene del video con position mínima (no del primero del array)', async () => {
    const property_con_videos_desordenados: PropertyEmbed = {
      id: 'prop-vid-uuid-abc',
      price: 5000,
      operation_type: 'rent',
      property_type: 'apartment',
      status: 'active',
      address: 'Test ordenamiento de videos, GDL',
      property_videos: [
        { thumbnail_url: 'https://cdn.urbea.app/thumb-pos3.jpg', position: 3 },
        { thumbnail_url: 'https://cdn.urbea.app/thumb-pos1.jpg', position: 1 },
        { thumbnail_url: 'https://cdn.urbea.app/thumb-pos2.jpg', position: 2 },
      ],
    };
    const mock = make_supabase_mock({
      query_result: {
        data: [{ properties: property_con_videos_desordenados }],
        error: null,
      },
    });
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    expect(result.current.properties).toHaveLength(1);
    // Debe ser el thumbnail del video con position=1, no el primero del array (position=3)
    expect(result.current.properties[0]?.thumbnail_url).toBe(
      'https://cdn.urbea.app/thumb-pos1.jpg'
    );
  });

  // ── (EC-4b) Thumbnail null-safe — sin videos ──────────────────────────────────

  it('(EC-4b) thumbnail_null_safe_sin_videos: propiedad con array de videos vacío → thumbnail_url === null (sin crash)', async () => {
    const property_sin_videos: PropertyEmbed = {
      ...PROPERTY_ROW_2,
      property_videos: [],
    };
    const mock = make_supabase_mock({
      query_result: { data: [{ properties: property_sin_videos }], error: null },
    });
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    expect(result.current.properties).toHaveLength(1);
    expect(result.current.properties[0]?.thumbnail_url).toBeNull();
  });

  // ── (EC-4c) Thumbnail null-safe — video con thumbnail_url null ────────────────

  it('(EC-4c) thumbnail_null_safe_thumbnail_url_nulo_en_video: si el video de menor position tiene thumbnail_url=null, el campo resultante es null', async () => {
    const property_thumb_null: PropertyEmbed = {
      ...PROPERTY_ROW_1,
      property_videos: [
        { thumbnail_url: null, position: 1 },
      ],
    };
    const mock = make_supabase_mock({
      query_result: { data: [{ properties: property_thumb_null }], error: null },
    });
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    expect(result.current.properties).toHaveLength(1);
    expect(result.current.properties[0]?.thumbnail_url).toBeNull();
  });

  // ── (EC-5) Fila con properties=null se descarta ───────────────────────────────
  //
  // Regla no obvia: cuando el embed properties llega null (propiedad borrada entre
  // el save y la consulta), la fila se descarta silenciosamente.
  // BUG1 FIX confirmado: saves NO tiene deleted_at (migración 0006, DELETE duro).

  it('(EC-5) fila_con_properties_null_se_descarta: filas donde properties=null se omiten del resultado sin lanzar excepción ni contar en length', async () => {
    const rows_con_null: SaveRow[] = [
      { properties: PROPERTY_ROW_1 },
      { properties: null }, // fila degrada — propiedad no encontrada
      { properties: PROPERTY_ROW_2 },
    ];
    const mock = make_supabase_mock({
       
      query_result: { data: rows_con_null as any, error: null },
    });
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    // La fila con properties=null se descarta → 2 propiedades válidas (no 3)
    expect(result.current.properties).toHaveLength(2);
    expect(result.current.error).toBeNull();
    // Verificar que las propiedades válidas están presentes con sus ids correctos
    expect(result.current.properties[0]?.id).toBe(PROPERTY_ROW_1.id);
    expect(result.current.properties[1]?.id).toBe(PROPERTY_ROW_2.id);
  });

  // ── (EC-6) Estado loading=false al terminar carga exitosa ─────────────────────

  it('(EC-6) loading_false_al_terminar_carga: loading=false después de que la query resuelve exitosamente y las propiedades están disponibles', async () => {
    const mock = make_supabase_mock();
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    expect(result.current.loading).toBe(false);
    // Confirmar también que la query se ejecutó (hay propiedades)
    expect(result.current.properties).toHaveLength(2);
  });

  // ── (EC-7) Error de query propagado ──────────────────────────────────────────

  it('(EC-7) error_query_expone_error_string_properties_vacias_loading_false: error de supabase → error=message string, properties=[], loading=false', async () => {
    const mock = make_supabase_mock({
      query_result: {
        data: null,
        error: { message: 'RLS policy violation: acceso denegado a saves' },
      },
    });
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    expect(result.current.error).toBe('RLS policy violation: acceso denegado a saves');
    expect(result.current.properties).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-8) refetch() vuelve a ejecutar la query ───────────────────────────────

  it('(EC-8) refetch_vuelve_a_ejecutar_query: llamar refetch() provoca que from("saves") se llame de nuevo (count > baseline tras mount)', async () => {
    const mock = make_supabase_mock();
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    const calls_tras_mount = mock._mock_from.mock.calls.length;
    // Debe haber al menos 1 llamada tras el mount (la carga inicial)
    expect(calls_tras_mount).toBeGreaterThanOrEqual(1);

    // Ejecuta refetch y espera que se complete
    await act(async () => {
      await result.current.refetch();
    });

    // Debe haber más llamadas que tras el mount
    expect(mock._mock_from.mock.calls.length).toBeGreaterThan(calls_tras_mount);
  });

  // ── (EC-9) Sin sesión — no consulta ───────────────────────────────────────────
  //
  // Regla no obvia: sin usuario autenticado, el hook NO debe llamar from('saves').
  // La RLS protege en DB, pero la consulta también debe evitarse en cliente.

  it('(EC-9) sin_sesion_no_consulta_from_saves: user=null → from("saves") no se llama, properties=[], loading=false, error=null', async () => {
    mock_use_auth.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
    });

    const mock = make_supabase_mock();
    const { result } = await renderHook(() =>
      useSavedProperties({ supabase: mock })
    );

    // La query NO debe ejecutarse si no hay sesión
    expect(mock._mock_from).not.toHaveBeenCalled();
    expect(result.current.properties).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

});

// ---------------------------------------------------------------------------
// EXTENSIÓN — Subtarea 55.2: suscripción a onPropertyDeleted
// ---------------------------------------------------------------------------

const SAVE_PROPERTY_ROW_A: PropertyEmbed = {
  id: 'guardada-55-uuid-aaa',
  price: 8500,
  operation_type: 'rent',
  property_type: 'apartment',
  status: 'active',
  address: 'Av. de las Rosas 10, GDL',
  property_videos: [{ thumbnail_url: 'https://cdn.urbea.app/thumb-55-aaa.jpg', position: 0 }],
};

const SAVE_PROPERTY_ROW_B: PropertyEmbed = {
  id: 'guardada-55-uuid-bbb',
  price: 9200,
  operation_type: 'rent',
  property_type: 'apartment',
  status: 'active',
  address: 'Av. de las Rosas 20, GDL',
  property_videos: [{ thumbnail_url: 'https://cdn.urbea.app/thumb-55-bbb.jpg', position: 0 }],
};

const SAVE_PROPERTY_ROW_C: PropertyEmbed = {
  id: 'guardada-55-uuid-ccc',
  price: 7100,
  operation_type: 'rent',
  property_type: 'apartment',
  status: 'active',
  address: 'Av. de las Rosas 30, GDL',
  property_videos: [{ thumbnail_url: 'https://cdn.urbea.app/thumb-55-ccc.jpg', position: 0 }],
};

async function render_loaded_saved_properties_hook() {
  const mock = make_supabase_mock({
    query_result: {
      data: [
        { properties: SAVE_PROPERTY_ROW_A },
        { properties: SAVE_PROPERTY_ROW_B },
        { properties: SAVE_PROPERTY_ROW_C },
      ],
      error: null,
    },
  });
  const rendered = await renderHook(() => useSavedProperties({ supabase: mock }));
  return rendered;
}

describe('useSavedProperties — suscripción a onPropertyDeleted (55.2)', () => {
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
  });

  // ── (EC-1-55.2) Happy path — el id borrado desaparece de properties ──────

  it('(EC-1-55.2) id_borrado_desaparece_de_properties_tras_emitPropertyDeleted: tras emitPropertyDeleted(idB), properties ya no contiene idB y su longitud baja de 3 a 2', async () => {
    const { result } = await render_loaded_saved_properties_hook();
    expect(result.current.properties.map((p) => p.id)).toEqual([
      SAVE_PROPERTY_ROW_A.id,
      SAVE_PROPERTY_ROW_B.id,
      SAVE_PROPERTY_ROW_C.id,
    ]);

    await act(async () => {
      emitPropertyDeleted(SAVE_PROPERTY_ROW_B.id);
    });

    expect(result.current.properties).toHaveLength(2);
    expect(result.current.properties.map((p) => p.id)).not.toContain(SAVE_PROPERTY_ROW_B.id);
  });

  // ── (EC-2-55.2) Los demás items conservan identidad y thumbnail ──────────

  it('(EC-2-55.2) otros_items_conservan_identidad_y_thumbnail: al borrar idB, los objetos idA/idC restantes mantienen su misma referencia y thumbnail_url', async () => {
    const { result } = await render_loaded_saved_properties_hook();
    const item_a_before = result.current.properties.find((p) => p.id === SAVE_PROPERTY_ROW_A.id);
    const item_c_before = result.current.properties.find((p) => p.id === SAVE_PROPERTY_ROW_C.id);
    expect(item_a_before).toBeDefined();
    expect(item_c_before).toBeDefined();

    await act(async () => {
      emitPropertyDeleted(SAVE_PROPERTY_ROW_B.id);
    });

    // La eliminación debe haber ocurrido de verdad (si no, la comparación de
    // identidad de abajo pasaría trivialmente sin que el hook haya hecho nada).
    expect(result.current.properties).toHaveLength(2);

    const item_a_after = result.current.properties.find((p) => p.id === SAVE_PROPERTY_ROW_A.id);
    const item_c_after = result.current.properties.find((p) => p.id === SAVE_PROPERTY_ROW_C.id);

    expect(item_a_after).toBe(item_a_before);
    expect(item_c_after).toBe(item_c_before);
    expect(item_a_after?.thumbnail_url).toBe(SAVE_PROPERTY_ROW_A.property_videos[0]!.thumbnail_url);
    expect(item_c_after?.thumbnail_url).toBe(SAVE_PROPERTY_ROW_C.property_videos[0]!.thumbnail_url);
  });

  // ── (EC-3-55.2) Emitir un id inexistente no afecta los items restantes ───

  it('(EC-3-55.2) emitir_id_inexistente_no_afecta_los_items_restantes: tras borrar idB (2 items quedan), emitir un id que no existe en guardados no cambia el conteo ni los ids restantes', async () => {
    const { result } = await render_loaded_saved_properties_hook();

    await act(async () => {
      emitPropertyDeleted(SAVE_PROPERTY_ROW_B.id);
    });
    // Confirma que el mecanismo de borrado real está activo antes del no-op.
    expect(result.current.properties).toHaveLength(2);

    await act(async () => {
      emitPropertyDeleted('guardada-55-uuid-que-no-existe');
    });

    expect(result.current.properties).toHaveLength(2);
    expect(result.current.properties.map((p) => p.id)).toEqual([
      SAVE_PROPERTY_ROW_A.id,
      SAVE_PROPERTY_ROW_C.id,
    ]);
  });

  // ── (EC-4-55.2) Desmontar limpia la suscripción ───────────────────────────

  it('(EC-4-55.2) desmontar_limpia_la_suscripcion_unsubscribe_invocado: el hook se suscribe una vez al montar y llama la función de unsubscribe devuelta al desmontar', async () => {
    const real_on_property_deleted = property_events.onPropertyDeleted;
    const on_property_deleted_spy = jest
      .spyOn(property_events, 'onPropertyDeleted')
      .mockImplementation((listener: (property_id: string) => void) => {
        const real_unsubscribe = real_on_property_deleted(listener);
        return jest.fn(real_unsubscribe);
      });

    const { unmount } = await render_loaded_saved_properties_hook();

    // El hook debe haberse suscrito exactamente una vez al montar.
    expect(on_property_deleted_spy).toHaveBeenCalledTimes(1);

    const wrapped_unsubscribe = on_property_deleted_spy.mock.results[0]!.value as jest.Mock;

    await act(async () => {
      unmount();
    });

    expect(wrapped_unsubscribe).toHaveBeenCalledTimes(1);

    on_property_deleted_spy.mockRestore();
  });
});
