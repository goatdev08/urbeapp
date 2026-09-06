/**
 * crm_band_meta.ts — metadatos visuales por banda de tendencia (CrmBand) +
 * reglas de acceso al radar anónimo.
 *
 * STUB mínimo — subtarea 267.3 (RED). La fase GREEN implementa el mapeo
 * real (exploración 045 §7.3/§7.4, decisiones de Abraham 2026-09-06).
 */

import { colors } from '@/theme/theme';

import type { CrmBand } from '../types';

export interface BandMeta {
  label: string;
  subtitle: string;
  color: string;
  collapsed_by_default: boolean;
}

/** Orden de despliegue del radar: más urgente primero. */
export const BAND_ORDER: CrmBand[] = ['hot', 'cooling', 'warming', 'silent'];

/**
 * Copy y color por banda de tendencia. `silent` colapsada por default
 * (decisión de Abraham 2026-09-06) — las otras 3 siempre abiertas.
 */
export const BAND_META: Record<CrmBand, BandMeta> = {
  hot: {
    label: 'Háblales hoy',
    subtitle: 'Señal fuerte en las últimas 24 h',
    color: colors.temp_hot,
    collapsed_by_default: false,
  },
  cooling: {
    label: 'Se están enfriando',
    subtitle: 'Estuvieron listos y nadie los alcanzó',
    color: colors.temp_cooling,
    collapsed_by_default: false,
  },
  warming: {
    label: 'Calentando',
    subtitle: 'Suben, pero aún no levantan la mano',
    color: colors.temp_warming,
    collapsed_by_default: false,
  },
  silent: {
    label: 'En silencio',
    subtitle: 'Sin actividad reciente',
    color: colors.temp_silent,
    collapsed_by_default: true,
  },
};

export function band_color(band: CrmBand): string {
  return BAND_META[band].color;
}

/**
 * 🔒 Solo warming/silent aceptan señal anónima en el radar (hot/cooling son
 * leads reales — exploración 045 §7.3, privacidad §7.5).
 */
export function band_accepts_anon(band: CrmBand): boolean {
  return band === 'warming' || band === 'silent';
}
