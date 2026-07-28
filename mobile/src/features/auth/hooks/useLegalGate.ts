/**
 * useLegalGate — ¿el usuario aceptó la versión VIGENTE de cada documento legal?
 * Subtarea 72.6 (PRD §5.5, LFPDPPP).
 *
 * La comparación "versión aceptada vs versión vigente" NO se hace aquí: la resuelve
 * la RPC `pending_legal_consents()` (migración 20260727000003_legal_gate.sql). El hook
 * solo consume esa respuesta. Es a propósito — si el cliente reimplementara la
 * comparación, un bug suyo significaría gente operando la plataforma bajo términos que
 * nunca aceptó, que es justo lo que hay que poder demostrar ante la ley.
 *
 * `pending` vacío = al día. Con elementos = bloquear y pedir re-aceptación.
 *
 * Patrón: función async DENTRO del efecto + contador `tick` para refetch, igual que
 * `features/leads/hooks/useAgentLeads.ts`. No es estilo: llamar desde el efecto a una
 * función definida fuera que hace setState cuenta como setState síncrono en efecto
 * (cascada de renders) y el linter de React lo marca como error.
 */
import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Fila tal como la devuelve `pending_legal_consents()`. */
export interface PendingLegalDocument {
  doc_type: 'terms' | 'privacy';
  version: string;
  terms_version_id: string;
}

export interface UseLegalGateReturn {
  pending: PendingLegalDocument[];
  is_loading: boolean;
  error: string | null;
  /** Acepta TODOS los documentos pendientes de una vez. */
  accept: () => Promise<void>;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLegalGate(): UseLegalGateReturn {
  const { user } = useAuth();
  const [pending, set_pending] = useState<PendingLegalDocument[]>([]);
  const [is_loading, set_is_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  // ponytail: contador como señal de refetch — mismo patrón que useAgentLeads, más
  // simple que un useReducer o una queryKey.
  const [tick, set_tick] = useState(0);

  useEffect(() => {
    // Evita el setState tras desmontaje o refetch solapado: este gate vive en el
    // arranque, donde la navegación cambia rápido y la respuesta puede llegar tarde.
    let ignore = false;

    async function fetch_pending(): Promise<void> {
      const { data, error: rpc_error } = await supabase.rpc('pending_legal_consents');
      if (ignore) return;

      if (rpc_error) {
        // No se relanza: un fallo de red al consultar el gate no debe tumbar el
        // arranque de la app. Queda expuesto en `error` para que la pantalla decida.
        set_error(rpc_error.message);
        set_pending([]);
        set_is_loading(false);
        return;
      }

      set_error(null);
      set_pending((data ?? []) as PendingLegalDocument[]);
      set_is_loading(false);
    }

    void fetch_pending();

    return () => {
      ignore = true;
    };
  }, [tick]);

  const accept = useCallback(async (): Promise<void> => {
    if (pending.length === 0 || user === null) return;

    // Una fila por documento en un solo INSERT: o entran todos o no entra ninguno.
    // Aceptar términos pero no privacidad dejaría un limbo que el gate volvería a
    // bloquear igual.
    // `user_id` explícito: el with_check de `consents_insert` exige que coincida con
    // auth.uid(), no hay default que lo ponga.
    const rows = pending.map((doc) => ({
      user_id: user.id,
      consent_type: doc.doc_type,
      terms_version_id: doc.terms_version_id,
    }));

    const { error: insert_error } = await supabase.from('user_consents').insert(rows);

    if (insert_error) {
      // Sin refetch a propósito: si el INSERT falló, `pending` sigue siendo la verdad y
      // volver a consultar solo gastaría un round-trip para llegar a lo mismo.
      set_error(insert_error.message);
      return;
    }

    set_error(null);
    set_tick((t) => t + 1);
  }, [pending, user]);

  const refresh = useCallback((): void => {
    set_is_loading(true);
    set_tick((t) => t + 1);
  }, []);

  return { pending, is_loading, error, accept, refresh };
}
