/**
 * Tests — appSession (lib pura, CRÍTICA por path mobile/**\/lib/**)
 * Archivo SUT: mobile/src/features/feed/lib/appSession.ts
 * Subtarea Taskmaster: 112.2 — cierre de mutantes vivos M9/M14 (hallazgo guardian)
 *
 * SUT: get_app_session_id(): string
 *
 * Contrato (ver docstring del propio appSession.ts):
 *   - UUID generado UNA vez al cargar el módulo (los módulos ES se evalúan una
 *     sola vez por proceso) — es "uno por apertura de la app".
 *   - Múltiples llamadas dentro de la MISMA carga del módulo devuelven el
 *     MISMO valor (M9: si devolviera un UUID nuevo por llamada, "veces que
 *     volvió a ver" quedaría en basura — siempre contaría como visita nueva).
 *   - El valor sale de Crypto.randomUUID() (expo-crypto), NO es una constante
 *     quemada (M14: si lo fuera, TODAS las sesiones de TODOS los usuarios
 *     compartirían el mismo session_id y el dedupe por sesión se rompería).
 *
 * ⚠️ Bajo jest-expo, Crypto.randomUUID() puede devolver `undefined` (gap
 * confirmado por el guardian en el mock del módulo nativo) — se mockea
 * expo-crypto explícitamente en vez de confiar en el mock por defecto del
 * preset, y se usa jest.resetModules() + require() para forzar una carga
 * fresca del módulo por test (simula "una apertura de la app" por test).
 *
 * EDGE CASES CUBIERTOS:
 * - (EC-1) valor_viene_de_crypto_randomuuid
 * - (EC-2) estable_entre_llamadas_misma_carga_del_modulo (M9)
 * - (EC-3) no_es_constante_quemada_cambia_entre_cargas_del_modulo (M14)
 */

const mock_random_uuid = jest.fn();

jest.mock('expo-crypto', () => ({
  randomUUID: (...args: unknown[]) => mock_random_uuid(...args),
}));

describe('get_app_session_id', () => {

  beforeEach(() => {
    jest.resetModules();
    mock_random_uuid.mockReset();
  });

  it('(EC-1) valor_viene_de_crypto_randomuuid: get_app_session_id() devuelve exactamente lo que retornó Crypto.randomUUID() al cargar el módulo', () => {
    mock_random_uuid.mockReturnValue('11111111-1111-4111-8111-111111111111');

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- carga fresca intencional del módulo (singleton evaluado una vez) para controlar el mock de randomUUID por test.
    const { get_app_session_id } = require('../lib/appSession');

    expect(get_app_session_id()).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('(EC-2) estable_entre_llamadas_misma_carga_del_modulo: 2 llamadas seguidas en la MISMA carga → mismo valor, randomUUID() se invoca UNA sola vez (M9: no se regenera por llamada)', () => {
    mock_random_uuid.mockReturnValue('22222222-2222-4222-8222-222222222222');

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { get_app_session_id } = require('../lib/appSession');

    const first = get_app_session_id();
    const second = get_app_session_id();

    expect(second).toBe(first);
    expect(mock_random_uuid).toHaveBeenCalledTimes(1);
  });

  it('(EC-3) no_es_constante_quemada_cambia_entre_cargas_del_modulo: dos cargas frescas del módulo (simulan 2 aperturas de la app) con randomUUID() distinto → get_app_session_id() distinto en cada una (M14: no es un string hardcodeado)', () => {
    mock_random_uuid.mockReturnValue('33333333-3333-4333-8333-333333333333');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const first_load = require('../lib/appSession');
    const first_value = first_load.get_app_session_id();

    jest.resetModules();
    mock_random_uuid.mockReturnValue('44444444-4444-4444-8444-444444444444');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const second_load = require('../lib/appSession');
    const second_value = second_load.get_app_session_id();

    expect(second_value).not.toBe(first_value);
    expect(second_value).toBe('44444444-4444-4444-8444-444444444444');
  });

});
