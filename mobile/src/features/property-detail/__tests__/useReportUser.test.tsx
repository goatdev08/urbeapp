/**
 * Tests fase RED — useReportUser (INSERT directo del cliente a user_reports
 * desde el botón «Reportar» de AgentCard, módulo 041-M3, tarea #220, subtarea
 * 220.6 "Reporte de perfil de publicador (alcance mínimo)")
 * Archivo SUT: mobile/src/features/property-detail/hooks/useReportUser.ts
 * Subtarea Taskmaster: 220.6
 *
 * SEAM BAJO TEST (firma pública, DI del cliente — sibling hook de
 * useReportProperty, 220.5. Ver decisión ponytail en la subtarea: sibling en
 * vez de generalizar el hook existente, para no tocar código ya GREEN/mergeado
 * de 220.5 y no romper su contrato — el sibling repite el patrón, pero el
 * SHEET (ReportPropertySheet) SÍ se reusa sin modificar su lógica, solo un
 * prop `title` opcional nuevo — ver ReportPropertySheet.test.tsx):
 *
 *   useReportUser({ reported_user_id: string; supabase?: unknown }): {
 *     submit_report(input: { reason: UserReportReason; reason_text?: string }):
 *       Promise<{ ok: true } | { ok: false }>;
 *     is_submitting: boolean;
 *     error_message: string | null;
 *   }
 *
 * UserReportReason = PropertyReportReason (mismo enum reusado a nivel SQL,
 * decisión documentada en supabase/migrations/20260828000005_user_reports.sql
 * — NO se crea un enum gemelo). Los 7 valores: not_exist_fraud | misleading |
 * false_price | wrong_address | inappropriate | duplicate | other.
 *
 * 🔴 DECISIÓN 2026-08-28 (Abraham, alcance mínimo): INSERT DIRECTO del cliente
 * a public.user_reports — NO hay Edge Function (mismo criterio que 220.5).
 * reported_by_user_id SIEMPRE sale de la sesión (useAuth), nunca de un
 * parámetro externo.
 *
 * CONTRATO ANCLADO POR supabase/tests/76_user_reports_test.sql (leído, no
 * asumido):
 *   - RLS user_reports_insert exige reported_by_user_id = auth.uid() (RLS2).
 *   - Índice único user_reports_one_per_user(reported_user_id,
 *     reported_by_user_id) → segundo INSERT del MISMO reportante sobre el
 *     MISMO publicador = 23505 (DEDUPE1b) → PRD §24.2 (mismo mecanismo que
 *     §24.1 "un usuario no puede reportar la misma propiedad dos veces").
 *   - CHECK user_reports_other_requires_text: idéntico a property_reports
 *     (reason='other' exige reason_text con >=1 carácter no-whitespace,
 *     OTHER1/OTHER2/OTHER3/OTHER6 del SQL) — el JS `.trim().length > 0` es fiel
 *     al `~ '\S'` de Postgres (recorta TODO whitespace Unicode, no solo ' ').
 *   - CHECK user_reports_no_self_report (`reported_user_id <>
 *     reported_by_user_id`, SELF1 del SQL) — invariante NUEVA sin equivalente
 *     en useReportProperty (una propiedad no tiene identidad de usuario
 *     comparable a auth.uid(); un perfil sí, por eso aquí SÍ hay un guard
 *     directo "no puedes reportarte a ti mismo").
 *
 * 🔴 GUARD DE AUTO-REPORTE (2ª capa — la 1ª es que AgentCard oculta el botón
 * cuando is_self=true, ver AgentCard.test.tsx): si `reported_user_id ===
 * user.id` de la sesión, `submit_report` NO llama a la red — resuelve
 * `{ok:false}` de inmediato con SELF_REPORT_MESSAGE. La 3ª capa es el CHECK
 * SQL (user_reports_no_self_report) — defensa en profundidad, como con el
 * guard de owner de useReportProperty.
 *
 * 🔴 «Otro» sin texto real se bloquea EN EL CLIENTE antes de llamar a la red
 * (mismo principio que useReportProperty — el CHECK SQL es la última capa).
 *
 * 🔴 NO SE DESPRENDE `client.from` DEL CLIENTE (nota supabase_js_metodo_desprendido
 * / regla #205): mismo EC de useReportProperty (EC-20).
 *
 * GOTCHAS RNTL ya pagados (memoria rntl14_renderhook_async): `renderHook` y
 * `rerender` son ASYNC — siempre con `await`; lectura SÍNCRONA de is_submitting
 * (EC-13) antes del primer await.
 *
 * EDGE CASES CUBIERTOS (18 casos):
 *
 * ### Happy path
 * - (EC-1)  exito_motivo_simple_sin_texto_reported_by_user_id_de_la_sesion
 * - (EC-2)  exito_motivo_other_con_texto_real_el_texto_viaja_tal_cual
 * - (EC-3)  el_insert_va_a_user_reports_no_a_property_reports_ni_saves_ni_likes
 * - (EC-4)  reported_by_user_id_es_siempre_el_de_la_sesion_nunca_un_parametro_externo
 *
 * ### Edge cases del PRD (§24.2)
 * - (EC-5)  dedupe_23505_produce_el_mensaje_de_duplicado_exacto
 * - (EC-6)  no_puedes_reportarte_a_ti_mismo_guard_en_el_hook_sin_llamar_red
 * - (EC-7)  motivo_other_sin_reason_text_se_bloquea_en_el_cliente_sin_llamar_red
 *
 * ### 🔴 Ramas no obvias — CHECK user_reports_other_requires_text (mirror 76_*.sql)
 * - (EC-8)  motivo_other_con_reason_text_vacio_se_bloquea_en_el_cliente
 * - (EC-9)  motivo_other_con_reason_text_de_solo_espacios_ascii_se_bloquea_en_el_cliente
 * - (EC-10) motivo_other_con_reason_text_de_solo_whitespace_no_ascii_tab_salto_se_bloquea_en_el_cliente
 * - (EC-11) motivo_other_con_un_solo_caracter_no_espacio_se_acepta_boundary
 * - (EC-12) motivo_distinto_de_other_nulifica_reason_text_aunque_el_caller_lo_mande
 *
 * ### Boundary / error
 * - (EC-13) is_submitting_true_sincronamente_al_disparar_submit_report
 * - (EC-14) is_submitting_false_tras_exito
 * - (EC-15) error_de_red_insert_rechazado_no_lanza_ok_false_mensaje_propio
 * - (EC-16) error_generico_del_servidor_no_23505_produce_mensaje_propio_ok_false
 * - (EC-17) error_message_se_expone_tras_un_fallo_y_se_limpia_en_el_siguiente_exito
 *
 * ### 🔴 Integridad del cliente supabase-js (#205)
 * - (EC-18) no_desprende_from_del_cliente_this_se_preserva_en_insert
 */

