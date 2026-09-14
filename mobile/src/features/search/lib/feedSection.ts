/**
 * feedSection.ts — derivación pura del FeedTab activo del feed (#296.3).
 *
 * Decisión de producto (2026-09-14, exploración 050 + /tm-plan 296): la
 * fila de tabs del feed pasa de 2 secciones (Venta·Renta, atadas 1:1 a
 * `filters.operation_types`) a 5 TABS — Para ti · Siguiendo · Nuevos · Venta ·
 * Renta — sobre un eje de FUENTE que ya NO vive dentro de FilterState (ver
 * filterStore.tsx: `feed_tab` es estado separado). Este módulo solo sabe
 * derivar `operation_types` a partir de un FeedTab; no sabe nada de storage
 * ni de React.
 *
 * Para ti / Siguiendo / Nuevos son tabs de FUENTE (no de operación): las tres
 * muestran ambas modalidades ['sale','rent']. Venta/Renta siguen fijando la
 * operación exacta, igual que antes (#241), ahora derivada del tab en vez de
 * ser ellas mismas el dato canónico.
 *
 * 'both' sigue siendo valor de DATO (una propiedad que acepta ambas
 * modalidades): build_filter_query lo agrega solo al .in(...), así una
 * propiedad 'both' aparece en Venta y en Renta.
 *
 * ponytail: funciones puras + 2 constantes; sin enum ni clase.
 */
import type { FilterState } from '../types';

export type FeedTab = 'para_ti' | 'siguiendo' | 'nuevos' | 'venta' | 'renta';

/** Para ti abre por defecto (decisión Abraham, /tm-plan 296 — Q1). */
export const DEFAULT_FEED_TAB: FeedTab = 'para_ti';

/** Orden y labels de la fila de tabs del feed. */
export const FEED_TABS: { value: FeedTab; label: string }[] = [
  { value: 'para_ti', label: 'Para ti' },
  { value: 'siguiendo', label: 'Siguiendo' },
  { value: 'nuevos', label: 'Nuevos' },
  { value: 'venta', label: 'Venta' },
  { value: 'renta', label: 'Renta' },
];

const FEED_TAB_VALUES: readonly FeedTab[] = FEED_TABS.map((t) => t.value);

/** Type guard: ¿`value` es uno de los 5 FeedTab válidos? */
export function is_feed_tab(value: unknown): value is FeedTab {
  return typeof value === 'string' && (FEED_TAB_VALUES as readonly string[]).includes(value);
}

/** operation_types que corresponde a `tab`. Array NUEVO en cada llamada. */
export function operation_types_for_tab(tab: FeedTab): string[] {
  if (tab === 'venta') return ['sale'];
  if (tab === 'renta') return ['rent'];
  return ['sale', 'rent'];
}

/** Copia de `filters` con operation_types fijado según `tab`. Puro. */
export function with_tab(filters: FilterState, tab: FeedTab): FilterState {
  return { ...filters, operation_types: operation_types_for_tab(tab) };
}
