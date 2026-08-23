/**
 * Tests fase RED — useModerateAd (acción de moderación del admin, tarea 208)
 * Archivos SUT: mobile/src/features/ads/hooks/useModerateAd.ts
 *               mobile/src/features/ads/ad_moderation_error_messages.ts
 * Subtarea Taskmaster: 208.2
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — calca
 * useUpdateLeadStatus (75.6), el hook de mutación por EF más maduro del repo):
 *
 *   useModerateAd(deps?: { supabase?: unknown; onSuccess?: () => void }): {
 *     approve(ad_id: string): Promise<ModerateResult>;
 *     reject(ad_id: string, rejection_reason: string): Promise<ModerateResult>;
 *     is_moderating: boolean;
 *     error: string | null;
 *   }
 *
 *   ModerateResult = { ok: boolean; error: string | null }
 *
 * CÓDIGOS DE ERROR DE LA EF — leídos de supabase/functions/moderate-ad/
 * {handler,types}.ts, NO asumidos:
 *   INVALID_INPUT (400) | REJECTION_REASON_REQUIRED (400) |
 *   METHOD_NOT_ALLOWED (405) | UNAUTHENTICATED (401) | FORBIDDEN (403) |
 *   AD_NOT_FOUND (404) | INVALID_AD_STATUS_TRANSITION (409) |
 *   ORGANIZATION_SUSPENDED (409) | DB_ERROR (500)
 *
 * Respuesta de éxito: 200 { status: 'active' | 'rejected' }.
 *
 * 🔴 REGLA DE #200 — EL MENSAJE NUNCA SALE DE error.message. `FunctionsHttpError.
 * message` es SIEMPRE el literal en inglés 'Edge Function returned a non-2xx
 * status code' (node_modules/@supabase/functions-js/src/types.ts:91), idéntico
 * para los 9 códigos: mostrarlo es enseñarle inglés genérico al admin en los 9
 * casos. El código real vive en el CUERPO de la respuesta y solo lo saca
 * `extract_error_code` (mobile/src/lib/supabase/edge-errors.ts, ya reusado por
 * 10 archivos). Ese colaborador NO se mockea: se ejercita con
 * FunctionsHttpError REALES construidos aquí (mismo patrón que
 * useUpdateLeadStatus.test.ts y auth/__tests__/api.test.ts).
 *
 * 🔴 REGLA DE #205 — NO DESPRENDER `client.functions.invoke` DEL CLIENTE.
 * `const { invoke } = client.functions` pierde el `this` y falla MUDO en
 * producción, con la suite en verde si el mock es un objeto plano (nota
 * `supabase_js_metodo_desprendido`). EC-20 lo caza: el mock verifica que
 * `this` sea el objeto `functions`, y una implementación que desprenda el
 * método reprueba.
 *
 * 🔴 EL CHECK BIDIRECCIONAL DE LA BASE MANDA EN EL PAYLOAD.
 * `ads_rejection_reason_matches_status` exige `(status='rejected') ===
 * (rejection_reason is not null)`. Consecuencias verificables aquí:
 *   - aprobar NO puede mandar `rejection_reason` (EC-4);
 *   - rechazar SIEMPRE lo manda (EC-5);
 *   - rechazar con motivo vacío o en blanco ni siquiera sale a la red (EC-6/EC-7):
 *     el viaje terminaría en 400 REJECTION_REASON_REQUIRED, y el admin merece
 *     el aviso inmediato. El guard local NO sustituye al de la EF — lo duplica
 *     a propósito en el lado barato.
 *
 * GOTCHAS RNTL ya pagados: `act()` async con `await`; `is_moderating` se lee
 * SÍNCRONAMENTE en el mismo tick en que arranca la acción (patrón
 * is_working_ref + force_update de usePropertyActions/useUpdateLeadStatus), por
 * eso EC-16 no usa `await` antes de la primera aserción.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path e invocación
 * - (EC-1) approve_invoca_la_ef_moderate_ad_y_devuelve_ok
 * - (EC-2) reject_invoca_la_ef_moderate_ad_y_devuelve_ok
 * - (EC-3) invoca_el_nombre_exacto_de_la_ef_moderate_ad
 *
 * ### 🔴 Payload gobernado por el CHECK bidireccional
 * - (EC-4) approve_no_manda_rejection_reason_en_el_body
 * - (EC-5) reject_manda_el_motivo_en_el_body
 * - (EC-6) reject_con_motivo_vacio_no_invoca_la_ef_y_devuelve_error
 * - (EC-7) reject_con_motivo_solo_espacios_no_invoca_la_ef
 * - (EC-8) reject_recorta_espacios_del_motivo_antes_de_mandarlo
 *
 * ### 🔴 Traducción de códigos — ninguno cae en inglés crudo (#200)
 * - (EC-9)  cada_codigo_tipado_produce_su_mensaje_en_espanol
 * - (EC-10) ningun_codigo_deja_ver_el_literal_en_ingles_de_supabase_js
 * - (EC-11) codigo_desconocido_cae_a_mensaje_neutro_no_al_codigo_crudo
 * - (EC-12) transicion_invalida_no_filtra_plpgsql_ni_nombres_de_trigger
 *
 * ### Fallo de red
 * - (EC-13) invoke_rechazado_devuelve_mensaje_neutro_sin_lanzar
 * - (EC-14) fallo_de_red_no_expone_el_texto_del_error_original
 *
 * ### onSuccess
 * - (EC-15) on_success_se_llama_solo_en_exito
 *
 * ### Estado
 * - (EC-16) is_moderating_true_sincronamente_al_disparar
 * - (EC-17) is_moderating_false_tras_exito
 * - (EC-18) is_moderating_false_tras_error
 * - (EC-19) error_expuesto_tras_fallo_y_limpiado_en_el_siguiente_exito
 *
 * ### 🔴 Integridad del cliente supabase-js
 * - (EC-20) no_desprende_functions_invoke_del_cliente
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { renderHook, act } from '@testing-library/react-native';

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(() => ({ user: { id: 'admin-uuid-208' } })),
}));

import { useModerateAd, type ModerateResult } from '../hooks/useModerateAd';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TEST_AD_ID = 'ad-uuid-a-moderar-208';
const REASON = 'El video muestra un inmueble que no corresponde al anunciante.';

/**
 * Literal EXACTO de @supabase/functions-js (FunctionsHttpError) — fuente
 * independiente del SUT, ver node_modules/@supabase/functions-js/src/types.ts:91.
 * Si este mensaje aparece en la UI, el defecto de #200 volvió.
 */
