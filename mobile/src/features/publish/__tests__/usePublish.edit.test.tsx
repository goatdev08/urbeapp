/**
 * Tests fase RED — usePublish hook: bifurcación create vs edit (modo edición)
 * (mobile/src/features/publish/hooks/usePublish.ts)
 * Subtarea Taskmaster: 17.8 → EXTENDIDO por 73.6 (Re-revisión por edición, PRD §15.5/§15.6)
 *
 * SUT: usePublish(deps?) → { status, error, property_id, publish }
 *   con extensión: deps.editMode=true, deps.propertyId='...'
 *
 * CAMBIO DE CONTRATO (73.6 — decisión de arquitectura 2026-08-09):
 *   Edit mode YA NO hace UPDATE directo (`from('properties').update()`, RLS
 *   como única guarda). Ahora invoca la Edge Function `edit-property`, que
 *   decide server-side si la edición se aplica directo (`mode:'direct'`) o si
 *   dispara una re-revisión (`mode:'revision'`, PRD §15.5/§15.6). El resultado
 *   del hook debe distinguir ambos modos para que la UI muestre un mensaje
 *   distinto ("cambios aplicados" vs "tu edición entró a revisión").
 *
 * SEAM bajo test: la firma pública de usePublish(deps?) — específicamente qué
 * invoca en `supabase` y qué expone en el objeto devuelto.
 *
 * Contrato (edit mode, POST-73.6):
 *   - En edit mode: publish() invoca supabase.functions.invoke('edit-property',
 *     { body: {...edit_payload, property_id} }). NO invoca
 *     from('properties').update() (el camino viejo). NO invoca
 *     functions.invoke('publish-property') (EF de create).
 *   - El body del invoke incluye los campos editables exactos + property_id.
 *   - Si no hay video_local_uri nuevo, el body NO incluye campos de video.
 *   - Éxito con mode:'direct' → status='success', editResultMode='direct'.
 *   - Éxito con mode:'revision' → status='success', editResultMode='revision',
 *     revisionId = el id que devolvió la EF.
 *   - Error del invoke (network/HTTP) → status='error', editResultMode=null.
 *   - En create mode (sin editMode): EXACTAMENTE el comportamiento actual — invoca
 *     la EF publish-property. (Tests de regresión: no se rompió create.)
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Regresión — create mode (no debe cambiar)
 * - (EC-R1) create_mode_invoca_ef_publish_property
 * - (EC-R2) create_mode_no_invoca_update_directo
 * - (EC-R3) create_mode_no_invoca_ef_edit_property
 *
 * ### Edit mode — happy path, modo 'direct' (73.6)
 * - (EC-11) edit_mode_invoca_ef_edit_property_no_update_ni_publish
 * - (EC-12) edit_mode_invoke_body_shape_correcto
 * - (EC-13) edit_mode_invoke_body_incluye_property_id_correcto
 * - (EC-17) edit_mode_exito_modo_direct_expone_status_success_y_editResultMode_direct
 *
 * ### Edit mode — happy path, modo 'revision' (73.6, PRD §15.5/§15.6)
 * - (EC-19) edit_mode_exito_modo_revision_expone_editResultMode_revision_y_revisionId
 *
 * ### Edit mode — video
 * - (EC-14) edit_mode_sin_cambiar_video_no_incluye_campos_de_video_en_body
 * - (EC-18) edit_mode_no_requiere_video_para_submit
 *
 * ### Edit mode — error
 * - (EC-16) edit_mode_error_invoke_expone_error_y_editResultMode_null
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
 * - (EC-CTX-4) edit_mode_desde_contexto_dirige_publish_a_ef_edit_property
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
import type { UsePublishResult } from '../hooks/usePublish';

// ---------------------------------------------------------------------------
// Extensión local de tipo — SOLO para estos tests (73.6, RED).
// `editResultMode`/`revisionId` AÚN NO EXISTEN en UsePublishResult; ese es el
// hueco que hace fallar los EC-17/EC-19/EC-16 de hoy. No se toca el tipo de
// producción en fase RED (eso ocurre en la fase GREEN).
// ---------------------------------------------------------------------------

type EditResultMode = 'direct' | 'revision' | null;

type UsePublishResultWithEditMode = UsePublishResult & {
  editResultMode: EditResultMode;
  revisionId: string | null;
};

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_PROPERTY_ID = 'prop-uuid-edit-abc-123';
const TEST_USER_ID = 'user-uid-agente-edit-456';
const TEST_REVISION_ID = 'revision-uuid-789';

/**
 * Campos del form válidos para CREATE (incluye video).
 * 68.12 (upload-first): cloudflare_uid es el gate real que exige
 * get_property_payload — video_id/storage_path se conservan como legado
 * en el state pero ya no bastan por sí solos.
 */
