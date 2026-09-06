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

/**
 * Mapa proyectado→acción (exploración 045 §7.4, decisiones de Abraham
 * 2026-09-06): nuevo/contactado son un tap directo ('set'); visita/cerrado
 * exigen elegir entre variantes (renta/venta/perdido o reabrir) y por eso
 * SIEMPRE abren el picker completo, nunca asignan un status a ciegas.
 * Cualquier valor fuera del dominio (legacy sin resolver, futuro no
 * contemplado) cae en el mismo fallback seguro: abrir el picker.
 */
export function crm_next_action(projected: ProjectedStatus): NextAction {
  switch (projected) {
    case 'nuevo':
      return { kind: 'set', status: 'contacted', label: 'Contactado' };
    case 'contactado':
      return { kind: 'set', status: AGENDAR_STATUS, label: 'Visita' };
    case 'visita':
      return { kind: 'open_picker', label: 'Cerrar…' };
    case 'cerrado':
      return { kind: 'open_picker', label: 'Reabrir' };
    default:
      return { kind: 'open_picker', label: 'Elegir estado' };
  }
}
