/**
 * Tests fase RED — useReportComment (INSERT directo del cliente a
 * comment_reports desde el botón «Reportar» de un comentario)
 * Archivo SUT: mobile/src/features/comments/hooks/useReportComment.ts
 * Subtarea Taskmaster: 289.7 (tarea #289)
 *
 * Calco de useReportProperty.ts (property-detail/hooks/useReportProperty.ts,
 * 220.5) adaptado a comment_reports (289.3) — misma filosofía (INSERT
 * directo, sin Edge Function; "other" exige texto validado en cliente con
 * `.trim()`; 23505 = mensaje de duplicado exacto), con DOS diferencias
 * deliberadas fijadas por el contrato de esta subtarea:
 *
 *   1. La firma NO recibe comment_id en la construcción del hook —
 *      `useReportComment(opts?)` es genérico y `report(comment_id, reason,
 *      reason_text)` recibe el id en cada llamada (un solo hook sirve para
 *      reportar cualquier comentario del hilo, no uno fijo por instancia).
 *   2. SIN guard de "no reportar lo propio" EN EL CLIENTE — a diferencia del
 *      OWNER_GUARD de useReportProperty (ahí el cliente SÍ conoce
 *      owner_user_id de antemano), comment_reports NO guarda el autor del
 *      comentario: el hook no tiene con qué comparar antes de la red. La
 *      regla "el autor no puede reportar su propio comentario" vive
 *      ÚNICAMENTE en el WITH CHECK de comment_reports_insert (migración
 *      20260910200001 §3, decisión (b) de su cabecera) y responde 42501 —
 *      este RED verifica que el hook MAPEA 42501 a un mensaje propio, NUNCA
 *      que lo bloquea antes de llamar a la red.
 *
 * SEAM BAJO TEST:
 *   useReportComment(opts?: { supabase?: unknown }): {
 *     report(comment_id: string, reason: CommentReportReason, reason_text?: string):
 *       Promise<{ok:boolean}>;
 *     reporting: boolean; error: string | null; reported: boolean;
 *   }
 *
 * CommentReportReason reusa los 7 valores de property_report_reason
 * (comment_reports.reason NO tiene enum propio, ver 20260910200001 §1).
 *
 * CONTRATO ANCLADO por supabase/tests/113_comment_reports_test.sql (leído vía
 * la migración, no asumido):
 *   - comment_reports_one_per_user (comment_id, reported_by_user_id) →
 *     segundo INSERT del MISMO usuario sobre el MISMO comentario = 23505.
 *   - CHECK comment_reports_other_requires_text: reason='other' exige
 *     reason_text con ≥1 carácter no-whitespace — mismo `.trim().length>0`
 *     de JS que useReportProperty (fiel al CHECK, que usa una forma
 *     equivalente al trim de JS, no el trim(' ') de Postgres).
 *   - WITH CHECK "no autor" → 42501 si reported_by_user_id insertado es el
 *     autor del comentario (RLS, no CHECK de columna).
 *
 * Memoria supabase_js_metodo_desprendido (#205): `insert()` verifica su
 * propio `this` — desprenderlo del builder de from() lanza (EC-17).
 *
 * EDGE CASES CUBIERTOS (17 casos):
 *
 * ### Happy path
 * - (EC-1) exito_insert_en_comment_reports_con_reported_by_user_id_de_la_sesion
 * - (EC-2) exito_reported_pasa_a_true_tras_el_insert
 * - (EC-3) exito_motivo_other_con_texto_real_viaja_tal_cual_sin_trim
 * - (EC-4) el_insert_va_a_comment_reports_no_a_property_reports_ni_user_reports
 *
 * ### Edge cases del PRD (§18.2 "usuarios pueden reportar comentarios")
 * - (EC-5) no_reportar_dos_veces_23505_mensaje_de_duplicado_exacto
 * - (EC-6) autor_no_puede_reportar_su_propio_comentario_42501_mensaje_propio_sin_guard_en_cliente
 * - (EC-7) motivo_other_sin_reason_text_se_bloquea_en_el_cliente_sin_llamar_a_la_red
 *
 * ### 🔴 Ramas no obvias — CHECK comment_reports_other_requires_text
 * - (EC-8)  motivo_other_con_reason_text_vacio_se_bloquea_en_el_cliente
 * - (EC-9)  motivo_other_con_solo_whitespace_no_ascii_se_bloquea_en_el_cliente
 * - (EC-10) motivo_other_con_un_solo_caracter_no_espacio_se_acepta_boundary
 * - (EC-11) motivo_distinto_de_other_nulifica_reason_text_aunque_el_caller_lo_mande
 *
 * ### Boundary / error
 * - (EC-12) error_generico_no_23505_no_42501_mensaje_propio_ok_false
 * - (EC-13) error_de_red_insert_rechazado_no_lanza_ok_false
 * - (EC-14) reporting_true_sincronamente_al_disparar_report
 * - (EC-15) reporting_false_tras_exito_y_tras_error
 * - (EC-16) reported_se_reinicia_a_false_sincronamente_al_iniciar_un_nuevo_report
 *
 * ### 🔴 Integridad del cliente supabase-js (#205)
 * - (EC-17) no_desprende_insert_del_cliente_this_se_preserva
 */

