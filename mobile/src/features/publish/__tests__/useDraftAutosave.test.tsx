/**
 * Tests fase RED — useDraftAutosave hook
 * (mobile/src/features/publish/hooks/useDraftAutosave.ts)
 * Subtarea Taskmaster: 73.3 — Wizard 5 pasos + autoguardado de borrador (PRD §14.1)
 *
 * SUT: useDraftAutosave(state: PublishFormState, deps?: { supabase? }): void
 *
 * CONTRATO (PRD §14.1 + gotcha #53 del vault):
 *   - Si el usuario sale del wizard ANTES de completar el paso 5, el sistema
 *     guarda automáticamente como status='draft', SIN pedir confirmación.
 *   - Debounce: NO escribe en cada cambio — espera DRAFT_AUTOSAVE_DEBOUNCE_MS
 *     de inactividad desde el último cambio de `state`.
 *   - Solo escribe cuando existen los campos mínimos que la tabla `properties`
 *     exige NOT NULL (operation_type, property_type, price, address, location):
 *     sin ellos no hay fila válida que crear — no-op silencioso.
 *   - Primera escritura → INSERT (status='draft'); escrituras siguientes →
 *     UPDATE reusando el id del draft ya creado (no duplica filas).
 *   - NUNCA corre en edit_mode=true (editar una property existente no es un
 *     draft nuevo — eso es flujo de usePublish/EF de 73.6).
 *   - edit_mode se lee de `state.edit_mode` (PublishFormState/contexto),
 *     JAMÁS de useLocalSearchParams (bug #53: el modo edición se perdía en la
 *     navegación entre pasos por viajar como URL param).
 *   - Fail-soft: si la escritura falla (sin conexión), el hook NO lanza.
 *   - Al desmontar, limpia el timer pendiente — no escribe después de unmount.
 *
 * PATRÓN DE MOCK: igual que usePublish.edit.test.tsx — cadena
 * from('properties').insert(payload).select('id').single() para la primera
 * escritura, from('properties').update(payload).eq('id', draftId) para las
 * siguientes.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) crea_draft_status_draft_tras_debounce: campos mínimos completos +
 *   debounce transcurrido → INSERT con status='draft' y los campos correctos.
 * - (EC-2) segunda_escritura_hace_update_reusa_id: tras el primer draft
 *   creado, un cambio posterior hace UPDATE (no un segundo INSERT).
 *
 * ### Edge cases del PRD §14.1
 * - (EC-3) no_escribe_antes_del_debounce: sin esperar el intervalo completo,
 *   no hay escritura.
 * - (EC-4) cambios_rapidos_colapsan_en_una_escritura_con_el_ultimo_valor:
 *   varias ediciones dentro de la ventana de debounce → UNA sola escritura,
 *   con el valor más reciente (no uno intermedio, no el primero).
 * - (EC-5) edit_mode_nunca_escribe: edit_mode=true con campos mínimos
 *   completos y tiempo de sobra → nunca INSERT ni UPDATE.
 * - (EC-6) sin_campos_minimos_no_escribe: solo operation_type/property_type
 *   (step1+2) sin price/address/lat/lng → no hay fila válida, no escribe.
 *
 * ### Ramas de reglas no obvias
 * - (EC-8) lee_edit_mode_de_state_no_de_url_params: regresión bug #53 — un
 *   useLocalSearchParams mockeado con datos contradictorios NO debe ganarle
 *   a state.edit_mode.
 * - (EC-10) flip_a_edit_mode_a_medio_tecleo_cancela_escritura_pendiente.
 *
 * ### Boundary / error
 * - (EC-7) escritura_falla_sin_crashear: INSERT rechaza (sin conexión) → el
 *   hook no lanza.
 * - (EC-9) desmontar_antes_del_debounce_no_escribe: cleanup del timer al
 *   unmount.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import { INITIAL_PUBLISH_FORM_STATE } from '../store/types';
import type { PublishFormState } from '../store/types';

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import {
  useDraftAutosave,
  DRAFT_AUTOSAVE_DEBOUNCE_MS,
  clear_current_draft,
  get_current_draft_id,
} from '../hooks/useDraftAutosave';

// ---------------------------------------------------------------------------
// Mock de expo-router — EC-8 necesita controlar useLocalSearchParams para
// probar que el hook lo IGNORA (lee edit_mode de state, no de la URL).
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const DRAFT_ID = 'draft-prop-uuid-test-1';
const USER_ID = 'user-uuid-test-1';

const MINIMUM_DRAFT_FIELDS: Partial<PublishFormState> = {
  operation_type: 'rent',
  property_type: 'departamento',
  price: 12500,
  address: 'Av. Insurgentes Sur 1602, CDMX',
  lat: 19.3836,
  lng: -99.1748,
};

// ---------------------------------------------------------------------------
// Helpers — snake_case por convención de factories de test del repo.
// ---------------------------------------------------------------------------

function build_state(overrides: Partial<PublishFormState> = {}): PublishFormState {
  return { ...INITIAL_PUBLISH_FORM_STATE, ...overrides };
}

/**
 * Mock del cliente Supabase inyectado — soporta las dos cadenas que el hook
 * necesita:
 *   from('properties').insert(payload).select('id').single()   (1ª escritura)
 *   from('properties').update(payload).eq('id', draftId)       (siguientes)
 */
