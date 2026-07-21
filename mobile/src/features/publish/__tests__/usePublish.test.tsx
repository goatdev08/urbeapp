/**
 * Tests fase RED — usePublish hook (mobile/src/features/publish/hooks/usePublish.ts)
 * Subtarea Taskmaster: 8.10 — Connect wizard to Edge Function and test complete flow
 *
 * SUT: usePublish(deps?: { supabase? }): { status, error, property_id, publish }
 *
 * Contrato:
 *   - publish() arma el payload con get_property_payload(state) del PublishFormContext.
 *   - Invoca supabase.functions.invoke('publish-property', { body: payload }).
 *   - En éxito (data.property_id presente, error=null): status='success', expone property_id,
 *     llama reset() → form queda limpio.
 *   - En error (error presente O data sin property_id): status='error', expone mensaje,
 *     NO llama reset (el usuario puede reintentar sin perder datos).
 *   - Expone { status, error, property_id, publish }.
 *     status: 'idle' | 'submitting' | 'success' | 'error'
 *
 * PATRÓN DE MOCK:
 *   El cliente Supabase se inyecta como dep: usePublish({ supabase: mock_supabase }).
 *   mock_supabase = { functions: { invoke: jest.fn() } }
 *   invoke retorna Promise<{ data, error }>.
 *
 * NOTA API: @testing-library/react-native v14 — renderHook es ASYNC.
 *   Patrón: `const { result } = await renderHook(...)`.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) happy_path_invoca_publish_property: invoke llamado una vez con body correcto.
 *
 * ### Edge cases de éxito y error
 * - (EC-2) exito_expone_property_id_y_status_success: data.property_id → status='success', property_id expuesto.
 * - (EC-3) exito_llama_reset_y_limpia_form: tras éxito, state.operation_type vuelve a null.
 * - (EC-4) error_ef_status_error_con_mensaje: respuesta con error → status='error', mensaje, sin reset.
 * - (EC-5) sin_property_id_en_data_trata_como_error: data={} sin property_id → status='error', sin reset.
 * - (EC-6) data_null_sin_error_trata_como_error: data=null, error=null → status='error', sin reset.
 * - (EC-7) invoke_lanza_excepcion_de_red: invoke rechaza → status='error', sin reset, error no null.
 *
 * ### Boundary / estado de la máquina
 * - (EC-8) estado_inicial_es_idle: al montar, status='idle', error=null, property_id=null.
 * - (EC-9) estado_submitting_durante_invocacion: status='submitting' mientras invoke está pendiente.
 * - (EC-10) error_no_hace_reset_form_preserva_datos: tras error, operation_type conserva el valor prellenado.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Wrapper con PublishFormProvider
// ---------------------------------------------------------------------------

import { PublishFormProvider, usePublishForm } from '../store/PublishFormContext';

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { usePublish } from '../hooks/usePublish';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_PROPERTY_ID = 'prop-uuid-test-abc123';

// State válido que satisface los 3 pasos del wizard (todos los campos requeridos).
// video_id/storage_path se conservan en el state (legacy, no cambia PublishFormState)
// para no bloquear el flujo con get_property_payload SIN migrar (RED, 68.12):
// la señal de este archivo es que el body enviado a la EF debe llevar
// cloudflare_uid — no que el flujo entero se caiga por falta de storage_path.
const VALID_FORM_FIELDS = {
  operation_type: 'rent' as const,
  property_type: 'departamento' as const,
  price: 12500,
  address: 'Av. Insurgentes Sur 1234, CDMX',
  lat: 19.3737,
  lng: -99.1731,
  video_id: 'vid-uuid-test-xyz',
  storage_path: 'user-uid-123/vid-uuid-test-xyz.mp4',
  cloudflare_uid: 'cf-stream-uid-test-xyz',
};

// ---------------------------------------------------------------------------
// Factory de mock del cliente Supabase inyectado
// Solo requiere { functions: { invoke } } — no auth ni storage.
// ---------------------------------------------------------------------------

function make_mock_supabase(opts: {
  invoke_result?: { data: unknown; error: unknown };
  invoke_throws?: Error;
}) {
  const { invoke_result, invoke_throws } = opts;

  const mock_invoke = invoke_throws
    ? jest.fn().mockRejectedValue(invoke_throws)
    : jest.fn().mockResolvedValue(invoke_result ?? { data: { property_id: TEST_PROPERTY_ID }, error: null });

  return {
    functions: { invoke: mock_invoke },
    // Expuesto para aserciones directas
    _mock_invoke: mock_invoke,
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PublishFormProvider>{children}</PublishFormProvider>
);

// ---------------------------------------------------------------------------
// Helper: rellena el form con datos válidos dentro de un act() previo
// Devuelve el setter para usarlo en los tests que necesitan acceso dual.
// ---------------------------------------------------------------------------

/**
 * Renderiza el SUT + el form reader en el mismo tree y rellena los campos
 * requeridos antes de retornar.
 * Uso:
 *   const { sut, form, mock_supabase } = await setup_with_valid_state({});
 *   await act(async () => { await sut.publish(); });
 */
