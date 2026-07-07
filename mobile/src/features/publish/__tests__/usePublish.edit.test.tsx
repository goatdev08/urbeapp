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
