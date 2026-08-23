/**
 * RED — tarea #207: las impresiones de anuncios NUNCA salían del dispositivo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * EL BUG. `adImpressionQueue` solo dispara `flush()` cuando la cola llega a
 * AD_IMPRESSION_BATCH_SIZE (10). Nadie más lo llama en todo `src/`. Y como
 * `app_config.ad_max_per_session = 5`, la cola NO PUEDE llegar a 10 jamás:
 * las exposiciones se encolan, se quedan en memoria y mueren con el proceso.
 * `ad_impressions` llevaba congelada desde el 2026-08-21 con 34 filas pese a
 * haber anuncios vistos completos.
 *
 * El propio módulo lo dice: «en la práctica el flush que manda es el de salir
 * de la pantalla». Ese flush nunca se escribió. Es el mismo patrón de #205 y
 * #206 — la unidad correcta, el cableado ausente — y por eso el test que lo
 * cierra NO puede ser otro test de la cola aislada (esa ya está en verde y no
 * vio nada): tiene que afirmar que ALGUIEN la vacía.
 *
 * 🔴 POR QUÉ ESTE TEST VIVE EN `useFeedActiveIndex` Y NO EN UN HOOK NUEVO.
 * El hook ya calcula la señal exacta que necesitamos —`is_app_active &&
 * is_focused`— para pausar el video. Un hook nuevo sería un SEGUNDO cable que
 * FeedScreen tendría que acordarse de conectar, y un cable que se puede
 * olvidar es precisamente el bug que estamos arreglando. Aquí el flush es
 * consecuencia de una señal que ya viaja por el único call site que existe.
 *
 * 🔴 EL ORDEN IMPORTA (EC-4, el test que de verdad duele). `AdFeedItem` cierra
 * y ENCOLA su exposición en un `useEffect` que reacciona a `isActive`. Si el
 * flush se colgara de un listener de AppState propio, correría en el MISMO
 * tick que el listener del hook — o sea ANTES de que React re-renderice al
 * hijo y su efecto encole. Se vaciaría una cola vacía y la última exposición
 * (la que el usuario acababa de ver) se perdería. Por eso el flush tiene que
 * ir en un EFECTO que reaccione a la señal ya renderizada: los efectos pasivos
 * de los hijos corren antes que los del padre en el mismo commit.
 * EC-4 monta un hijo con la forma exacta de AdFeedItem y exige que la
 * exposición que ese hijo encola VIAJE en el POST.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { act, render } from '@testing-library/react-native';

// El singleton `ad_impression_queue` resuelve su cliente con un require perezoso
// de '@/lib/supabase/client' al construirse. Se intercepta ahí para que el test
// use la cola REAL (no un doble) y pueda inspeccionar el cuerpo del POST.
const mock_invoke = jest.fn().mockResolvedValue({ data: {}, error: null });
// ⚠️ `invoke` se referencia PEREZOSAMENTE. La fábrica del mock corre al
// importar `adImpressionQueue` (el singleton resuelve su cliente en el import),
// y los `import` se izan por encima de este `const`: pasarle `mock_invoke`
// directo lo dejaría en TDZ, el ReferenceError caería en el try/catch de
// `get_default_supabase` y la cola se quedaría SIN cliente — con los tests
// fallando por la razón equivocada.
jest.mock('@/lib/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mock_invoke(...args) } },
}));

// useFocusEffect controlable: su CLEANUP es el blur del tab (irse a otra
// pestaña sin minimizar la app) — el otro camino real por el que alguien deja
// de ver un anuncio, y que AppState no cubre.
let mock_set_focused: ((v: boolean) => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => (() => void) | void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const react = require('react') as typeof import('react');
    const [focused, set_focused] = react.useState(true);
    mock_set_focused = set_focused;
    react.useEffect(() => {
      if (!focused) return;
      return cb();
    }, [cb, focused]);
  },
}));

import { useFeedActiveIndex } from '../hooks/useFeedActiveIndex';
import { ad_impression_queue } from '../lib/adImpressionQueue';

// 🔴 El singleton `ad_impression_queue` guarda `emitted` a nivel de MÓDULO (es
// su contrato: un par (sesión, anuncio) se emite UNA sola vez, ver REQUISITO 1).
// Ese estado sobrevive entre tests del mismo archivo, así que cada test usa su
// propio par — si no, el segundo test encolaría en una cola que ya lo descartó
// y el RED se leería como GREEN por la razón equivocada.
let current_session = '';
let current_ad = '';
let pair_seq = 0;
const next_pair = () => {
  pair_seq += 1;
  current_session = `aaaaaaaa-aaaa-aaaa-aaaa-${String(pair_seq).padStart(12, '0')}`;
  current_ad = `11111111-1111-1111-1111-${String(pair_seq).padStart(12, '0')}`;
};

// ⚠️ `await act(async …)` en TODO: con React concurrente un act SÍNCRONO no
// aplica el estado ([[rntl14_renderhook_async]]), y los efectos del montaje
// tampoco han corrido justo después de `render` — sin el primer await el
// listener de AppState todavía no está registrado y esto no despertaría a nadie.
async function emit_app_state(next: 'active' | 'background' | 'inactive') {
  await act(async () => {
    const calls = (AppState.addEventListener as unknown as jest.Mock).mock.calls as [
      string,
      (s: string) => void,
    ][];
    for (const [event, handler] of calls) if (event === 'change') handler(next);
  });
}

/**
 * Monta el feed y deja correr los efectos del montaje.
 * ⚠️ `await render(...)`: en RNTL 14 render devuelve una promesa y no
 * esperarla deja un `act()` ABIERTO — a partir de ahí todo act se solapa
 * («overlapping act() calls») y ningún `setState` externo re-renderiza.
 */
