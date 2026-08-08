// supabase/functions/contact-agent/lead_repo.test.ts
// Tests RED — subtarea 75.1.
//
// SEAM bajo test: la firma exportada `make_lead_repo(client)` (types.ts#LeadRepo).
// HOY el stub de lead_repo.ts SOLO lanza `not_implemented` — por eso TODO lo de abajo
// falla por EXCEPCIÓN (no por import): es el caso "SUT no existe, stub mínimo que
// lanza" del protocolo TDD del repo.
//
// EDGE CASES (RED):
// - insert_lead: el payload de .insert() en la tabla `leads` trae status='whatsapp_opened'
//   (PRD §19.2 "Se crea el lead en estado whatsapp_opened"), NO 'new' (el literal viejo
//   que index.ts:120 hardcodea hoy). Fuente independiente: el literal del PRD, no
//   recomputado del propio código bajo prueba.
// - insert_lead: el payload SIGUE incluyendo agent_id y user_id (no-regresión de forma).
//
// Fuera de alcance (75.4, NO tocar aquí): unificación de leads / template de WhatsApp.

import { assertEquals } from "@std/assert";
import { make_lead_repo } from "./lead_repo.ts";

const AGENT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";

interface CapturedInsert {
  table: string;
  payload: Record<string, unknown>;
}

/**
 * Fake client chainable mínimo — mismo patrón que
 * update-lead-status/lead_status_updater.test.ts#make_fake_client, adaptado al único
 * método que insert_lead usa: .from().insert().select().single().
 */
function make_fake_client(): {
  // deno-lint-ignore no-explicit-any
  client: { from(table: string): any };
  captured: CapturedInsert[];
} {
  const captured: CapturedInsert[] = [];

  const client = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          captured.push({ table, payload: { ...payload } });
          return this;
        },
        select(_cols?: string) {
          return this;
        },
        async single() {
          return {
            data: { id: "lead-nuevo", status: "whatsapp_opened", first_contact_at: "2026-08-07T00:00:00Z" },
            error: null,
          };
        },
      };
    },
  };

  return { client, captured };
}

Deno.test("contact_agent_lead_repo_insert_lead_status_inicial_es_whatsapp_opened", async () => {
  const { client, captured } = make_fake_client();
  const repo = make_lead_repo(client);

  await repo.insert_lead(AGENT_ID, USER_ID);

  assertEquals(
    captured[0]?.payload.status,
    "whatsapp_opened",
    "el lead debe nacer en 'whatsapp_opened' (PRD §19.2), no en 'new'",
  );
});

Deno.test("contact_agent_lead_repo_insert_lead_payload_conserva_agent_id_y_user_id", async () => {
  const { client, captured } = make_fake_client();
  const repo = make_lead_repo(client);

  await repo.insert_lead(AGENT_ID, USER_ID);

  assertEquals(captured[0]?.payload.agent_id, AGENT_ID);
  assertEquals(captured[0]?.payload.user_id, USER_ID);
});
