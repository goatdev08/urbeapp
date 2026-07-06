/**
 * SUT stub — fase RED (subtarea 41.2)
 * Lógica PURA de decisión de la siguiente acción de permiso de ubicación.
 * NO llama a expo-location; recibe un status plano y decide.
 *
 * STUB MÍNIMO: implementación real pendiente (fase GREEN). Este stub
 * devuelve siempre 'granted' a propósito para que EC-3 y EC-4 fallen
 * por aserción (no por import/tipo).
 */

export type PermissionAction = 'granted' | 'request' | 'open_settings';

export interface PermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
}

export function decide_permission_action(_status: PermissionStatus): PermissionAction {
  return 'granted';
}
