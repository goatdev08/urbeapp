/**
 * lead_status_meta.ts — metadatos visuales de los estados de lead.
 *
 * Única fuente de verdad para etiquetas en español y colores de badge.
 * Usado por LeadCard y LeadExpandedView.
 *
 * ponytail: módulo plano de datos — sin lógica de negocio.
 */

import { colors } from '@/theme/theme';

import type { LeadStatus } from './types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface StatusMeta {
  label: string;
  bg: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Mapa completo (enum lead_status, migración 0001)
// ---------------------------------------------------------------------------

export const STATUS_META: Record<LeadStatus, StatusMeta> = {
  new:             { label: 'Nuevo',           bg: colors.primary,      text: '#FFFFFF' },
  contacted:       { label: 'Contactado',      bg: colors.accent_soft,  text: colors.ink },
  in_progress:     { label: 'En progreso',     bg: colors.accent,       text: '#FFFFFF' },
  visit_scheduled: { label: 'Visita agendada', bg: colors.primary_soft, text: '#FFFFFF' },
  closed_won:      { label: 'Ganado',          bg: colors.primary_deep, text: '#FFFFFF' },
  closed_lost:     { label: 'Perdido',         bg: colors.paper_3,      text: colors.gray_3 },
  discarded:       { label: 'Descartado',      bg: colors.paper_2,      text: colors.gray_2 },
};

/** Orden canónico del enum (flujo de progresión del lead). */
export const ALL_LEAD_STATUSES: LeadStatus[] = [
  'new',
  'contacted',
  'in_progress',
  'visit_scheduled',
  'closed_won',
  'closed_lost',
  'discarded',
];

/** Fallback seguro: si el status es desconocido devuelve neutro. */
export function get_status_meta(status: LeadStatus): StatusMeta {
  return STATUS_META[status] ?? { label: status, bg: colors.paper_3, text: colors.gray_3 };
}
