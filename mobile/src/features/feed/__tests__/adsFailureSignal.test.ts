/**
 * RED — tarea #196: el fail-soft de anuncios debe dejar RASTRO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * EL PROBLEMA (guardián del GREEN de 170.4): los dos `catch` de
 * useFeedProperties degradan a feed-sin-anuncios ante cualquier fallo de
 * `ads_feed_config` o `ads_for_zone`. Hacia el usuario está bien y es lo
 * pedido. El problema es del otro lado: desde el negocio, "la RPC lleva tres
 * días fallando y no se sirve un solo anuncio" se ve EXACTAMENTE IGUAL que
 * "no hay inventario contratado en esa zona". Con facturación por impresión,
 * eso cuesta dinero durante días sin que nadie se entere.
 *
 * Degradar en silencio hacia el USUARIO y degradar en silencio hacia el
 * OPERADOR son dos decisiones distintas, y en 170.4 se tomaron juntas sin
 * querer. El fail-soft NO se toca; lo que falta es la señal.
 *
 * DECISIÓN (Abraham, 2026-08-20): un evento `ads_fetch_failed` en
 * `events_raw` — la única infraestructura de telemetría que existe en la app
 * (no hay Sentry ni analytics), y acepta `event_type` libre + payload jsonb,
 * así que no hace falta ninguna migración.
 *
 * SEAM: `report_ads_failure` y el store de dedupe. Se observa QUÉ se escribe
 * en events_raw y CUÁNTAS veces; nunca internals.
 *
 * ── Edge cases enumerados ───────────────────────────────────────────────────
 *  EC-1  Escribe una fila en events_raw con event_type 'ads_fetch_failed',
 *        el user_id de la sesión, el session_id y payload {stage}.
 *  EC-2  🔒 PRIVACIDAD: la fila NO lleva property_id, ni coordenadas, ni
 *        ad_id, ni nada que describa a la persona más allá de a quién le
 *        falló. Assert sobre el conjunto EXACTO de claves — un campo de más
 *        rompe el test a propósito.
 *  EC-3  Dedupe por (session_id, stage): dos fallos del mismo tramo en la
 *        misma sesión escriben UNA sola fila (el feed pagina; sin dedupe una
 *        caída generaría una fila por scroll).
 *  EC-4  Stages distintos en la misma sesión sí escriben una fila cada uno.
 *  EC-5  Sesión distinta vuelve a escribir (es el insumo de "cuántas sesiones
 *        se vieron afectadas").
 *  EC-6  Sin sesión de usuario: no escribe y no lanza (la policy de INSERT de
 *        events_raw exige user_id = auth.uid(); sin usuario no hay fila
 *        posible).
 *  EC-7  Cliente sin `.auth` (mocks legados): no lanza.
 *  EC-8  🔴 FIRE-AND-FORGET: si el propio INSERT falla, NO propaga. La
 *        telemetría del fallo no puede tener el mismo modo de fallo que lo
 *        que reporta.
 *  EC-9  Si `auth.getSession()` rechaza, tampoco propaga.
 *  EC-10 Un fallo del reporte NO marca el dedupe: el siguiente intento en la
 *        misma sesión vuelve a intentarlo (si marcara, un error transitorio
 *        silenciaría la señal por el resto de la sesión).
 * ════════════════════════════════════════════════════════════════════════════
 */

import {
  ADS_FETCH_FAILED_EVENT_TYPE,
  create_ads_failure_store,
  report_ads_failure,
} from '../lib/adsFailureSignal';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function make_client(overrides: { insert?: jest.Mock; session?: unknown; get_session?: jest.Mock } = {}) {
  const insert = overrides.insert ?? jest.fn().mockResolvedValue({ error: null });
  // `'session' in overrides` y no `??`: con nullish coalescing, pasar
  // `session: null` (el caso EC-6, "sin sesión") caería al default y el test
  // no probaría nada.
  const session = 'session' in overrides ? overrides.session : { user: { id: USER_ID } };
  const get_session =
    overrides.get_session ?? jest.fn().mockResolvedValue({ data: { session }, error: null });
  return {
    client: {
      auth: { getSession: get_session },
      from: jest.fn().mockReturnValue({ insert }),
    },
    insert,
    get_session,
  };
}

