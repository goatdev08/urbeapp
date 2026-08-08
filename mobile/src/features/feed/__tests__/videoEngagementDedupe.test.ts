/**
 * Tests fase RED — videoEngagementDedupe (lib pura)
 * Archivo SUT: mobile/src/features/feed/lib/videoEngagementDedupe.ts
 * Subtarea Taskmaster: 112.2 — captura en el feed: video_view y
 * video_completed con dedupe por sesión (parte crítica)
 *
 * SUT:
 *   is_video_completed(current_time, duration): boolean
 *   create_video_engagement_store(): { has_seen, mark_seen }
 *
 * Contrato (contexto verificado en la subtarea 112, sin PRD § — feature
 * derivada de 75.2):
 *   - Umbral de compleción: currentTime >= duration * 0.95 (el último frame
 *     casi nunca se alcanza exacto). Un video a la mitad NO cuenta.
 *   - duration inválida (0, NaN, undefined, null — típico mientras el video
 *     carga) → false, NUNCA throw. Es el caso que más fácil se cuela.
 *   - El store de dedupe es la base del requisito MÁS importante de la
 *     subtarea: una sola fila por (session_id, event_type, property_id). El
 *     feed reproduce en LOOP → sin esto, timeUpdate generaría cientos de
 *     filas por un video olvidado en pantalla.
 *
 * EDGE CASES CUBIERTOS (15 casos):
 *
 * ### Happy path — umbral de compleción
 * - (EC-1) umbral_95_porciento_exacto_es_completado
 * - (EC-2) justo_debajo_del_umbral_no_es_completado
 *
 * ### Ramas de reglas no obvias (contexto 112.2, requisito 5)
 * - (EC-3) mitad_del_video_no_es_completado
 * - (EC-4) fin_exacto_100_porciento_es_completado
 *
 * ### Boundary / error — duration inválida (contexto 112.2, requisito 6)
 * - (EC-5) duration_cero_no_es_completado_sin_throw
 * - (EC-6) duration_nan_no_es_completado_sin_throw
 * - (EC-7) duration_undefined_no_es_completado_sin_throw
 * - (EC-8) duration_null_no_es_completado_sin_throw
 * - (EC-9) current_time_nan_no_es_completado_sin_throw
 *
 * ### Happy path — store de dedupe
 * - (EC-10) store_nuevo_no_ha_visto_nada
 * - (EC-11) mark_seen_hace_que_has_seen_devuelva_true
 *
 * ### Ramas de reglas no obvias — dedupe por bucle (requisito 1)
 * - (EC-12) mark_seen_repetido_es_idempotente
 *
 * ### Boundary — aislamiento de claves compuestas
 * - (EC-13) dedupe_es_por_event_type_no_cruza_view_y_completed
 * - (EC-14) dedupe_es_por_sesion_sesion_nueva_no_hereda_marca
 * - (EC-15) dedupe_es_por_propiedad_no_cruza_entre_propiedades
 */

import {
  is_video_completed,
  create_video_engagement_store,
  VIDEO_COMPLETION_THRESHOLD_RATIO,
} from '../lib/videoEngagementDedupe';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const SESSION_A = 'sesion-uuid-primera-visita';
const SESSION_B = 'sesion-uuid-app-reabierta';
const PROPERTY_A = 'propiedad-uuid-departamento-roma';
const PROPERTY_B = 'propiedad-uuid-casa-condesa';

// ---------------------------------------------------------------------------
// Umbral de compleción
// ---------------------------------------------------------------------------

