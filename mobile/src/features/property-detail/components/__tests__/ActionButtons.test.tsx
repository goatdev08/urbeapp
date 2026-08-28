/**
 * Tests fase RED — ActionButtons component
 * Archivo SUT: mobile/src/features/property-detail/components/ActionButtons.tsx
 * Subtarea Taskmaster: 10.7 — botones like/save flotantes (detalle de propiedad)
 *
 * SUT: <ActionButtons property_id={string} property_video_id={string | null} />
 *
 * Contrato (decisiones usuario + plan 10.7):
 *   - Reutiliza useLikeProperty({ property_video_id, property_id }) del feed (#9) SIN modificar.
 *   - Reutiliza useSaveProperty({ property_id }) del feed (#9) SIN modificar.
 *   - Like: isLiked=false → accessibilityLabel "Dar like"; isLiked=true → "Quitar like"
 *   - Save: isSaved=false → accessibilityLabel "Guardar propiedad"; isSaved=true → "Quitar de guardados"
 *   - Tap like → toggleLike() del hook.
 *   - Tap save → toggleSave() del hook.
 *   - property_video_id=null (sin videos) → botón like ausente; botón save sigue presente.
 *   - useSaveProperty recibe property_id SIN property_video_id (invariante schema saves, migración 0006).
 *
 * PATRÓN DE MOCK:
 *   - jest.mock de los módulos de hooks (useLikeProperty + useSaveProperty).
 *   - Los mocks controlan el estado (isLiked/isSaved) y exponen spies para toggles.
 *   - No se mockea useAuth: los hooks completos están mockeados a nivel de módulo.
 *   - 220.5: se agrega jest.mock de useReportProperty (SIN llamarlo — estos
 *     tests no pasan owner_user_id, así que el botón "Reportar" nunca se
 *     renderiza). Necesario porque el import estático de useReportProperty
 *     arrastra @/features/auth/context → @/lib/supabase/client, que revienta
 *     en este entorno de test por falta de EXPO_PUBLIC_SUPABASE_URL si no se
 *     mockea el módulo completo (mismo motivo por el que useSaveProperty ya
 *     estaba mockeado).
 *
 * NOTA RNTL v14: render() retorna Promise → todos los tests son async + await render(...).
 *
 * EDGE CASES CUBIERTOS (10 casos):
 *
 * ### Happy path
 * - (EC-1) like_no_likeado_boton_tiene_accesibilidad_dar_like
 * - (EC-2) like_likeado_boton_tiene_accesibilidad_quitar_like
 * - (EC-3) tap_like_invoca_toggle_like_una_vez
 * - (EC-4) save_no_guardado_boton_tiene_accesibilidad_guardar_propiedad
 * - (EC-5) save_guardado_boton_tiene_accesibilidad_quitar_de_guardados
 * - (EC-6) tap_save_invoca_toggle_save_una_vez
 *
 * ### Edge cases del PRD (§ botones flotantes, plan 10.7)
 * - (EC-7) hook_like_llamado_con_property_video_id_correcto
 * - (EC-8) hook_like_llamado_con_property_id_correcto
 * - (EC-9) hook_save_llamado_con_property_id_correcto_no_video_id
 *
 * ### Boundary / error
 * - (EC-10) sin_videos_boton_save_presente_aunque_video_id_nulo
 *
 * ### Hardening 220.5 (mutantes M8 — guard de owner en can_report)
 * - (EC-11) owner_ve_su_propia_publicacion_boton_reportar_no_se_renderiza
 * - (EC-12) no_owner_ve_boton_reportar_visible
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Imports DESPUÉS de registrar mocks
// ─────────────────────────────────────────────────────────────────────────────

import { useLikeProperty } from '@/features/feed/hooks/useLikeProperty';
import { useSaveProperty } from '@/features/feed/hooks/useSaveProperty';
import { useReportProperty } from '@/features/property-detail/hooks/useReportProperty';
import { ActionButtons } from '../ActionButtons';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks de módulos — ANTES de cualquier import del SUT
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('@/features/feed/hooks/useLikeProperty', () => ({
  useLikeProperty: jest.fn(),
}));

jest.mock('@/features/feed/hooks/useSaveProperty', () => ({
  useSaveProperty: jest.fn(),
}));

// 220.5: ninguno de estos tests pasa owner_user_id, así que el botón
// "Reportar" nunca se renderiza y el hook nunca se llama — el mock solo
// existe para que el import estático no evalúe el módulo real (ver docblock).
jest.mock('@/features/property-detail/hooks/useReportProperty', () => ({
  useReportProperty: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de test
// ─────────────────────────────────────────────────────────────────────────────

const TEST_PROPERTY_ID = 'propiedad-uuid-detalle-abc123';
const TEST_VIDEO_ID = 'video-uuid-primer-video-xyz789';

// ─────────────────────────────────────────────────────────────────────────────
// Cast tipado de mocks
// ─────────────────────────────────────────────────────────────────────────────

const mock_use_like = useLikeProperty as jest.MockedFunction<typeof useLikeProperty>;
const mock_use_save = useSaveProperty as jest.MockedFunction<typeof useSaveProperty>;
const mock_use_report = useReportProperty as jest.MockedFunction<typeof useReportProperty>;

// ─────────────────────────────────────────────────────────────────────────────
// Spies reutilizables
// ─────────────────────────────────────────────────────────────────────────────

const mock_toggle_like = jest.fn();
const mock_like_only = jest.fn();
const mock_toggle_save = jest.fn();

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Estado por defecto: no likeado, no guardado
  mock_use_like.mockReturnValue({
    isLiked: false,
    toggleLike: mock_toggle_like,
    likeOnly: mock_like_only,
  });

  mock_use_save.mockReturnValue({
    isSaved: false,
    toggleSave: mock_toggle_save,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ActionButtons', () => {

  // ── (EC-1) Like no likeado → accessibilityLabel "Dar like" ────────────────

  it('(EC-1) like_no_likeado_boton_tiene_accesibilidad_dar_like: isLiked=false → botón like accesible con label "Dar like"', async () => {
    mock_use_like.mockReturnValue({
      isLiked: false,
      toggleLike: mock_toggle_like,
      likeOnly: mock_like_only,
    });

    const { queryByLabelText } = await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
      />
    );

    expect(queryByLabelText('Dar like')).not.toBeNull();
  });

  // ── (EC-2) Like likeado → accessibilityLabel "Quitar like" ────────────────

  it('(EC-2) like_likeado_boton_tiene_accesibilidad_quitar_like: isLiked=true → botón like accesible con label "Quitar like"', async () => {
    mock_use_like.mockReturnValue({
      isLiked: true,
      toggleLike: mock_toggle_like,
      likeOnly: mock_like_only,
    });

    const { queryByLabelText } = await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
      />
    );

    expect(queryByLabelText('Quitar like')).not.toBeNull();
  });

  // ── (EC-3) Tap like → toggleLike llamado 1 vez ────────────────────────────

  it('(EC-3) tap_like_invoca_toggle_like_una_vez: press en botón like → toggleLike del hook es llamado exactamente 1 vez', async () => {
    const { queryByLabelText } = await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
      />
    );

    const like_btn = queryByLabelText('Dar like');
    expect(like_btn).not.toBeNull();
    fireEvent.press(like_btn!);

    expect(mock_toggle_like).toHaveBeenCalledTimes(1);
  });

  // ── (EC-4) Save no guardado → accessibilityLabel "Guardar propiedad" ───────

  it('(EC-4) save_no_guardado_boton_tiene_accesibilidad_guardar_propiedad: isSaved=false → botón save accesible con label "Guardar propiedad"', async () => {
    mock_use_save.mockReturnValue({
      isSaved: false,
      toggleSave: mock_toggle_save,
    });

    const { queryByLabelText } = await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
      />
    );

    expect(queryByLabelText('Guardar propiedad')).not.toBeNull();
  });

  // ── (EC-5) Save guardado → accessibilityLabel "Quitar de guardados" ────────

  it('(EC-5) save_guardado_boton_tiene_accesibilidad_quitar_de_guardados: isSaved=true → botón save accesible con label "Quitar de guardados"', async () => {
    mock_use_save.mockReturnValue({
      isSaved: true,
      toggleSave: mock_toggle_save,
    });

    const { queryByLabelText } = await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
      />
    );

    expect(queryByLabelText('Quitar de guardados')).not.toBeNull();
  });

  // ── (EC-6) Tap save → toggleSave llamado 1 vez ────────────────────────────

  it('(EC-6) tap_save_invoca_toggle_save_una_vez: press en botón save → toggleSave del hook es llamado exactamente 1 vez', async () => {
    const { queryByLabelText } = await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
      />
    );

    const save_btn = queryByLabelText('Guardar propiedad');
    expect(save_btn).not.toBeNull();
    fireEvent.press(save_btn!);

    expect(mock_toggle_save).toHaveBeenCalledTimes(1);
  });

  // ── (EC-7) useLikeProperty recibe property_video_id correcto ──────────────

  it('(EC-7) hook_like_llamado_con_property_video_id_correcto: render → useLikeProperty es invocado con property_video_id=TEST_VIDEO_ID exacto', async () => {
    await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
      />
    );

    expect(mock_use_like).toHaveBeenCalledWith(
      expect.objectContaining({ property_video_id: TEST_VIDEO_ID })
    );
  });

  // ── (EC-8) useLikeProperty recibe property_id correcto ────────────────────

  it('(EC-8) hook_like_llamado_con_property_id_correcto: render → useLikeProperty es invocado con property_id=TEST_PROPERTY_ID exacto', async () => {
    await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
      />
    );

    expect(mock_use_like).toHaveBeenCalledWith(
      expect.objectContaining({ property_id: TEST_PROPERTY_ID })
    );
  });

  // ── (EC-9) useSaveProperty recibe property_id SIN property_video_id ────────

  it('(EC-9) hook_save_llamado_con_property_id_correcto_no_video_id: useSaveProperty recibe { property_id } exacto — schema saves NO incluye property_video_id (invariante migración 0006)', async () => {
    await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
      />
    );

    expect(mock_use_save).toHaveBeenCalledWith(
      expect.objectContaining({ property_id: TEST_PROPERTY_ID })
    );
    // El argumento NO debe incluir property_video_id (schema saves lo omite)
    const save_call_arg = mock_use_save.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(save_call_arg).toBeDefined();
    expect(save_call_arg!.property_video_id).toBeUndefined();
  });

  // ── (EC-10) Sin videos: botón save sigue accesible cuando video_id=null ───

  it('(EC-10) sin_videos_boton_save_presente_aunque_video_id_nulo: property_video_id=null → botón "Guardar propiedad" sigue accesible (save no depende de video)', async () => {
    // property_video_id=null simula propiedad sin videos aún cargados
    const { queryByLabelText } = await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={null}
      />
    );

    // Save no depende del video_id → debe seguir renderizado
    expect(queryByLabelText('Guardar propiedad')).not.toBeNull();
  });

  // ── (EC-11) Hardening M8: owner_user_id + is_owner=true → sin botón "Reportar" ──

  it('(EC-11) owner_ve_su_propia_publicacion_boton_reportar_no_se_renderiza: owner_user_id presente + is_owner=true → botón "Reportar publicación" NO se renderiza', async () => {
    const { queryByLabelText } = await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
        owner_user_id="owner-uuid-detalle-xyz"
        is_owner={true}
      />
    );

    expect(queryByLabelText('Reportar publicación')).toBeNull();
  });

  // ── (EC-12) Hardening M8: owner_user_id + is_owner=false → botón "Reportar" visible ──

  it('(EC-12) no_owner_ve_boton_reportar_visible: owner_user_id presente + is_owner=false → botón "Reportar publicación" SÍ se renderiza', async () => {
    mock_use_report.mockReturnValue({
      submit_report: jest.fn().mockResolvedValue({ ok: true }),
      is_submitting: false,
      error_message: null,
    });

    const { queryByLabelText } = await render(
      <ActionButtons
        property_id={TEST_PROPERTY_ID}
        property_video_id={TEST_VIDEO_ID}
        owner_user_id="owner-uuid-detalle-xyz"
        is_owner={false}
      />
    );

    expect(queryByLabelText('Reportar publicación')).not.toBeNull();
  });

});