import { renderHook, act } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context';

import { useReportComment, type SubmitCommentReportResult } from '../hooks/useReportComment';

// ---------------------------------------------------------------------------
// Mock de useAuth — se hoistea al inicio del archivo (patrón useReportProperty.test.tsx).
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const REPORTER_ID = 'usuario-reportante-uuid-289';
const COMMENT_ID_A = 'comentario-reportado-uuid-289-a';
const COMMENT_ID_B = 'comentario-reportado-uuid-289-b';

const DUPLICATE_MESSAGE = 'Ya reportaste este comentario.';
const SELF_REPORT_MESSAGE = 'No puedes reportar tu propio comentario.';
const OTHER_TEXT_REQUIRED_MESSAGE = 'Escribe el motivo del reporte.';
const GENERIC_ERROR_MESSAGE = 'No se pudo enviar el reporte. Intenta de nuevo.';

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Helpers de mock del cliente supabase-js (calco useReportProperty.test.tsx)
// ---------------------------------------------------------------------------

type InsertResult = { error: { message: string; code?: string } | null };
type InsertCall = Record<string, unknown>;

function make_client(behavior: () => Promise<InsertResult>): {
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

const rejecting_insert = (): Promise<InsertResult> => Promise.reject(new Error('Network request failed'));

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

describe('useReportComment — happy path', () => {
  it('EC-1 éxito: INSERT con reported_by_user_id de la sesión', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    let res!: SubmitCommentReportResult;
    await act(async () => {
      res = await result.current.report(COMMENT_ID_A, 'inappropriate');
    });

    expect(res).toEqual({ ok: true });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toEqual({
      table: 'comment_reports',
      row: { comment_id: COMMENT_ID_A, reported_by_user_id: REPORTER_ID, reason: 'inappropriate', reason_text: null },
    });
  });

  it('EC-2 éxito: reported pasa a true tras el insert', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    expect(result.current.reported).toBe(false);
    await act(async () => {
      await result.current.report(COMMENT_ID_A, 'inappropriate');
    });
    expect(result.current.reported).toBe(true);
  });

  it('EC-3 éxito motivo other + texto real: viaja TAL CUAL (sin trim)', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    await act(async () => {
      await result.current.report(COMMENT_ID_A, 'other', '  contenido ofensivo real  ');
    });

    expect(mock.calls[0]?.row.reason_text).toBe('  contenido ofensivo real  ');
  });

  it('EC-4 el INSERT va a comment_reports, no a property_reports ni user_reports', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    await act(async () => {
      await result.current.report(COMMENT_ID_A, 'duplicate');
    });

    expect(mock.client.from).toHaveBeenCalledWith('comment_reports');
    expect(mock.client.from).not.toHaveBeenCalledWith('property_reports');
    expect(mock.client.from).not.toHaveBeenCalledWith('user_reports');
  });
});

// ---------------------------------------------------------------------------
// Edge cases del PRD §18.2
// ---------------------------------------------------------------------------

