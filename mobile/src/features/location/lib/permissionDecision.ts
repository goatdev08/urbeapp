/**
 * permissionDecision.ts — Lógica PURA de decisión de permiso de ubicación (subtarea 41.2).
 *
 * Decide la siguiente acción a partir de un status plano ({ granted, canAskAgain }),
 * SIN llamar a expo-location. El LocationProvider / LocationWall despachan la acción;
 * este módulo solo decide (testeable sin el módulo nativo, inputs planos).
 *
 * Reglas:
 *   - granted                    → 'granted'       (proceder; canAskAgain irrelevante)
 *   - !granted && canAskAgain    → 'request'       (mostrar diálogo de permiso del SO)
 *   - !granted && !canAskAgain   → 'open_settings' (SO bloqueó; abrir Ajustes)
 */

export type PermissionAction = 'granted' | 'request' | 'open_settings';

export interface PermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
}

export function decide_permission_action(status: PermissionStatus): PermissionAction {
  if (status.granted) {
    return 'granted';
  }
  if (status.canAskAgain) {
    return 'request';
  }
  return 'open_settings';
}
