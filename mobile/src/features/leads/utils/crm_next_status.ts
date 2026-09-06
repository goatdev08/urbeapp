/**
 * crm_next_status.ts — acción sugerida del botón primario de la fila CRM,
 * según el status proyectado 8→4 (ProjectedStatus).
 *
 * STUB mínimo — subtarea 267.3 (RED). La fase GREEN implementa el mapeo
 * real (exploración 045 §7.3/§7.4, decisiones de Abraham 2026-09-06).
 */

import type { LeadStatus, ProjectedStatus } from '../types';

/**
 * NextAction — o bien un status concreto a asignar de un tap ('set'), o bien
 * la señal de abrir el picker completo porque la acción exige elegir entre
 * variantes ('open_picker' — cerrar exige renta/venta/perdido, nunca un tap).
 */
export type NextAction =
  | { kind: 'set'; status: LeadStatus; label: string }
  | { kind: 'open_picker'; label: string };

/** El botón "Agendar" siempre marca este status vigente. */
export const AGENDAR_STATUS: LeadStatus = 'visit_scheduled';

export function crm_next_action(_projected: ProjectedStatus): NextAction {
  throw new Error('not implemented');
}