describe('useReportComment — 🔴 PRD §18.2', () => {
  it('EC-5 "no reportar dos veces": 23505 produce el mensaje de duplicado EXACTO', async () => {
    const mock = make_client(failing_insert('23505', 'duplicate key value violates unique constraint'));
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    let res!: SubmitCommentReportResult;
    await act(async () => {
      res = await result.current.report(COMMENT_ID_A, 'duplicate');
    });

    expect(res).toEqual({ ok: false });
    expect(result.current.error).toBe(DUPLICATE_MESSAGE);
  });

  it('EC-6 el autor no puede reportar su propio comentario: 42501, mensaje propio, SIN guard previo en el cliente', async () => {
    const mock = make_client(failing_insert('42501', 'permission denied for table comment_reports'));
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    let res!: SubmitCommentReportResult;
    await act(async () => {
      res = await result.current.report(COMMENT_ID_A, 'inappropriate');
    });

    // A diferencia de useReportProperty (OWNER_GUARD bloquea SIN red), aquí
    // el INSERT SÍ se intenta — es el servidor (RLS) quien lo rechaza.
    expect(mock.calls).toHaveLength(1);
    expect(res).toEqual({ ok: false });
    expect(result.current.error).toBe(SELF_REPORT_MESSAGE);
  });

  it('EC-7 motivo "other" sin reason_text se bloquea en el cliente, sin llamar a la red', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    let res!: SubmitCommentReportResult;
    await act(async () => {
      res = await result.current.report(COMMENT_ID_A, 'other');
    });

    expect(res).toEqual({ ok: false });
    expect(mock.calls).toHaveLength(0);
    expect(result.current.error).toBe(OTHER_TEXT_REQUIRED_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Ramas no obvias — CHECK comment_reports_other_requires_text
// ---------------------------------------------------------------------------

describe('useReportComment — 🔴 boundary del CHECK other_requires_text', () => {
  it('EC-8 reason_text vacío ("") se bloquea en el cliente', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    await act(async () => {
      await result.current.report(COMMENT_ID_A, 'other', '');
    });

    expect(mock.calls).toHaveLength(0);
    expect(result.current.error).toBe(OTHER_TEXT_REQUIRED_MESSAGE);
  });

  it('EC-9 reason_text de solo whitespace NO-ASCII (tab/salto/CR) se bloquea', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    await act(async () => {
      await result.current.report(COMMENT_ID_A, 'other', '\t\n\r ');
    });

    expect(mock.calls).toHaveLength(0);
    expect(result.current.error).toBe(OTHER_TEXT_REQUIRED_MESSAGE);
  });

  it('EC-10 un solo carácter no-espacio ("x") SÍ se acepta (boundary opuesto)', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    let res!: SubmitCommentReportResult;
    await act(async () => {
      res = await result.current.report(COMMENT_ID_A, 'other', 'x');
    });

    expect(res).toEqual({ ok: true });
    expect(mock.calls[0]?.row.reason_text).toBe('x');
  });

  it('EC-11 motivo distinto de "other" nulifica reason_text aunque el caller lo mande', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    await act(async () => {
      await result.current.report(COMMENT_ID_A, 'misleading', 'texto que no debería viajar');
    });

    expect(mock.calls[0]?.row.reason_text).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boundary / error
// ---------------------------------------------------------------------------

describe('useReportComment — boundary / error', () => {
  it('EC-12 error genérico (code distinto de 23505/42501): mensaje propio, ok:false', async () => {
    const mock = make_client(failing_insert('50000', 'internal server error'));
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    let res!: SubmitCommentReportResult;
    await act(async () => {
      res = await result.current.report(COMMENT_ID_A, 'inappropriate');
    });

    expect(res).toEqual({ ok: false });
    expect(result.current.error).toBe(GENERIC_ERROR_MESSAGE);
  });

  it('EC-13 error de red (insert rechazado): no lanza, ok:false', async () => {
    const mock = make_client(rejecting_insert as unknown as () => Promise<InsertResult>);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    let res!: SubmitCommentReportResult;
    let threw: unknown = null;
    await act(async () => {
      try {
        res = await result.current.report(COMMENT_ID_A, 'inappropriate');
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(res).toEqual({ ok: false });
    expect((result.current.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-14 reporting=true SÍNCRONAMENTE al disparar report()', async () => {
    const pending = new Promise<InsertResult>(() => {});
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    act(() => {
      void result.current.report(COMMENT_ID_A, 'inappropriate');
    });

    expect(result.current.reporting).toBe(true);
  });

  it('EC-15 reporting=false tras éxito y tras error', async () => {
    const mock_ok = make_client(ok_insert);
    const { result: result_ok } = await renderHook(() => useReportComment({ supabase: mock_ok.client }));
    await act(async () => {
      await result_ok.current.report(COMMENT_ID_A, 'inappropriate');
    });
    expect(result_ok.current.reporting).toBe(false);

    const mock_fail = make_client(failing_insert('50000'));
    const { result: result_fail } = await renderHook(() => useReportComment({ supabase: mock_fail.client }));
    await act(async () => {
      await result_fail.current.report(COMMENT_ID_A, 'inappropriate');
    });
    expect(result_fail.current.reporting).toBe(false);
  });

  it('EC-16 reported se reinicia a false SÍNCRONAMENTE al iniciar un nuevo report()', async () => {
    // 1ª llamada resuelve de inmediato; la 2ª se queda pendiente a propósito
    // (nunca resuelve) para poder leer el estado SÍNCRONO justo tras dispararla.
    let call_count = 0;
    const behavior = (): Promise<InsertResult> => {
      call_count += 1;
      if (call_count === 1) return Promise.resolve({ error: null });
      return new Promise<InsertResult>(() => {});
    };
    const mock = make_client(behavior);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    await act(async () => {
      await result.current.report(COMMENT_ID_A, 'inappropriate');
    });
    expect(result.current.reported).toBe(true);

    act(() => {
      void result.current.report(COMMENT_ID_B, 'duplicate');
    });
    expect(result.current.reported).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Integridad del cliente supabase-js (#205)
// ---------------------------------------------------------------------------

describe('useReportComment — 🔴 no desprender métodos de supabase-js (#205)', () => {
  it('EC-17 invoca insert() SOBRE el builder de from(), sin desprenderlo', async () => {
    const mock = make_client(ok_insert);
    const { result } = await renderHook(() => useReportComment({ supabase: mock.client }));

    await act(async () => {
      await result.current.report(COMMENT_ID_A, 'inappropriate');
    });

    expect(mock.was_detached()).toBe(false);
    expect(mock.calls).toHaveLength(1);
  });
});
