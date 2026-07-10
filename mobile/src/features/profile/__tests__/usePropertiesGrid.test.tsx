/**
 * Tests fase RED — usePropertiesGrid hook — suscripción a onPropertyDeleted (55.2)
 * Archivo SUT: mobile/src/features/profile/hooks/usePropertiesGrid.ts
 * Subtarea Taskmaster: 55.2 — Approach B (consumer-side signal subscription)
 *
 * OBJETIVO DEL RED:
 *   HOY usePropertiesGrid NO se suscribe a onPropertyDeleted (mobile/src/lib/propertyEvents.ts,
 *   subtarea 55.1, ya implementada y real). Estos tests fallan por ASERCIÓN: el id
 *   "borrado" emitido con emitPropertyDeleted sigue presente en `state.data` porque
 *   el hook no tiene el useEffect de suscripción todavía.
 *
 * GREEN esperado (NO implementado aquí):
 *   useEffect(() => onPropertyDeleted((id) =>
 *     set_state(s => s.data ? { ...s, data: s.data.filter(p => p.id !== id) } : s)
 *   ), [])
 *
 * PATRÓN DE MOCK:
 *   - '@/lib/supabase/client' mockeado vía getter sobre `mock_supabase_holder`
 *     (idéntico al patrón de useAgentProfile.test.tsx) — puebla `data` con 3
 *     propiedades vía la query real que dispara el useEffect de carga.
 *   - '@/lib/propertyEvents' NUNCA se mockea (punto de integración real): el test
 *     emite con emitPropertyDeleted(id) real y verifica que el hook, suscrito vía
 *     onPropertyDeleted real, quita el id.
 *   - EC-4 (cleanup en unmount) usa jest.spyOn sobre onPropertyDeleted con
 *     mockImplementation que DELEGA a la implementación real (Set-based pub/sub
 *     intacto) y envuelve el unsubscribe devuelto en un jest.fn para poder
 *     verificar que el hook lo invoca al desmontar.
 *
 * EDGE CASES CUBIERTOS (4 casos, EC-1..EC-4 del plan de 55.2):
 *
 * ### Happy path
 * - (EC-1) id_borrado_desaparece_de_state_data_tras_emitPropertyDeleted
 *
 * ### Edge cases del plan (55.2)
 * - (EC-2) otros_items_conservan_identidad_y_thumbnail
 * - (EC-3) emitir_id_inexistente_no_afecta_los_items_restantes
 *
 * ### Boundary / error
 * - (EC-4) desmontar_limpia_la_suscripcion_unsubscribe_invocado
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — ANTES de importar el SUT
//
// `mock_supabase_holder` debe estar prefijado con "mock" (case-insensitive)
// para que Jest permita referenciarlo dentro del factory de jest.mock().
// ---------------------------------------------------------------------------

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { usePropertiesGrid } from '../hooks/usePropertiesGrid';

import * as property_events from '@/lib/propertyEvents';
import { emitPropertyDeleted } from '@/lib/propertyEvents';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const OWNER_USER_ID = 'agente-uuid-grid-test-55';

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

type VideoEmbed = {
  thumbnail_url: string | null;
  storage_path: string | null;
  position: number;
};

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
    address: `Calle Grid Test ${id}, GDL`,
    published_at: '2026-01-01T00:00:00Z',
    property_videos: [
      { thumbnail_url: `https://cdn.urbea.app/thumb-${id}.jpg`, storage_path: `path/${id}.mp4`, position: 0 },
    ],
    ...overrides,
  };
}

const ROW_A = make_property_row('grid-prop-uuid-aaa');
const ROW_B = make_property_row('grid-prop-uuid-bbb');
const ROW_C = make_property_row('grid-prop-uuid-ccc');

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
//
// Cadena que el hook ejecuta:
//   supabase.from('properties').select(...).eq('owner_user_id', id)
//     .in('status', [...]).is('deleted_at', null).order('published_at', {...})
// ---------------------------------------------------------------------------

function make_supabase_mock(opts: { rows?: PropertyRow[] } = {}) {
  const { rows = [ROW_A, ROW_B, ROW_C] } = opts;

  const mock_order = jest.fn().mockResolvedValue({ data: rows, error: null });
  const mock_is = jest.fn().mockReturnValue({ order: mock_order });
  const mock_in = jest.fn().mockReturnValue({ is: mock_is });
  const mock_eq = jest.fn().mockReturnValue({ in: mock_in });
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_order: mock_order,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

// ---------------------------------------------------------------------------
// Helper — monta el hook y espera a que la carga inicial puebla `data`
// ---------------------------------------------------------------------------

async function render_loaded_hook() {
  const rendered = await renderHook(() => usePropertiesGrid(OWNER_USER_ID));
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePropertiesGrid — suscripción a onPropertyDeleted (55.2)', () => {
  // ── (EC-1) Happy path — el id borrado desaparece de state.data ───────────

  it('(EC-1) id_borrado_desaparece_de_state_data_tras_emitPropertyDeleted: tras emitPropertyDeleted(idB), state.data ya no contiene idB y su longitud baja de 3 a 2', async () => {
    const { result } = await render_loaded_hook();
    expect(result.current.data?.map((p) => p.id)).toEqual([ROW_A.id, ROW_B.id, ROW_C.id]);

    await act(async () => {
      emitPropertyDeleted(ROW_B.id);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.map((p) => p.id)).not.toContain(ROW_B.id);
  });

  // ── (EC-2) Los demás items conservan identidad y thumbnail ────────────────

  it('(EC-2) otros_items_conservan_identidad_y_thumbnail: al borrar idB, los objetos idA/idC restantes mantienen su misma referencia y thumbnail_url', async () => {
    const { result } = await render_loaded_hook();
    const item_a_before = result.current.data?.find((p) => p.id === ROW_A.id);
    const item_c_before = result.current.data?.find((p) => p.id === ROW_C.id);
    expect(item_a_before).toBeDefined();
    expect(item_c_before).toBeDefined();

    await act(async () => {
      emitPropertyDeleted(ROW_B.id);
    });

    // La eliminación debe haber ocurrido de verdad (si no, la comparación de
    // identidad de abajo pasaría trivialmente sin que el hook haya hecho nada).
    expect(result.current.data).toHaveLength(2);

    const item_a_after = result.current.data?.find((p) => p.id === ROW_A.id);
    const item_c_after = result.current.data?.find((p) => p.id === ROW_C.id);

    expect(item_a_after).toBe(item_a_before);
    expect(item_c_after).toBe(item_c_before);
    expect(item_a_after?.thumbnail_url).toBe(ROW_A.property_videos[0]!.thumbnail_url);
    expect(item_c_after?.thumbnail_url).toBe(ROW_C.property_videos[0]!.thumbnail_url);
  });

  // ── (EC-3) Emitir un id inexistente no afecta los items restantes ────────

  it('(EC-3) emitir_id_inexistente_no_afecta_los_items_restantes: tras borrar idB (2 items quedan), emitir un id que no existe en la grilla no cambia el conteo ni los ids restantes', async () => {
    const { result } = await render_loaded_hook();

    await act(async () => {
      emitPropertyDeleted(ROW_B.id);
    });
    // Confirma que el mecanismo de borrado real está activo antes del no-op.
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      emitPropertyDeleted('grid-prop-uuid-que-no-existe');
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.map((p) => p.id)).toEqual([ROW_A.id, ROW_C.id]);
  });

  // ── (EC-4) Desmontar limpia la suscripción ────────────────────────────────

  it('(EC-4) desmontar_limpia_la_suscripcion_unsubscribe_invocado: el hook se suscribe una vez al montar y llama la función de unsubscribe devuelta al desmontar', async () => {
    const real_on_property_deleted = property_events.onPropertyDeleted;
    const on_property_deleted_spy = jest
      .spyOn(property_events, 'onPropertyDeleted')
      .mockImplementation((listener: (property_id: string) => void) => {
        const real_unsubscribe = real_on_property_deleted(listener);
        return jest.fn(real_unsubscribe);
      });

    const { unmount } = await render_loaded_hook();

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