describe('report_ads_failure — qué se escribe', () => {
  it('(EC-1) escribe una fila en events_raw con el tipo, el usuario, la sesión y el tramo que falló', async () => {
    const { client, insert } = make_client();

    await report_ads_failure({
      client,
      session_id: SESSION_A,
      stage: 'zone',
      store: create_ads_failure_store(),
    });

    expect(client.from).toHaveBeenCalledWith('events_raw');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      event_type: ADS_FETCH_FAILED_EVENT_TYPE,
      user_id: USER_ID,
      session_id: SESSION_A,
      payload: { stage: 'zone' },
    });
  });

  it("(EC-1b) el literal del tipo de evento es exactamente 'ads_fetch_failed'", () => {
    expect(ADS_FETCH_FAILED_EVENT_TYPE).toBe('ads_fetch_failed');
  });

  it('(EC-2) 🔒 la fila NO lleva property_id, coordenadas ni ad_id — solo las 4 claves acordadas', async () => {
    const { client, insert } = make_client();

    await report_ads_failure({
      client,
      session_id: SESSION_A,
      stage: 'config',
      store: create_ads_failure_store(),
    });

    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['event_type', 'payload', 'session_id', 'user_id']);
    expect(Object.keys(row.payload as Record<string, unknown>)).toEqual(['stage']);
  });
});

describe('report_ads_failure — dedupe por (sesión, tramo)', () => {
  it('(EC-3) dos fallos del mismo tramo en la misma sesión escriben UNA sola fila', async () => {
    const { client, insert } = make_client();
    const store = create_ads_failure_store();

    await report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store });
    await report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store });
    await report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store });

    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('(EC-4) tramos distintos en la misma sesión escriben una fila cada uno', async () => {
    const { client, insert } = make_client();
    const store = create_ads_failure_store();

    await report_ads_failure({ client, session_id: SESSION_A, stage: 'config', store });
    await report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store });

    expect(insert).toHaveBeenCalledTimes(2);
    const stages = insert.mock.calls.map((c) => (c[0] as { payload: { stage: string } }).payload.stage);
    expect(stages.sort()).toEqual(['config', 'zone']);
  });

  it('(EC-5) una sesión distinta vuelve a escribir', async () => {
    const { client, insert } = make_client();
    const store = create_ads_failure_store();

    await report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store });
    await report_ads_failure({ client, session_id: SESSION_B, stage: 'zone', store });

    expect(insert).toHaveBeenCalledTimes(2);
  });
});

describe('report_ads_failure — 🔴 no puede tumbar el feed', () => {
  it('(EC-6) sin sesión de usuario no escribe y no lanza', async () => {
    const { client, insert } = make_client({ session: null });

    await expect(
      report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store: create_ads_failure_store() }),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it('(EC-7) un cliente sin `.auth` (mock legado) no lanza', async () => {
    const client = { from: jest.fn() } as unknown as Parameters<typeof report_ads_failure>[0]['client'];

    await expect(
      report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store: create_ads_failure_store() }),
    ).resolves.toBeUndefined();
  });

  it('(EC-8) si el INSERT rechaza, el error NO propaga', async () => {
    const insert = jest.fn().mockRejectedValue(new Error('offline'));
    const { client } = make_client({ insert });

    await expect(
      report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store: create_ads_failure_store() }),
    ).resolves.toBeUndefined();
  });

  it('(EC-9) si auth.getSession() rechaza, el error NO propaga', async () => {
    const get_session = jest.fn().mockRejectedValue(new Error('storage corrupto'));
    const { client, insert } = make_client({ get_session });

    await expect(
      report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store: create_ads_failure_store() }),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it('(EC-10) un reporte fallido NO consume el dedupe: el siguiente intento vuelve a intentarlo', async () => {
    const insert = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ error: null });
    const { client } = make_client({ insert });
    const store = create_ads_failure_store();

    await report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store });
    await report_ads_failure({ client, session_id: SESSION_A, stage: 'zone', store });

    expect(insert).toHaveBeenCalledTimes(2);
  });
});
