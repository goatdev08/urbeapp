/**
 * Tests fase RED — useModerateProperty (mutación: approve|needs_changes|reject
 * sobre la cola de revisiones de ediciones vía la EF moderate-property, módulo
 * 041-M1, tarea #218)
 * Archivos SUT: mobile/src/features/admin/hooks/useModerateProperty.ts
 *               mobile/src/features/admin/revision_error_messages.ts
 * Subtarea Taskmaster: 218.1
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — calca
 * useSetOrgAdvertising (209.3) / useSuspendAgency (211.2), los hooks de
 * mutación por EF más recientes del repo, vía DI del cliente):
 *
 *   useModerateProperty(deps?: { supabase?: unknown }): {
 *     moderate(params: { property_id: string;
 *       action: 'approve' | 'needs_changes' | 'reject'; reason?: string }):
 *       Promise<ModeratePropertyResult>;
 *     is_submitting: boolean;
 *     error_message: string | null;
 *   }
 *
 *   ModeratePropertyResult = { ok: true; status: string } | { ok: false; status: null }
 *   (a diferencia de useSetOrgAdvertising/useSuspendAgency, el `error` NO viaja
 *   en el resultado por-llamada — vive únicamente en `error_message` del hook,
 *   decisión de 218.1 fijada en este RED).
 *
 * CONTRATO DE LA EF — leído de supabase/functions/moderate-property/
 * {handler,types}.ts, NO asumido: input {property_id, action, reason?} → 200
 * {property_id, status} en éxito. Códigos de error (handler.ts verificado):
 *   INVALID_INPUT (400) | UNAUTHENTICATED (401) | FORBIDDEN (403) |
 *   PROPERTY_NOT_FOUND (404) | INVALID_TRANSITION (400) |
 *   NOTHING_TO_MODERATE (400) | DB_ERROR (500).
 * Este hook restringe `action` a 'approve'|'needs_changes'|'reject' — 'suspend'
 * (la cuarta acción de la EF) NO es parte de la cola de revisiones y no se
 * expone aquí (fuera de alcance de 218.1).
 *
 * 🔴 REGLA DE #200 — EL MENSAJE NUNCA SALE DE error.message. `FunctionsHttpError.
 * message` es SIEMPRE el literal en inglés 'Edge Function returned a non-2xx
 * status code' (node_modules/@supabase/functions-js/src/types.ts:91), idéntico
 * para los 7 códigos: mostrarlo es enseñarle inglés genérico al admin. El
 * código real vive en el CUERPO de la respuesta y solo lo saca
 * `extract_error_code` (mobile/src/lib/supabase/edge-errors.ts). Ese
 * colaborador NO se mockea: se ejercita con FunctionsHttpError REALES
 * construidos aquí (mismo patrón que useSetOrgAdvertising.test.tsx).
 *
 * 🔴 REGLA DE #205 — NO DESPRENDER `client.functions.invoke` DEL CLIENTE.
 * `const { invoke } = client.functions` pierde el `this` y falla MUDO en
 * producción, con la suite en verde si el mock es un objeto plano. EC-19 lo
 * caza: el mock verifica que `this` sea el objeto `functions`.
 *
 * 🔴 EL HOOK NO VALIDA `reason` — la UI lo exige para needs_changes/reject
 * (decisión de producto, ver plan de 218.1); el hook solo lo reenvía si vino
 * (EC-2/EC-3, calca el patrón de `category` en useSetOrgAdvertising).
 *
 * 🔴 NO DOBLE-SUBMIT, semántica IGNORAR (decisión de 218.1, distinta de
 * useSuspendAgency que COALESCE): mientras `is_submitting` es true, una
 * segunda llamada a `moderate` NO dispara una segunda invocación de red y
 * resuelve de inmediato a `{ ok: false, status: null }` sin esperar a que la
 * primera termine — la primera sigue su curso normal e intacta (EC-17/EC-18).
 *
 * GOTCHAS RNTL ya pagados: `act()` async con `await`; `is_submitting` se lee
 * SÍNCRONAMENTE en el mismo tick en que arranca la acción (patrón
 * is_working_ref + force_update de useSetOrgAdvertising/useSuspendAgency), por
 * eso EC-13 no usa `await` antes de la primera aserción.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path e invocación
 * - (EC-1) exito_approve_body_correcto_is_submitting_baja_y_error_null
 * - (EC-2) exito_con_reason_el_reason_viaja_en_el_body
 * - (EC-3) sin_reason_la_clave_reason_no_se_manda_en_el_body
 * - (EC-4) invoca_el_nombre_exacto_de_la_ef_moderate_property
 * - (EC-5) el_body_incluye_property_id_y_action_exactos
 * - (EC-6) la_respuesta_de_exito_expone_el_status_resultante_que_devuelve_la_ef
 *
 * ### 🔴 Traducción de códigos — ninguno cae en inglés crudo (#200)
 * - (EC-7)  cada_codigo_conocido_produce_un_mensaje_en_espanol_distinguible
 * - (EC-8)  ningun_codigo_deja_ver_el_literal_en_ingles_de_supabase_js
 * - (EC-9)  codigo_desconocido_cae_a_mensaje_neutro_no_al_codigo_crudo
 * - (EC-10) nothing_to_moderate_y_property_not_found_producen_mensajes_distintos
 *
 * ### Fallo de red
 * - (EC-11) invoke_rechazado_devuelve_ok_false_sin_lanzar_y_mensaje_neutro
 * - (EC-12) fallo_de_red_no_expone_el_texto_del_error_original
 *
 * ### Estado
 * - (EC-13) is_submitting_true_sincronamente_al_disparar
 * - (EC-14) is_submitting_false_tras_exito
 * - (EC-15) is_submitting_false_tras_error
 * - (EC-16) error_message_expuesto_tras_fallo_y_limpiado_en_el_siguiente_exito
 *
 * ### 🔴 No doble-submit — semántica IGNORAR
 * - (EC-17) segunda_llamada_mientras_la_primera_sigue_en_vuelo_es_ignorada_sin_segunda_invocacion
 * - (EC-18) la_llamada_ignorada_no_afecta_el_resultado_de_la_llamada_en_curso
 *
 * ### 🔴 Integridad del cliente supabase-js
 * - (EC-19) no_desprende_functions_invoke_del_cliente
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { renderHook, act } from '@testing-library/react-native';

import { useModerateProperty, type ModeratePropertyResult } from '../hooks/useModerateProperty';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TEST_PROPERTY_ID = 'property-uuid-a-configurar-218';

/**
 * Literal EXACTO de @supabase/functions-js (FunctionsHttpError) — fuente
 * independiente del SUT, ver node_modules/@supabase/functions-js/src/types.ts:91.
 * Si este mensaje aparece en la UI, el defecto de #200 volvió.
 */
