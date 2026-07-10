/**
 * Tests fase RED — useFeedProperties hook — suscripción a onPropertyDeleted (55.2)
 * Archivo SUT: mobile/src/features/feed/hooks/useFeedProperties.ts
 * Subtarea Taskmaster: 55.2 — Approach B (consumer-side signal subscription)
 *
 * OBJETIVO DEL RED:
 *   HOY useFeedProperties NO se suscribe a onPropertyDeleted (mobile/src/lib/propertyEvents.ts,
 *   subtarea 55.1, ya implementada y real). Estos tests fallan por ASERCIÓN: el id
 *   "borrado" emitido con emitPropertyDeleted sigue presente en `data` porque el hook
 *   no tiene el useEffect de suscripción todavía.
 *
 * GREEN esperado (NO implementado aquí):
 *   useEffect(() => onPropertyDeleted((id) => set_data(prev => prev.filter(p => p.id !== id))), [])
 *
 * PATRÓN DE MOCK:
 *   - '../lib/feedProperties' (fetchFeedProperties) mockeado por completo — puebla
 *     `data` con 3 propiedades vía loadInitial().
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
 * - (EC-1) id_borrado_desaparece_del_estado_tras_emitPropertyDeleted
 *
 * ### Edge cases del plan (55.2)
 * - (EC-2) otros_items_conservan_identidad_y_signed_url
 * - (EC-3) emitir_id_inexistente_no_afecta_los_items_restantes
 *
 * ### Boundary / error
 * - (EC-4) desmontar_limpia_la_suscripcion_unsubscribe_invocado
 *
 * ### Coords → deps (#42.2 — arnés nuevo, NO debilita EC-1..EC-4)
 * - (EC-5) coords_de_uselocation_fluyen_a_deps_de_fetchfeedproperties
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock de '../lib/feedProperties' — ANTES de importar el SUT
// ---------------------------------------------------------------------------

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
}));

// ponytail: harness-only (#42.2) — useFeedProperties ahora consume useLocation()
// para pasar coords a fetchFeedProperties. Default: sin coords (gate en
// 'loading'), como en la mayoría de sesiones reales al montar. EC-5 override
// con mockReturnValueOnce para verificar el flujo cuando sí hay coords.
const mock_use_location = jest.fn().mockReturnValue({ coords: null, status: 'loading' });
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => mock_use_location(),
}));

// ponytail: harness-only (#42.2) — build_deps hace require('@/lib/supabase/client')
// lazy solo cuando hay coords; el top-level real lanza sin env vars (ver
// feedProperties.ts). Stub inerte: ningún test de este archivo assert sobre
// el valor de supabase, solo sobre coords.
jest.mock('@/lib/supabase/client', () => ({ supabase: {} }));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetchFeedProperties } from '../lib/feedProperties';
import type { FeedPropertyWithUrl } from '../types';

import * as property_events from '@/lib/propertyEvents';
import { emitPropertyDeleted } from '@/lib/propertyEvents';

// ---------------------------------------------------------------------------
// Helper — cast tipado del mock
// ---------------------------------------------------------------------------

const mock_fetch_feed_properties = fetchFeedProperties as jest.MockedFunction<
  typeof fetchFeedProperties
>;

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

function make_feed_property(
  id: string,
  overrides: Partial<FeedPropertyWithUrl> = {},
): FeedPropertyWithUrl {
  return {
    id,
    price: 15000,
    address: 'Av. Chapultepec 100, Col. Juárez, CDMX',
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: 'owner-uuid-feed-test',
    agency_id: null,
    created_at: '2026-01-01T00:00:00Z',
    agent_phone: null,
    video: {
      id: `video-${id}`,
      storage_path: `properties/${id}/video.mp4`,
      position: 0,
      thumbnail_url: null,
    },
    signed_url: `https://cdn.urbea.app/signed/${id}.mp4`,
    video_id: `video-${id}`,
    ...overrides,
  };
}

const PROP_A = make_feed_property('feed-prop-uuid-aaa');
const PROP_B = make_feed_property('feed-prop-uuid-bbb');
const PROP_C = make_feed_property('feed-prop-uuid-ccc');

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_fetch_feed_properties.mockResolvedValue({
    data: [PROP_A, PROP_B, PROP_C],
    nextCursor: null,
  });
});

// ---------------------------------------------------------------------------
// Helper — monta el hook y espera a que loadInitial puebla `data`
// ---------------------------------------------------------------------------

async function render_loaded_hook() {
  const rendered = await renderHook(() => useFeedProperties());
  await act(async () => {
    await rendered.result.current.loadInitial();
  });
  return rendered;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFeedProperties — suscripción a onPropertyDeleted (55.2)', () => {
  // ── (EC-1) Happy path — el id borrado desaparece del estado ──────────────

  it('(EC-1) id_borrado_desaparece_del_estado_tras_emitPropertyDeleted: tras emitPropertyDeleted(idB), data ya no contiene idB y su longitud baja de 3 a 2', async () => {
    const { result } = await render_loaded_hook();
    expect(result.current.data.map((p) => p.id)).toEqual([
      PROP_A.id,
      PROP_B.id,
      PROP_C.id,
    ]);

    await act(async () => {
      emitPropertyDeleted(PROP_B.id);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data.map((p) => p.id)).not.toContain(PROP_B.id);
  });

  // ── (EC-2) Los demás items conservan identidad y signed URL ───────────────

  it('(EC-2) otros_items_conservan_identidad_y_signed_url: al borrar idB, los objetos idA/idC restantes mantienen su misma referencia y signed_url (el video en reproducción no se reinicia)', async () => {
    const { result } = await render_loaded_hook();
    const prop_a_before = result.current.data.find((p) => p.id === PROP_A.id);
    const prop_c_before = result.current.data.find((p) => p.id === PROP_C.id);
    expect(prop_a_before).toBeDefined();
    expect(prop_c_before).toBeDefined();

    await act(async () => {
      emitPropertyDeleted(PROP_B.id);
    });

    // La eliminación debe haber ocurrido de verdad (si no, la comparación de
    // identidad de abajo pasaría trivialmente sin que el hook haya hecho nada).
    expect(result.current.data).toHaveLength(2);

    const prop_a_after = result.current.data.find((p) => p.id === PROP_A.id);
    const prop_c_after = result.current.data.find((p) => p.id === PROP_C.id);

    // Misma referencia de objeto — el card/video de idA e idC no se re-mintan.
    expect(prop_a_after).toBe(prop_a_before);
    expect(prop_c_after).toBe(prop_c_before);
    expect(prop_a_after?.signed_url).toBe(PROP_A.signed_url);
    expect(prop_c_after?.signed_url).toBe(PROP_C.signed_url);
  });

  // ── (EC-3) Emitir un id inexistente no afecta los items restantes ────────

  it('(EC-3) emitir_id_inexistente_no_afecta_los_items_restantes: tras borrar idB (2 items quedan), emitir un id que no existe en el feed no cambia el conteo ni los ids restantes', async () => {
    const { result } = await render_loaded_hook();

    await act(async () => {
      emitPropertyDeleted(PROP_B.id);
    });
    // Confirma que el mecanismo de borrado real está activo antes del no-op.
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      emitPropertyDeleted('feed-prop-uuid-que-no-existe');
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data.map((p) => p.id)).toEqual([PROP_A.id, PROP_C.id]);
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

    const wrapped_unsubscribe = on_property_deleted_spy.mock.results[0]!
      .value as jest.Mock;

    await act(async () => {
      unmount();
    });

    expect(wrapped_unsubscribe).toHaveBeenCalledTimes(1);

    on_property_deleted_spy.mockRestore();
  });

  // ── (EC-5) coords de useLocation fluyen a deps de fetchFeedProperties ────

  it('(EC-5) coords_de_uselocation_fluyen_a_deps_de_fetchfeedproperties: useLocation devuelve coords reales → loadInitial llama fetchFeedProperties con deps.coords === esas coords', async () => {
    const coords = { latitude: 20.6597, longitude: -103.3496 };
    mock_use_location.mockReturnValueOnce({ coords, status: 'granted' });

    await render_loaded_hook();

    expect(mock_fetch_feed_properties).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ coords }),
      undefined,
    );
  });
});
