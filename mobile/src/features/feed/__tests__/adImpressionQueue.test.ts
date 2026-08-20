/**
 * RED — subtarea 170.7: adImpressionQueue.ts (batch + dedupe bajo loop).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA TRAMPA EXACTA DE #112: el feed reproduce EN LOOP, así que el fin de
 * reproducción se dispara muchas veces por UNA sola exposición. Sin dedupe, un
 * anuncio olvidado en pantalla generaría cientos de filas facturables.
 *
 * 🔴 DOS REQUISITOS DUROS que 170.6 le impone a esta subtarea. No son
 * sugerencias: el servidor YA se comporta así y no va a cambiar.
 *
 * REQUISITO 1 — UNA exposición se emite UNA SOLA VEZ, y solo cuando su
 * `watched_ms` es DEFINITIVO. El writer de la EF usa `ON CONFLICT DO NOTHING`,
 * así que el contrato real es «GANA LA PRIMERA ESCRITURA» — lo contrario de lo
 * que casi cualquiera asume al leer la palabra *upsert*. Si un
 * (session_id, ad_id) se emite dos veces, el segundo valor SE DESCARTA EN
 * SILENCIO: sin error y sin contador. La fila queda con el tiempo parcial y
 * `viewed` puede quedar en false para una exposición que SÍ superó los 3 s.
 *
 * ⇒ El dedupe GATEA LA EMISIÓN, no solo la identidad de la fila. Y como la
 *   emisión ocurre únicamente al TERMINAR la exposición, la cola nunca llega a
 *   contener un watched_ms parcial — con lo que el flush por tamaño deja de
 *   ser peligroso. Esa era la ambigüedad que el guardián marcó en el plan.
 *
 * REQUISITO 2 — el tap al CTA NUNCA puede viajar en un POST ANTERIOR al de su
 * impresión. `record_cta_tap` es un UPDATE, no un upsert (a propósito: su
 * firma acotada impide que toque watched_ms/viewed/completed). Un tap que
 * llega antes no matchea ninguna fila y se pierde — y el CTA es lo que se
 * factura por clic, o sea el evento más caro del sistema.
 * El handler procesa upsert_impressions ANTES que record_cta_tap, así que van
 * bien en el MISMO POST. Lo prohibido es un POST de taps que adelante al de
 * su impresión. Ver #198 (la señal server-side para lo que ni el cliente
 * puede garantizar).
 *
 * CONTRATO YA CERRADO EN 170.6 que esta cola consume (#193):
 *   · El cliente NO manda `id` ni `user_id` — el servidor deriva
 *     id = uuid_v5(ns, "user_id:ad_id:session_id").
 *   · El cliente NO declara zona: manda coordenadas y el servidor resuelve.
 *   · `viewed` lo deriva el servidor (umbral 3 s); lo que mande el cliente se
 *     ignora.
 *
 * OFFLINE: el batch se PIERDE sin romper la reproducción. Sin cola
 * persistente. Subcontar es el error correcto.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { create_ad_impression_queue, AD_IMPRESSION_BATCH_SIZE } from '../lib/adImpressionQueue';

const SESSION_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const AD_1 = '11111111-1111-1111-1111-111111111111';
const AD_2 = '22222222-2222-2222-2222-222222222222';

function make_exposure(overrides: Partial<Parameters<ReturnType<typeof create_ad_impression_queue>['enqueue_impression']>[0]> = {}) {
  return {
    ad_id: AD_1,
    session_id: SESSION_A,
    shown_at: '2026-08-20T12:00:00.000Z',
    watched_ms: 9000,
    completed: true,
    lat: 20.6597,
    lng: -103.3496,
    device: 'android',
    ...overrides,
  };
}

function make_queue(opts: { invoke?: jest.Mock } = {}) {
  const invoke = opts.invoke ?? jest.fn().mockResolvedValue({ data: {}, error: null });
  const supabase = { functions: { invoke } };
  const queue = create_ad_impression_queue({ supabase });
  return { queue, invoke };
}

/** Cuerpos de cada POST a la EF, en orden. */
function bodies(invoke: jest.Mock): { impressions: unknown[]; cta_taps: unknown[] }[] {
  return invoke.mock.calls.map((c) => (c[1] as { body: { impressions: unknown[]; cta_taps: unknown[] } }).body);
}

