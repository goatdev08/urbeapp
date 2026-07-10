/**
 * Tests fase RED — usePublish hook: bifurcación create vs edit (modo edición)
 * (mobile/src/features/publish/hooks/usePublish.ts)
 * Subtarea Taskmaster: 17.8 — Implement edit flow pre-filling publication wizard
 *
 * SUT: usePublish(deps?) → { status, error, property_id, publish }
 *   con extensión: deps.editMode=true, deps.propertyId='...'
 *
 * Contrato (edit mode):
 *   - En edit mode: publish() invoca supabase.from('properties').update({...}).eq('id', propertyId).
 *     NO invoca functions.invoke('publish-property') (EF).
 *   - El update incluye los campos editables exactos.
 *   - Si no hay video_local_uri nuevo, el update NO incluye campos de video.
 *   - En create mode (sin editMode): EXACTAMENTE el comportamiento actual — invoca la EF.
 *     (Tests de regresión: garantizan que no se rompió el flujo de creación.)
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Regresión — create mode (no debe cambiar)
 * - (EC-R1) create_mode_invoca_ef_publish_property
 * - (EC-R2) create_mode_no_invoca_update_directo
 *
 * ### Edit mode — happy path
 * - (EC-11) edit_mode_invoca_update_no_ef
 * - (EC-12) edit_mode_update_shape_correcto
 * - (EC-13) edit_mode_update_eq_property_id
 * - (EC-17) edit_mode_exito_expone_status_success
 *
 * ### Edit mode — video
 * - (EC-14) edit_mode_sin_cambiar_video_no_sube_video
 * - (EC-18) edit_mode_no_requiere_video_para_submit
 *
 * ### Edit mode — error
 * - (EC-16) edit_mode_error_update_expone_error
 *
 * ### Propagación edit_mode/property_id vía PublishFormContext (53.1, RED)
 * SUT ampliado: PublishFormContext.tsx / types.ts — opción A de la exploración
 * `.taskmaster/docs/exploraciones/031-bug-edicion-publicacion-duplica.md`.
 * `edit_mode`/`property_id` AÚN NO EXISTEN en `PublishFormState` — estos casos
 * fallan HOY por aserción (valor `undefined` en vez de `false`/`null`, o el
 * publish() cae en create mode por falta de propagación), no por error de import.
 * - (EC-CTX-1) context_expone_edit_mode_y_property_id_en_default
 * - (EC-CTX-2) update_setea_edit_mode_true_y_property_id
 * - (EC-CTX-3) edit_mode_y_property_id_persisten_tras_update_de_otros_campos
 * - (EC-CTX-4) edit_mode_desde_contexto_dirige_publish_a_update_no_ef
 * - (EC-CTX-5) reset_limpia_edit_mode_y_property_id
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Wrapper con PublishFormProvider
// ---------------------------------------------------------------------------

import { PublishFormProvider, usePublishForm } from '../store/PublishFormContext';
import type { PublishFormState } from '../store/types';

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { usePublish } from '../hooks/usePublish';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_PROPERTY_ID = 'prop-uuid-edit-abc-123';
const TEST_USER_ID = 'user-uid-agente-edit-456';

/** Campos del form válidos para CREATE (incluye video) */
const VALID_FORM_CREATE = {
  operation_type: 'rent' as const,
  property_type: 'departamento' as const,
  price: 12500,
  address: 'Av. Insurgentes Sur 1234, CDMX',
  lat: 19.3737,
  lng: -99.1731,
  video_id: 'vid-uuid-create-xyz',
  storage_path: `${TEST_USER_ID}/vid-uuid-create-xyz.mp4`,
};

/**
 * Campos del form válidos para EDIT (sin video — el usuario no cambió el video).
 * operation_type, property_type y price son mínimo requerido para el UPDATE.
 * video_id y storage_path son null porque en edit mode no se requiere subir video nuevo.
 */
const VALID_FORM_EDIT_NO_VIDEO = {
  operation_type: 'sale' as const,
  property_type: 'casa' as const,
  price: 2500000,
  bedrooms: 3,
  bathrooms: 2,
  square_meters: 120,
  address: 'Calle Durango 55, Col. Roma, CDMX',
  lat: 19.4181,
  lng: -99.1608,
  description: 'Casa remodelada en la Roma',
  pet_friendly: true,
  allows_no_guarantor: false,
  student_friendly: false,
  // Sin video nuevo — edit mode lo permite
  video_id: null,
  storage_path: null,
  video_local_uri: null,
};

// ---------------------------------------------------------------------------
// Factory de mock Supabase para EDIT mode
// Soporta tanto functions.invoke (para la regresión) como from().update() (edit)
// ---------------------------------------------------------------------------

