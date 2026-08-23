/**
 * Tests fase RED — useSuspendAgency (suspender/reactivar una organización
 * desde el detalle de admin, tarea #211, subtarea 211.2)
 * Archivos SUT: mobile/src/features/admin/hooks/useSuspendAgency.ts
 *               mobile/src/features/admin/agency_status_error_messages.ts
 * Subtarea Taskmaster: 211.2
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — calca
 * useSetOrgAdvertising (209.3) / useModerateAd (208.2/210.3), los hooks de
 * mutación por EF más recientes del repo). Solo el HOOK es crítico; la
 * pantalla (agencies/[id].tsx) va en GREEN ligera — NO hay tests de pantalla
 * aquí.
 *
 *   useSuspendAgency(deps?: { supabase?: unknown; onSuccess?: () => void }): {
 *     suspend(agency_id: string): Promise<SuspendAgencyResult>;
 *     reactivate(agency_id: string): Promise<SuspendAgencyResult>;
 *     is_working: boolean;
 *     error: string | null;
 *   }
 *
 *   SuspendAgencyResult = { ok: boolean; status: 'active'|'suspended'|null; error: string | null }
 *
 * CÓDIGOS DE ERROR DE LA EF — leídos de supabase/functions/suspend-agency/
 * {handler,types}.ts, NO asumidos. Los 3 que nacen del writer/trigger están
 * tipados en types.ts (AgencyStatusErrorCode); los otros 4 son HTTP-level que
 * el handler devuelve directo (parseo/método/auth), igual que en los gemelos:
 *   INVALID_INPUT (400) | METHOD_NOT_ALLOWED (405) | UNAUTHENTICATED (401) |
 *   FORBIDDEN (403) | AGENCY_NOT_FOUND (404) | INVALID_STATUS_TRANSITION (409) |
 *   DB_ERROR (500).
 *
 * Respuesta de éxito: 200 { status: 'active' | 'suspended' } (handler.ts:139
 * — a diferencia de set-org-advertising, esta EF SÍ devuelve el estado
 * resultante; el hook lo expone en `result.status`).
 *
 * 🔴 REGLA DE #200 — EL MENSAJE NUNCA SALE DE error.message. `FunctionsHttpError.
 * message` es SIEMPRE el literal en inglés 'Edge Function returned a non-2xx
 * status code' (node_modules/@supabase/functions-js/src/types.ts:91), idéntico
 * para los 7 códigos: mostrarlo es enseñarle inglés genérico al admin en los 7
 * casos. El código real vive en el CUERPO de la respuesta y solo lo saca
 * `extract_error_code` (mobile/src/lib/supabase/edge-errors.ts). Ese
 * colaborador NO se mockea: se ejercita con FunctionsHttpError REALES
 * construidos aquí (mismo patrón que useSetOrgAdvertising.test.tsx).
 *
 * 🔴 REGLA DE #205 — NO DESPRENDER `client.functions.invoke` DEL CLIENTE.
 * `const { invoke } = client.functions` pierde el `this` y falla MUDO en
 * producción, con la suite en verde si el mock es un objeto plano (nota
 * `supabase_js_metodo_desprendido`). EC-24 lo caza: el mock verifica que
 * `this` sea el objeto `functions`, y una implementación que desprenda el
 * método reprueba.
 *
 * 🔴 SIN LÓGICA DE ESTADO EN EL HOOK. La obs. 1 del guardian de 211.1 deja
 * claro que `reactivate` sobre una organización `pending_approval` ejecuta
 * una APROBACIÓN completa vía el trigger — eso es correcto y NO es cosa de
 * este hook decidir ni bloquear; es la PANTALLA (211.2, ligera) la que solo
 * ofrece el botón "Reactivar" cuando status='suspended'. Por eso ningún test
 * de este archivo condiciona el comportamiento al status ORIGEN de la
 * organización — el hook manda la acción que se le pide, punto.
 *
 * 🔴 NO DOBLE-SUBMIT (nuevo respecto a los gemelos, motivado por la
 * criticidad de la acción: suspender cascada sobre `ads`). Mientras
 * `is_working` es true, una segunda llamada (a `suspend` o `reactivate`, da
 * igual cuál — comparten un único estado "en vuelo") NO dispara una segunda
 * invocación de red; se resuelve al MISMO resultado que la llamada en curso
 * (EC-22/EC-23).
 *
 * GOTCHAS RNTL ya pagados: `act()` async con `await`; `is_working` se lee
 * SÍNCRONAMENTE en el mismo tick en que arranca la acción (patrón
 * is_working_ref + force_update de useModerateAd/useSetOrgAdvertising), por
 * eso EC-17 no usa `await` antes de la primera aserción.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path e invocación
 * - (EC-1) suspend_invoca_la_ef_y_devuelve_ok_con_status_suspended
 * - (EC-2) reactivate_invoca_la_ef_y_devuelve_ok_con_status_active
 * - (EC-3) invoca_el_nombre_exacto_de_la_ef_suspend_agency
 * - (EC-4) suspend_manda_action_suspend_en_el_body
 * - (EC-5) reactivate_manda_action_reactivate_en_el_body
 * - (EC-6) el_body_incluye_agency_id_exacto_y_ninguna_clave_extra
 *
 * ### 🔴 Traducción de códigos — ninguno cae en inglés crudo (#200)
 * - (EC-7)  cada_codigo_tipado_produce_su_mensaje_en_espanol
 * - (EC-8)  ningun_codigo_deja_ver_el_literal_en_ingles_de_supabase_js
 * - (EC-9)  codigo_desconocido_cae_a_mensaje_neutro_no_al_codigo_crudo
 * - (EC-10) invalid_status_transition_explica_que_el_estado_no_permite_la_accion
 * - (EC-11) agency_not_found_e_invalid_status_transition_producen_mensajes_distintos
 *
 * ### Fallo de red
 * - (EC-12) invoke_rechazado_devuelve_mensaje_neutro_sin_lanzar
 * - (EC-13) fallo_de_red_no_expone_el_texto_del_error_original
 *
 * ### onSuccess
 * - (EC-14) on_success_se_llama_solo_en_exito_de_suspend
 * - (EC-15) on_success_se_llama_solo_en_exito_de_reactivate
 * - (EC-16) on_success_no_se_llama_tras_error
 *
 * ### Estado
 * - (EC-17) is_working_true_sincronamente_al_disparar_suspend
 * - (EC-18) is_working_false_tras_exito
 * - (EC-19) is_working_false_tras_error
 * - (EC-20) error_expuesto_tras_fallo_y_limpiado_en_el_siguiente_exito
 * - (EC-21) exito_de_reactivate_limpia_el_error_dejado_por_un_suspend_fallido
 *
 * ### 🔴 No doble-submit
 * - (EC-22) segunda_llamada_mientras_la_primera_sigue_en_vuelo_no_dispara_una_segunda_invocacion
 * - (EC-23) la_llamada_coalescida_resuelve_al_mismo_resultado_que_la_llamada_en_curso
 *
 * ### 🔴 Integridad del cliente supabase-js
 * - (EC-24) no_desprende_functions_invoke_del_cliente
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { renderHook, act } from '@testing-library/react-native';

import {
  useSuspendAgency,
  type SuspendAgencyResult,
} from '../hooks/useSuspendAgency';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TEST_AGENCY_ID = 'agency-uuid-a-configurar-211';

/**
 * Literal EXACTO de @supabase/functions-js (FunctionsHttpError) — fuente
 * independiente del SUT, ver node_modules/@supabase/functions-js/src/types.ts:91.
 * Si este mensaje aparece en la UI, el defecto de #200 volvió.
 */