function make_mock_supabase_draft(opts: {
  insert_result?: { data: unknown; error: unknown };
  update_result?: { data: unknown; error: unknown };
}) {
  const {
    insert_result = { data: { id: DRAFT_ID }, error: null },
    update_result = { data: [{ id: DRAFT_ID }], error: null },
  } = opts;

  const mock_single = jest.fn().mockResolvedValue(insert_result);
  const mock_select = jest.fn().mockReturnValue({ single: mock_single });
  const mock_insert = jest.fn().mockReturnValue({ select: mock_select });

  const mock_eq = jest.fn().mockResolvedValue(update_result);
  const mock_update = jest.fn().mockReturnValue({ eq: mock_eq });

  const mock_from = jest.fn().mockReturnValue({ insert: mock_insert, update: mock_update });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_insert: mock_insert,
    _mock_select: mock_select,
    _mock_single: mock_single,
    _mock_update: mock_update,
    _mock_eq: mock_eq,
  };
}

type MockSupabaseDraft = ReturnType<typeof make_mock_supabase_draft>;

function render_autosave(
  initial_state: PublishFormState,
  mock_supabase: MockSupabaseDraft,
  get_user_id: () => Promise<string | null> = () => Promise.resolve(USER_ID),
) {
  return renderHook(
    ({ state }: { state: PublishFormState }) =>
      useDraftAutosave(state, {
        // El mock no es un SupabaseClient completo — el hook solo usa .from()
        // (y .auth solo cuando NO se inyecta get_user_id).
        supabase: mock_supabase as never,
        get_user_id,
      }),
    { initialProps: { state: initial_state } },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDraftAutosave', () => {
  beforeEach(async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
    // Drenar microtareas pendientes de guardados del test anterior ANTES de
    // limpiar el draft id de módulo — una cadena a medio resolver podría
    // asignarlo DESPUÉS del clear y contaminar este test.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // #127(6): el draft id vive a nivel de módulo — limpiarlo entre tests.
    clear_current_draft();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.warn as jest.Mock).mockRestore();
  });

  // ── (EC-1) Happy path: crea el draft tras el debounce ──────────────────────

  it('(EC-1) crea_draft_status_draft_tras_debounce: con los campos mínimos completos, tras esperar el debounce hace INSERT con status=draft', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    const [insert_payload] = mock_supabase._mock_insert.mock.calls[0] as [Record<string, unknown>];
    expect(insert_payload.status).toBe('draft');
    expect(insert_payload.operation_type).toBe('rent');
    expect(insert_payload.property_type).toBe('departamento');
    expect(insert_payload.price).toBe(12500);
    expect(insert_payload.address).toBe('Av. Insurgentes Sur 1602, CDMX');

    jest.useRealTimers();
  });

  // ── (EC-2) Segunda escritura hace UPDATE, reusa el id del draft ────────────

  it('(EC-2) segunda_escritura_hace_update_reusa_id: tras el primer draft creado, un cambio posterior hace UPDATE (no un segundo INSERT)', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    const { rerender } = await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });
    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ state: build_state({ ...MINIMUM_DRAFT_FIELDS, price: 13000 }) });
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });

    // No debe haber un segundo INSERT — el draft ya existe.
    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_eq).toHaveBeenCalledWith('id', DRAFT_ID);
    const [update_payload] = mock_supabase._mock_update.mock.calls[0] as [Record<string, unknown>];
    expect(update_payload.price).toBe(13000);

    jest.useRealTimers();
  });

  // ── (EC-3) No escribe antes del debounce ───────────────────────────────────

  it('(EC-3) no_escribe_antes_del_debounce: sin esperar el intervalo completo, no hay escritura', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS - 200);
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  // ── (EC-4) Cambios rápidos colapsan en UNA escritura con el último valor ──

  it('(EC-4) cambios_rapidos_colapsan_en_una_escritura_con_el_ultimo_valor: varias ediciones dentro de la ventana de debounce → una sola escritura con el valor más reciente', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    const { rerender } = await render_autosave(
      build_state({ ...MINIMUM_DRAFT_FIELDS, price: 10000 }),
      mock_supabase,
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS / 2);
    });
    await act(async () => {
      rerender({ state: build_state({ ...MINIMUM_DRAFT_FIELDS, price: 11000 }) });
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS / 2);
    });
    await act(async () => {
      rerender({ state: build_state({ ...MINIMUM_DRAFT_FIELDS, price: 12000 }) });
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    const [insert_payload] = mock_supabase._mock_insert.mock.calls[0] as [Record<string, unknown>];
    expect(insert_payload.price).toBe(12000);

    jest.useRealTimers();
  });

  // ── (EC-5) edit_mode nunca escribe ──────────────────────────────────────────

  it('(EC-5) edit_mode_nunca_escribe: edit_mode=true con campos mínimos completos y tiempo de sobra → nunca INSERT ni UPDATE', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    await render_autosave(
      build_state({ ...MINIMUM_DRAFT_FIELDS, edit_mode: true, property_id: 'prop-existing-1' }),
      mock_supabase,
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS * 3);
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();
    expect(mock_supabase._mock_update).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  // ── (EC-6) Sin campos mínimos no escribe ────────────────────────────────────

  it('(EC-6) sin_campos_minimos_no_escribe: solo operation_type/property_type (step1+2), sin price/address/lat/lng → no hay fila válida, no escribe', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    await render_autosave(
      build_state({ operation_type: 'rent', property_type: 'departamento' }),
      mock_supabase,
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS * 2);
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  // ── (EC-7) Escritura falla sin crashear ─────────────────────────────────────

  it('(EC-7) escritura_falla_sin_crashear: INSERT rechaza (sin conexión) → el hook no lanza', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    mock_supabase._mock_single.mockRejectedValue(new Error('Network request failed'));
    jest.useFakeTimers();

    let caught_error: unknown = null;
    try {
      await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
      });
    } catch (e) {
      caught_error = e;
    }

    expect(caught_error).toBeNull();

    jest.useRealTimers();
  });

  // ── (EC-8) Lee edit_mode de state, no de useLocalSearchParams (bug #53) ────

  it('(EC-8) lee_edit_mode_de_state_no_de_url_params: state.edit_mode=true gana aunque useLocalSearchParams diga lo contrario (regresión #53)', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      edit_mode: 'false',
      property_id: 'from-url-param-no-confiable',
    });

    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    await render_autosave(
      build_state({ ...MINIMUM_DRAFT_FIELDS, edit_mode: true, property_id: 'prop-existing-2' }),
      mock_supabase,
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS * 2);
    });

    // Si el hook leyera (incorrectamente) del URL param, escribiría porque
    // 'false' string ahí sugeriría "no es edit mode". Debe ganar state.edit_mode.
    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  // ── (EC-9, INVERTIDO en #127(4)) Desmontar con cambios pendientes GUARDA ────
  // El contrato original ("desmontar antes del debounce no escribe") fijaba el
  // bug: salir del wizard antes de 1.5 s de silencio perdía el borrador — justo
  // el caso de uso que el PRD §14.1 documenta. Ahora el cleanup de desmontaje
  // dispara un guardado inmediato con el último estado.

  it('(EC-9) desmontar_con_cambios_pendientes_guarda_de_inmediato (#127(4))', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    const { unmount } = await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);

    // Desmonta ANTES de que el debounce dispare — el flush debe guardar igual.
    await act(async () => {
      unmount();
      await jest.advanceTimersByTimeAsync(0); // microtasks del flush
    });
    // Drenar la cadena completa del guardado (get_user_id → insert → id).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    const [insert_payload] = mock_supabase._mock_insert.mock.calls[0] as [Record<string, unknown>];
    expect(insert_payload.status).toBe('draft');
    // La cadena terminó DENTRO de este test (no contamina al siguiente).
    expect(get_current_draft_id()).toBe(DRAFT_ID);

    await act(async () => {
      await jest.runOnlyPendingTimersAsync();
    });
    jest.useRealTimers();
  });

  it('(EC-9b) desmontar_sin_campos_minimos_no_escribe: el flush respeta el gate de fila válida', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    const { unmount } = await render_autosave(
      build_state({ operation_type: 'rent' }),
      mock_supabase,
    );

    await act(async () => {
      unmount();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();

    await act(async () => {
      await jest.runOnlyPendingTimersAsync();
    });
    jest.useRealTimers();
  });

  // ── (EC-10) Flip a edit_mode a medio-tecleo cancela la escritura pendiente ─

  it('(EC-10) flip_a_edit_mode_a_medio_tecleo_cancela_escritura_pendiente: si edit_mode cambia a true antes de que dispare el debounce, no escribe', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    const { rerender } = await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS / 2);
    });

    await act(async () => {
      rerender({
        state: build_state({ ...MINIMUM_DRAFT_FIELDS, edit_mode: true, property_id: 'prop-existing-3' }),
      });
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS * 2);
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // #127 — los 6 defectos del hook original
  // ═══════════════════════════════════════════════════════════════════════════

  it('(#127-1) insert_incluye_owner_user_id_de_la_sesion: la columna es NOT NULL y la RLS lo exige — sin él NINGÚN insert pasaba', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    const [insert_payload] = mock_supabase._mock_insert.mock.calls[0] as [Record<string, unknown>];
    expect(insert_payload.owner_user_id).toBe(USER_ID);

    jest.useRealTimers();
  });

  it('(#127-1b) sin_sesion_no_escribe: get_user_id null → no hay fila válida que crear', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    await render_autosave(
      build_state(MINIMUM_DRAFT_FIELDS),
      mock_supabase,
      () => Promise.resolve(null),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS * 2);
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('(#127-2) insert_lento_no_duplica_filas: un segundo disparo mientras el primer INSERT sigue volando NO hace otro INSERT', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    // INSERT que no resuelve hasta que lo soltemos manualmente.
    let release_insert: (v: { data: unknown; error: unknown }) => void = () => {};
    mock_supabase._mock_single.mockImplementation(
      () => new Promise((resolve) => {
        release_insert = resolve;
      }),
    );
    jest.useFakeTimers();

    const { rerender } = await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);

    // Primer disparo — INSERT queda en vuelo (single() pendiente).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });
    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);

    // Cambio + segundo disparo COMPLETO mientras el primero sigue volando.
    await act(async () => {
      rerender({ state: build_state({ ...MINIMUM_DRAFT_FIELDS, price: 999 }) });
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });

    // El defecto original: draft_id aún null → segundo INSERT → dos borradores.
    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);

    // Soltar el primer INSERT — ahora sí registra el draft id.
    await act(async () => {
      release_insert({ data: { id: DRAFT_ID }, error: null });
    });
    expect(get_current_draft_id()).toBe(DRAFT_ID);

    await act(async () => {
      await jest.runOnlyPendingTimersAsync();
    });
    jest.useRealTimers();
  });

  it('(#127-3) update_con_error_de_rls_se_loguea: el error de supabase-js no lanza — leerlo o perderlo', async () => {
    const mock_supabase = make_mock_supabase_draft({
      update_result: { data: null, error: { message: 'RLS: row-level security violation' } },
    });
    jest.useFakeTimers();

    const { rerender } = await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });
    await act(async () => {
      rerender({ state: build_state({ ...MINIMUM_DRAFT_FIELDS, price: 500 }) });
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });

    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE del borrador falló'),
      expect.stringContaining('RLS'),
    );

    jest.useRealTimers();
  });

  it('(#127-6) el_draft_id_sobrevive_al_desmontaje: salir y volver a entrar al wizard hace UPDATE del MISMO draft, no un segundo INSERT', async () => {
    const mock_supabase = make_mock_supabase_draft({});
    jest.useFakeTimers();

    // Primera sesión de wizard: crea el draft.
    const first = await render_autosave(build_state(MINIMUM_DRAFT_FIELDS), mock_supabase);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });
    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.unmount();
      await jest.advanceTimersByTimeAsync(0);
    });

    // Segunda sesión (remonta el wizard): debe REUSAR el draft.
    await render_autosave(build_state({ ...MINIMUM_DRAFT_FIELDS, price: 777 }), mock_supabase);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DEBOUNCE_MS);
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1); // sigue siendo UNO
    expect(mock_supabase._mock_update).toHaveBeenCalled();
    expect(mock_supabase._mock_eq).toHaveBeenCalledWith('id', DRAFT_ID);

    jest.useRealTimers();
  });
});
