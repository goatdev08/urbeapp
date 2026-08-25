/**
 * useModerateProperty — moderar una revisión de edición o una publicación
 * inicial (approve|needs_changes|reject) desde la cola de revisiones del
 * panel admin (módulo 041-M1, tarea #218, subtarea 218.1). Fase RED. Contrato
 * completo y los 19 edge cases están en el docblock de
 * mobile/src/features/admin/__tests__/useModerateProperty.test.tsx.
 *
 * Calca useSetOrgAdvertising (209.3) / useSuspendAgency (211.2):
 * is_working_ref + force_update síncrono ANTES del primer await, DI del
 * cliente, run_action, getters en el objeto retornado.
 *
 * 🔴 EL MENSAJE NUNCA SALE DE error.message (#200). extract_error_code lee el
 * código del CUERPO; map_revision_error lo traduce.
 *
 * 🔴 NO SE DESPRENDE `client.functions.invoke` (#205). `const { invoke } =
 * client.functions` pierde el `this` y falla MUDO en producción — con la
 * suite en verde si el mock es un objeto plano. La llamada va siempre como
 * `client.functions.invoke(...)`.
 *
 * 🔴 NO VALIDA `reason` — la UI lo exige para needs_changes/reject; el hook
 * solo lo reenvía si vino (nunca manda la clave si está ausente).
 *
 * 🔴 NO DOBLE-SUBMIT, semántica IGNORAR (distinta de useSuspendAgency, que
 * COALESCE): mientras `is_submitting` es true, una segunda llamada resuelve
 * de inmediato a `{ ok: false, status: null }` SIN invocar la EF ni esperar a
 * la primera — la primera sigue intacta.
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { extract_error_code } from '@/lib/supabase/edge-errors';

import { map_revision_error } from '../revision_error_messages';

export type ModeratePropertyAction = 'approve' | 'needs_changes' | 'reject';

export interface ModeratePropertyParams {
  property_id: string;
  action: ModeratePropertyAction;
  reason?: string;
}

export type ModeratePropertyResult =
  | { ok: true; status: string }
  | { ok: false; status: null };

export interface UseModeratePropertyDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — refresca la cola de revisiones. */
  onSuccess?: () => void;
}

export interface UseModeratePropertyReturn {
  moderate(params: ModeratePropertyParams): Promise<ModeratePropertyResult>;
  is_submitting: boolean;
  error_message: string | null;
}

export function useModerateProperty(
  deps?: UseModeratePropertyDeps,
): UseModeratePropertyReturn {
  // Referenciados para que TS no marque los imports como no usados en este
  // stub — el GREEN los usa de verdad.
  void useCallback;
  void useMemo;
  void useReducer;
  void useRef;
  void extract_error_code;
  void map_revision_error;
  void deps;
  throw new Error('not_implemented');
}
