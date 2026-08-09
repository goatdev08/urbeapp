/**
 * useDraftAutosave — STUB para fase RED (subtarea Taskmaster 73.3).
 *
 * Firma acordada (ver EDGE CASES en la subtarea 73.3 de Taskmaster para el
 * detalle completo de comportamiento esperado):
 *
 *   useDraftAutosave(state: PublishFormState, deps?: UseDraftAutosaveDeps): void
 *
 * Debounce ~DRAFT_AUTOSAVE_DEBOUNCE_MS tras el último cambio del state, guarda
 * status='draft' vía supabase.from('properties') — INSERT la primera vez,
 * UPDATE las siguientes (reusa el id del draft ya creado). NO corre en
 * edit_mode (leído de state.edit_mode, NUNCA de useLocalSearchParams — bug
 * #53). Fail-soft ante error de escritura (no lanza, no crashea el wizard).
 *
 * Implementación real: fase GREEN del agente mobile. Este archivo es
 * intencionalmente un stub que lanza — NO tocar aquí lógica de negocio.
 */

import type { PublishFormState } from '../store/types';

export const DRAFT_AUTOSAVE_DEBOUNCE_MS = 1500;

export interface UseDraftAutosaveDeps {
  supabase?: unknown;
}

export function useDraftAutosave(
  _state: PublishFormState,
  _deps?: UseDraftAutosaveDeps,
): void {
  throw new Error('not_implemented');
}