import { renderHook, act } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context';
import {
  useReportUser,
  type SubmitUserReportResult,
} from '../hooks/useReportUser';

// ---------------------------------------------------------------------------
// Mock de useAuth — jest.mock() se hoistea al inicio del archivo.
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const REPORTER_ID = 'usuario-reportante-uuid-220-6';
const TARGET_ID = 'usuario-publicador-reportado-uuid-220-6';

/**
 * Copys ancla (fuente independiente — literales decididos en este RED, NUNCA
 * recomputados desde el SUT). Si el GREEN cambia el texto exacto, el guardian
 * debe verlo como una decisión deliberada, no un accidente.
 */
const DUPLICATE_MESSAGE = 'Ya reportaste a este usuario.';
const SELF_REPORT_MESSAGE = 'No puedes reportarte a ti mismo.';
const OTHER_TEXT_REQUIRED_MESSAGE = 'Escribe el motivo del reporte.';

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Helpers de mock del cliente supabase-js
// ---------------------------------------------------------------------------

type InsertResult = { error: { message: string; code?: string } | null };
type InsertCall = Record<string, unknown>;

/**
 * Mock de `client.from('user_reports').insert({...})`. `insert` verifica su
 * propio `this`: si el hook desprende el método, `this` deja de ser el
 * builder — EC-18 lo caza.
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

/** user autenticado por defecto — el reportante, NUNCA el publicador reportado. */
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

describe('useReportUser — happy path', () => {
  it('EC-1 éxito con motivo simple sin texto: INSERT con reported_by_user_id de la sesión, ok:true', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    let res!: SubmitUserReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(res).toEqual({ ok: true });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toEqual({
      table: 'user_reports',
      row: {
        reported_user_id: TARGET_ID,
        reported_by_user_id: REPORTER_ID,
        reason: 'not_exist_fraud',
        reason_text: null,
      },
    });
  });

  it('EC-2 éxito con motivo other + texto real: el texto viaja TAL CUAL (sin trim)', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'other', reason_text: '  perfil sospechoso, mismo texto en varios anuncios  ' });
    });

    expect(mock.calls[0]?.row.reason_text).toBe('  perfil sospechoso, mismo texto en varios anuncios  ');
    expect(mock.calls[0]?.row.reason).toBe('other');
  });

  it('EC-3 el INSERT va a from("user_reports"), no a "property_reports", "saves" ni "likes"', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'duplicate' });
    });

    expect(mock.client.from).toHaveBeenCalledWith('user_reports');
    expect(mock.client.from).not.toHaveBeenCalledWith('property_reports');
    expect(mock.client.from).not.toHaveBeenCalledWith('saves');
    expect(mock.client.from).not.toHaveBeenCalledWith('likes');
  });

  it('EC-4 reported_by_user_id es SIEMPRE el de la sesión, nunca un parámetro externo', async () => {
    set_auth_user('otro-usuario-de-sesion-uuid');
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    await act(async () => {
      // SubmitUserReportInput no expone reported_by_user_id — no hay forma de
      // inyectarlo desde el caller. Solo verificamos que el insert usa el id
      // de useAuth() vigente, distinto de REPORTER_ID (el default global).
      await result.current.submit_report({ reason: 'misleading' });
    });

    expect(mock.calls[0]?.row.reported_by_user_id).toBe('otro-usuario-de-sesion-uuid');
  });
});

