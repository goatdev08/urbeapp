/**
 * Tests fase RED — usePublish: el hook debe TRADUCIR el error_code tipado que
 * viajan las EFs publish-property/edit-property, nunca dejar pasar el string
 * de infraestructura de supabase-js ("Edge Function returned a non-2xx
 * status code").
 * Archivo SUT: mobile/src/features/publish/hooks/usePublish.ts
 * Tarea Taskmaster: 200 · Subtarea: 200.1 (RED)
 *
 * EL DEFECTO (verificado en el código, no inferido):
 *   usePublish.ts resuelve error_ref.current = error.message ?? '...' tanto
 *   en create mode (publish-property, ~L178) como en edit mode
 *   (edit-property, ~L139). Con un FunctionsHttpError, error.message es
 *   LITERALMENTE "Edge Function returned a non-2xx status code" — el código
 *   de negocio ('AGENCY_MEMBERSHIP_SUSPENDED', 'DUPLICATE_PROPERTY', ...)
 *   viaja en el BODY y solo se recupera con extract_error_code
 *   (mobile/src/lib/supabase/edge-errors.ts), que usePublish.ts hoy NUNCA
 *   invoca.
 *
 * SEAM bajo test: la firma pública de usePublish(deps?) — específicamente el
 * string expuesto en `.error` tras un `publish()` fallido. Se ejercita con
 * FunctionsHttpError REALES (Response real con body JSON), igual que
 * mobile/src/features/leads/__tests__/useUpdateLeadStatus.test.ts y
 * mobile/src/lib/supabase/__tests__/edge-errors.test.ts — extract_error_code
 * es colaborador interno propio, NO se mockea.
 *
 * CATÁLOGO DE CÓDIGOS REALES (verificados leyendo el código, no de memoria):
 *   supabase/functions/publish-property/handler.ts + types.ts:
 *     METHOD_NOT_ALLOWED, INVALID_INPUT, UNAUTHENTICATED, FORBIDDEN (verifier),
 *     VIDEO_NOT_FOUND, VIDEO_NOT_READY, VIDEO_DURATION_INVALID,
 *     DUPLICATE_PROPERTY, AGENCY_MEMBERSHIP_SUSPENDED,
 *     AGENCY_CANNOT_PUBLISH_PROPERTIES (PUBLISH_PROPERTY_FORBIDDEN_CODES),
 *     DB_ERROR (fallback del RPC vía extract_publish_error_code).
 *   supabase/functions/edit-property/handler.ts + index.ts:
 *     METHOD_NOT_ALLOWED, INVALID_INPUT, UNAUTHENTICATED, PROPERTY_NOT_FOUND,
 *     UNAUTHORIZED_EDITOR, DB_ERROR.
 *   (NO comparten AGENCY_MEMBERSHIP_SUSPENDED/AGENCY_CANNOT_PUBLISH_PROPERTIES —
 *   esos son propios del RPC de creación; edit-property no los emite.)
 *
 * Mensajes en español ASUMIDOS para el GREEN (200.2) — mismo patrón que
 * mobile/src/features/leads/lead_error_messages.ts (map_lead_ef_error):
 * fallback 'código presente pero desconocido' vs fallback 'undefined -> red',
 * ambos DISTINTOS entre sí y del texto crudo de supabase-js. Los literales de
 * este archivo son independientes del SUT (no se importan de ningún catálogo
 * de la implementación) — si el GREEN usa otro texto, esto lo detecta como
 * regresión real, no como tautología.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path — no-regresión del camino feliz (edge case 7)
 * - (EC-EM-1) create_mode_camino_feliz_no_se_rompe
 * - (EC-EM-2) edit_mode_camino_feliz_no_se_rompe
 *
 * ### Catálogo real — create mode (publish-property)
 * - (EC-EM-3) create_agencia_suspendida_mensaje_espanol_sin_texto_de_infra (edge case 1)
 * - (EC-EM-4) create_agencia_sin_capacidad_mensaje_propio
 * - (EC-EM-5) create_propiedad_duplicada_mensaje_propio (edge case 2)
 * - (EC-EM-6) create_video_no_listo_mensaje_propio (edge case 2, alterno)
 *
 * ### Catálogo real — edit mode (edit-property)
 * - (EC-EM-7) edit_propiedad_no_encontrada_mensaje_propio
 * - (EC-EM-8) edit_no_autorizado_mensaje_propio
 * - (EC-EM-19) edit_agencia_suspendida_mensaje_propio (#202: edit-property YA
 *   emite AGENCY_MEMBERSHIP_SUSPENDED — deja de ser exclusivo de create mode)
 *
 * ### Ramas no obvias — fail-soft de extract_error_code
 * - (EC-EM-9) create_codigo_desconocido_mensaje_generico_no_filtra_codigo_crudo (edge case 3)
 * - (EC-EM-10) create_context_json_rechaza_body_no_json_mensaje_generico_sin_excepcion (edge case 4)
 * - (EC-EM-11) create_error_sin_context_mensaje_de_conexion_sin_romper (edge case 5)
 * - (EC-EM-12) edit_codigo_desconocido_mensaje_generico (edge case 3, modo edit)
 * - (EC-EM-13) edit_error_sin_context_mensaje_de_conexion (edge case 5, modo edit)
 *
 * ### Boundary — ninguna rama filtra el string de infraestructura (edge case 6)
 * - (EC-EM-14) ninguna_rama_de_create_expone_non_2xx_ni_edge_function
 * - (EC-EM-15) ninguna_rama_de_edit_expone_non_2xx_ni_edge_function
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js';

import { PublishFormProvider, usePublishForm } from '../store/PublishFormContext';
import { usePublish } from '../hooks/usePublish';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_PROPERTY_ID = 'prop-uuid-error-mapping-200';
const TEST_EDIT_PROPERTY_ID = 'prop-uuid-edit-error-mapping-200';

// Literal EXACTO de @supabase/functions-js (ver node_modules/@supabase/functions-js/src/types.ts:91)
// — fuente independiente del SUT.
const RAW_INFRA_MESSAGE = 'Edge Function returned a non-2xx status code';

// Fallbacks del catálogo, escritos a mano A PROPÓSITO (no importados de
// publish_error_messages.ts): un test que importa la tabla que verifica se
// compara contra su propia copia y deja de detectar que el catálogo colapsó.
// Si alguien cambia la redacción de un fallback, este archivo debe cambiar con
// él — esa fricción es la señal, no el estorbo.
const GENERICO_CREATE = 'Ocurrió un error al publicar. Intenta de nuevo.';
const GENERICO_EDIT = 'Ocurrió un error al actualizar la propiedad. Intenta de nuevo.';
const MENSAJE_CONEXION = 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';

const VALID_FORM_CREATE = {
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

const VALID_FORM_EDIT = {
  operation_type: 'sale' as const,
  property_type: 'casa' as const,
  price: 2500000,
  address: 'Calle Durango 55, Col. Roma, CDMX',
  lat: 19.4181,
  lng: -99.1608,
  description: 'Casa remodelada en la Roma',
  pet_friendly: true,
  allows_no_guarantor: false,
  student_friendly: false,
  video_id: null,
  storage_path: null,
};

// ---------------------------------------------------------------------------
// Helpers — FunctionsHttpError REAL con body {error:{code,message}}, mismo
// patrón que useUpdateLeadStatus.test.ts / edge-errors.test.ts.
// ---------------------------------------------------------------------------

function make_ef_http_error(code: string): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(JSON.stringify({ error: { code, message: `mensaje interno EF: ${code}` } }), {
      status: 400,
    }),
  );
}

/** FunctionsHttpError con body NO-JSON — context.json() rechaza (EC-EM-10). */
function make_ef_http_error_non_json_body(): FunctionsHttpError {
  return new FunctionsHttpError(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
}

/** Error de red real de supabase-js — sin `.context.json()` disponible (EC-EM-11/13). */
function make_network_error(): FunctionsFetchError {
  return new FunctionsFetchError(new TypeError('Network request failed'));
}

// ---------------------------------------------------------------------------
// Factory del mock supabase — misma forma que usePublish.test.tsx.
// ---------------------------------------------------------------------------

function make_mock_supabase_create(invoke_result: { data: unknown; error: unknown }) {
  return {
    functions: { invoke: jest.fn().mockResolvedValue(invoke_result) },
  };
}

function make_mock_supabase_edit(invoke_result: { data: unknown; error: unknown }) {
  const mock_invoke = jest.fn((fn_name: string) => {
    if (fn_name === 'edit-property') return Promise.resolve(invoke_result);
    return Promise.resolve({ data: null, error: { message: `EF inesperada: ${fn_name}` } });
  });
  return { functions: { invoke: mock_invoke } };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PublishFormProvider>{children}</PublishFormProvider>
);

async function setup_create(invoke_result: { data: unknown; error: unknown }) {
  const mock_supabase = make_mock_supabase_create(invoke_result);
  const { result } = await renderHook(
    () => ({ sut: usePublish({ supabase: mock_supabase }), form: usePublishForm() }),
    { wrapper },
  );
  await act(async () => {
    result.current.form.update(VALID_FORM_CREATE);
  });
  return { result, mock_supabase };
}

async function setup_edit(invoke_result: { data: unknown; error: unknown }) {
  const mock_supabase = make_mock_supabase_edit(invoke_result);
  const { result } = await renderHook(
    () => ({
      sut: usePublish({ supabase: mock_supabase, editMode: true, propertyId: TEST_EDIT_PROPERTY_ID }),
      form: usePublishForm(),
    }),
    { wrapper },
  );
  await act(async () => {
    result.current.form.update(VALID_FORM_EDIT);
  });
  return { result, mock_supabase };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePublish — traduce el error_code tipado (200.1, RED)', () => {
  // ── Happy path — no-regresión ──────────────────────────────────────────

  it('(EC-EM-1) create_mode_camino_feliz_no_se_rompe: éxito sigue exponiendo property_id y status success', async () => {
    const { result } = await setup_create({ data: { property_id: TEST_PROPERTY_ID }, error: null });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('success');
    expect(result.current.sut.property_id).toBe(TEST_PROPERTY_ID);
    expect(result.current.sut.error).toBeNull();
  });

  it('(EC-EM-2) edit_mode_camino_feliz_no_se_rompe: éxito sigue exponiendo editResultMode y revisionId', async () => {
    const { result } = await setup_edit({
      data: { ok: true, mode: 'revision', revision_id: 'revision-uuid-em-2' },
      error: null,
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('success');
    expect(result.current.sut.editResultMode).toBe('revision');
    expect(result.current.sut.revisionId).toBe('revision-uuid-em-2');
  });

  // ── Catálogo real — create mode ────────────────────────────────────────

  it('(EC-EM-3) create_agencia_suspendida_mensaje_espanol_sin_texto_de_infra: AGENCY_MEMBERSHIP_SUSPENDED → mensaje habla de suspensión, no de infraestructura', async () => {
    const { result } = await setup_create({
      data: null,
      error: make_ef_http_error('AGENCY_MEMBERSHIP_SUSPENDED'),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.error).toMatch(/suspendid/i);
    expect(result.current.sut.error).not.toMatch(/non-2xx/i);
    expect(result.current.sut.error).not.toMatch(/Edge Function/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
  });

  it('(EC-EM-4) create_agencia_sin_capacidad_mensaje_propio: AGENCY_CANNOT_PUBLISH_PROPERTIES → mensaje propio sobre la capacidad de publicación, distinto del de suspensión', async () => {
    const suspended = await setup_create({
      data: null,
      error: make_ef_http_error('AGENCY_MEMBERSHIP_SUSPENDED'),
    });
    await act(async () => {
      await suspended.result.current.sut.publish();
    });

    const { result } = await setup_create({
      data: null,
      error: make_ef_http_error('AGENCY_CANNOT_PUBLISH_PROPERTIES'),
    });
    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
    expect(result.current.sut.error).not.toBe(suspended.result.current.sut.error);
  });

  it('(EC-EM-5) create_propiedad_duplicada_mensaje_propio: DUPLICATE_PROPERTY → mensaje sobre dirección duplicada', async () => {
    const { result } = await setup_create({
      data: null,
      error: make_ef_http_error('DUPLICATE_PROPERTY'),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).toMatch(/direcci[oó]n|duplicad/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
  });

  it('(EC-EM-6) create_video_no_listo_mensaje_propio: VIDEO_NOT_READY → mensaje sobre el procesamiento del video', async () => {
    const { result } = await setup_create({
      data: null,
      error: make_ef_http_error('VIDEO_NOT_READY'),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).toMatch(/video/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
  });

  // ── Catálogo real — edit mode ──────────────────────────────────────────

  it('(EC-EM-7) edit_propiedad_no_encontrada_mensaje_propio: PROPERTY_NOT_FOUND → mensaje sobre propiedad inexistente/eliminada', async () => {
    const { result } = await setup_edit({
      data: null,
      error: make_ef_http_error('PROPERTY_NOT_FOUND'),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).toMatch(/existe|encontr|eliminad/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
    expect(result.current.sut.editResultMode).toBeNull();
  });

  it('(EC-EM-8) edit_no_autorizado_mensaje_propio: UNAUTHORIZED_EDITOR → mensaje sobre falta de permiso, distinto del de propiedad no encontrada', async () => {
    const not_found = await setup_edit({ data: null, error: make_ef_http_error('PROPERTY_NOT_FOUND') });
    await act(async () => {
      await not_found.result.current.sut.publish();
    });

    const { result } = await setup_edit({
      data: null,
      error: make_ef_http_error('UNAUTHORIZED_EDITOR'),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).toMatch(/permiso|autorizad/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
    expect(result.current.sut.error).not.toBe(not_found.result.current.sut.error);
  });

  it('(EC-EM-19) edit_agencia_suspendida_mensaje_propio: AGENCY_MEMBERSHIP_SUSPENDED (#202) → mensaje habla de suspensión, no de infraestructura', async () => {
    const { result } = await setup_edit({
      data: null,
      error: make_ef_http_error('AGENCY_MEMBERSHIP_SUSPENDED'),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.error).toMatch(/suspend|pausó/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
  });

  // ── Ramas no obvias — fail-soft de extract_error_code ──────────────────

  it('(EC-EM-9) create_codigo_desconocido_mensaje_generico_no_filtra_codigo_crudo: código fuera del catálogo → mensaje genérico, el código NUNCA aparece en pantalla', async () => {
    const { result } = await setup_create({
      data: null,
      error: make_ef_http_error('CODIGO_FUTURO_SIN_MAPEAR_200'),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
    expect(result.current.sut.error).not.toMatch(/CODIGO_FUTURO_SIN_MAPEAR_200/);
  });

  it('(EC-EM-10) create_context_json_rechaza_body_no_json_mensaje_generico_sin_excepcion: body no-JSON → mensaje genérico, status=error, sin excepción propagada', async () => {
    const { result } = await setup_create({
      data: null,
      error: make_ef_http_error_non_json_body(),
    });

    // 🔴 El idioma original era `await expect(act(async () => …)).resolves.not.toThrow()`.
    // Dos problemas, ambos reales: (1) `.not.toThrow()` aplicado al valor RESUELTO
    // (undefined) es una aserción vacía — nunca puede fallar, así que no probaba nada;
    // (2) envolver el thenable de `act` en `expect().resolves` no espera el flush
    // completo, y el assert corría con el hook a medio camino. Se captura la excepción
    // explícitamente: prueba de verdad que `publish()` no propaga, y espera de verdad.
    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.sut.publish();
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeNull();

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
  });

  it('(EC-EM-11) create_error_sin_context_mensaje_de_conexion_sin_romper: FunctionsFetchError (red) → mensaje de conexión, sin romper el wizard', async () => {
    const { result } = await setup_create({ data: null, error: make_network_error() });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).toMatch(/conex|conecta/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
  });

  it('(EC-EM-12) edit_codigo_desconocido_mensaje_generico: código fuera del catálogo en edit mode → mensaje genérico, sin filtrar el código', async () => {
    const { result } = await setup_edit({
      data: null,
      error: make_ef_http_error('CODIGO_FUTURO_EDIT_200'),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
    expect(result.current.sut.error).not.toMatch(/CODIGO_FUTURO_EDIT_200/);
    expect(result.current.sut.editResultMode).toBeNull();
  });

  it('(EC-EM-13) edit_error_sin_context_mensaje_de_conexion: FunctionsFetchError en edit mode → mensaje de conexión', async () => {
    const { result } = await setup_edit({ data: null, error: make_network_error() });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).toMatch(/conex|conecta/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
  });

  // ── Boundary — ninguna rama filtra el texto crudo de infraestructura ───

  it('(EC-EM-14) ninguna_rama_de_create_expone_non_2xx_ni_edge_function: para TODO el catálogo real de publish-property, el mensaje nunca es el literal de supabase-js', async () => {
    const codigos_reales = [
      'INVALID_INPUT',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'VIDEO_NOT_FOUND',
      'VIDEO_NOT_READY',
      'VIDEO_DURATION_INVALID',
      'DUPLICATE_PROPERTY',
      'AGENCY_MEMBERSHIP_SUSPENDED',
      'AGENCY_CANNOT_PUBLISH_PROPERTIES',
      'DB_ERROR',
    ];

    // 🔴 Refuerzo (guardián 200, obs. 1): asertar SOLO lo negativo dejaba pasar
    // el colapso del catálogo — si alguien borrara una entrada del mapa, su
    // código caería al genérico y este loop seguiría verde. Se asierta además
    // que cada código produce un mensaje PROPIO (ni el genérico, ni el de
    // conexión) y que los mensajes son distintos entre sí. Dos códigos que
    // compartan mensaje es una decisión legítima, pero tiene que ser
    // consciente: si se toma, este test es el que obliga a declararla.
    const mensajes: string[] = [];

    for (const code of codigos_reales) {
      const { result } = await setup_create({ data: null, error: make_ef_http_error(code) });

      await act(async () => {
        await result.current.sut.publish();
      });

      expect(result.current.sut.error).not.toBeNull();
      expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
      expect(result.current.sut.error).not.toMatch(/non-2xx/i);
      expect(result.current.sut.error).not.toMatch(/Edge Function returned/i);
      expect(result.current.sut.error).not.toBe(GENERICO_CREATE);
      expect(result.current.sut.error).not.toBe(MENSAJE_CONEXION);

      mensajes.push(result.current.sut.error as string);
    }

    expect(new Set(mensajes).size).toBe(codigos_reales.length);
  });

  it('(EC-EM-15) ninguna_rama_de_edit_expone_non_2xx_ni_edge_function: para TODO el catálogo real de edit-property, el mensaje nunca es el literal de supabase-js', async () => {
    const codigos_reales = [
      'INVALID_INPUT',
      'UNAUTHENTICATED',
      'PROPERTY_NOT_FOUND',
      'UNAUTHORIZED_EDITOR',
      'AGENCY_MEMBERSHIP_SUSPENDED', // #202: edit-property ya lo emite (suspensión congela editar)
      'DB_ERROR',
    ];

    // Mismo refuerzo que EC-EM-14 (guardián 200, obs. 1).
    const mensajes: string[] = [];

    for (const code of codigos_reales) {
      const { result } = await setup_edit({ data: null, error: make_ef_http_error(code) });

      await act(async () => {
        await result.current.sut.publish();
      });

      expect(result.current.sut.error).not.toBeNull();
      expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
      expect(result.current.sut.error).not.toMatch(/non-2xx/i);
      expect(result.current.sut.error).not.toMatch(/Edge Function returned/i);
      expect(result.current.sut.error).not.toBe(GENERICO_EDIT);
      expect(result.current.sut.error).not.toBe(MENSAJE_CONEXION);

      mensajes.push(result.current.sut.error as string);
    }

    expect(new Set(mensajes).size).toBe(codigos_reales.length);
  });

  // ── Refuerzo 200 (guardián, obs. 2): 502 con body HTML ≠ "revisa tu WiFi" ──
  //
  // extract_error_code colapsa DOS situaciones distintas en el mismo
  // `undefined`: "el servidor respondió pero no pude leer el código" (502 con
  // body HTML del gateway) y "no hubo respuesta" (red caída). Mandarlas al
  // mismo mensaje hace que un agente cuya EF devolvió 502 se ponga a revisar
  // su conexión. Son diagnósticos opuestos y el usuario actúa distinto en
  // cada uno.

  it('(EC-EM-16) create_502_body_html_no_culpa_a_la_conexion: hubo respuesta HTTP → mensaje de servidor, NO el de conexión', async () => {
    const { result } = await setup_create({
      data: null,
      error: make_ef_http_error_non_json_body(),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBe(MENSAJE_CONEXION);
    expect(result.current.sut.error).not.toMatch(/conex|conecta/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
  });

  it('(EC-EM-17) edit_502_body_html_no_culpa_a_la_conexion: mismo contrato en edit mode', async () => {
    const { result } = await setup_edit({
      data: null,
      error: make_ef_http_error_non_json_body(),
    });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBe(MENSAJE_CONEXION);
    expect(result.current.sut.error).not.toMatch(/conex|conecta/i);
    expect(result.current.sut.error).not.toBe(RAW_INFRA_MESSAGE);
  });

  it('(EC-EM-18) error_de_red_sigue_culpando_a_la_conexion: sin respuesta HTTP → el mensaje de conexión NO se pierde', async () => {
    const { result } = await setup_create({ data: null, error: make_network_error() });

    await act(async () => {
      await result.current.sut.publish();
    });

    expect(result.current.sut.error).toBe(MENSAJE_CONEXION);
  });
});
