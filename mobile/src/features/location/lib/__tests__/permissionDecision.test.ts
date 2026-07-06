/**
 * Tests fase RED — decide_permission_action
 * Archivo SUT: mobile/src/features/location/lib/permissionDecision.ts
 * Subtarea Taskmaster: 41.2 — lógica pura de decisión de permiso de ubicación
 *
 * SUT: decide_permission_action(status: PermissionStatus) → PermissionAction
 *
 * Contrato (fuente: detalle tarea #41 + exploración 027 líneas 130, 163):
 *   - status.granted === true → 'granted' (canAskAgain es IRRELEVANTE cuando granted).
 *   - granted === false && canAskAgain === true  → 'request'.
 *   - granted === false && canAskAgain === false → 'open_settings'.
 *
 * Función PURA: inputs planos, SIN mocks, SIN llamar a expo-location.
 *
 * EDGE CASES CUBIERTOS (4 casos — exhaustivo sobre {granted}×{canAskAgain}):
 *
 * - (EC-1) granted_true_y_can_ask_again_true_devuelve_granted
 * - (EC-2) granted_true_y_can_ask_again_false_devuelve_granted_precedencia_de_granted
 * - (EC-3) granted_false_y_can_ask_again_true_devuelve_request
 * - (EC-4) granted_false_y_can_ask_again_false_devuelve_open_settings
 */

import { decide_permission_action } from '../permissionDecision';
import type { PermissionStatus } from '../permissionDecision';

describe('decide_permission_action', () => {

  // ── (EC-1) granted=true, canAskAgain=true → 'granted' ────────────────────────

  it('(EC-1) granted_true_y_can_ask_again_true_devuelve_granted: {granted:true, canAskAgain:true} → "granted"', () => {
    const status: PermissionStatus = { granted: true, canAskAgain: true };

    const result = decide_permission_action(status);

    expect(result).toBe('granted');
  });

  // ── (EC-2) granted=true, canAskAgain=false → 'granted' (precedencia de granted) ──

  it('(EC-2) granted_true_y_can_ask_again_false_devuelve_granted_precedencia_de_granted: {granted:true, canAskAgain:false} → "granted" (canAskAgain se ignora)', () => {
    const status: PermissionStatus = { granted: true, canAskAgain: false };

    const result = decide_permission_action(status);

    expect(result).toBe('granted');
  });

  // ── (EC-3) granted=false, canAskAgain=true → 'request' ───────────────────────

  it('(EC-3) granted_false_y_can_ask_again_true_devuelve_request: {granted:false, canAskAgain:true} → "request"', () => {
    const status: PermissionStatus = { granted: false, canAskAgain: true };

    const result = decide_permission_action(status);

    expect(result).toBe('request');
  });

  // ── (EC-4) granted=false, canAskAgain=false → 'open_settings' ────────────────

  it('(EC-4) granted_false_y_can_ask_again_false_devuelve_open_settings: {granted:false, canAskAgain:false} → "open_settings"', () => {
    const status: PermissionStatus = { granted: false, canAskAgain: false };

    const result = decide_permission_action(status);

    expect(result).toBe('open_settings');
  });

});