// ---------------------------------------------------------------------------
// Edge cases del PRD §24.2
// ---------------------------------------------------------------------------

describe('useReportUser — 🔴 PRD §24.2', () => {
  it('EC-5 dedupe: 23505 produce el mensaje de duplicado EXACTO', async () => {
    const mock = make_client(failing_insert('23505', 'duplicate key value violates unique constraint'));
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    let res!: SubmitUserReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'duplicate' });
    });

    expect(res).toEqual({ ok: false });
    expect(result.current.error_message).toBe(DUPLICATE_MESSAGE);
  });

  it('EC-6 no puedes reportarte a ti mismo: guard en el hook, sin llamar a la red', async () => {
    set_auth_user(TARGET_ID); // la sesión ES el publicador que se intenta reportar
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    let res!: SubmitUserReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(res).toEqual({ ok: false });
    expect(mock.calls).toHaveLength(0);
    expect(result.current.error_message).toBe(SELF_REPORT_MESSAGE);
  });

  it('EC-7 motivo "other" sin reason_text se bloquea en el cliente, sin llamar a la red', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    let res!: SubmitUserReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'other' });
    });

    expect(res).toEqual({ ok: false });
    expect(mock.calls).toHaveLength(0);
    expect(result.current.error_message).toBe(OTHER_TEXT_REQUIRED_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Ramas no obvias — CHECK user_reports_other_requires_text
// (mirror boundary de supabase/tests/76_user_reports_test.sql)
// ---------------------------------------------------------------------------

describe('useReportUser — 🔴 boundary del CHECK other_requires_text', () => {
  it('EC-8 reason_text vacío ("") se bloquea en el cliente', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    let res!: SubmitUserReportResult;
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
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
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
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
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
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    let res!: SubmitUserReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'other', reason_text: 'x' });
    });

    expect(res).toEqual({ ok: true });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.row.reason_text).toBe('x');
  });

  it('EC-12 motivo distinto de "other" nulifica reason_text aunque el caller lo mande', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    await act(async () => {
      // El sheet NO muestra el campo de texto salvo para 'other' — un caller
      // que igual lo mande no debe filtrarse a la fila insertada.
      await result.current.submit_report({ reason: 'misleading', reason_text: 'texto que no debería viajar' });
    });

    expect(mock.calls[0]?.row.reason_text).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boundary / error
// ---------------------------------------------------------------------------

describe('useReportUser — boundary / error', () => {
  it('EC-13 is_submitting es true SÍNCRONAMENTE al disparar submit_report', async () => {
    const pending = new Promise<InsertResult>(() => {});
    const mock = make_client(() => pending);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    act(() => {
      void result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    // Lectura SÍNCRONA, sin await — is_working_ref se fija antes del primer await.
    expect(result.current.is_submitting).toBe(true);
  });

  it('EC-14 is_submitting vuelve a false tras un éxito', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(result.current.is_submitting).toBe(false);
  });

  it('EC-15 error de red (insert rechazado): no lanza, ok:false, mensaje propio', async () => {
    const mock = make_client(rejecting_insert as unknown as () => Promise<InsertResult>);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    let res!: SubmitUserReportResult;
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

  it('EC-16 error genérico del servidor (code distinto de 23505): mensaje propio, ok:false', async () => {
    const mock = make_client(failing_insert('50000', 'internal server error'));
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    let res!: SubmitUserReportResult;
    await act(async () => {
      res = await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(res).toEqual({ ok: false });
    expect((result.current.error_message ?? '').length).toBeGreaterThan(0);
    expect(result.current.error_message).not.toBe(DUPLICATE_MESSAGE);
  });

  it('EC-17 error_message se expone tras un fallo y se limpia en el siguiente envío exitoso', async () => {
    const mock_fail = make_client(failing_insert('50000'));
    const { result, rerender } = await renderHook(
      ({ client }: { client: unknown }) =>
        useReportUser({ reported_user_id: TARGET_ID, supabase: client }),
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

describe('useReportUser — 🔴 no desprender métodos de supabase-js (#205)', () => {
  it('EC-18 invoca insert() SOBRE el builder de from(), sin desprenderlo', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() =>
      useReportUser({ reported_user_id: TARGET_ID, supabase: mock.client }),
    );

    await act(async () => {
      await result.current.submit_report({ reason: 'not_exist_fraud' });
    });

    expect(mock.was_detached()).toBe(false);
  });
});
