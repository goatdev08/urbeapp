/**
 * crm_narrative.ts — copy narrativo del header del CRM y de cada fila.
 *
 * STUB mínimo — subtarea 267.3 (RED). La fase GREEN implementa el copy
 * real (exploración 045 §7.3/§7.4, decisiones de Abraham 2026-09-06).
 */

import type { CrmBand, CrmLeadSignals } from '../types';

export interface CrmHeaderNarrative {
  headline: string;
  highlight: string | null;
  subline: string | null;
}

export function crm_header_narrative(
  _counts: Record<CrmBand, number>,
  _top_cooling?: { first_name: string; delta: number } | null,
): CrmHeaderNarrative {
  throw new Error('not implemented');
}

export function crm_row_narrative(
  _signals: CrmLeadSignals,
  _origin_address: string | null,
  _opened_whatsapp_without_writing: boolean,
): string {
  throw new Error('not implemented');
}
