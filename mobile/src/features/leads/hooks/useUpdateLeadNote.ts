/**
 * useUpdateLeadNote — STUB mínimo, fase RED (29.5).
 *
 * Mirror de useUpdateLeadStatus.ts pero con responsabilidad única: editar
 * internal_notes sin tocar el status del lead (invoca la EF 'update-lead-note').
 *
 * Este stub NO implementa lógica real — solo existe para que
 * useUpdateLeadNote.test.ts pueda importar y compilar. La fase GREEN
 * reemplazará el cuerpo con el patrón is_working_ref + force_update,
 * idéntico al de useUpdateLeadStatus.
 *
 * NO IMPLEMENTAR LÓGICA AQUÍ — ese es el trabajo de la fase GREEN.
 */

export interface UseUpdateLeadNoteDeps {
  /** Cliente Supabase inyectado (en producción: supabase del singleton). */
  supabase?: unknown;
  /** Callback invocado tras éxito (p.ej. refetch de la lista CRM). */
  onSuccess?: () => void;
}

export interface UseUpdateLeadNoteReturn {
  /**
   * Invoca la EF update-lead-note con lead_id y note.
   * note="" es válido (limpia la nota). Llama onSuccess si la operación
   * es exitosa.
   */
  update_note(lead_id: string, note: string): Promise<void>;
  /** true mientras la invocación está en vuelo, false en reposo. */
  is_updating: boolean;
  /** null tras éxito; string con descripción en fallo. */
  error: string | null;
}

export function useUpdateLeadNote(_deps?: UseUpdateLeadNoteDeps): UseUpdateLeadNoteReturn {
  return {
    update_note: async () => {},
    is_updating: false,
    error: null,
  };
}
