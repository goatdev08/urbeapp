/**
 * Tests fase RED — useReportProperty (INSERT directo del cliente a
 * property_reports desde el botón «Reportar» del detalle, módulo 041-M2,
 * tarea #220, subtarea 220.5)
 * Archivo SUT: mobile/src/features/property-detail/hooks/useReportProperty.ts
 * Subtarea Taskmaster: 220.5
 *
 * SEAM BAJO TEST (firma pública, DI del cliente — calca el patrón de
 * useModerateProperty (218.1)/useSaveProperty (9.7), los hooks de mutación
 * más recientes del repo):
 *
 *   useReportProperty({ property_id: string; owner_user_id: string;
 *     supabase?: unknown }): {
 *     submit_report(input: { reason: PropertyReportReason; reason_text?: string }):
 *       Promise<{ ok: true } | { ok: false }>;
 *     is_submitting: boolean;
 *     error_message: string | null;
 *   }
 *
 * PropertyReportReason = los 7 valores del enum property_report_reason
 * (migración 0007/0010): not_exist_fraud | misleading | false_price |
 * wrong_address | inappropriate | duplicate | other.
 *
 * 🔴 DECISIÓN 2026-08-28 (Abraham): la vía de creación es INSERT DIRECTO del
 * cliente a public.property_reports — NO hay Edge Function. reported_by_user_id
 * SIEMPRE sale de la sesión (useAuth), nunca de un parámetro externo (mismo
 * invariante que useSaveProperty/useLikeProperty).
 *
 * CONTRATO ANCLADO POR supabase/tests/73_property_reports_create_test.sql
 * (leído, no asumido):
 *   - RLS reports_insert exige reported_by_user_id = auth.uid() (RLS1/RLS2).
 *   - Índice único property_reports_one_per_user(property_id, reported_by_user_id)
 *     → segundo INSERT del MISMO usuario sobre la MISMA propiedad = 23505
 *     (DEDUPE1) → PRD §24.1 "Un usuario no puede reportar la misma propiedad
 *     dos veces".
 *   - CHECK property_reports_other_requires_text: reason='other' exige
 *     reason_text con al menos un carácter no-whitespace (trim() recorta
 *     TODO whitespace Unicode, no solo el espacio ASCII — OTHER1..OTHER6 del
 *     SQL). El JS `.trim()` nativo YA tiene esa semántica (a diferencia del
 *     `trim()` de Postgres, que solo recorta ' ' — por eso el CHECK usa una
 *     forma equivalente a `.trim()` de JS, no `trim(both ' ' from ...)`), así
 *     que replicar `.trim().length > 0` en el cliente es fiel al contrato.
 *   - reason distinto de 'other': reason_text es opcional/libre (el CHECK no
 *     aplica) — pero el mockup solo muestra el campo de texto para 'other'
 *     (subtarea 220.5, "campo de texto obligatorio solo en «Otro»"), así que
 *     el hook nulifica reason_text defensivamente para cualquier otro reason.
 *
 * 🔴 GUARD DE PROPIETARIO (fijado por el orquestador, sin mockup — el rail no
 * lo mostrará, pero el hook es la 2ª capa): si `owner_user_id === user.id` de
 * la sesión, `submit_report` NO llama a la red — resuelve `{ok:false}` de
 * inmediato con un mensaje propio.
 *
 * 🔴 «Otro» sin texto real se bloquea EN EL CLIENTE antes de llamar a la red
 * (el CHECK de la migración es la 2ª capa, no la 1ª) — mismo principio que
 * useModerateProperty valida reason solo del lado de la UI, aquí el hook
 * valida 'other' porque es un invariante de datos, no de producto.
 *
 * 🔴 NO SE DESPRENDE `client.from` DEL CLIENTE (nota supabase_js_metodo_desprendido
 * / regla #205): `const { from } = client` pierde el `this` y falla MUDO en
 * producción con la suite en verde si el mock es un objeto plano. EC-20 lo
 * caza verificando el `this` de `.insert()`.
 *
 * GOTCHAS RNTL ya pagados (memoria rntl14_renderhook_async): `renderHook` y
 * `rerender` son ASYNC — siempre con `await`; `act` síncrono no aplica estado,
 * salvo la lectura SÍNCRONA de EC-16 (is_working_ref se fija antes del primer
 * await, mismo patrón que useModerateProperty EC-13).
 *
 * EDGE CASES CUBIERTOS (20 casos):
 *
 * ### Happy path
 * - (EC-1)  exito_motivo_simple_sin_texto_reported_by_user_id_de_la_sesion
 * - (EC-2)  exito_motivo_other_con_texto_real_el_texto_viaja_tal_cual
 * - (EC-3)  el_insert_va_a_property_reports_no_a_saves_ni_likes
 * - (EC-4)  reported_by_user_id_es_siempre_el_de_la_sesion_nunca_un_parametro_externo
 *
 * ### Edge cases del PRD (§24.1)
 * - (EC-5)  no_reportar_dos_veces_23505_produce_el_mensaje_de_duplicado_exacto
 * - (EC-6)  el_owner_no_puede_reportar_su_propia_propiedad_guard_en_el_hook_sin_llamar_red
 * - (EC-7)  motivo_other_sin_reason_text_se_bloquea_en_el_cliente_sin_llamar_red
 *
 * ### 🔴 Ramas no obvias — CHECK property_reports_other_requires_text (mirror 73_*.sql)
 * - (EC-8)  motivo_other_con_reason_text_vacio_se_bloquea_en_el_cliente
 * - (EC-9)  motivo_other_con_reason_text_de_solo_espacios_ascii_se_bloquea_en_el_cliente
 * - (EC-10) motivo_other_con_reason_text_de_solo_whitespace_no_ascii_tab_salto_se_bloquea_en_el_cliente
 * - (EC-11) motivo_other_con_un_solo_caracter_no_espacio_se_acepta_boundary
 * - (EC-12) motivo_other_con_texto_real_con_padding_se_acepta_y_no_se_reescribe
 * - (EC-13) motivo_distinto_de_other_nulifica_reason_text_aunque_el_caller_lo_mande
 *
 * ### Boundary / error
 * - (EC-14) error_de_red_insert_rechazado_no_lanza_ok_false_mensaje_distinto_del_duplicado
 * - (EC-15) error_generico_del_servidor_no_23505_produce_mensaje_propio_ok_false
 * - (EC-16) is_submitting_true_sincronamente_al_disparar_submit_report
 * - (EC-17) is_submitting_false_tras_exito
 * - (EC-18) is_submitting_false_tras_error_del_servidor_no_se_queda_colgado
 * - (EC-19) error_message_se_expone_tras_un_fallo_y_se_limpia_en_el_siguiente_exito
 *
 * ### 🔴 Integridad del cliente supabase-js (#205)
 * - (EC-20) no_desprende_from_del_cliente_this_se_preserva_en_insert
 */

