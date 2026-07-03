/**
 * Tests fase RED — useLoadProperty hook
 * (mobile/src/features/publish/hooks/useLoadProperty.ts)
 * Subtarea Taskmaster: 17.8 — Implement edit flow pre-filling publication wizard
 *
 * SUT: useLoadProperty(property_id, deps?) → { formState, loading, error }
 *
 * Contrato:
 *   - Carga propiedad por ID desde supabase.from('properties').select(...).eq('id',...).single().
 *   - Devuelve formState mapeado al shape de PublishFormState (campos editables).
 *   - property_id null → no hace query, formState=null, error=null.
 *   - not-found / error de DB → error no null, formState=null, sin crash.
 *   - loading=true mientras query pendiente; false al completar.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (LP-1) carga_propiedad_ok_mapea_campos_basicos
 * - (LP-2) carga_propiedad_ok_mapea_descripcion_y_flags
 * - (LP-3) carga_propiedad_ok_mapea_dimensiones
 * - (LP-4) carga_propiedad_ok_mapea_video_existente
 *
 * ### Estado de carga
 * - (LP-5) loading_true_en_mount_loading_false_al_completar
 *
 * ### Boundary / error
 * - (LP-6) not_found_establece_error
 * - (LP-7) error_db_establece_error
 * - (LP-8) property_id_null_no_hace_query
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Wrapper con PublishFormProvider (el hook puede necesitar el contexto)
// ---------------------------------------------------------------------------

import { PublishFormProvider } from '../store/PublishFormContext';

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { useLoadProperty } from '../hooks/useLoadProperty';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_PROPERTY_ID = 'prop-uuid-edit-test-abc';
const TEST_VIDEO_ID = 'video-uuid-existing-xyz';
const TEST_USER_ID = 'user-uid-agente-999';

// ---------------------------------------------------------------------------
// Factory de fila DB completa para la propiedad
// ---------------------------------------------------------------------------

function make_db_property(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_PROPERTY_ID,
    operation_type: 'rent' as const,
    property_type: 'departamento' as const,
    price: 15000,
    address: 'Av. Reforma 100, Col. Juárez, CDMX',
    lat: 19.4269,
    lng: -99.1673,
    bedrooms: 2,
    bathrooms: 1,
    square_meters: 65,
    description: 'Departamento amplio y luminoso en zona céntrica',
    pet_friendly: true,
    allows_no_guarantor: false,
    student_friendly: true,
    owner_user_id: TEST_USER_ID,
    status: 'active' as const,
    property_videos: [
      {
        id: TEST_VIDEO_ID,
        storage_path: `${TEST_USER_ID}/${TEST_VIDEO_ID}.mp4`,
        position: 1,
        status: 'ready' as const,
        thumbnail_url: null,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Factory de mock del cliente Supabase inyectado
// Simula la cadena: from('properties').select('...').eq('id', id).single()
// ---------------------------------------------------------------------------

function make_mock_supabase_load(opts: {
  property_data?: ReturnType<typeof make_db_property> | null;
  error?: { message: string; code?: string } | null;
  pending?: boolean;
}) {
  const { property_data, error = null, pending = false } = opts;

  let resolve_single!: (v: { data: unknown; error: unknown }) => void;
  const pending_promise = new Promise<{ data: unknown; error: unknown }>((res) => {
    resolve_single = res;
  });

  const resolved_value = {
    data: property_data !== undefined ? property_data : make_db_property(),
    error,
  };

  const mock_single = pending
    ? jest.fn().mockReturnValue(pending_promise)
    : jest.fn().mockResolvedValue(resolved_value);

  const mock_eq = jest.fn().mockReturnValue({ single: mock_single });
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_eq: mock_eq,
    _mock_single: mock_single,
    _resolve_single: (v?: Partial<{ data: unknown; error: unknown }>) =>
      resolve_single({ ...resolved_value, ...(v ?? {}) }),
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PublishFormProvider>{children}</PublishFormProvider>
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLoadProperty', () => {
  // ── (LP-1) Happy path — mapeo de campos básicos ───────────────────────────

  it('(LP-1) carga_propiedad_ok_mapea_campos_basicos: property found → formState incluye operation_type, property_type, price, address, lat, lng correctos', async () => {
    const mock_supabase = make_mock_supabase_load({
      property_data: make_db_property(),
    });

    const { result } = await renderHook(
      () => useLoadProperty(TEST_PROPERTY_ID, { supabase: mock_supabase }),
      { wrapper }
    );

    await act(async () => {
      // Espera que el hook resuelva la carga
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.formState).not.toBeNull();
    expect(result.current.formState?.operation_type).toBe('rent');
    expect(result.current.formState?.property_type).toBe('departamento');
    expect(result.current.formState?.price).toBe(15000);
    expect(result.current.formState?.address).toBe('Av. Reforma 100, Col. Juárez, CDMX');
    expect(result.current.formState?.lat).toBe(19.4269);
    expect(result.current.formState?.lng).toBe(-99.1673);
    expect(result.current.error).toBeNull();
  });

  // ── (LP-2) Happy path — mapeo de descripción y flags de nicho ─────────────

  it('(LP-2) carga_propiedad_ok_mapea_descripcion_y_flags: mapea description, pet_friendly, allows_no_guarantor, student_friendly', async () => {
    const mock_supabase = make_mock_supabase_load({
      property_data: make_db_property({
        description: 'Departamento amplio y luminoso en zona céntrica',
        pet_friendly: true,
        allows_no_guarantor: false,
        student_friendly: true,
      }),
    });

    const { result } = await renderHook(
      () => useLoadProperty(TEST_PROPERTY_ID, { supabase: mock_supabase }),
      { wrapper }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.formState?.description).toBe('Departamento amplio y luminoso en zona céntrica');
    expect(result.current.formState?.pet_friendly).toBe(true);
    expect(result.current.formState?.allows_no_guarantor).toBe(false);
    expect(result.current.formState?.student_friendly).toBe(true);
  });

  // ── (LP-3) Happy path — mapeo de dimensiones ─────────────────────────────

  it('(LP-3) carga_propiedad_ok_mapea_dimensiones: mapea bedrooms, bathrooms, square_meters desde DB', async () => {
    const mock_supabase = make_mock_supabase_load({
      property_data: make_db_property({ bedrooms: 3, bathrooms: 2, square_meters: 90 }),
    });

    const { result } = await renderHook(
      () => useLoadProperty(TEST_PROPERTY_ID, { supabase: mock_supabase }),
      { wrapper }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.formState?.bedrooms).toBe(3);
    expect(result.current.formState?.bathrooms).toBe(2);
    expect(result.current.formState?.square_meters).toBe(90);
  });

  // ── (LP-4) Happy path — mapeo de video existente ─────────────────────────

  it('(LP-4) carga_propiedad_ok_mapea_video_existente: storage_path y video_id del primer video aparecen en formState', async () => {
    const expected_storage_path = `${TEST_USER_ID}/${TEST_VIDEO_ID}.mp4`;
    const mock_supabase = make_mock_supabase_load({
      property_data: make_db_property({
        property_videos: [
          {
            id: TEST_VIDEO_ID,
            storage_path: expected_storage_path,
            position: 1,
            status: 'ready',
            thumbnail_url: null,
          },
        ],
      }),
    });

    const { result } = await renderHook(
      () => useLoadProperty(TEST_PROPERTY_ID, { supabase: mock_supabase }),
      { wrapper }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.formState?.video_id).toBe(TEST_VIDEO_ID);
    expect(result.current.formState?.storage_path).toBe(expected_storage_path);
  });

  // ── (LP-5) loading=true en mount, false al completar ─────────────────────

  it('(LP-5) loading_true_en_mount_loading_false_al_completar: loading=true mientras query pendiente, false tras completar', async () => {
    const mock_supabase = make_mock_supabase_load({ pending: true });

    const { result } = await renderHook(
      () => useLoadProperty(TEST_PROPERTY_ID, { supabase: mock_supabase }),
      { wrapper }
    );

    // Inmediatamente tras montar debe estar cargando
    expect(result.current.loading).toBe(true);

    // Resolvemos la query pendiente
    await act(async () => {
      mock_supabase._resolve_single();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.loading).toBe(false);
  });

  // ── (LP-6) not-found → error, formState null ──────────────────────────────

  it('(LP-6) not_found_establece_error: .single() devuelve error PGRST116 (not found) → error no null, formState null, sin crash', async () => {
    const mock_supabase = make_mock_supabase_load({
      property_data: null,
      error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
    });

    const { result } = await renderHook(
      () => useLoadProperty(TEST_PROPERTY_ID, { supabase: mock_supabase }),
      { wrapper }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.formState).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.loading).toBe(false);
  });

  // ── (LP-7) error de DB genérico → error, sin crash ───────────────────────

  it('(LP-7) error_db_establece_error: Supabase retorna error genérico → error no null, formState null, no lanza excepción', async () => {
    const mock_supabase = make_mock_supabase_load({
      property_data: null,
      error: { message: 'permission denied for table properties' },
    });

    const { result } = await renderHook(
      () => useLoadProperty(TEST_PROPERTY_ID, { supabase: mock_supabase }),
      { wrapper }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.formState).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.error).toMatch(/permission|denied|properties/i);
    expect(result.current.loading).toBe(false);
  });

  // ── (LP-8) property_id null → no hace query ──────────────────────────────

  it('(LP-8) property_id_null_no_hace_query: property_id null → from() nunca es llamado, formState null, error null', async () => {
    const mock_supabase = make_mock_supabase_load({});

    const { result } = await renderHook(
      () => useLoadProperty(null, { supabase: mock_supabase }),
      { wrapper }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
    expect(result.current.formState).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