const VALID_FORM_CREATE = {
  operation_type: 'rent' as const,
  property_type: 'departamento' as const,
  price: 12500,
  address: 'Av. Insurgentes Sur 1234, CDMX',
  lat: 19.3737,
  lng: -99.1731,
  video_id: 'vid-uuid-create-xyz',
  storage_path: `${TEST_USER_ID}/vid-uuid-create-xyz.mp4`,
  cloudflare_uid: 'cf-stream-uid-test-create-xyz',
};

/**
 * Campos del form válidos para EDIT (sin video — el usuario no cambió el video).
 * operation_type, property_type y price son mínimo requerido para el envío.
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
// Factory de mock Supabase — 73.6: AMBOS modos (create/edit) pasan por
// functions.invoke, ruteado por el nombre de la EF. Se conserva el mock de
// from().update() SOLO para probar que edit mode YA NO lo llama (regresión
// inversa del contrato pre-73.6).
// ---------------------------------------------------------------------------

function make_mock_supabase_edit(opts: {
  edit_invoke_result?: { data: unknown; error: { message?: string } | null };
  publish_invoke_result?: { data: unknown; error: unknown };
}) {
  const {
    edit_invoke_result = { data: { ok: true, mode: 'direct' }, error: null },
    publish_invoke_result = { data: { property_id: 'nuevo-prop-ef' }, error: null },
  } = opts;

  const mock_invoke = jest.fn(
    (fn_name: string, _opts?: { body: Record<string, unknown> }) => {
      if (fn_name === 'edit-property') return Promise.resolve(edit_invoke_result);
      if (fn_name === 'publish-property') return Promise.resolve(publish_invoke_result);
      return Promise.resolve({ data: null, error: { message: `EF desconocida invocada: ${fn_name}` } });
    },
  );

  // Legacy: mock del UPDATE directo, conservado SOLO para afirmar que edit
  // mode YA NO lo invoca tras 73.6.
  const mock_eq = jest.fn().mockResolvedValue({ data: [{ id: TEST_PROPERTY_ID }], error: null });
  const mock_update = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ update: mock_update });

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
  edit_invoke_result?: { data: unknown; error: { message?: string } | null };
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
  publish_invoke_result?: { data: unknown; error: unknown };
}) {
  const mock_supabase = make_mock_supabase_edit({
    publish_invoke_result: opts.publish_invoke_result ?? {
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

describe('usePublish — edit mode invoca EF edit-property (73.6)', () => {
  // ── REGRESIÓN: create mode no debe cambiar ────────────────────────────────

  it('(EC-R1) create_mode_invoca_ef_publish_property: sin editMode, publish() invoca functions.invoke("publish-property") exactamente una vez', async () => {
    const { result, mock_supabase } = await setup_create_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    const publish_calls = mock_supabase._mock_invoke.mock.calls.filter(
      ([fn_name]) => fn_name === 'publish-property',
    );
    expect(publish_calls.length).toBe(1);
  });

  it('(EC-R2) create_mode_no_invoca_update_directo: sin editMode, publish() NO llama from("properties").update()', async () => {
    const { result, mock_supabase } = await setup_create_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(mock_supabase._mock_update).not.toHaveBeenCalled();
  });

  it('(EC-R3) create_mode_no_invoca_ef_edit_property: sin editMode, publish() NO invoca functions.invoke("edit-property")', async () => {
    const { result, mock_supabase } = await setup_create_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    const edit_calls = mock_supabase._mock_invoke.mock.calls.filter(
      ([fn_name]) => fn_name === 'edit-property',
    );
    expect(edit_calls.length).toBe(0);
  });

  // ── EDIT mode: happy path, modo 'direct' ──────────────────────────────────

  it('(EC-11) edit_mode_invoca_ef_edit_property_no_update_ni_publish: editMode=true → functions.invoke("edit-property") es llamado; from("properties").update() y functions.invoke("publish-property") NO son llamados', async () => {
    const { result, mock_supabase } = await setup_edit_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    const edit_calls = mock_supabase._mock_invoke.mock.calls.filter(
      ([fn_name]) => fn_name === 'edit-property',
    );
    expect(edit_calls.length).toBe(1);

    const publish_calls = mock_supabase._mock_invoke.mock.calls.filter(
      ([fn_name]) => fn_name === 'publish-property',
    );
    expect(publish_calls.length).toBe(0);

    // El UPDATE directo (contrato viejo, pre-73.6) YA NO debe usarse
    expect(mock_supabase._mock_update).not.toHaveBeenCalled();
  });

  it('(EC-12) edit_mode_invoke_body_shape_correcto: el body pasado a functions.invoke("edit-property") incluye los campos editables exactos', async () => {
    const { result, mock_supabase } = await setup_edit_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    const [, invoke_opts] = mock_supabase._mock_invoke.mock.calls.find(
      ([fn_name]) => fn_name === 'edit-property',
    ) as [string, { body: Record<string, unknown> }];
    const body = invoke_opts.body;

    // Campos editables que DEBEN estar en el body
    expect(body.operation_type).toBe(VALID_FORM_EDIT_NO_VIDEO.operation_type);
    expect(body.property_type).toBe(VALID_FORM_EDIT_NO_VIDEO.property_type);
    expect(body.price).toBe(VALID_FORM_EDIT_NO_VIDEO.price);
    expect(body.address).toBe(VALID_FORM_EDIT_NO_VIDEO.address);
    // Ubicación: columna geography `location` en EWKT (no existen columnas lat/lng)
    expect(body.location).toBe(
      `SRID=4326;POINT(${VALID_FORM_EDIT_NO_VIDEO.lng} ${VALID_FORM_EDIT_NO_VIDEO.lat})`,
    );
    expect(body.lat).toBeUndefined();
    expect(body.lng).toBeUndefined();
    expect(body.pet_friendly).toBe(VALID_FORM_EDIT_NO_VIDEO.pet_friendly);
    expect(body.allows_no_guarantor).toBe(VALID_FORM_EDIT_NO_VIDEO.allows_no_guarantor);
    expect(body.student_friendly).toBe(VALID_FORM_EDIT_NO_VIDEO.student_friendly);
    expect(body.description).toBe(VALID_FORM_EDIT_NO_VIDEO.description);

    // Campos que NO deben estar: owner_user_id (inmutable), campos internos
    expect(body.owner_user_id).toBeUndefined();
  });

  it('(EC-13) edit_mode_invoke_body_incluye_property_id_correcto: el body incluye property_id = TEST_PROPERTY_ID', async () => {
    const { result, mock_supabase } = await setup_edit_mode({});

    await act(async () => {
      await result.current.sut.publish();
    });

    const [, invoke_opts] = mock_supabase._mock_invoke.mock.calls.find(
      ([fn_name]) => fn_name === 'edit-property',
    ) as [string, { body: Record<string, unknown> }];

    expect(invoke_opts.body.property_id).toBe(TEST_PROPERTY_ID);
  });

  it('(EC-17) edit_mode_exito_modo_direct_expone_status_success_y_editResultMode_direct: la EF responde mode:"direct" → status="success", editResultMode="direct"', async () => {
    const { result } = await setup_edit_mode({
      edit_invoke_result: { data: { ok: true, mode: 'direct' }, error: null },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    const sut = result.current.sut as UsePublishResultWithEditMode;
    expect(sut.status).toBe('success');
    expect(sut.error).toBeNull();
    expect(sut.editResultMode).toBe('direct');
  });

  // ── EDIT mode: happy path, modo 'revision' (PRD §15.5/§15.6) ──────────────

  it('(EC-19) edit_mode_exito_modo_revision_expone_editResultMode_revision_y_revisionId: la EF responde mode:"revision" → status="success", editResultMode="revision", revisionId = el id devuelto', async () => {
    const { result } = await setup_edit_mode({
      edit_invoke_result: {
        data: { ok: true, mode: 'revision', revision_id: TEST_REVISION_ID },
        error: null,
      },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    const sut = result.current.sut as UsePublishResultWithEditMode;
    expect(sut.status).toBe('success');
    expect(sut.error).toBeNull();
    expect(sut.editResultMode).toBe('revision');
    expect(sut.revisionId).toBe(TEST_REVISION_ID);
  });

  // ── EDIT mode: video ──────────────────────────────────────────────────────

  it('(EC-14) edit_mode_sin_cambiar_video_no_incluye_campos_de_video_en_body: sin video_local_uri nuevo, el body no incluye video_id ni storage_path del video nuevo', async () => {
    const { result, mock_supabase } = await setup_edit_mode({
      form_fields: { ...VALID_FORM_EDIT_NO_VIDEO, video_local_uri: null, video_id: null, storage_path: null },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    const [, invoke_opts] = mock_supabase._mock_invoke.mock.calls.find(
      ([fn_name]) => fn_name === 'edit-property',
    ) as [string, { body: Record<string, unknown> }];

    // storage_path/video_id NO son campos de `properties` — no deben viajar en el body.
    expect(invoke_opts.body.storage_path).toBeUndefined();
    expect(invoke_opts.body.video_id).toBeUndefined();
  });

  it('(EC-18) edit_mode_no_requiere_video_para_submit: edit mode con video_id=null y storage_path=null logra invocar la EF sin bloquearse por validación', async () => {
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
    // En edit mode, debe llegar al invoke aunque no haya video nuevo.
    const edit_calls = mock_supabase._mock_invoke.mock.calls.filter(
      ([fn_name]) => fn_name === 'edit-property',
    );
    expect(edit_calls.length).toBe(1);
    expect(result.current.sut.status).toBe('success');
  });

  // ── EDIT mode: error ──────────────────────────────────────────────────────

  it('(EC-16) edit_mode_error_invoke_expone_error_y_editResultMode_null: la EF responde error → functions.invoke fue invocado, status="error", error contiene mensaje, property_id null, editResultMode null', async () => {
    const { result, mock_supabase } = await setup_edit_mode({
      edit_invoke_result: {
        data: null,
        error: { message: 'No autorizado: el caller no es el dueño de la propiedad' },
      },
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    const edit_calls = mock_supabase._mock_invoke.mock.calls.filter(
      ([fn_name]) => fn_name === 'edit-property',
    );
    expect(edit_calls.length).toBe(1);

    const sut = result.current.sut as UsePublishResultWithEditMode;
    expect(sut.status).toBe('error');
    expect(sut.error).not.toBeNull();
    expect(sut.error).toMatch(/no autorizado/i);
    expect(sut.property_id).toBeNull();
    expect(sut.editResultMode).toBeNull();
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

  it('(EC-CTX-4) edit_mode_desde_contexto_dirige_publish_a_ef_edit_property: cuando editMode/propertyId provienen de context.state (propagados vía update, no de un literal fijo), publish() invoca functions.invoke("edit-property"), NO invoca update() ni "publish-property", y el body no incluye campos de video', async () => {
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

    // El UPDATE directo (contrato viejo) NUNCA debe invocarse en modo edición.
    expect(mock_supabase._mock_update).not.toHaveBeenCalled();

    // La EF edit-property debe haberse invocado (contrato objetivo 73.6).
    const edit_calls = mock_supabase._mock_invoke.mock.calls.filter(
      ([fn_name]) => fn_name === 'edit-property',
    );
    expect(edit_calls.length).toBe(1);

    const [, invoke_opts] = edit_calls[0] as [string, { body: Record<string, unknown> }];
    expect(invoke_opts.body.video_id).toBeUndefined();
    expect(invoke_opts.body.storage_path).toBeUndefined();
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