const RAW_SUPABASE_JS_MESSAGE = 'Edge Function returned a non-2xx status code';

/** Los 9 códigos que la EF moderate-ad puede emitir (handler.ts verificado). */
const ALL_CODES = [
  'INVALID_INPUT',
  'REJECTION_REASON_REQUIRED',
  'METHOD_NOT_ALLOWED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'AD_NOT_FOUND',
  'INVALID_AD_STATUS_TRANSITION',
  'ORGANIZATION_SUSPENDED',
  'DB_ERROR',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** FunctionsHttpError REAL con el cuerpo {error:{code,message}} que emite la EF. */
function make_http_error(code: string, status = 400, message = 'mensaje interno de la EF') {
  return new FunctionsHttpError(
    new Response(JSON.stringify({ error: { code, message } }), { status }),
  );
}

type InvokeResult = { data: unknown; error: unknown | null };
type InvokeCall = { name: string; options: { body?: Record<string, unknown> } };

/**
 * Mock del cliente. `functions.invoke` verifica su propio `this`: si el hook
 * desprende el método del objeto (`const {invoke} = client.functions`), `this`
 * deja de ser `functions` y la llamada se marca como desprendida — EC-20.
 */
function make_client(behavior: () => Promise<InvokeResult>) {
  const calls: InvokeCall[] = [];
  let detached = false;

  const functions = {
    invoke(this: unknown, name: string, options: { body?: Record<string, unknown> } = {}) {
      if (this !== functions) detached = true;
      calls.push({ name, options });
      return behavior();
    },
  };

  return {
    client: { functions },
    calls,
    was_detached: () => detached,
  };
}

const ok_invoke = (): Promise<InvokeResult> =>
  Promise.resolve({ data: { status: 'active' }, error: null });

const failing_invoke = (code: string, status = 400) => (): Promise<InvokeResult> =>
  Promise.resolve({ data: null, error: make_http_error(code, status) });

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Happy path e invocación
// ---------------------------------------------------------------------------

describe('useModerateAd — happy path', () => {
  it('EC-1 approve invoca la EF y devuelve ok', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let res!: ModerateResult;
    await act(async () => {
      res = await result.current.approve(TEST_AD_ID);
    });

    expect(res.ok).toBe(true);
    expect(res.error).toBeNull();
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.options.body).toMatchObject({ ad_id: TEST_AD_ID, action: 'approve' });
  });

  it('EC-2 reject invoca la EF y devuelve ok', async () => {
    const mock = make_client(() => Promise.resolve({ data: { status: 'rejected' }, error: null }));
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let res!: ModerateResult;
    await act(async () => {
      res = await result.current.reject(TEST_AD_ID, REASON);
    });

    expect(res.ok).toBe(true);
    expect(res.error).toBeNull();
    expect(mock.calls[0]?.options.body).toMatchObject({ ad_id: TEST_AD_ID, action: 'reject' });
  });

  it('EC-3 invoca el nombre exacto de la EF: moderate-ad', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    await act(async () => {
      await result.current.approve(TEST_AD_ID);
    });

    expect(mock.calls[0]?.name).toBe('moderate-ad');
  });
});