import { renderHook, act } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context';
import {
  useReportProperty,
  type SubmitReportResult,
} from '../hooks/useReportProperty';

// ---------------------------------------------------------------------------
// Mock de useAuth — jest.mock() se hoistea al inicio del archivo pese a estar
// declarado después de los imports (mismo patrón que useSaveProperty.test.tsx).
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const REPORTER_ID = 'usuario-reportante-uuid-220';
const OWNER_ID = 'usuario-publicador-uuid-220';
const PROPERTY_ID = 'propiedad-reportada-uuid-220';

/**
 * Copys ancla (fuente independiente — literales decididos en este RED, NUNCA
 * recomputados desde el SUT). Si el GREEN cambia el texto exacto, el guardian
 * debe verlo como una decisión deliberada, no un accidente.
 */
const DUPLICATE_MESSAGE = 'Ya reportaste esta publicación.';
const OWNER_GUARD_MESSAGE = 'No puedes reportar tu propia publicación.';
const OTHER_TEXT_REQUIRED_MESSAGE = 'Escribe el motivo del reporte.';

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Helpers de mock del cliente supabase-js
// ---------------------------------------------------------------------------

type InsertResult = { error: { message: string; code?: string } | null };
type InsertCall = Record<string, unknown>;

/**
 * Mock de `client.from('property_reports').insert({...})`. `insert` verifica
 * su propio `this`: si el hook desprende el método (`const {insert} = client
 * .from(...)`), `this` deja de ser el builder — EC-20 lo caza.
 */
function make_client(
  behavior: () => Promise<InsertResult>,
): {
  client: { from: jest.Mock };
  calls: { table: string; row: InsertCall }[];
  was_detached: () => boolean;
} {
  const calls: { table: string; row: InsertCall }[] = [];
  let detached = false;

  const from = jest.fn((table: string) => {
    const builder = {
      insert(this: unknown, row: InsertCall) {
        if (this !== builder) detached = true;
        calls.push({ table, row });
        return behavior();
      },
    };
    return builder;
  });

  return { client: { from }, calls, was_detached: () => detached };
}

