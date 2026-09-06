/**
 * crm_band_meta.ts — metadatos visuales por banda de tendencia (CrmBand) +
 * reglas de acceso al radar anónimo.
 *
 * STUB mínimo — subtarea 267.3 (RED). La fase GREEN implementa el mapeo
 * real (exploración 045 §7.3/§7.4, decisiones de Abraham 2026-09-06).
 */

import type { CrmBand } from '../types';

export interface BandMeta {
  label: string;
  subtitle: string;
  color: string;
  collapsed_by_default: boolean;
}

export const BAND_ORDER: CrmBand[] = [];

export const BAND_META: Record<CrmBand, BandMeta> = {
  hot: { label: '', subtitle: '', color: '', collapsed_by_default: false },
  cooling: { label: '', subtitle: '', color: '', collapsed_by_default: false },
  warming: { label: '', subtitle: '', color: '', collapsed_by_default: false },
  silent: { label: '', subtitle: '', color: '', collapsed_by_default: false },
};

export function band_color(_band: CrmBand): string {
  throw new Error('not implemented');
}

export function band_accepts_anon(_band: CrmBand): boolean {
  throw new Error('not implemented');
}
