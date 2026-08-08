// supabase/functions/contact-agent/lead_repo.ts
// Fábrica del LeadRepo real — GREEN 75.1.
//
// Separada de index.ts para ser testeable — mismo patrón que
// update-lead-status/lead_status_updater.ts y update-lead-note/note_updater.ts.
// Movida (no reescrita) desde el closure inline de `Deno.serve` en index.ts:93-140,
// que hardcodeaba `status: "new"`.
//
// Decisión del usuario (PRD §19.2/§19.8): el lead nace en 'whatsapp_opened', no en
// 'new' — es el estado real del embudo tras el primer contacto por WhatsApp. El
// data-fix + los 4 valores nuevos del enum viven en la migración 20260807000002/3
// (subtarea 75.1, capa DB); este archivo es el lado Edge Function del mismo cambio.

import type { FindActiveLeadResult, InsertLeadResult, LeadRepo } from "./types.ts";

// deno-lint-ignore no-explicit-any
export function make_lead_repo(client: { from(table: string): any }): LeadRepo {
  return {
    async find_active_lead(agent_id: string, user_id: string): Promise<FindActiveLeadResult> {
      const { data, error } = await client
        .from("leads")
        .select("id, status, first_contact_at")
        .eq("agent_id", agent_id)
        .eq("user_id", user_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) return { ok: false, error_code: "DB_ERROR" };
      if (!data) return { ok: true, found: false };

      return {
        ok: true,
        found: true,
        lead: {
          id: data.id,
          status: data.status,
          first_contact_at: data.first_contact_at,
        },
      };
    },

    async insert_lead(agent_id: string, user_id: string): Promise<InsertLeadResult> {
      const { data, error } = await client
        .from("leads")
        .insert({ agent_id, user_id, status: "whatsapp_opened" })
        // first_contact_at: DEFAULT now() en schema; no hace falta pasarlo.
        .select("id, status, first_contact_at")
        .single();

      if (error) {
        // supabase-js mapea SQLSTATE 23505 (unique_violation) a error.code === "23505"
        if (error.code === "23505") return { ok: false, error_code: "CONFLICT_23505" };
        return { ok: false, error_code: "DB_ERROR" };
      }

      return {
        ok: true,
        lead: {
          id: data.id,
          status: data.status,
          first_contact_at: data.first_contact_at,
        },
      };
    },
  };
}