async function mount_feed() {
  const view = await render(feed());
  await act(async () => {});
  return view;
}

/** Padre mínimo: el único consumidor real de este hook es FeedScreen. */
function Screen({ children }: { children?: (isActive: boolean) => React.ReactNode }) {
  const { isItemActive } = useFeedActiveIndex();
  return <>{children?.(isItemActive(0))}</>;
}

/** Hijo con la forma EXACTA de AdFeedItem: encola al dejar de estar activo. */
function AdLike({ isActive }: { isActive: boolean }) {
  useEffect(() => {
    if (isActive) return;
    ad_impression_queue.enqueue_impression({
      ad_id: current_ad,
      session_id: current_session,
      shown_at: '2026-08-22T12:00:00.000Z',
      watched_ms: 9000,
      completed: true,
      lat: 20.6597,
      lng: -103.3496,
    });
  }, [isActive]);
  return null;
}

const feed = () => <Screen>{(isActive) => <AdLike isActive={isActive} />}</Screen>;

function body_of(call: unknown[] | undefined) {
  return (call?.[1] as { body?: { impressions?: unknown[] } } | undefined)?.body;
}

describe('#207 — alguien tiene que vaciar la cola de impresiones', () => {
  beforeEach(() => {
    mock_invoke.mockClear();
    next_pair();
    jest.spyOn(AppState, 'addEventListener');
  });
  afterEach(() => jest.restoreAllMocks());

  it('EC-1: montar el feed NO manda nada (no se fabrican POSTs vacíos)', async () => {
    await render(<Screen />);
    expect(mock_invoke).not.toHaveBeenCalled();
  });

  it('EC-2: mandar la app a background dispara el flush', async () => {
    await mount_feed();
    await emit_app_state('background');
    expect(mock_invoke).toHaveBeenCalledWith('record-ad-impressions', expect.anything());
  });

  it('EC-3: volver y minimizar otra vez vuelve a vaciar (no es one-shot)', async () => {
    await mount_feed();
    await emit_app_state('background');
    expect(mock_invoke).toHaveBeenCalledTimes(1);

    // Otro anuncio: el mismo par no se re-encola nunca (REQUISITO 1), así que
    // repetir el ciclo con el mismo id probaría el dedupe, no el flush.
    await emit_app_state('active');
    next_pair();
    await emit_app_state('background');

    expect(mock_invoke).toHaveBeenCalledTimes(2);
  });

  it('EC-5: salir a otra pestaña (blur) también vacía — no solo el background', async () => {
    await mount_feed();
    await act(async () => mock_set_focused?.(false));
    expect(mock_invoke).toHaveBeenCalledWith('record-ad-impressions', expect.anything());
  });

  it('EC-4 🔴: la exposición que el hijo cierra EN ESA MISMA transición viaja en el POST', async () => {
    await mount_feed();
    await emit_app_state('background');

    const body = body_of(mock_invoke.mock.calls[0]);
    expect(body?.impressions).toEqual([
      expect.objectContaining({ ad_id: current_ad, session_id: current_session, watched_ms: 9000 }),
    ]);
  });
});
