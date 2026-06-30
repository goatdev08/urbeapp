// supabase/functions/update-lead-status/lead_status_updater.ts
// STUB — implementación pendiente (fase RED, subtarea 15.6).
// La factory es importable y tiene la signature correcta;
// el updater retornado lanza 'not_implemented' para que los tests fallen por excepción.

import type { LeadStatusUpdater } from "./types.ts";

// deno-lint-ignore no-explicit-any
export function make_lead_status_updater(_client: { from(table: string): any }): LeadStatusUpdater {
  return {
    update(_params) {
      throw new Error("not_implemented");
    },
  };
}