// ---------------------------------------------------------------------------
// 🔴 Payload gobernado por el CHECK bidireccional de la base
// ---------------------------------------------------------------------------

describe('useModerateAd — 🔴 payload y el CHECK ads_rejection_reason_matches_status', () => {
  it('EC-4 approve NO manda rejection_reason en el body', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    await act(async () => {
      await result.current.approve(TEST_AD_ID);
    });

    // Sin este guard, un stub que NO invoca deja body={} y hasOwnProperty=false:
    // el caso pasaría sin que la EF se llamara nunca.
    expect(mock.calls).toHaveLength(1);
    const body = mock.calls[0]?.options.body ?? {};
    expect(Object.prototype.hasOwnProperty.call(body, 'rejection_reason')).toBe(false);
  });

  it('EC-5 reject SIEMPRE manda el motivo en el body', async () => {
    const mock = make_client(() => Promise.resolve({ data: { status: 'rejected' }, error: null }));
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    await act(async () => {
      await result.current.reject(TEST_AD_ID, REASON);
    });

    expect(mock.calls[0]?.options.body?.rejection_reason).toBe(REASON);
  });

  it('EC-6 reject con motivo vacío NO invoca la EF y devuelve error', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let res!: ModerateResult;
    await act(async () => {
      res = await result.current.reject(TEST_AD_ID, '');
    });

    expect(mock.calls).toHaveLength(0);
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe('string');
    expect((res.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-7 reject con motivo de solo espacios NO invoca la EF', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let res!: ModerateResult;
    await act(async () => {
      res = await result.current.reject(TEST_AD_ID, '   \n\t  ');
    });

    expect(mock.calls).toHaveLength(0);
    expect(res.ok).toBe(false);
    // Un stub que nunca invoca nada también deja calls en 0: hace falta exigir
    // el mensaje Y demostrar que un motivo VÁLIDO sí sale a la red.
    expect((res.error ?? '').length).toBeGreaterThan(0);

    await act(async () => {
      await result.current.reject(TEST_AD_ID, REASON);
    });
    expect(mock.calls).toHaveLength(1);
  });

  it('EC-8 reject recorta los espacios del motivo antes de mandarlo', async () => {
    const mock = make_client(() => Promise.resolve({ data: { status: 'rejected' }, error: null }));
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    await act(async () => {
      await result.current.reject(TEST_AD_ID, `   ${REASON}   `);
    });

    expect(mock.calls[0]?.options.body?.rejection_reason).toBe(REASON);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Traducción de códigos — la regla de #200
// ---------------------------------------------------------------------------

describe('useModerateAd — 🔴 traducción de códigos tipados (#200)', () => {
  it('EC-9 cada código tipado produce un mensaje en español distinguible', async () => {
    const messages: string[] = [];

    for (const code of ALL_CODES) {
      const mock = make_client(failing_invoke(code));
      const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

      let res!: ModerateResult;
      await act(async () => {
        res = await result.current.approve(TEST_AD_ID);
      });

      expect(res.ok).toBe(false);
      expect(typeof res.error).toBe('string');
      expect((res.error ?? '').length).toBeGreaterThan(0);
      messages.push(res.error ?? '');
    }

    // Un mapa que devolviera el mismo texto para los 9 códigos "traduce" sin
    // informar. Al menos los casos que el admin puede accionar deben diferir.
    expect(new Set(messages).size).toBeGreaterThan(1);
  });

  it('EC-10 ningún código deja ver el literal en inglés de supabase-js', async () => {
    for (const code of ALL_CODES) {
      const mock = make_client(failing_invoke(code));
      const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

      let res!: ModerateResult;
      await act(async () => {
        res = await result.current.approve(TEST_AD_ID);
      });

      expect(res.error).not.toContain(RAW_SUPABASE_JS_MESSAGE);
      expect(res.error).not.toContain('non-2xx');
      expect(res.error).not.toContain('Edge Function');
    }
  });

  it('EC-11 un código desconocido cae a un mensaje neutro, no al código crudo', async () => {
    const mock = make_client(failing_invoke('ALGUN_CODIGO_FUTURO_NO_MAPEADO'));
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let res!: ModerateResult;
    await act(async () => {
      res = await result.current.approve(TEST_AD_ID);
    });

    expect(res.ok).toBe(false);
    expect(res.error).not.toContain('ALGUN_CODIGO_FUTURO_NO_MAPEADO');
    expect((res.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-12 INVALID_AD_STATUS_TRANSITION no filtra PL/pgSQL ni nombres de trigger', async () => {
    // Espejo en el cliente de la aserción EC-15 del RED de 208.1: la fuga de
    // internals de Postgres se corta en la EF, y tampoco se reintroduce aquí.
    const mock = make_client(failing_invoke('INVALID_AD_STATUS_TRANSITION', 409));
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let res!: ModerateResult;
    await act(async () => {
      res = await result.current.approve(TEST_AD_ID);
    });

    expect(res.error).not.toContain('PL/pgSQL');
    expect(res.error).not.toContain('handle_ad_status_change');
    expect(res.error).not.toContain('P0001');
    expect(res.error).not.toContain('INVALID_AD_STATUS_TRANSITION');
  });
});

// ---------------------------------------------------------------------------
// Fallo de red
// ---------------------------------------------------------------------------

describe('useModerateAd — fallo de red', () => {
  it('EC-13 invoke rechazado devuelve mensaje neutro sin lanzar', async () => {
    const mock = make_client(() => Promise.reject(new Error('Network request failed')));
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let res!: ModerateResult;
    let threw: unknown = null;
    await act(async () => {
      try {
        res = await result.current.approve(TEST_AD_ID);
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(res.ok).toBe(false);
    expect((res.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-14 un fallo de red no expone el texto del error original', async () => {
    const mock = make_client(() => Promise.reject(new Error('Network request failed')));
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let res!: ModerateResult;
    await act(async () => {
      res = await result.current.approve(TEST_AD_ID);
    });

    expect(res.error).not.toContain('Network request failed');
  });
});

// ---------------------------------------------------------------------------
// onSuccess
// ---------------------------------------------------------------------------

describe('useModerateAd — onSuccess', () => {
  it('EC-15 onSuccess se llama solo en éxito', async () => {
    const on_success = jest.fn();

    const ok_mock = make_client(ok_invoke);
    const { result: ok_result } = await renderHook(() =>
      useModerateAd({ supabase: ok_mock.client, onSuccess: on_success }),
    );
    await act(async () => {
      await ok_result.current.approve(TEST_AD_ID);
    });
    expect(on_success).toHaveBeenCalledTimes(1);

    on_success.mockClear();

    const bad_mock = make_client(failing_invoke('AD_NOT_FOUND', 404));
    const { result: bad_result } = await renderHook(() =>
      useModerateAd({ supabase: bad_mock.client, onSuccess: on_success }),
    );
    await act(async () => {
      await bad_result.current.approve(TEST_AD_ID);
    });
    expect(on_success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

describe('useModerateAd — estado', () => {
  it('EC-16 is_moderating es true SÍNCRONAMENTE al disparar', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    expect(result.current.is_moderating).toBe(false);

    let action!: Promise<ModerateResult>;
    act(() => {
      action = result.current.approve(TEST_AD_ID);
    });

    expect(result.current.is_moderating).toBe(true);

    await act(async () => {
      release({ data: { status: 'active' }, error: null });
      await action;
    });

    expect(result.current.is_moderating).toBe(false);
  });

  it('EC-17 is_moderating vuelve a false tras éxito (habiendo sido true)', async () => {
    // Un stub con is_moderating siempre false pasa la versión ingenua de este
    // caso. Solo protege si exige la transición completa.
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let action!: Promise<ModerateResult>;
    act(() => {
      action = result.current.approve(TEST_AD_ID);
    });
    expect(result.current.is_moderating).toBe(true);

    let res!: ModerateResult;
    await act(async () => {
      release({ data: { status: 'active' }, error: null });
      res = await action;
    });

    expect(res.ok).toBe(true);
    expect(result.current.is_moderating).toBe(false);
  });

  it('EC-18 is_moderating vuelve a false tras error (habiendo sido true)', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    let action!: Promise<ModerateResult>;
    act(() => {
      action = result.current.approve(TEST_AD_ID);
    });
    expect(result.current.is_moderating).toBe(true);

    let res!: ModerateResult;
    await act(async () => {
      release({ data: null, error: make_http_error('DB_ERROR', 500) });
      res = await action;
    });

    expect(res.ok).toBe(false);
    expect(result.current.is_moderating).toBe(false);
  });

  it('EC-19 error se expone tras el fallo y se limpia en el siguiente éxito', async () => {
    let fail = true;
    const mock = make_client(() =>
      fail
        ? Promise.resolve({ data: null, error: make_http_error('AD_NOT_FOUND', 404) })
        : Promise.resolve({ data: { status: 'active' }, error: null }),
    );
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    await act(async () => {
      await result.current.approve(TEST_AD_ID);
    });
    expect(result.current.error).not.toBeNull();

    fail = false;
    await act(async () => {
      await result.current.approve(TEST_AD_ID);
    });
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Integridad del cliente supabase-js (#205)
// ---------------------------------------------------------------------------

describe('useModerateAd — 🔴 no desprender métodos de supabase-js (#205)', () => {
  it('EC-20 invoca functions.invoke SOBRE el objeto functions, sin desprenderlo', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useModerateAd({ supabase: mock.client }));

    await act(async () => {
      await result.current.approve(TEST_AD_ID);
    });

    // `const { invoke } = client.functions` pierde el `this` y en producción
    // falla mudo (nota supabase_js_metodo_desprendido). El mock lo detecta.
    expect(mock.was_detached()).toBe(false);
    expect(mock.calls).toHaveLength(1);
  });
});