const RAW_SUPABASE_JS_MESSAGE = 'Edge Function returned a non-2xx status code';

/** Los 7 códigos que la EF moderate-property puede emitir (handler.ts verificado). */
const ALL_CODES = [
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'PROPERTY_NOT_FOUND',
  'INVALID_TRANSITION',
  'NOTHING_TO_MODERATE',
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

const ok_invoke = (status = 'active') => (): Promise<InvokeResult> =>
  Promise.resolve({ data: { property_id: TEST_PROPERTY_ID, status }, error: null });

const failing_invoke = (code: string, status = 400) => (): Promise<InvokeResult> =>
  Promise.resolve({ data: null, error: make_http_error(code, status) });

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Happy path e invocación
// ---------------------------------------------------------------------------

describe('useModerateProperty — happy path', () => {
  it('EC-1 éxito approve: body correcto, is_submitting baja y error_message queda null', async () => {
    const mock = make_client(ok_invoke('active'));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    let res!: ModeratePropertyResult;
    await act(async () => {
      res = await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    expect(res.ok).toBe(true);
    expect(mock.calls).toHaveLength(1);
    expect(result.current.is_submitting).toBe(false);
    expect(result.current.error_message).toBeNull();
  });

  it('EC-2 éxito con reason: el reason viaja en el body', async () => {
    const mock = make_client(ok_invoke('needs_changes'));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    await act(async () => {
      await result.current.moderate({
        property_id: TEST_PROPERTY_ID,
        action: 'needs_changes',
        reason: 'Faltan fotos de la fachada',
      });
    });

    expect(mock.calls[0]?.options.body?.reason).toBe('Faltan fotos de la fachada');
  });

  it('EC-3 sin reason: la clave reason NO se manda en el body', async () => {
    const mock = make_client(ok_invoke('active'));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    await act(async () => {
      await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    // Sin este guard, un stub que NO invoca deja body={} y hasOwnProperty=false:
    // el caso pasaría sin que la EF se llamara nunca.
    expect(mock.calls).toHaveLength(1);
    const body = mock.calls[0]?.options.body ?? {};
    expect(Object.prototype.hasOwnProperty.call(body, 'reason')).toBe(false);
  });

  it('EC-4 invoca el nombre exacto de la EF: moderate-property', async () => {
    const mock = make_client(ok_invoke('active'));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    await act(async () => {
      await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    expect(mock.calls[0]?.name).toBe('moderate-property');
  });

  it('EC-5 el body incluye property_id y action exactos', async () => {
    const mock = make_client(ok_invoke('rejected'));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    await act(async () => {
      await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'reject', reason: 'no cumple' });
    });

    expect(mock.calls[0]?.options.body?.property_id).toBe(TEST_PROPERTY_ID);
    expect(mock.calls[0]?.options.body?.action).toBe('reject');
  });

  it('EC-6 la respuesta de éxito expone el status RESULTANTE que devuelve la EF', async () => {
    const mock = make_client(ok_invoke('active'));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    let res!: ModeratePropertyResult;
    await act(async () => {
      res = await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    expect(res).toEqual({ ok: true, status: 'active' });
  });
});

// ---------------------------------------------------------------------------
// 🔴 Traducción de códigos — la regla de #200
// ---------------------------------------------------------------------------

describe('useModerateProperty — 🔴 traducción de códigos tipados (#200)', () => {
  it('EC-7 cada código conocido produce un mensaje en español distinguible', async () => {
    const messages: string[] = [];

    for (const code of ALL_CODES) {
      const mock = make_client(failing_invoke(code));
      const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

      let res!: ModeratePropertyResult;
      await act(async () => {
        res = await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBeNull();
      expect(typeof result.current.error_message).toBe('string');
      expect((result.current.error_message ?? '').length).toBeGreaterThan(0);
      messages.push(result.current.error_message ?? '');
    }

    // Un mapa que devolviera el mismo texto para los 7 códigos "traduce" sin
    // informar. Al menos los casos que el admin puede accionar deben diferir.
    expect(new Set(messages).size).toBeGreaterThan(1);
  });

  it('EC-8 ningún código deja ver el literal en inglés de supabase-js', async () => {
    for (const code of ALL_CODES) {
      const mock = make_client(failing_invoke(code));
      const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

      await act(async () => {
        await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
      });

      expect(result.current.error_message).not.toContain(RAW_SUPABASE_JS_MESSAGE);
      expect(result.current.error_message).not.toContain('non-2xx');
      expect(result.current.error_message).not.toContain('Edge Function');
    }
  });

  it('EC-9 un código desconocido cae a un mensaje neutro, no al código crudo', async () => {
    const mock = make_client(failing_invoke('ALGUN_CODIGO_FUTURO_NO_MAPEADO'));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    let res!: ModeratePropertyResult;
    await act(async () => {
      res = await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    expect(res.ok).toBe(false);
    expect(result.current.error_message).not.toContain('ALGUN_CODIGO_FUTURO_NO_MAPEADO');
    expect((result.current.error_message ?? '').length).toBeGreaterThan(0);
  });

  it('EC-10 NOTHING_TO_MODERATE y PROPERTY_NOT_FOUND producen mensajes distintos', async () => {
    const mock_nothing = make_client(failing_invoke('NOTHING_TO_MODERATE', 400));
    const { result: r1 } = await renderHook(() => useModerateProperty({ supabase: mock_nothing.client }));
    await act(async () => {
      await r1.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });
    const msg1 = r1.current.error_message;

    const mock_not_found = make_client(failing_invoke('PROPERTY_NOT_FOUND', 404));
    const { result: r2 } = await renderHook(() => useModerateProperty({ supabase: mock_not_found.client }));
    await act(async () => {
      await r2.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });
    const msg2 = r2.current.error_message;

    expect(msg1).not.toBeNull();
    expect(msg2).not.toBeNull();
    expect(msg1).not.toBe(msg2);
  });
});

// ---------------------------------------------------------------------------
// Fallo de red
// ---------------------------------------------------------------------------

describe('useModerateProperty — fallo de red', () => {
  it('EC-11 invoke rechazado devuelve ok:false sin lanzar y deja mensaje neutro', async () => {
    const mock = make_client(() => Promise.reject(new Error('Network request failed')));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    let res!: ModeratePropertyResult;
    let threw: unknown = null;
    await act(async () => {
      try {
        res = await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(res.ok).toBe(false);
    expect(res.status).toBeNull();
    expect((result.current.error_message ?? '').length).toBeGreaterThan(0);
  });

  it('EC-12 un fallo de red no expone el texto del error original', async () => {
    const mock = make_client(() => Promise.reject(new Error('Network request failed')));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    await act(async () => {
      await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    expect(result.current.error_message).not.toContain('Network request failed');
  });
});

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

describe('useModerateProperty — estado', () => {
  it('EC-13 is_submitting es true SÍNCRONAMENTE al disparar moderate', async () => {
    const pending = new Promise<InvokeResult>(() => {});
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    act(() => {
      void result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    // Lectura SÍNCRONA, sin await — is_working_ref se fija antes del primer await.
    expect(result.current.is_submitting).toBe(true);
  });

  it('EC-14 is_submitting vuelve a false tras un éxito', async () => {
    const mock = make_client(ok_invoke('active'));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    await act(async () => {
      await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    expect(result.current.is_submitting).toBe(false);
  });

  it('EC-15 is_submitting vuelve a false tras un error', async () => {
    const mock = make_client(failing_invoke('DB_ERROR', 500));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    await act(async () => {
      await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    expect(result.current.is_submitting).toBe(false);
  });

  it('EC-16 error_message se expone tras el fallo y se limpia en el siguiente éxito', async () => {
    const mock_fail = make_client(failing_invoke('DB_ERROR', 500));
    const { result, rerender } = await renderHook(
      ({ client }: { client: unknown }) => useModerateProperty({ supabase: client }),
      { initialProps: { client: mock_fail.client } },
    );

    await act(async () => {
      await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });
    expect(result.current.error_message).not.toBeNull();

    const mock_ok = make_client(ok_invoke('active'));
    // RNTL 14: rerender es async (memoria rntl14_renderhook_async) — sin
    // `await`, el siguiente `act(async)` de este mismo test se anida sobre un
    // "act scope" no asentado y corrompe el estado interno de React/RNTL para
    // los tests SIGUIENTES del archivo (reparación 218.1, ver bitácora).
    await rerender({ client: mock_ok.client });

    await act(async () => {
      await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    expect(result.current.error_message).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 No doble-submit — semántica IGNORAR
// ---------------------------------------------------------------------------

describe('useModerateProperty — 🔴 no doble-submit (ignorar)', () => {
  it('EC-17 una segunda llamada mientras la primera sigue en vuelo NO dispara una segunda invocación', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    let first!: Promise<ModeratePropertyResult>;
    let second!: Promise<ModeratePropertyResult>;
    // `await act(async () => {...})`, no el `act(() => {...})` síncrono: con
    // React concurrente el act síncrono no aplica el estado (is_working_ref +
    // force_update) de forma confiable y corrompe el entorno de test para los
    // casos siguientes del archivo (reparación 218.1, ver bitácora). Ninguna
    // de las dos llamadas se espera aquí dentro — ambas promesas quedan
    // `pending` (o, en el caso de la segunda, ya resuelta sin red) hasta los
    // `await` explícitos de abajo.
    await act(async () => {
      first = result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
      second = result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'reject', reason: 'x' });
    });

    // La segunda se ignora de inmediato: resuelve a {ok:false, status:null}
    // SIN esperar a que la primera libere su promesa.
    const second_result = await second;
    expect(second_result).toEqual({ ok: false, status: null });
    expect(mock.calls).toHaveLength(1);

    await act(async () => {
      release({ data: { property_id: TEST_PROPERTY_ID, status: 'active' }, error: null });
      await first;
    });
  });

  it('EC-18 la llamada ignorada no afecta el resultado de la llamada en curso', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    let first!: Promise<ModeratePropertyResult>;
    // Mismo fix que EC-17: `await act(async () => {...})`, no el síncrono.
    await act(async () => {
      first = result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
      void result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'reject', reason: 'x' });
    });

    let first_result!: ModeratePropertyResult;
    await act(async () => {
      release({ data: { property_id: TEST_PROPERTY_ID, status: 'active' }, error: null });
      first_result = await first;
    });

    expect(first_result).toEqual({ ok: true, status: 'active' });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.options.body?.action).toBe('approve');
  });
});

// ---------------------------------------------------------------------------
// 🔴 Integridad del cliente supabase-js (#205)
// ---------------------------------------------------------------------------

describe('useModerateProperty — 🔴 no desprender métodos de supabase-js (#205)', () => {
  it('EC-19 invoca functions.invoke SOBRE el objeto functions, sin desprenderlo', async () => {
    const mock = make_client(ok_invoke('active'));
    const { result } = await renderHook(() => useModerateProperty({ supabase: mock.client }));

    await act(async () => {
      await result.current.moderate({ property_id: TEST_PROPERTY_ID, action: 'approve' });
    });

    // `const { invoke } = client.functions` pierde el `this` y en producción
    // falla mudo (nota supabase_js_metodo_desprendido). El mock lo detecta.
    expect(mock.was_detached()).toBe(false);
    expect(mock.calls).toHaveLength(1);
  });
});
