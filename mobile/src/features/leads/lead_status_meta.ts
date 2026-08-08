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
// Nivel de actividad (frío/tibio/caliente) — RETIRADO en tarea #112 (decisión
// del dueño: el puntaje/temperatura salen de la UI, reemplazados por la barra
// de acciones tangible — ver ActionStatsBar.tsx). `leads.score`/`leads.level`
// siguen vivos en DB/tipos (AgentLead.score/level, apps v1.0.3 + el OTA del
// mismo día allá afuera leyéndolas) — solo este mapeo visual (LEVEL_META/
// get_level_meta), sin consumidores tras el retiro de LeadCard, se elimina.
// ---------------------------------------------------------------------------