function make_mock_supabase_edit(opts: {
  update_result?: { data: unknown; error: { message: string } | null };
  invoke_result?: { data: unknown; error: unknown };
}) {
  const {
    update_result = { data: [{ id: TEST_PROPERTY_ID }], error: null },
    invoke_result = { data: { property_id: 'nuevo-prop-ef' }, error: null },
  } = opts;

  // mock para el UPDATE chain: from('properties').update({...}).eq('id', id)
  const mock_eq = jest.fn().mockResolvedValue(update_result);
  const mock_update = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ update: mock_update });

  // mock para la Edge Function (create mode)
  const mock_invoke = jest.fn().mockResolvedValue(invoke_result);

  return {
    from: mock_from,
    functions: { invoke: mock_invoke },
    // Expuestos para aserciones
    _mock_from: mock_from,
    _mock_update: mock_update,
    _mock_eq: mock_eq,
    _mock_invoke: mock_invoke,
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PublishFormProvider>{children}</PublishFormProvider>
);

// ---------------------------------------------------------------------------
// Helper: setup para edit mode
// ---------------------------------------------------------------------------

async function setup_edit_mode(opts: {
  update_result?: { data: unknown; error: { message: string } | null };
  form_fields?: Record<string, unknown>;
}) {
  const mock_supabase = make_mock_supabase_edit(opts);

  const { result } = await renderHook(
    () => ({
      sut: usePublish({
        supabase: mock_supabase,
        editMode: true,
        propertyId: TEST_PROPERTY_ID,
      }),
      form: usePublishForm(),
    }),
    { wrapper }
  );

  await act(async () => {
    result.current.form.update(opts.form_fields ?? VALID_FORM_EDIT_NO_VIDEO);
  });

  return { result, mock_supabase };
}

// ---------------------------------------------------------------------------
// Helper: setup para create mode (regresión)
// ---------------------------------------------------------------------------