const ok_insert = (): Promise<InsertResult> => Promise.resolve({ error: null });

const failing_insert = (code: string, message = 'error interno'): (() => Promise<InsertResult>) =>
  () => Promise.resolve({ error: { message, code } });

const rejecting_insert = (): Promise<InsertResult> =>
  Promise.reject(new Error('Network request failed'));

/** user autenticado por defecto — el reportante, NUNCA el owner. */
function set_auth_user(id: string) {
  mock_use_auth.mockReturnValue({
    user: { id } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  set_auth_user(REPORTER_ID);
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('useReportProperty — happy path', () => {
  it('EC-1 éxito con motivo simple sin texto: INSERT con reported_by_user_id de la sesión, ok:true', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    let res!: SubmitReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(res).toEqual({ ok: true });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toEqual({
      table: 'property_reports',
      row: {
        property_id: PROPERTY_ID,
        reported_by_user_id: REPORTER_ID,
        reason: 'not_exist_fraud',
        reason_text: null,
      },
    });
  });

  it('EC-2 éxito con motivo other + texto real: el texto viaja TAL CUAL (sin trim)', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'other', reason_text: '  motivo real con padding  ' });
    });

    expect(mock.calls[0]?.row.reason_text).toBe('  motivo real con padding  ');
    expect(mock.calls[0]?.row.reason).toBe('other');
  });

  it('EC-3 el INSERT va a from("property_reports"), no a "saves" ni "likes"', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'duplicate' });
    });

    expect(mock.client.from).toHaveBeenCalledWith('property_reports');
    expect(mock.client.from).not.toHaveBeenCalledWith('saves');
    expect(mock.client.from).not.toHaveBeenCalledWith('likes');
  });

  it('EC-4 reported_by_user_id es SIEMPRE el de la sesión, nunca un parámetro externo', async () => {
    set_auth_user('otro-usuario-de-sesion-uuid');
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      // SubmitReportInput no expone reported_by_user_id — no hay forma de
      // inyectarlo desde el caller. Solo verificamos que el insert usa el id
      // de useAuth() vigente, distinto de REPORTER_ID (el default global).
      await result.current.submit_report({ reason: 'misleading' });
    });

    expect(mock.calls[0]?.row.reported_by_user_id).toBe('otro-usuario-de-sesion-uuid');
  });
});

// ---------------------------------------------------------------------------
// Edge cases del PRD §24.1
// ---------------------------------------------------------------------------

describe('useReportProperty — 🔴 PRD §24.1', () => {
  it('EC-5 "no reportar dos veces": 23505 produce el mensaje de duplicado EXACTO', async () => {
    const mock = make_client(failing_insert('23505', 'duplicate key value violates unique constraint'));
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    let res!: SubmitReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'duplicate' });
    });

    expect(res).toEqual({ ok: false });
    expect(result.current.error_message).toBe(DUPLICATE_MESSAGE);
  });

  it('EC-6 el owner NO puede reportar su propia propiedad: guard en el hook, sin llamar a la red', async () => {
    set_auth_user(OWNER_ID); // la sesión ES el dueño de la propiedad reportada
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    let res!: SubmitReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(res).toEqual({ ok: false });
    expect(mock.calls).toHaveLength(0);
    expect(result.current.error_message).toBe(OWNER_GUARD_MESSAGE);
  });

  it('EC-7 motivo "other" sin reason_text se bloquea en el cliente, sin llamar a la red', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    let res!: SubmitReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'other' });
    });

    expect(res).toEqual({ ok: false });
    expect(mock.calls).toHaveLength(0);
    expect(result.current.error_message).toBe(OTHER_TEXT_REQUIRED_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Ramas no obvias — CHECK property_reports_other_requires_text
// (mirror boundary de supabase/tests/73_property_reports_create_test.sql)
// ---------------------------------------------------------------------------

describe('useReportProperty — 🔴 boundary del CHECK other_requires_text', () => {
  it('EC-8 reason_text vacío ("") se bloquea en el cliente', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    let res!: SubmitReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'other', reason_text: '' });
    });

    expect(res).toEqual({ ok: false });
    expect(mock.calls).toHaveLength(0);
    expect(result.current.error_message).toBe(OTHER_TEXT_REQUIRED_MESSAGE);
  });

  it('EC-9 reason_text de solo espacios ASCII ("    ") se bloquea en el cliente', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'other', reason_text: '    ' });
    });

    expect(mock.calls).toHaveLength(0);
    expect(result.current.error_message).toBe(OTHER_TEXT_REQUIRED_MESSAGE);
  });

  it('EC-10 reason_text de solo whitespace NO-ASCII (tab/salto/CR) se bloquea (mirror OTHER6 del SQL)', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'other', reason_text: '\t\n\r ' });
    });

    expect(mock.calls).toHaveLength(0);
    expect(result.current.error_message).toBe(OTHER_TEXT_REQUIRED_MESSAGE);
  });

  it('EC-11 un solo carácter no-espacio ("x") SÍ se acepta (boundary opuesto)', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    let res!: SubmitReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'other', reason_text: 'x' });
    });

    expect(res).toEqual({ ok: true });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.row.reason_text).toBe('x');
  });

  it('EC-12 texto real con padding se acepta y NO se reescribe (mirror OTHER5 del SQL)', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'other', reason_text: '  motivo real con padding  ' });
    });

    expect(mock.calls[0]?.row.reason_text).toBe('  motivo real con padding  ');
  });

  it('EC-13 motivo distinto de "other" nulifica reason_text aunque el caller lo mande', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      // El mockup NO muestra el campo de texto salvo para 'other' — un caller
      // que igual lo mande no debe filtrarse a la fila insertada.
      await result.current.submit_report({ reason: 'misleading', reason_text: 'texto que no debería viajar' });
    });

    expect(mock.calls[0]?.row.reason_text).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boundary / error
