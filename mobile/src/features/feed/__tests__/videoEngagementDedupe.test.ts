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
  compute_progress_percent,
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

// ---------------------------------------------------------------------------
// AÑADIDO 268.1 — video_progress: máximo % de reproducción alcanzado
//
// SUT nuevo:
//   compute_progress_percent(current_time, duration): number | null
//   store.get_max_progress(session_id, property_id): number | null
//   store.bump_max_progress(session_id, property_id, progress): number
//
// Contrato (subtarea 268.1, decisión Abraham 2026-09-06):
//   - Entero 0–100 vía Math.floor, clampado. null si duration <= 0, no
//     finita, o current_time no finito/negativo (mismo espíritu de guarda
//     que is_video_completed, pero SIN silenciar con `false`: aquí no hay
//     "falso" posible, el contrato es un número o ausencia de dato).
//   - El máximo por (session_id, property_id) es MONOTÓNICO: nunca baja.
//   - Namespace de progreso INDEPENDIENTE del namespace has_seen/mark_seen
//     (mismo Set/Map interno no debe colisionar aunque compartan session_id
//     y property_id — son dos preguntas distintas: "¿ya se vio/completó?"
//     vs "¿cuál es el avance máximo?").
//
// EDGE CASES CUBIERTOS (18 casos):
//
// ### Happy path — compute_progress_percent
// - (EC-16) treinta_de_sesenta_es_cincuenta_porciento
// - (EC-17) fraccion_se_trunca_por_piso_no_redondeo
// - (EC-18) fin_exacto_es_cien_porciento
// - (EC-19) inicio_exacto_es_cero_porciento
//
// ### Boundary — clamp superior
// - (EC-20) excede_la_duracion_se_clampa_a_cien
//
// ### Boundary / error — duration inválida
// - (EC-21) duration_cero_es_null
// - (EC-22) duration_negativa_es_null
// - (EC-23) duration_infinita_es_null
// - (EC-24) duration_nan_es_null
//
// ### Boundary / error — current_time inválido
// - (EC-25) current_time_nan_es_null
// - (EC-26) current_time_negativo_es_null
// - (EC-27) current_time_infinito_es_null
//
// ### Happy path — store, máximo monotónico
// - (EC-28) sin_bump_previo_el_maximo_es_null
// - (EC-29) primer_bump_establece_el_maximo_y_lo_devuelve
// - (EC-30) bump_con_valor_menor_no_baja_el_maximo
// - (EC-31) bump_con_valor_mayor_si_sube_el_maximo
//
// ### Boundary — aislamiento de claves de progreso
// - (EC-32) claves_de_progreso_independientes_por_sesion_y_propiedad
// - (EC-33) claves_de_progreso_no_colisionan_con_has_seen_mark_seen
// ---------------------------------------------------------------------------

describe('compute_progress_percent — % entero 0–100 del avance de reproducción', () => {

  it('(EC-16) treinta_de_sesenta_es_cincuenta_porciento: currentTime=30s, duration=60s → 50', () => {
    expect(compute_progress_percent(30, 60)).toBe(50);
  });

  it('(EC-17) fraccion_se_trunca_por_piso_no_redondeo: currentTime=59.9s, duration=60s (99.83%) → 99, NO 100 (Math.floor, no Math.round)', () => {
    expect(compute_progress_percent(59.9, 60)).toBe(99);
  });

  it('(EC-18) fin_exacto_es_cien_porciento: currentTime=60s, duration=60s → 100', () => {
    expect(compute_progress_percent(60, 60)).toBe(100);
  });

  it('(EC-19) inicio_exacto_es_cero_porciento: currentTime=0s, duration=60s → 0', () => {
    expect(compute_progress_percent(0, 60)).toBe(0);
  });

  it('(EC-20) excede_la_duracion_se_clampa_a_cien: currentTime=70s, duration=60s (el loop reinició antes del último tick) → 100, NUNCA > 100', () => {
    expect(compute_progress_percent(70, 60)).toBe(100);
  });

  it('(EC-21) duration_cero_es_null: duration=0 (player recién montado) → null, no lanza', () => {
    expect(() => compute_progress_percent(10, 0)).not.toThrow();
    expect(compute_progress_percent(10, 0)).toBe(null);
  });

  it('(EC-22) duration_negativa_es_null: duration=-5 (nunca debería pasar, pero no debe tronar) → null', () => {
    expect(compute_progress_percent(10, -5)).toBe(null);
  });

  it('(EC-23) duration_infinita_es_null: duration=Infinity → null, no lanza', () => {
    expect(() => compute_progress_percent(10, Infinity)).not.toThrow();
    expect(compute_progress_percent(10, Infinity)).toBe(null);
  });

  it('(EC-24) duration_nan_es_null: duration=NaN (aún cargando) → null', () => {
    expect(compute_progress_percent(10, NaN)).toBe(null);
  });

  it('(EC-25) current_time_nan_es_null: currentTime=NaN con duration válida → null, no lanza', () => {
    expect(() => compute_progress_percent(NaN, 60)).not.toThrow();
    expect(compute_progress_percent(NaN, 60)).toBe(null);
  });

  it('(EC-26) current_time_negativo_es_null: currentTime=-1 (no debería pasar, pero no debe tronar) → null', () => {
    expect(compute_progress_percent(-1, 60)).toBe(null);
  });

  it('(EC-27) current_time_infinito_es_null: currentTime=Infinity → null', () => {
    expect(compute_progress_percent(Infinity, 60)).toBe(null);
  });

});