async function setup_create_mode(opts: {
  invoke_result?: { data: unknown; error: unknown };
}) {
  const mock_supabase = make_mock_supabase_edit({
    invoke_result: opts.invoke_result ?? {
      data: { property_id: 'nuevo-prop-creado' },
      error: null,
    },
  });

  const { result } = await renderHook(
    () => ({
      // Sin editMode → create mode por defecto
      sut: usePublish({ supabase: mock_supabase }),
      form: usePublishForm(),
    }),
    { wrapper }
  );

  await act(async () => {
    result.current.form.update(VALID_FORM_CREATE);
  });

  return { result, mock_supabase };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePublish — edit mode (17.8)', () => {
  // ── REGRESIÓN: create mode no debe cambiar ────────────────────────────────

  it('(EC-R1) create_mode_invoca_ef_publish_property: sin editMode, publish() invoca functions.invoke("publish-property") exactamente una vez', async () => {
    const { result, mock_supabase } = await setup_create_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    const [fn_name] = mock_supabase._mock_invoke.mock.calls[0] as [string, unknown];
    expect(fn_name).toBe('publish-property');
  });

  it('(EC-R2) create_mode_no_invoca_update_directo: sin editMode, publish() NO llama from("properties").update()', async () => {
    const { result, mock_supabase } = await setup_create_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    // No debe haber ninguna llamada from('properties') seguida de update en create mode
    expect(mock_supabase._mock_update).not.toHaveBeenCalled();
  });

  // ── EDIT mode: happy path ─────────────────────────────────────────────────

  it('(EC-11) edit_mode_invoca_update_no_ef: editMode=true → from("properties").update() es llamado; functions.invoke("publish-property") NO es llamado', async () => {
    const { result, mock_supabase } = await setup_edit_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    // La EF NO debe ser invocada
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();

    // from('properties') debe haber sido llamado con 'properties'
    expect(mock_supabase._mock_from).toHaveBeenCalledWith('properties');

    // update() debe haber sido llamado
    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
  });

  it('(EC-12) edit_mode_update_shape_correcto: el objeto pasado a update() incluye los campos editables exactos', async () => {
    const { result, mock_supabase } = await setup_edit_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
    const [update_payload] = mock_supabase._mock_update.mock.calls[0] as [Record<string, unknown>];

    // Campos editables que DEBEN estar en el payload
    expect(update_payload.operation_type).toBe(VALID_FORM_EDIT_NO_VIDEO.operation_type);
    expect(update_payload.property_type).toBe(VALID_FORM_EDIT_NO_VIDEO.property_type);
    expect(update_payload.price).toBe(VALID_FORM_EDIT_NO_VIDEO.price);
    expect(update_payload.address).toBe(VALID_FORM_EDIT_NO_VIDEO.address);
    // Ubicación: columna geography `location` en EWKT (no existen columnas lat/lng)
    expect(update_payload.location).toBe(
      `SRID=4326;POINT(${VALID_FORM_EDIT_NO_VIDEO.lng} ${VALID_FORM_EDIT_NO_VIDEO.lat})`,
    );
    expect(update_payload.lat).toBeUndefined();
    expect(update_payload.lng).toBeUndefined();
    expect(update_payload.pet_friendly).toBe(VALID_FORM_EDIT_NO_VIDEO.pet_friendly);
    expect(update_payload.allows_no_guarantor).toBe(VALID_FORM_EDIT_NO_VIDEO.allows_no_guarantor);
    expect(update_payload.student_friendly).toBe(VALID_FORM_EDIT_NO_VIDEO.student_friendly);
    expect(update_payload.description).toBe(VALID_FORM_EDIT_NO_VIDEO.description);

    // Campos que NO deben estar: owner_user_id (inmutable), campos internos
    expect(update_payload.owner_user_id).toBeUndefined();
  });

  it('(EC-13) edit_mode_update_eq_property_id: el .eq("id", propertyId) usa el TEST_PROPERTY_ID correcto', async () => {
    const { result, mock_supabase } = await setup_edit_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(mock_supabase._mock_eq).toHaveBeenCalledWith('id', TEST_PROPERTY_ID);
  });

  it('(EC-17) edit_mode_exito_expone_status_success: UPDATE exitoso → status="success"', async () => {
    const { result } = await setup_edit_mode({
      update_result: { data: [{ id: TEST_PROPERTY_ID }], error: null },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('success');
    expect(result.current.sut.error).toBeNull();
  });

  // ── EDIT mode: video ──────────────────────────────────────────────────────

  it('(EC-14) edit_mode_sin_cambiar_video_no_sube_video: sin video_local_uri nuevo, el update no incluye video_id ni storage_path del video nuevo', async () => {
    const { result, mock_supabase } = await setup_edit_mode({
      form_fields: { ...VALID_FORM_EDIT_NO_VIDEO, video_local_uri: null, video_id: null, storage_path: null },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
    const [update_payload] = mock_supabase._mock_update.mock.calls[0] as [Record<string, unknown>];

    // El update NO debe borrar/tocar el campo de video existente en DB
    // (si se pasa storage_path null se sobreescribiría el video — esto no debe ocurrir)
    // El campo video_id y storage_path de la fila property_videos NO se modifica vía properties.update
    // Validamos que el payload no tiene storage_path (campo de property_videos, no de properties)
    expect(update_payload.storage_path).toBeUndefined();
    // video_id tampoco es campo de la tabla properties
    expect(update_payload.video_id).toBeUndefined();
  });

  it('(EC-18) edit_mode_no_requiere_video_para_submit: edit mode con video_id=null y storage_path=null logra llamar al update sin bloquearse por validación', async () => {
    const { result, mock_supabase } = await setup_edit_mode({
      form_fields: {
        ...VALID_FORM_EDIT_NO_VIDEO,
        video_id: null,
        storage_path: null,
        video_local_uri: null,
      },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    // En create mode con video_id=null, get_property_payload lanzaría → status='error'.
    // En edit mode, debe llegar al UPDATE aunque no haya video nuevo.
    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
    expect(result.current.sut.status).toBe('success');
  });

  // ── EDIT mode: error ──────────────────────────────────────────────────────

  it('(EC-16) edit_mode_error_update_expone_error: UPDATE retorna error RLS → update() fue invocado, status="error", error contiene mensaje, property_id null', async () => {
    const { result, mock_supabase } = await setup_edit_mode({
      update_result: {
        data: null,
        error: { message: 'new row violates row-level security policy' },
      },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    // El UPDATE fue invocado (diferencia clave respecto al fallo de validación en create)
    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.error).toMatch(/row-level security|rls|policy/i);
    expect(result.current.sut.property_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — propagación edit_mode/property_id vía PublishFormContext (53.1, RED)
// ---------------------------------------------------------------------------

/**
 * Extensión local de tipo — SOLO para estos tests. `edit_mode`/`property_id`
 * aún no existen en `PublishFormState` (types.ts); ese es precisamente el
 * hueco que hace fallar los EC-CTX-* de hoy. No se toca el tipo de producción
 * en fase RED (eso ocurre en la fase GREEN de subtareas siguientes).
 */
type PublishFormStateWithEditCtx = PublishFormState & {
  edit_mode: boolean;
  property_id: string | null;
};

describe('PublishFormContext — edit_mode/property_id propagation (53.1, RED)', () => {
  it('(EC-CTX-1) context_expone_edit_mode_y_property_id_en_default: el estado expone edit_mode:boolean y property_id:string|null con default false/null', async () => {
    const { result } = await renderHook(() => usePublishForm(), { wrapper });

    const state = result.current.state as PublishFormStateWithEditCtx;

    expect(state.edit_mode).toBe(false);
    expect(state.property_id).toBeNull();
  });

  it('(EC-CTX-2) update_setea_edit_mode_true_y_property_id: tras update({edit_mode:true, property_id}), el estado refleja ambos valores', async () => {
    const { result } = await renderHook(() => usePublishForm(), { wrapper });

    // Precondición: arranca en default — ya falla HOY porque el campo no
    // existe en PublishFormState (undefined !== false).
    expect((result.current.state as PublishFormStateWithEditCtx).edit_mode).toBe(false);

    await act(async () => {
      result.current.update(
        { edit_mode: true, property_id: TEST_PROPERTY_ID } as Partial<PublishFormStateWithEditCtx>,
      );
    });

    const state = result.current.state as PublishFormStateWithEditCtx;
    expect(state.edit_mode).toBe(true);
    expect(state.property_id).toBe(TEST_PROPERTY_ID);
  });

  it('(EC-CTX-3) edit_mode_y_property_id_persisten_tras_update_de_otros_campos: cambiar precio/descripción no resetea edit_mode ni property_id', async () => {
    const { result } = await renderHook(() => usePublishForm(), { wrapper });

    // Precondición: arranca en default — ya falla HOY (RED).
    expect((result.current.state as PublishFormStateWithEditCtx).property_id).toBeNull();

    await act(async () => {
      result.current.update(
        { edit_mode: true, property_id: TEST_PROPERTY_ID } as Partial<PublishFormStateWithEditCtx>,
      );
    });

    await act(async () => {
      result.current.update({ price: 3_000_000, description: 'Casa remodelada, nueva descripción' });
    });

    const state = result.current.state as PublishFormStateWithEditCtx;
    expect(state.edit_mode).toBe(true);
    expect(state.property_id).toBe(TEST_PROPERTY_ID);
    // Confirma que sí se aplicó el update de otros campos (no quedó "congelado")
    expect(state.price).toBe(3_000_000);
    expect(state.description).toBe('Casa remodelada, nueva descripción');
  });

  it('(EC-CTX-4) edit_mode_desde_contexto_dirige_publish_a_update_no_ef: cuando editMode/propertyId provienen de context.state (propagados vía update, no de un literal fijo), publish() hace UPDATE directo, NO invoca la EF, y el payload no incluye campos de video', async () => {
    const mock_supabase = make_mock_supabase_edit({});

    const { result } = await renderHook(
      () => {
        const form = usePublishForm();
        const ctx_state = form.state as PublishFormStateWithEditCtx;
        return {
          form,
          sut: usePublish({
            supabase: mock_supabase,
            // Contrato esperado (Opción A, exploración 031): editMode/propertyId
            // se derivan del contexto propagado desde el _layout — NO de un
            // literal fijo ni de useLocalSearchParams en step3.
            editMode: ctx_state.edit_mode,
            propertyId: ctx_state.property_id,
          }),
        };
      },
      { wrapper },
    );

    // Precondición: antes de propagar, edit_mode arranca en default (false).
    // Ya falla HOY porque el campo no existe en PublishFormState
    // (undefined !== false) — RED antes de tocar update().
    expect((result.current.form.state as PublishFormStateWithEditCtx).edit_mode).toBe(false);

    await act(async () => {
      result.current.form.update(
        {
          edit_mode: true,
          property_id: TEST_PROPERTY_ID,
          ...VALID_FORM_EDIT_NO_VIDEO,
        } as Partial<PublishFormStateWithEditCtx>,
      );
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    // La EF NO debe invocarse en modo edición.
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();

    // El UPDATE directo debe haberse llamado (contrato objetivo tras GREEN).
    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);

    const [update_payload] = mock_supabase._mock_update.mock.calls[0] as [Record<string, unknown>];
    expect(update_payload.video_id).toBeUndefined();
    expect(update_payload.storage_path).toBeUndefined();
  });

  it('(EC-CTX-5) reset_limpia_edit_mode_y_property_id: tras editar y llamar reset(), edit_mode vuelve a false y property_id a null', async () => {
    const { result } = await renderHook(() => usePublishForm(), { wrapper });

    await act(async () => {
      result.current.update(
        { edit_mode: true, property_id: TEST_PROPERTY_ID } as Partial<PublishFormStateWithEditCtx>,
      );
    });

    await act(async () => {
      result.current.reset();
    });

    const state = result.current.state as PublishFormStateWithEditCtx;
    expect(state.edit_mode).toBe(false);
    expect(state.property_id).toBeNull();
  });
});
