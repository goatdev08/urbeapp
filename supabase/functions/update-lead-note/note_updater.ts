// supabase/functions/update-lead-note/note_updater.ts
// STUB mínimo (fase RED, subtareas 29.2/29.3). La lógica real (doble query,
// ownership, UPDATE shape) se implementa en el GREEN de la subtarea 29.4.
// Este stub existe solo para que note_updater.test.ts compile e importe;
// debe FALLAR por aserción, nunca por import.

import type { NoteUpdater, UpdateLeadNoteParams, UpdateLeadNoteResult } from "./types.ts";

// deno-lint-ignore no-explicit-any
export function make_note_updater(_client: { from(table: string): any }): NoteUpdater {
  return {
    update(_params: UpdateLeadNoteParams): Promise<UpdateLeadNoteResult> {
      return Promise.resolve({ ok: false, error_code: "DB_ERROR" });
    },
  };
}