async function setup_with_valid_state(opts: {
  invoke_result?: { data: unknown; error: unknown };
  invoke_throws?: Error;
}) {
  const mock_supabase = make_mock_supabase(opts);

  const { result } = await renderHook(
    () => ({
      sut: usePublish({ supabase: mock_supabase }),
      form: usePublishForm(),
    }),
    { wrapper }
  );

  // Prellenamos el form con datos válidos
  await act(async () => {
    result.current.form.update(VALID_FORM_FIELDS);
  });

  return { result, mock_supabase };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePublish', () => {
  // ── (EC-8) Estado inicial ──────────────────────────────────────────────────

  it('(EC-8) estado_inicial_es_idle: al montar, status=idle, error=null, property_id=null', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => usePublish({ supabase: mock_supabase }),
      { wrapper }
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.property_id).toBeNull();
  });

  // ── (EC-1) Happy path — invoca con el body correcto ────────────────────────

  it('(EC-1) happy_path_invoca_publish_property: invoke llamado una vez con body que coincide con get_property_payload(state)', async () => {
    const { result, mock_supabase } = await setup_with_valid_state({});

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);

    // El primer argumento debe ser el nombre de la Edge Function
    const [fn_name, options] = mock_supabase._mock_invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fn_name).toBe('publish-property');

    // El body debe contener todos los campos clave del estado válido
    const body = options.body;
    expect(body.operation_type).toBe(VALID_FORM_FIELDS.operation_type);
    expect(body.property_type).toBe(VALID_FORM_FIELDS.property_type);
    expect(body.price).toBe(VALID_FORM_FIELDS.price);
    expect(body.address).toBe(VALID_FORM_FIELDS.address);
    expect(body.lat).toBe(VALID_FORM_FIELDS.lat);
    expect(body.lng).toBe(VALID_FORM_FIELDS.lng);
    // 68.12 — upload-first: el body debe llevar cloudflare_uid (referencia del
    // video ya subido a Cloudflare Stream a enlazar), no storage_path.
    expect(body.cloudflare_uid).toBe(VALID_FORM_FIELDS.cloudflare_uid);
  });

  // ── (EC-2) Éxito: expone property_id y status='success' ──────────────────

  it('(EC-2) exito_expone_property_id_y_status_success: data con property_id → property_id expuesto, status success', async () => {
    const { result } = await setup_with_valid_state({
      invoke_result: { data: { property_id: TEST_PROPERTY_ID }, error: null },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('success');
    expect(result.current.sut.property_id).toBe(TEST_PROPERTY_ID);
    expect(result.current.sut.error).toBeNull();
  });

  // ── (EC-3) Éxito: llama reset() y limpia el form ─────────────────────────

  it('(EC-3) exito_llama_reset_y_limpia_form: tras éxito, state.operation_type vuelve a null', async () => {
    const { result } = await setup_with_valid_state({
      invoke_result: { data: { property_id: TEST_PROPERTY_ID }, error: null },
    });

    // Confirmamos que el form tenía el valor antes de publish
    expect(result.current.form.state.operation_type).toBe(VALID_FORM_FIELDS.operation_type);

    await act(async () => {
      await result.current.sut.publish();
    });

    // reset() debió limpiar el form → operation_type vuelve al valor inicial null
    expect(result.current.form.state.operation_type).toBeNull();
  });

  // ── (EC-4) Error de la EF: status='error', mensaje, sin reset ─────────────

  it('(EC-4) error_ef_status_error_con_mensaje: respuesta con error → status=error, expone mensaje, sin reset', async () => {
    const { result } = await setup_with_valid_state({
      invoke_result: { data: null, error: { message: 'FORBIDDEN' } },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.error).toMatch(/FORBIDDEN/i);
    expect(result.current.sut.property_id).toBeNull();
    // Form no fue reseteado — operation_type conserva el valor
    expect(result.current.form.state.operation_type).toBe(VALID_FORM_FIELDS.operation_type);
  });

  // ── (EC-5) data sin property_id → error ──────────────────────────────────

  it('(EC-5) sin_property_id_en_data_trata_como_error: data={} sin property_id → status=error, sin reset', async () => {
    const { result } = await setup_with_valid_state({
      invoke_result: { data: {}, error: null },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.property_id).toBeNull();
    // Form preservado — sin reset
    expect(result.current.form.state.operation_type).toBe(VALID_FORM_FIELDS.operation_type);
  });

  // ── (EC-6) data=null, error=null → error ────────────────────────────────

  it('(EC-6) data_null_sin_error_trata_como_error: data=null, error=null → status=error, sin reset', async () => {
    const { result } = await setup_with_valid_state({
      invoke_result: { data: null, error: null },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.property_id).toBeNull();
    expect(result.current.form.state.operation_type).toBe(VALID_FORM_FIELDS.operation_type);
  });

  // ── (EC-7) invoke lanza excepción de red ─────────────────────────────────

  it('(EC-7) invoke_lanza_excepcion_de_red: invoke rechaza con Error → status=error, error no null, sin reset', async () => {
    const { result } = await setup_with_valid_state({
      invoke_throws: new Error('Network request failed'),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.property_id).toBeNull();
    // Form preservado — sin reset
    expect(result.current.form.state.operation_type).toBe(VALID_FORM_FIELDS.operation_type);
  });

  // ── (EC-9) Status 'submitting' mientras invoke está pendiente ─────────────

  it('(EC-9) estado_submitting_durante_invocacion: status=submitting mientras invoke Promise está pendiente', async () => {
    let resolve_invoke!: (v: { data: unknown; error: null }) => void;
    const pending_invoke = new Promise<{ data: unknown; error: null }>((res) => {
      resolve_invoke = res;
    });

    const mock_supabase = {
      functions: { invoke: jest.fn().mockReturnValue(pending_invoke) },
    };

    const { result } = await renderHook(
      () => ({
        sut: usePublish({ supabase: mock_supabase }),
        form: usePublishForm(),
      }),
      { wrapper }
    );

    // Prellenamos el form
    await act(async () => {
      result.current.form.update(VALID_FORM_FIELDS);
    });

    // Inicia publish pero NO awaita — la Promise queda pendiente
    act(() => {
      void result.current.sut.publish();
    });

    // Debe estar en 'submitting' mientras invoke no resuelve
    expect(result.current.sut.status).toBe('submitting');

    // Limpieza: resolvemos para no dejar Promises colgadas
    await act(async () => {
      resolve_invoke({ data: { property_id: TEST_PROPERTY_ID }, error: null });
    });
  });

  // ── (EC-10) Error preserva los datos del form ─────────────────────────────

  it('(EC-10) error_no_hace_reset_form_preserva_datos: tras error, los campos del wizard se conservan', async () => {
    const { result } = await setup_with_valid_state({
      invoke_result: { data: null, error: { message: 'INTERNAL_ERROR' } },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    // Todos los campos clave deben estar intactos
    expect(result.current.form.state.operation_type).toBe(VALID_FORM_FIELDS.operation_type);
    expect(result.current.form.state.property_type).toBe(VALID_FORM_FIELDS.property_type);
    expect(result.current.form.state.price).toBe(VALID_FORM_FIELDS.price);
    expect(result.current.form.state.address).toBe(VALID_FORM_FIELDS.address);
    expect(result.current.form.state.lat).toBe(VALID_FORM_FIELDS.lat);
    expect(result.current.form.state.lng).toBe(VALID_FORM_FIELDS.lng);
    expect(result.current.form.state.video_id).toBe(VALID_FORM_FIELDS.video_id);
    expect(result.current.form.state.storage_path).toBe(VALID_FORM_FIELDS.storage_path);
    expect(result.current.sut.status).toBe('error');
  });
});
