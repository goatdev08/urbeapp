/**
 * Tests fase RED — useSetOrgAdvertising (activar/desactivar el modo comercial
 * de una organización desde el detalle de admin, tarea #209)
 * Archivos SUT: mobile/src/features/admin/hooks/useSetOrgAdvertising.ts
 *               mobile/src/features/admin/org_advertising_error_messages.ts
 * Subtarea Taskmaster: 209.3
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — calca
 * useModerateAd (208.2), el hook de mutación por EF más reciente del repo):
 *
 *   useSetOrgAdvertising(deps?: { supabase?: unknown; onSuccess?: () => void }): {
 *     setAdvertising(params: { agency_id: string; enabled: boolean;
 *       category?: AdvertiserCategory }): Promise<SetOrgAdvertisingResult>;
 *     is_saving: boolean;
 *     error: string | null;
 *   }
 *
 *   SetOrgAdvertisingResult = { ok: boolean; error: string | null }
 *
 * CÓDIGOS DE ERROR DE LA EF — leídos de supabase/functions/set-org-advertising/
 * {handler,types}.ts, NO asumidos:
 *   INVALID_INPUT (400) | METHOD_NOT_ALLOWED (405) | UNAUTHENTICATED (401) |
 *   FORBIDDEN (403) | AGENCY_NOT_FOUND (404) | ADVERTISER_CATEGORY_REQUIRED (422) |
 *   DB_ERROR (500).
 *
 * Respuesta de éxito: 200 { ok: true } (sin payload adicional — a diferencia
 * de moderate-ad, la EF NO devuelve un `status`; ver handler.ts:139).
 *
 * 🔴 REGLA DE #200 — EL MENSAJE NUNCA SALE DE error.message. `FunctionsHttpError.
 * message` es SIEMPRE el literal en inglés 'Edge Function returned a non-2xx
 * status code' (node_modules/@supabase/functions-js/src/types.ts:91), idéntico
 * para los 7 códigos: mostrarlo es enseñarle inglés genérico al admin en los 7
 * casos. El código real vive en el CUERPO de la respuesta y solo lo saca
 * `extract_error_code` (mobile/src/lib/supabase/edge-errors.ts). Ese
 * colaborador NO se mockea: se ejercita con FunctionsHttpError REALES
 * construidos aquí (mismo patrón que useModerateAd.test.tsx).
 *
 * 🔴 REGLA DE #205 — NO DESPRENDER `client.functions.invoke` DEL CLIENTE.
 * `const { invoke } = client.functions` pierde el `this` y falla MUDO en
 * producción, con la suite en verde si el mock es un objeto plano (nota
 * `supabase_js_metodo_desprendido`). EC-19 lo caza: el mock verifica que
 * `this` sea el objeto `functions`, y una implementación que desprenda el
 * método reprueba.
 *
 * 🔴 EL BODY LO GOBIERNA EL CHECK `agencies_categoria_requerida_para_anunciar`
 * + `set_org_advertising_atomic` (ver supabase/functions/set-org-advertising/
 * types.ts, comentario de módulo). El handler NO decide si category es
 * obligatoria — solo la reenvía si vino. Consecuencia verificable aquí:
 *   - encender CON categoría manda `category` en el body (EC-2);
 *   - apagar NO manda `category` en el body, aunque el llamador la pase por
 *     error (EC-4/EC-5): el hook no tiene autoridad para decidir cuándo es
 *     necesaria, así que ni la reenvía cuando enabled=false.
 *
 * GOTCHAS RNTL ya pagados: `act()` async con `await`; `is_saving` se lee
 * SÍNCRONAMENTE en el mismo tick en que arranca la acción (patrón
 * is_working_ref + force_update de useModerateAd/useUpdateLeadStatus), por eso
 * EC-15 no usa `await` antes de la primera aserción.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path e invocación
 * - (EC-1) encender_con_categoria_invoca_la_ef_y_devuelve_ok
 * - (EC-2) encender_manda_category_en_el_body
 * - (EC-3) apagar_sin_categoria_invoca_la_ef_y_devuelve_ok
 * - (EC-4) apagar_no_manda_category_en_el_body
 * - (EC-5) apagar_no_manda_category_aunque_el_llamador_la_pase
 * - (EC-6) invoca_el_nombre_exacto_de_la_ef_set_org_advertising
 * - (EC-7) el_body_incluye_agency_id_y_enabled_exactos
 *
 * ### 🔴 Traducción de códigos — ninguno cae en inglés crudo (#200)
 * - (EC-8)  cada_codigo_tipado_produce_su_mensaje_en_espanol
 * - (EC-9)  ningun_codigo_deja_ver_el_literal_en_ingles_de_supabase_js
 * - (EC-10) codigo_desconocido_cae_a_mensaje_neutro_no_al_codigo_crudo
 * - (EC-11) agency_not_found_y_advertiser_category_required_producen_mensajes_distintos
 *
 * ### Fallo de red
 * - (EC-12) invoke_rechazado_devuelve_mensaje_neutro_sin_lanzar
 * - (EC-13) fallo_de_red_no_expone_el_texto_del_error_original
 *
 * ### onSuccess
 * - (EC-14) on_success_se_llama_solo_en_exito
 *
 * ### Estado
 * - (EC-15) is_saving_true_sincronamente_al_disparar
 * - (EC-16) is_saving_false_tras_exito
 * - (EC-17) is_saving_false_tras_error
 * - (EC-18) error_expuesto_tras_fallo_y_limpiado_en_el_siguiente_exito
 *
 * ### 🔴 Integridad del cliente supabase-js
 * - (EC-19) no_desprende_functions_invoke_del_cliente
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { renderHook, act } from '@testing-library/react-native';

import {
  useSetOrgAdvertising,
  type SetOrgAdvertisingResult,
} from '../hooks/useSetOrgAdvertising';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TEST_AGENCY_ID = 'agency-uuid-a-configurar-209';
const CATEGORY = 'credito_hipotecario' as const;

/**
 * Literal EXACTO de @supabase/functions-js (FunctionsHttpError) — fuente
 * independiente del SUT, ver node_modules/@supabase/functions-js/src/types.ts:91.
 * Si este mensaje aparece en la UI, el defecto de #200 volvió.
 */