const RAW_SUPABASE_JS_MESSAGE = 'Edge Function returned a non-2xx status code';

/** Los 7 códigos que la EF suspend-agency puede emitir (handler.ts verificado). */
const ALL_CODES = [
  'INVALID_INPUT',
  'METHOD_NOT_ALLOWED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'AGENCY_NOT_FOUND',
  'INVALID_STATUS_TRANSITION',
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
 * deja de ser `functions` y la llamada se marca como desprendida — EC-24.
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

const ok_invoke = (status: 'active' | 'suspended') => (): Promise<InvokeResult> =>
  Promise.resolve({ data: { status }, error: null });

const failing_invoke = (code: string, status = 400) => (): Promise<InvokeResult> =>
  Promise.resolve({ data: null, error: make_http_error(code, status) });

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Happy path e invocación
// ---------------------------------------------------------------------------

describe('useSuspendAgency — happy path', () => {
  it('EC-1 suspend invoca la EF y devuelve ok con status suspended', async () => {
    const mock = make_client(ok_invoke('suspended'));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let res!: SuspendAgencyResult;
    await act(async () => {
      res = await result.current.suspend(TEST_AGENCY_ID);
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe('suspended');
    expect(res.error).toBeNull();
    expect(mock.calls).toHaveLength(1);
  });

  it('EC-2 reactivate invoca la EF y devuelve ok con status active', async () => {
    const mock = make_client(ok_invoke('active'));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let res!: SuspendAgencyResult;
    await act(async () => {
      res = await result.current.reactivate(TEST_AGENCY_ID);
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe('active');
    expect(res.error).toBeNull();
    expect(mock.calls).toHaveLength(1);
  });

  it('EC-3 invoca el nombre exacto de la EF: suspend-agency', async () => {
    const mock = make_client(ok_invoke('suspended'));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    await act(async () => {
      await result.current.suspend(TEST_AGENCY_ID);
    });

    expect(mock.calls[0]?.name).toBe('suspend-agency');
  });

  it('EC-4 suspend manda action="suspend" en el body', async () => {
    const mock = make_client(ok_invoke('suspended'));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    await act(async () => {
      await result.current.suspend(TEST_AGENCY_ID);
    });

    expect(mock.calls[0]?.options.body?.action).toBe('suspend');
  });

  it('EC-5 reactivate manda action="reactivate" en el body', async () => {
    const mock = make_client(ok_invoke('active'));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    await act(async () => {
      await result.current.reactivate(TEST_AGENCY_ID);
    });

    expect(mock.calls[0]?.options.body?.action).toBe('reactivate');
  });

  it('EC-6 el body incluye agency_id exacto y ninguna clave extra', async () => {
    const mock = make_client(ok_invoke('suspended'));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    await act(async () => {
      await result.current.suspend(TEST_AGENCY_ID);
    });

    const body = mock.calls[0]?.options.body ?? {};
    expect(body.agency_id).toBe(TEST_AGENCY_ID);
    expect(Object.keys(body).sort()).toEqual(['action', 'agency_id']);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Traducción de códigos — la regla de #200
// ---------------------------------------------------------------------------

describe('useSuspendAgency — 🔴 traducción de códigos tipados (#200)', () => {
  it('EC-7 cada código tipado produce un mensaje en español distinguible', async () => {
    const messages: string[] = [];

    for (const code of ALL_CODES) {
      const mock = make_client(failing_invoke(code));
      const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

      let res!: SuspendAgencyResult;
      await act(async () => {
        res = await result.current.suspend(TEST_AGENCY_ID);
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBeNull();
      expect(typeof res.error).toBe('string');
      expect((res.error ?? '').length).toBeGreaterThan(0);
      messages.push(res.error ?? '');
    }

    // Un mapa que devolviera el mismo texto para los 7 códigos "traduce" sin
    // informar. Al menos los casos que el admin puede accionar deben diferir.
    expect(new Set(messages).size).toBeGreaterThan(1);
  });

  it('EC-8 ningún código deja ver el literal en inglés de supabase-js', async () => {
    for (const code of ALL_CODES) {
      const mock = make_client(failing_invoke(code));
      const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

      let res!: SuspendAgencyResult;
      await act(async () => {
        res = await result.current.suspend(TEST_AGENCY_ID);
      });

      expect(res.error).not.toContain(RAW_SUPABASE_JS_MESSAGE);
      expect(res.error).not.toContain('non-2xx');
      expect(res.error).not.toContain('Edge Function');
    }
  });

  it('EC-9 un código desconocido cae a un mensaje neutro, no al código crudo', async () => {
    const mock = make_client(failing_invoke('ALGUN_CODIGO_FUTURO_NO_MAPEADO'));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let res!: SuspendAgencyResult;
    await act(async () => {
      res = await result.current.suspend(TEST_AGENCY_ID);
    });

    expect(res.ok).toBe(false);
    expect(res.error).not.toContain('ALGUN_CODIGO_FUTURO_NO_MAPEADO');
    expect((res.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-10 INVALID_STATUS_TRANSITION explica que el estado no permite la acción', async () => {
    const mock = make_client(failing_invoke('INVALID_STATUS_TRANSITION', 409));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let res!: SuspendAgencyResult;
    await act(async () => {
      res = await result.current.reactivate(TEST_AGENCY_ID);
    });

    expect(res.ok).toBe(false);
    // No es un DB_ERROR genérico: el texto debe orientar a que el ESTADO de
    // la organización es lo que bloqueó la acción (pantalla desactualizada),
    // no un problema técnico indistinguible.
    expect(res.error).toEqual(expect.stringContaining('estado'));
    expect(res.error).not.toContain('DB_ERROR');
  });

  it('EC-11 AGENCY_NOT_FOUND e INVALID_STATUS_TRANSITION producen mensajes distintos', async () => {
    const mock_not_found = make_client(failing_invoke('AGENCY_NOT_FOUND', 404));
    const { result: r1 } = await renderHook(() => useSuspendAgency({ supabase: mock_not_found.client }));
    let res1!: SuspendAgencyResult;
    await act(async () => {
      res1 = await r1.current.suspend(TEST_AGENCY_ID);
    });

    const mock_transition = make_client(failing_invoke('INVALID_STATUS_TRANSITION', 409));
    const { result: r2 } = await renderHook(() => useSuspendAgency({ supabase: mock_transition.client }));
    let res2!: SuspendAgencyResult;
    await act(async () => {
      res2 = await r2.current.suspend(TEST_AGENCY_ID);
    });

    expect(res1.error).not.toBeNull();
    expect(res2.error).not.toBeNull();
    expect(res1.error).not.toBe(res2.error);
  });
});

// ---------------------------------------------------------------------------
// Fallo de red
// ---------------------------------------------------------------------------

describe('useSuspendAgency — fallo de red', () => {
  it('EC-12 invoke rechazado devuelve mensaje neutro sin lanzar', async () => {
    const mock = make_client(() => Promise.reject(new Error('Network request failed')));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let res!: SuspendAgencyResult;
    let threw: unknown = null;
    await act(async () => {
      try {
        res = await result.current.suspend(TEST_AGENCY_ID);
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(res.ok).toBe(false);
    expect(res.status).toBeNull();
    expect((res.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-13 un fallo de red no expone el texto del error original', async () => {
    const mock = make_client(() => Promise.reject(new Error('Network request failed')));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let res!: SuspendAgencyResult;
    await act(async () => {
      res = await result.current.suspend(TEST_AGENCY_ID);
    });

    expect(res.error).not.toContain('Network request failed');
  });
});

// ---------------------------------------------------------------------------
// onSuccess
// ---------------------------------------------------------------------------

describe('useSuspendAgency — onSuccess', () => {
  it('EC-14 onSuccess se llama solo en éxito de suspend', async () => {
    const on_success = jest.fn();
    const mock = make_client(ok_invoke('suspended'));
    const { result } = await renderHook(() =>
      useSuspendAgency({ supabase: mock.client, onSuccess: on_success }),
    );

    await act(async () => {
      await result.current.suspend(TEST_AGENCY_ID);
    });

    expect(on_success).toHaveBeenCalledTimes(1);
  });

  it('EC-15 onSuccess se llama solo en éxito de reactivate', async () => {
    const on_success = jest.fn();
    const mock = make_client(ok_invoke('active'));
    const { result } = await renderHook(() =>
      useSuspendAgency({ supabase: mock.client, onSuccess: on_success }),
    );

    await act(async () => {
      await result.current.reactivate(TEST_AGENCY_ID);
    });

    expect(on_success).toHaveBeenCalledTimes(1);
  });

  it('EC-16 onSuccess NO se llama tras error', async () => {
    const on_success = jest.fn();
    const mock = make_client(failing_invoke('AGENCY_NOT_FOUND', 404));
    const { result } = await renderHook(() =>
      useSuspendAgency({ supabase: mock.client, onSuccess: on_success }),
    );

    await act(async () => {
      await result.current.suspend(TEST_AGENCY_ID);
    });

    expect(on_success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

describe('useSuspendAgency — estado', () => {
  it('EC-17 is_working es true SÍNCRONAMENTE al disparar suspend', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    expect(result.current.is_working).toBe(false);

    let action!: Promise<SuspendAgencyResult>;
    act(() => {
      action = result.current.suspend(TEST_AGENCY_ID);
    });

    expect(result.current.is_working).toBe(true);

    await act(async () => {
      release({ data: { status: 'suspended' }, error: null });
      await action;
    });

    expect(result.current.is_working).toBe(false);
  });

  it('EC-18 is_working vuelve a false tras éxito (habiendo sido true)', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let action!: Promise<SuspendAgencyResult>;
    act(() => {
      action = result.current.suspend(TEST_AGENCY_ID);
    });
    expect(result.current.is_working).toBe(true);

    let res!: SuspendAgencyResult;
    await act(async () => {
      release({ data: { status: 'suspended' }, error: null });
      res = await action;
    });

    expect(res.ok).toBe(true);
    expect(result.current.is_working).toBe(false);
  });

  it('EC-19 is_working vuelve a false tras error (habiendo sido true)', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let action!: Promise<SuspendAgencyResult>;
    act(() => {
      action = result.current.suspend(TEST_AGENCY_ID);
    });
    expect(result.current.is_working).toBe(true);

    let res!: SuspendAgencyResult;
    await act(async () => {
      release({ data: null, error: make_http_error('DB_ERROR', 500) });
      res = await action;
    });

    expect(res.ok).toBe(false);
    expect(result.current.is_working).toBe(false);
  });

  it('EC-20 error se expone tras el fallo y se limpia en el siguiente éxito', async () => {
    let fail = true;
    const mock = make_client(() =>
      fail
        ? Promise.resolve({ data: null, error: make_http_error('AGENCY_NOT_FOUND', 404) })
        : Promise.resolve({ data: { status: 'suspended' }, error: null }),
    );
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    await act(async () => {
      await result.current.suspend(TEST_AGENCY_ID);
    });
    expect(result.current.error).not.toBeNull();

    fail = false;
    await act(async () => {
      await result.current.suspend(TEST_AGENCY_ID);
    });
    expect(result.current.error).toBeNull();
  });

  it('EC-21 éxito de reactivate limpia el error dejado por un suspend fallido', async () => {
    let fail = true;
    const mock = make_client(() =>
      fail
        ? Promise.resolve({ data: null, error: make_http_error('INVALID_STATUS_TRANSITION', 409) })
        : Promise.resolve({ data: { status: 'active' }, error: null }),
    );
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    await act(async () => {
      await result.current.suspend(TEST_AGENCY_ID);
    });
    expect(result.current.error).not.toBeNull();

    fail = false;
    await act(async () => {
      await result.current.reactivate(TEST_AGENCY_ID);
    });
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 No doble-submit
// ---------------------------------------------------------------------------

describe('useSuspendAgency — 🔴 no doble-submit', () => {
  it('EC-22 una segunda llamada mientras la primera sigue en vuelo NO dispara una segunda invocación', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let first!: Promise<SuspendAgencyResult>;
    let second!: Promise<SuspendAgencyResult>;
    act(() => {
      first = result.current.suspend(TEST_AGENCY_ID);
      second = result.current.reactivate(TEST_AGENCY_ID);
    });

    // Ambas llamadas ocurrieron mientras is_working era true tras la primera:
    // solo debe haber UNA invocación de red, sin importar que la segunda
    // pidiera una acción distinta.
    expect(mock.calls).toHaveLength(1);

    await act(async () => {
      release({ data: { status: 'suspended' }, error: null });
      await Promise.all([first, second]);
    });
  });

  it('EC-23 la llamada coalescida resuelve al mismo resultado que la llamada en curso', async () => {
    let release!: (r: InvokeResult) => void;
    const pending = new Promise<InvokeResult>((res) => {
      release = res;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    let first!: Promise<SuspendAgencyResult>;
    let second!: Promise<SuspendAgencyResult>;
    act(() => {
      first = result.current.suspend(TEST_AGENCY_ID);
      second = result.current.suspend(TEST_AGENCY_ID);
    });

    let res1!: SuspendAgencyResult;
    let res2!: SuspendAgencyResult;
    await act(async () => {
      release({ data: { status: 'suspended' }, error: null });
      [res1, res2] = await Promise.all([first, second]);
    });

    expect(res1).toEqual(res2);
    expect(res1.ok).toBe(true);
    expect(mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Integridad del cliente supabase-js (#205)
// ---------------------------------------------------------------------------

describe('useSuspendAgency — 🔴 no desprender métodos de supabase-js (#205)', () => {
  it('EC-24 invoca functions.invoke SOBRE el objeto functions, sin desprenderlo', async () => {
    const mock = make_client(ok_invoke('suspended'));
    const { result } = await renderHook(() => useSuspendAgency({ supabase: mock.client }));

    await act(async () => {
      await result.current.suspend(TEST_AGENCY_ID);
    });

    // `const { invoke } = client.functions` pierde el `this` y en producción
    // falla mudo (nota supabase_js_metodo_desprendido). El mock lo detecta.
    expect(mock.was_detached()).toBe(false);
    expect(mock.calls).toHaveLength(1);
  });
});
