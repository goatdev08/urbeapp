/**
 * lead_status_meta.ts — metadatos visuales de los estados de lead.
 *
 * Única fuente de verdad para etiquetas en español y colores de badge.
 * Usado por LeadCard y LeadExpandedView.
 *
 * ponytail: módulo plano de datos — sin lógica de negocio.
 */

import { colors } from '@/theme/theme';

import type { LeadStatus, LeadTemperature } from './types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface StatusMeta {
  label: string;
  bg: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Mapa completo (enum lead_status, migración 0001 + reconcile #75.1)
// ---------------------------------------------------------------------------
//
// Incluye los 3 legacy (new, in_progress, closed_won) para que un lead viejo
// se siga viendo bien — pero NO aparecen en ALL_LEAD_STATUSES, así que el
// picker no permite volver a elegirlos.

export const STATUS_META: Record<LeadStatus, StatusMeta> = {
  // ── Legacy (solo label/color — fuera del picker) ──────────────────────────
  new:             { label: 'Nuevo',           bg: colors.primary,      text: '#FFFFFF' },
  in_progress:     { label: 'En progreso',     bg: colors.accent,       text: '#FFFFFF' },
  closed_won:      { label: 'Ganado',          bg: colors.primary_deep, text: '#FFFFFF' },
  // ── Vigentes ──────────────────────────────────────────────────────────────
  whatsapp_opened: { label: 'Nuevo',           bg: colors.primary,      text: '#FFFFFF' },
  contacted:       { label: 'Contactado',      bg: colors.accent_soft,  text: colors.ink },
  interested:      { label: 'Interesado',      bg: colors.accent,       text: '#FFFFFF' },
  visit_scheduled: { label: 'Visita agendada', bg: colors.primary_soft, text: '#FFFFFF' },
  closed_won_rent: { label: 'Ganado (renta)',  bg: colors.primary_deep, text: '#FFFFFF' },
  closed_won_sale: { label: 'Ganado (venta)',  bg: colors.primary_deep, text: '#FFFFFF' },
  closed_lost:     { label: 'Perdido',         bg: colors.paper_3,      text: colors.gray_3 },
  discarded:       { label: 'Descartado',      bg: colors.paper_2,      text: colors.gray_2 },
};

/**
 * Set que ofrece el picker (LeadExpandedView) — SOLO los 8 estados vigentes.
 * Los 3 legacy (new, in_progress, closed_won) quedan fuera: un lead ya
 * migrado no debe poder volver a un estado que el backend ya no asigna.
 */
export const ALL_LEAD_STATUSES: LeadStatus[] = [
  'whatsapp_opened',
  'contacted',
  'interested',
  'visit_scheduled',
  'closed_won_rent',
  'closed_won_sale',
  'closed_lost',
  'discarded',
];

/** Fallback seguro: si el status es desconocido devuelve neutro. */
export function get_status_meta(status: LeadStatus): StatusMeta {
  return STATUS_META[status] ?? { label: status, bg: colors.paper_3, text: colors.gray_3 };
}

// ---------------------------------------------------------------------------
// Nivel de actividad (frío/tibio/caliente) — subtarea 75.6, §19.9
// ---------------------------------------------------------------------------
//
// Escala de intensidad en un solo tono (Arcilla) — frío en gris neutro, tibio
// y caliente en Arcilla creciente. Deliberadamente NO reusa los tokens exactos
// del status badge más cercano visualmente (closed_lost/interested) para que
// nivel y estado sigan siendo dos badges distinguibles a simple vista.

export const LEVEL_META: Record<LeadTemperature, StatusMeta> = {
  frio:     { label: 'Frío',     bg: colors.silver,      text: colors.gray_3 },
  tibio:    { label: 'Tibio',    bg: colors.accent_tint,  text: colors.accent_deep },
  caliente: { label: 'Caliente', bg: colors.accent,       text: '#FFFFFF' },
};

/** Fallback seguro: si el nivel es desconocido devuelve neutro. */
export function get_level_meta(level: LeadTemperature): StatusMeta {
  return LEVEL_META[level] ?? { label: level, bg: colors.paper_3, text: colors.gray_3 };
}