describe('is_video_completed — umbral de compleción', () => {

  it('(EC-1) umbral_95_porciento_exacto_es_completado: duration=40s, currentTime=38s (=40*0.95) → true', () => {
    expect(VIDEO_COMPLETION_THRESHOLD_RATIO).toBe(0.95);
    expect(is_video_completed(38, 40)).toBe(true);
  });

  it('(EC-2) justo_debajo_del_umbral_no_es_completado: duration=40s, currentTime=37.9s (<38) → false', () => {
    expect(is_video_completed(37.9, 40)).toBe(false);
  });

  it('(EC-3) mitad_del_video_no_es_completado: duration=40s, currentTime=20s (50%) → false', () => {
    expect(is_video_completed(20, 40)).toBe(false);
  });

  it('(EC-4) fin_exacto_100_porciento_es_completado: duration=40s, currentTime=40s → true', () => {
    expect(is_video_completed(40, 40)).toBe(true);
  });

  it('(EC-5) duration_cero_no_es_completado_sin_throw: duration=0 (video recién montado) → false, no lanza', () => {
    expect(() => is_video_completed(0, 0)).not.toThrow();
    expect(is_video_completed(0, 0)).toBe(false);
  });

  it('(EC-6) duration_nan_no_es_completado_sin_throw: duration=NaN (aún cargando) → false, no lanza', () => {
    expect(() => is_video_completed(5, NaN)).not.toThrow();
    expect(is_video_completed(5, NaN)).toBe(false);
  });

  it('(EC-7) duration_undefined_no_es_completado_sin_throw: duration=undefined (player sin cargar) → false, no lanza', () => {
    expect(() => is_video_completed(5, undefined)).not.toThrow();
    expect(is_video_completed(5, undefined)).toBe(false);
  });

  it('(EC-8) duration_null_no_es_completado_sin_throw: duration=null → false, no lanza', () => {
    expect(() => is_video_completed(5, null)).not.toThrow();
    expect(is_video_completed(5, null)).toBe(false);
  });

  it('(EC-9) current_time_nan_no_es_completado_sin_throw: currentTime=NaN con duration válida → false, no lanza', () => {
    expect(() => is_video_completed(NaN, 40)).not.toThrow();
    expect(is_video_completed(NaN, 40)).toBe(false);
  });

});

// ---------------------------------------------------------------------------
// Store de dedupe
// ---------------------------------------------------------------------------

describe('create_video_engagement_store — dedupe por (sesión, tipo, propiedad)', () => {

  it('(EC-10) store_nuevo_no_ha_visto_nada: store recién creado → has_seen devuelve false para cualquier clave', () => {
    const store = create_video_engagement_store();
    expect(store.has_seen(SESSION_A, 'video_view', PROPERTY_A)).toBe(false);
  });

  it('(EC-11) mark_seen_hace_que_has_seen_devuelva_true: mark_seen(session,type,property) → has_seen(misma clave) === true', () => {
    const store = create_video_engagement_store();
    store.mark_seen(SESSION_A, 'video_completed', PROPERTY_A);
    expect(store.has_seen(SESSION_A, 'video_completed', PROPERTY_A)).toBe(true);
  });

  it('(EC-12) mark_seen_repetido_es_idempotente: 5 mark_seen consecutivos (simula N timeUpdate del loop) → has_seen sigue true, sin lanzar', () => {
    const store = create_video_engagement_store();
    expect(() => {
      for (let i = 0; i < 5; i++) {
        store.mark_seen(SESSION_A, 'video_completed', PROPERTY_A);
      }
    }).not.toThrow();
    expect(store.has_seen(SESSION_A, 'video_completed', PROPERTY_A)).toBe(true);
  });

  it('(EC-13) dedupe_es_por_event_type_no_cruza_view_y_completed: mark_seen(...,"video_view",...) NO marca "video_completed" para la misma sesión/propiedad', () => {
    const store = create_video_engagement_store();
    store.mark_seen(SESSION_A, 'video_view', PROPERTY_A);
    expect(store.has_seen(SESSION_A, 'video_completed', PROPERTY_A)).toBe(false);
  });

  it('(EC-14) dedupe_es_por_sesion_sesion_nueva_no_hereda_marca: marcado en SESSION_A → SESSION_B (misma propiedad) NO lo hereda (así "volvió a ver" cuenta en sesión nueva)', () => {
    const store = create_video_engagement_store();
    store.mark_seen(SESSION_A, 'video_view', PROPERTY_A);
    expect(store.has_seen(SESSION_B, 'video_view', PROPERTY_A)).toBe(false);
  });

  it('(EC-15) dedupe_es_por_propiedad_no_cruza_entre_propiedades: marcado en PROPERTY_A → PROPERTY_B (misma sesión/tipo) sigue sin verse', () => {
    const store = create_video_engagement_store();
    store.mark_seen(SESSION_A, 'video_view', PROPERTY_A);
    expect(store.has_seen(SESSION_A, 'video_view', PROPERTY_B)).toBe(false);
  });

});