describe('store — máximo de progreso monotónico por (sesión, propiedad)', () => {

  it('(EC-28) sin_bump_previo_el_maximo_es_null: store recién creado → get_max_progress devuelve null para cualquier clave', () => {
    const store = create_video_engagement_store();
    expect(store.get_max_progress(SESSION_A, PROPERTY_A)).toBe(null);
  });

  it('(EC-29) primer_bump_establece_el_maximo_y_lo_devuelve: bump_max_progress(session,property,40) → devuelve 40, y get_max_progress(misma clave) === 40', () => {
    const store = create_video_engagement_store();
    expect(store.bump_max_progress(SESSION_A, PROPERTY_A, 40)).toBe(40);
    expect(store.get_max_progress(SESSION_A, PROPERTY_A)).toBe(40);
  });

  it('(EC-30) bump_con_valor_menor_no_baja_el_maximo: máximo en 40, bump con 20 (el video se reinició por el loop) → sigue devolviendo 40, get_max_progress sigue 40', () => {
    const store = create_video_engagement_store();
    store.bump_max_progress(SESSION_A, PROPERTY_A, 40);
    expect(store.bump_max_progress(SESSION_A, PROPERTY_A, 20)).toBe(40);
    expect(store.get_max_progress(SESSION_A, PROPERTY_A)).toBe(40);
  });

  it('(EC-31) bump_con_valor_mayor_si_sube_el_maximo: máximo en 40, bump con 90 → devuelve 90, get_max_progress sigue el nuevo máximo', () => {
    const store = create_video_engagement_store();
    store.bump_max_progress(SESSION_A, PROPERTY_A, 40);
    expect(store.bump_max_progress(SESSION_A, PROPERTY_A, 90)).toBe(90);
    expect(store.get_max_progress(SESSION_A, PROPERTY_A)).toBe(90);
  });

  it('(EC-32) claves_de_progreso_independientes_por_sesion_y_propiedad: bump en (SESSION_A,PROPERTY_A) a 70 no afecta (SESSION_A,PROPERTY_B) ni (SESSION_B,PROPERTY_A), que siguen null', () => {
    const store = create_video_engagement_store();
    store.bump_max_progress(SESSION_A, PROPERTY_A, 70);
    expect(store.get_max_progress(SESSION_A, PROPERTY_B)).toBe(null);
    expect(store.get_max_progress(SESSION_B, PROPERTY_A)).toBe(null);
  });

  it('(EC-33) claves_de_progreso_no_colisionan_con_has_seen_mark_seen: mark_seen("video_view") no establece un máximo de progreso, y bump_max_progress no marca has_seen("video_view") como visto', () => {
    const store_a = create_video_engagement_store();
    store_a.mark_seen(SESSION_A, 'video_view', PROPERTY_A);
    expect(store_a.get_max_progress(SESSION_A, PROPERTY_A)).toBe(null);

    const store_b = create_video_engagement_store();
    store_b.bump_max_progress(SESSION_A, PROPERTY_A, 55);
    expect(store_b.has_seen(SESSION_A, 'video_view', PROPERTY_A)).toBe(false);
  });

});