// ───────────────────────────────────────────────────────────────────────────
describe('adImpressionQueue — qué se manda', () => {
  it('(EC-1) una exposición produce un ítem con el shape que la EF espera', async () => {
    const { queue, invoke } = make_queue();
    queue.enqueue_impression(make_exposure());
    await queue.flush();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe('record-ad-impressions');
    expect(bodies(invoke)[0].impressions).toEqual([
      {
        ad_id: AD_1,
        session_id: SESSION_A,
        shown_at: '2026-08-20T12:00:00.000Z',
        watched_ms: 9000,
        completed: true,
        lat: 20.6597,
        lng: -103.3496,
        device: 'android',
      },
    ]);
  });

  it('(EC-2) 🔒 NUNCA manda id, user_id, viewed ni zona — el servidor los deriva (#193)', async () => {
    const { queue, invoke } = make_queue();
    queue.enqueue_impression(make_exposure());
    await queue.flush();

    const item = bodies(invoke)[0].impressions[0] as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(
      ['ad_id', 'completed', 'device', 'lat', 'lng', 'session_id', 'shown_at', 'watched_ms'].sort(),
    );
    for (const forbidden of ['id', 'user_id', 'viewed', 'municipality_id', 'neighborhood_id']) {
      expect(item).not.toHaveProperty(forbidden);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('adImpressionQueue — 🔴 REQUISITO 1: una exposición, un solo envío', () => {
  it('(EC-3) el LOOP del feed: 20 encolados del mismo par producen UN solo ítem', async () => {
    const { queue, invoke } = make_queue();
    for (let i = 0; i < 20; i += 1) queue.enqueue_impression(make_exposure());
    await queue.flush();

    const all = bodies(invoke).flatMap((b) => b.impressions);
    expect(all).toHaveLength(1);
  });

  it('(EC-4) 🔴 el dedupe SOBREVIVE a los flushes: reencolar tras enviar no produce un 2º envío', async () => {
    const { queue, invoke } = make_queue();
    queue.enqueue_impression(make_exposure({ watched_ms: 3000 }));
    await queue.flush();
    queue.enqueue_impression(make_exposure({ watched_ms: 30000 }));
    await queue.flush();

    const all = bodies(invoke).flatMap((b) => b.impressions);
    expect(all).toHaveLength(1);
    // Y es el PRIMER valor, igual que "gana la primera escritura" del servidor:
    // cliente y base concuerdan en qué fila existe.
    expect((all[0] as { watched_ms: number }).watched_ms).toBe(3000);
  });

  it('(EC-5) un ad_id DISTINTO en la misma sesión sí se emite', async () => {
    const { queue, invoke } = make_queue();
    queue.enqueue_impression(make_exposure({ ad_id: AD_1 }));
    queue.enqueue_impression(make_exposure({ ad_id: AD_2 }));
    await queue.flush();

    expect(bodies(invoke)[0].impressions).toHaveLength(2);
  });

  it('(EC-6) una sesión DISTINTA sí vuelve a emitir el mismo anuncio', async () => {
    const { queue, invoke } = make_queue();
    queue.enqueue_impression(make_exposure({ session_id: SESSION_A }));
    queue.enqueue_impression(make_exposure({ session_id: SESSION_B }));
    await queue.flush();

    expect(bodies(invoke)[0].impressions).toHaveLength(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('adImpressionQueue — flush', () => {
  it('(EC-7) llegar a AD_IMPRESSION_BATCH_SIZE dispara el envío solo', async () => {
    const { queue, invoke } = make_queue();
    for (let i = 0; i < AD_IMPRESSION_BATCH_SIZE; i += 1) {
      queue.enqueue_impression(make_exposure({ ad_id: `0000000${i}-1111-1111-1111-111111111111` }));
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(bodies(invoke)[0].impressions).toHaveLength(AD_IMPRESSION_BATCH_SIZE);
  });

  it('(EC-8) flush() con la cola vacía NO llama a la EF', async () => {
    const { queue, invoke } = make_queue();
    await queue.flush();
    expect(invoke).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('adImpressionQueue — 🔴 REQUISITO 2: el tap nunca adelanta a su impresión', () => {
  it('(EC-9) un tap cuya impresión está en la cola viaja en el MISMO POST', async () => {
    const { queue, invoke } = make_queue();
    queue.enqueue_impression(make_exposure());
    queue.report_cta_tap({ ad_id: AD_1, session_id: SESSION_A, cta_tapped_at: '2026-08-20T12:00:05.000Z' });
    await queue.flush();

    expect(invoke).toHaveBeenCalledTimes(1);
    const body = bodies(invoke)[0];
    expect(body.impressions).toHaveLength(1);
    expect(body.cta_taps).toEqual([
      { ad_id: AD_1, session_id: SESSION_A, cta_tapped_at: '2026-08-20T12:00:05.000Z' },
    ]);
  });

  it('(EC-10) 🔴 un tap SIN impresión encolada NO viaja — se queda esperando', async () => {
    const { queue, invoke } = make_queue();
    // La persona toca el CTA mientras el anuncio TODAVÍA se reproduce: la
    // exposición aún no terminó, así que su impresión no está encolada.
    queue.report_cta_tap({ ad_id: AD_1, session_id: SESSION_A, cta_tapped_at: '2026-08-20T12:00:05.000Z' });
    await queue.flush();

    expect(invoke).not.toHaveBeenCalled();
  });

  it('(EC-11) ese tap parqueado viaja en el flush siguiente, junto con su impresión', async () => {
    const { queue, invoke } = make_queue();
    queue.report_cta_tap({ ad_id: AD_1, session_id: SESSION_A, cta_tapped_at: '2026-08-20T12:00:05.000Z' });
    await queue.flush();
    queue.enqueue_impression(make_exposure());
    await queue.flush();

    expect(invoke).toHaveBeenCalledTimes(1);
    const body = bodies(invoke)[0];
    expect(body.impressions).toHaveLength(1);
    expect(body.cta_taps).toHaveLength(1);
  });

  it('(EC-12) un tap cuya impresión YA se envió antes sí puede viajar solo', async () => {
    const { queue, invoke } = make_queue();
    queue.enqueue_impression(make_exposure());
    await queue.flush();
    queue.report_cta_tap({ ad_id: AD_1, session_id: SESSION_A, cta_tapped_at: '2026-08-20T12:00:09.000Z' });
    await queue.flush();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(bodies(invoke)[1].impressions).toHaveLength(0);
    expect(bodies(invoke)[1].cta_taps).toHaveLength(1);
  });

  it('(EC-13) doble tap del mismo par produce UN solo tap', async () => {
    const { queue, invoke } = make_queue();
    queue.enqueue_impression(make_exposure());
    queue.report_cta_tap({ ad_id: AD_1, session_id: SESSION_A, cta_tapped_at: '2026-08-20T12:00:05.000Z' });
    queue.report_cta_tap({ ad_id: AD_1, session_id: SESSION_A, cta_tapped_at: '2026-08-20T12:00:06.000Z' });
    await queue.flush();

    expect(bodies(invoke)[0].cta_taps).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('adImpressionQueue — offline: pierde el batch, nunca la reproducción', () => {
  it('(EC-14) si el invoke RECHAZA, flush() no lanza', async () => {
    const invoke = jest.fn().mockRejectedValue(new Error('offline'));
    const { queue } = make_queue({ invoke });
    queue.enqueue_impression(make_exposure());

    await expect(queue.flush()).resolves.toBeUndefined();
  });

  it('(EC-15) si el invoke devuelve error, flush() tampoco lanza', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { queue } = make_queue({ invoke });
    queue.enqueue_impression(make_exposure());

    await expect(queue.flush()).resolves.toBeUndefined();
  });

  it('(EC-16) el batch perdido NO se reencola — subcontar es el error correcto, duplicar no', async () => {
    const invoke = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: {}, error: null });
    const { queue } = make_queue({ invoke });
    queue.enqueue_impression(make_exposure());
    await queue.flush();
    await queue.flush();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('(EC-17) sin cliente supabase inyectado y sin singleton disponible, no lanza', async () => {
    const queue = create_ad_impression_queue({ supabase: undefined as never });
    queue.enqueue_impression(make_exposure());
    await expect(queue.flush()).resolves.toBeUndefined();
  });
});