const RAW_SUPABASE_JS_MESSAGE = 'Edge Function returned a non-2xx status code';

/** Los 7 códigos que la EF set-org-advertising puede emitir (handler.ts verificado). */
const ALL_CODES = [
  'INVALID_INPUT',
  'METHOD_NOT_ALLOWED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'AGENCY_NOT_FOUND',
  'ADVERTISER_CATEGORY_REQUIRED',
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
 * deja de ser `functions` y la llamada se marca como desprendida — EC-19.
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

const ok_invoke = (): Promise<InvokeResult> => Promise.resolve({ data: { ok: true }, error: null });

const failing_invoke = (code: string, status = 400) => (): Promise<InvokeResult> =>
  Promise.resolve({ data: null, error: make_http_error(code, status) });

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Happy path e invocación
// ---------------------------------------------------------------------------

describe('useSetOrgAdvertising — happy path', () => {
  it('EC-1 encender con categoría invoca la EF y devuelve ok', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    let res!: SetOrgAdvertisingResult;
    await act(async () => {
      res = await result.current.setAdvertising({
        agency_id: TEST_AGENCY_ID,
        enabled: true,
        category: CATEGORY,
      });
    });

    expect(res.ok).toBe(true);
    expect(res.error).toBeNull();
    expect(mock.calls).toHaveLength(1);
  });

  it('EC-2 encender manda category en el body', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    await act(async () => {
      await result.current.setAdvertising({
        agency_id: TEST_AGENCY_ID,
        enabled: true,
        category: CATEGORY,
      });
    });

    expect(mock.calls[0]?.options.body?.category).toBe(CATEGORY);
  });

  it('EC-3 apagar sin categoría invoca la EF y devuelve ok', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    let res!: SetOrgAdvertisingResult;
    await act(async () => {
      res = await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: false });
    });

    expect(res.ok).toBe(true);
    expect(res.error).toBeNull();
    expect(mock.calls).toHaveLength(1);
  });

  it('EC-4 apagar NO manda category en el body', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    await act(async () => {
      await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: false });
    });

    // Sin este guard, un stub que NO invoca deja body={} y hasOwnProperty=false:
    // el caso pasaría sin que la EF se llamara nunca.
    expect(mock.calls).toHaveLength(1);
    const body = mock.calls[0]?.options.body ?? {};
    expect(Object.prototype.hasOwnProperty.call(body, 'category')).toBe(false);
  });

  it('EC-5 apagar NO manda category aunque el llamador la pase por error', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    await act(async () => {
      await result.current.setAdvertising({
        agency_id: TEST_AGENCY_ID,
        enabled: false,
        category: CATEGORY,
      });
    });

    const body = mock.calls[0]?.options.body ?? {};
    expect(Object.prototype.hasOwnProperty.call(body, 'category')).toBe(false);
  });

  it('EC-6 invoca el nombre exacto de la EF: set-org-advertising', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    await act(async () => {
      await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });

    expect(mock.calls[0]?.name).toBe('set-org-advertising');
  });

  it('EC-7 el body incluye agency_id y enabled exactos', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    await act(async () => {
      await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });

    expect(mock.calls[0]?.options.body?.agency_id).toBe(TEST_AGENCY_ID);
    expect(mock.calls[0]?.options.body?.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Traducción de códigos — la regla de #200
// ---------------------------------------------------------------------------

describe('useSetOrgAdvertising — 🔴 traducción de códigos tipados (#200)', () => {
  it('EC-8 cada código tipado produce un mensaje en español distinguible', async () => {
    const messages: string[] = [];

    for (const code of ALL_CODES) {
      const mock = make_client(failing_invoke(code));
      const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

      let res!: SetOrgAdvertisingResult;
      await act(async () => {
        res = await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
      });

      expect(res.ok).toBe(false);
      expect(typeof res.error).toBe('string');
      expect((res.error ?? '').length).toBeGreaterThan(0);
      messages.push(res.error ?? '');
    }

    // Un mapa que devolviera el mismo texto para los 7 códigos "traduce" sin
    // informar. Al menos los casos que el admin puede accionar deben diferir.
    expect(new Set(messages).size).toBeGreaterThan(1);
  });

  it('EC-9 ningún código deja ver el literal en inglés de supabase-js', async () => {
    for (const code of ALL_CODES) {
      const mock = make_client(failing_invoke(code));
      const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

      let res!: SetOrgAdvertisingResult;
      await act(async () => {
        res = await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
      });

      expect(res.error).not.toContain(RAW_SUPABASE_JS_MESSAGE);
      expect(res.error).not.toContain('non-2xx');
      expect(res.error).not.toContain('Edge Function');
    }
  });

  it('EC-10 un código desconocido cae a un mensaje neutro, no al código crudo', async () => {
    const mock = make_client(failing_invoke('ALGUN_CODIGO_FUTURO_NO_MAPEADO'));
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    let res!: SetOrgAdvertisingResult;
    await act(async () => {
      res = await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });

    expect(res.ok).toBe(false);
    expect(res.error).not.toContain('ALGUN_CODIGO_FUTURO_NO_MAPEADO');
    expect((res.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-11 AGENCY_NOT_FOUND y ADVERTISER_CATEGORY_REQUIRED producen mensajes distintos', async () => {
    const mock_not_found = make_client(failing_invoke('AGENCY_NOT_FOUND', 404));
    const { result: r1 } = await renderHook(() => useSetOrgAdvertising({ supabase: mock_not_found.client }));
    let res1!: SetOrgAdvertisingResult;
    await act(async () => {
      res1 = await r1.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });

    const mock_category = make_client(failing_invoke('ADVERTISER_CATEGORY_REQUIRED', 422));
    const { result: r2 } = await renderHook(() => useSetOrgAdvertising({ supabase: mock_category.client }));
    let res2!: SetOrgAdvertisingResult;
    await act(async () => {
      res2 = await r2.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true });
    });

    expect(res1.error).not.toBeNull();
    expect(res2.error).not.toBeNull();
    expect(res1.error).not.toBe(res2.error);
  });
});

// ---------------------------------------------------------------------------
// Fallo de red
// ---------------------------------------------------------------------------

describe('useSetOrgAdvertising — fallo de red', () => {
  it('EC-12 invoke rechazado devuelve mensaje neutro sin lanzar', async () => {
    const mock = make_client(() => Promise.reject(new Error('Network request failed')));
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    let res!: SetOrgAdvertisingResult;
    let threw: unknown = null;
    await act(async () => {
      try {
        res = await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(res.ok).toBe(false);
    expect((res.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-13 un fallo de red no expone el texto del error original', async () => {
    const mock = make_client(() => Promise.reject(new Error('Network request failed')));
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    let res!: SetOrgAdvertisingResult;
    await act(async () => {
      res = await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });

    expect(res.error).not.toContain('Network request failed');
  });
});

// ---------------------------------------------------------------------------
// onSuccess
// ---------------------------------------------------------------------------

describe('useSetOrgAdvertising — onSuccess', () => {
  it('EC-14 onSuccess se llama solo en éxito', async () => {
    const on_success = jest.fn();

    const ok_mock = make_client(ok_invoke);
    const { result: ok_result } = await renderHook(() =>
      useSetOrgAdvertising({ supabase: ok_mock.client, onSuccess: on_success }),
    );
    await act(async () => {
      await ok_result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });
    expect(on_success).toHaveBeenCalledTimes(1);

    on_success.mockClear();

    const bad_mock = make_client(failing_invoke('AGENCY_NOT_FOUND', 404));
    const { result: bad_result } = await renderHook(() =>
      useSetOrgAdvertising({ supabase: bad_mock.client, onSuccess: on_success }),
    );
    await act(async () => {
      await bad_result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });
    expect(on_success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

describe('useSetOrgAdvertising — estado', () => {
  it('EC-15 is_saving es true SÍNCRONAMENTE al disparar', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    expect(result.current.is_saving).toBe(false);

    let action!: Promise<SetOrgAdvertisingResult>;
    act(() => {
      action = result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });

    expect(result.current.is_saving).toBe(true);

    await act(async () => {
      release({ data: { ok: true }, error: null });
      await action;
    });

    expect(result.current.is_saving).toBe(false);
  });

  it('EC-16 is_saving vuelve a false tras éxito (habiendo sido true)', async () => {
    // Un stub con is_saving siempre false pasa la versión ingenua de este
    // caso. Solo protege si exige la transición completa.
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    let action!: Promise<SetOrgAdvertisingResult>;
    act(() => {
      action = result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });
    expect(result.current.is_saving).toBe(true);

    let res!: SetOrgAdvertisingResult;
    await act(async () => {
      release({ data: { ok: true }, error: null });
      res = await action;
    });

    expect(res.ok).toBe(true);
    expect(result.current.is_saving).toBe(false);
  });

  it('EC-17 is_saving vuelve a false tras error (habiendo sido true)', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    let action!: Promise<SetOrgAdvertisingResult>;
    act(() => {
      action = result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });
    expect(result.current.is_saving).toBe(true);

    let res!: SetOrgAdvertisingResult;
    await act(async () => {
      release({ data: null, error: make_http_error('DB_ERROR', 500) });
      res = await action;
    });

    expect(res.ok).toBe(false);
    expect(result.current.is_saving).toBe(false);
  });

  it('EC-18 error se expone tras el fallo y se limpia en el siguiente éxito', async () => {
    let fail = true;
    const mock = make_client(() =>
      fail
        ? Promise.resolve({ data: null, error: make_http_error('AGENCY_NOT_FOUND', 404) })
        : Promise.resolve({ data: { ok: true }, error: null }),
    );
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    await act(async () => {
      await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });
    expect(result.current.error).not.toBeNull();

    fail = false;
    await act(async () => {
      await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Integridad del cliente supabase-js (#205)
// ---------------------------------------------------------------------------

describe('useSetOrgAdvertising — 🔴 no desprender métodos de supabase-js (#205)', () => {
  it('EC-19 invoca functions.invoke SOBRE el objeto functions, sin desprenderlo', async () => {
    const mock = make_client(ok_invoke);
    const { result } = await renderHook(() => useSetOrgAdvertising({ supabase: mock.client }));

    await act(async () => {
      await result.current.setAdvertising({ agency_id: TEST_AGENCY_ID, enabled: true, category: CATEGORY });
    });

    // `const { invoke } = client.functions` pierde el `this` y en producción
    // falla mudo (nota supabase_js_metodo_desprendido). El mock lo detecta.
    expect(mock.was_detached()).toBe(false);
    expect(mock.calls).toHaveLength(1);
  });
});