// ---------------------------------------------------------------------------

describe('useReportProperty — boundary / error', () => {
  it('EC-14 error de red (insert rechazado): no lanza, ok:false, mensaje distinto del de duplicado', async () => {
    const mock = make_client(rejecting_insert as unknown as () => Promise<InsertResult>);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    let res!: SubmitReportResult;
    let threw: unknown = null;
    await act(async () => {
      try {
        res = await result.current.submit_report({ reason: 'not_exist_fraud' });
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(res).toEqual({ ok: false });
    expect((result.current.error_message ?? '').length).toBeGreaterThan(0);
    expect(result.current.error_message).not.toBe(DUPLICATE_MESSAGE);
  });

  it('EC-15 error genérico del servidor (code distinto de 23505): mensaje propio, ok:false', async () => {
    const mock = make_client(failing_insert('50000', 'internal server error'));
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    let res!: SubmitReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(res).toEqual({ ok: false });
    expect((result.current.error_message ?? '').length).toBeGreaterThan(0);
    expect(result.current.error_message).not.toBe(DUPLICATE_MESSAGE);
  });

  it('EC-16 is_submitting es true SÍNCRONAMENTE al disparar submit_report', async () => {
    const pending = new Promise<InsertResult>(() => {});
    const mock = make_client(() => pending);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    act(() => {
      void result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    // Lectura SÍNCRONA, sin await — is_working_ref se fija antes del primer await.
    expect(result.current.is_submitting).toBe(true);
  });

  it('EC-17 is_submitting vuelve a false tras un éxito', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(result.current.is_submitting).toBe(false);
  });

  it('EC-18 is_submitting vuelve a false tras un error del servidor (no se queda colgado en "enviando")', async () => {
    const mock = make_client(failing_insert('50000'));
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(result.current.is_submitting).toBe(false);
  });

  it('EC-19 error_message se expone tras un fallo y se limpia en el siguiente envío exitoso', async () => {
    const mock_fail = make_client(failing_insert('50000'));
    const { result, rerender } = await renderHook(
      ({ client }: { client: unknown }) =>
        useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: client }),
      { initialProps: { client: mock_fail.client } },
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'not_exist_fraud' });
    });
    expect(result.current.error_message).not.toBeNull();

    const mock_ok = make_client(ok_insert);
    // RNTL 14: rerender es async (memoria rntl14_renderhook_async) — sin
    // `await` corrompe los tests SIGUIENTES del archivo.
    await rerender({ client: mock_ok.client });

    await act(async () => {
      await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(result.current.error_message).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Integridad del cliente supabase-js (#205)
// ---------------------------------------------------------------------------

describe('useReportProperty — 🔴 no desprender métodos de supabase-js (#205)', () => {
  it('EC-20 invoca insert() SOBRE el builder de from(), sin desprenderlo', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportProperty({ property_id: PROPERTY_ID, owner_user_id: OWNER_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(mock.was_detached()).toBe(false);
    expect(mock.calls).toHaveLength(1);
  });
});
