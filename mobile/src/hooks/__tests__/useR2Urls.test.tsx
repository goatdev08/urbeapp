/**
 * Tests fase RED — useR2Urls (hooks/useR2Urls.ts)
 * Subtarea Taskmaster: 69.3 — Cliente: avatar de usuario vía R2 presigned
 *
 * SUT: useR2Urls(keys, deps?): { urls: (string | null)[]; loading: boolean }
 *
 * Hook FINO que envuelve `resolve_r2_urls` (lib pura, ver r2Resolver.test.ts)
 * para consumo directo desde componentes (feed overlay, CRM, perfil — el
 * WIRING de esos componentes queda fuera de este RED, es UI/GREEN ligero).
 *
 * Frontera del sistema a mockear: `supabase.functions.invoke` (inyectado vía
 * `deps.supabase`, mismo patrón DI que useUpdateLeadStatus/useAgentStats) —
 * NUNCA se mockea `resolve_r2_urls` en sí (es un colaborador interno propio,
 * no una frontera de confianza): el test verifica el comportamiento
 * observable end-to-end del hook a través del invoke real de la EF.
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - (a) estado_inicial_loading_true_urls_null: con el invoke pendiente (nunca
 *   resuelve en el test), loading es true y urls es un array de null del
 *   mismo tamaño que keys.
 * - (b) tras_resolver_expone_urls_y_loading_false: tras resolver, urls
 *   refleja las urls devueltas y loading pasa a false.
 *
 * ### Ramas no obvias
 * - (c) delega_en_invoke_batch_una_sola_llamada: con varios keys, invoke se
 *   llama UNA sola vez con el lote completo (no una llamada por key) —
 *   prueba que el hook reusa el resolver en lote, no re-implementa lógica.
 * - (d) keys_todas_invalidas_no_invoca_ef: keys=[null,''] → NO invoca la EF,
 *   urls=[null,null], loading termina en false.
 *
 * ### Boundary / error
 * - (e) ef_falla_fail_soft_sin_throw: invoke responde con error → urls=[null],
 *   loading false, el render no lanza (no error boundary disparado).
 * - (f) recalcula_al_cambiar_keys: un rerender con un array de keys distinto
 *   dispara una nueva resolución (nuevo invoke con las keys nuevas).
 */

import { renderHook, act } from '@testing-library/react-native';

import { useR2Urls } from '../useR2Urls';

const mock_invoke = jest.fn();

const mock_supabase = {
  functions: { invoke: mock_invoke },
};

const TEST_KEY_1 = 'avatars/user-1/uuid-1';
const TEST_KEY_2 = 'avatars/user-2/uuid-2';
const TEST_URL_1 = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-1/uuid-1?sig=1';
const TEST_URL_2 = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-2/uuid-2?sig=2';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useR2Urls — hook fino sobre resolve_r2_urls', () => {
  // ── (a) estado inicial ────────────────────────────────────────────────────

  it('(a) estado_inicial_loading_true_urls_null: con el invoke pendiente, loading es true y urls es [null]', async () => {
    const pending = new Promise(() => {
      /* nunca resuelve en este test */
    });
    mock_invoke.mockReturnValue(pending);

    const { result } = await renderHook(() =>
      useR2Urls([TEST_KEY_1], { supabase: mock_supabase }),
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.urls).toEqual([null]);
  });

  // ── (b) tras resolver ──────────────────────────────────────────────────────

  it('(b) tras_resolver_expone_urls_y_loading_false: tras resolver el invoke, urls refleja las urls resueltas y loading es false', async () => {
    mock_invoke.mockResolvedValue({
      data: {
        urls: [
          { key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 },
          { key: TEST_KEY_2, url: TEST_URL_2, expires: 3600 },
        ],
      },
      error: null,
    });

    const { result } = await renderHook(() =>
      useR2Urls([TEST_KEY_1, TEST_KEY_2], { supabase: mock_supabase }),
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.urls).toEqual([TEST_URL_1, TEST_URL_2]);
  });

  // ── (c) batch: una sola llamada para varios keys ─────────────────────────

  it('(c) delega_en_invoke_batch_una_sola_llamada: varios keys generan UN solo invoke con el lote completo', async () => {
    mock_invoke.mockResolvedValue({
      data: {
        urls: [
          { key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 },
          { key: TEST_KEY_2, url: TEST_URL_2, expires: 3600 },
        ],
      },
      error: null,
    });

    await renderHook(() => useR2Urls([TEST_KEY_1, TEST_KEY_2], { supabase: mock_supabase }));

    expect(mock_invoke).toHaveBeenCalledTimes(1);
    const [, options] = mock_invoke.mock.calls[0] as [string, { body: { keys: string[] } }];
    expect(options.body.keys).toEqual([TEST_KEY_1, TEST_KEY_2]);
  });

  // ── (d) keys todas inválidas: sin invoke ─────────────────────────────────

  it('(d) keys_todas_invalidas_no_invoca_ef: keys=[null,""] → NO invoca la EF, urls=[null,null], loading false', async () => {
    const { result } = await renderHook(() =>
      useR2Urls([null, ''], { supabase: mock_supabase }),
    );

    expect(mock_invoke).not.toHaveBeenCalled();
    expect(result.current.urls).toEqual([null, null]);
    expect(result.current.loading).toBe(false);
  });

  // ── (e) la EF falla → fail-soft, sin throw ────────────────────────────────

  it('(e) ef_falla_fail_soft_sin_throw: invoke responde con error → urls=[null], loading false, sin lanzar', async () => {
    mock_invoke.mockResolvedValue({ data: null, error: { message: 'internal error' } });

    let thrown: unknown = null;
    let final_state: { loading: boolean; urls: (string | null)[] } | undefined;
    try {
      const rendered = await renderHook(() =>
        useR2Urls([TEST_KEY_1], { supabase: mock_supabase }),
      );
      final_state = rendered.result.current;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(final_state?.loading).toBe(false);
    expect(final_state?.urls).toEqual([null]);
  });

  // ── (f) recalcula al cambiar las keys ────────────────────────────────────

  it('(f) recalcula_al_cambiar_keys: un rerender con keys distintas dispara un nuevo invoke con el lote nuevo', async () => {
    mock_invoke.mockResolvedValue({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });

    const { result, rerender } = await renderHook(
      ({ keys }: { keys: (string | null)[] }) => useR2Urls(keys, { supabase: mock_supabase }),
      { initialProps: { keys: [TEST_KEY_1] } },
    );

    expect(result.current.urls).toEqual([TEST_URL_1]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);

    mock_invoke.mockResolvedValue({
      data: { urls: [{ key: TEST_KEY_2, url: TEST_URL_2, expires: 3600 }] },
      error: null,
    });

    await act(async () => {
      rerender({ keys: [TEST_KEY_2] });
    });

    expect(mock_invoke).toHaveBeenCalledTimes(2);
    const [, second_call_options] = mock_invoke.mock.calls[1] as [
      string,
      { body: { keys: string[] } },
    ];
    expect(second_call_options.body.keys).toEqual([TEST_KEY_2]);
    expect(result.current.urls).toEqual([TEST_URL_2]);
  });
});
