// supabase/functions/request-agent-upgrade/application_creator.ts
// Fábrica del ApplicationCreator real. Separado de index.ts para ser testeable.
// Patrón espejo de create-invitation/invitation_creator.ts.
//
// ⭐ El `client` inyectado aquí DEBE ser un user_client (_shared/clients.ts,
// anon key + JWT del caller) — NUNCA service_role. La autorización ("solo tu
// propio user_id") la hace la política RLS agent_app_insert, no este código;
// así un cambio futuro en la política se refleja automáticamente aquí sin
// duplicar la regla en JS.

import type {
  ApplicationCreator,
  CreateApplicationParams,
  CreateApplicationResult,
} from "./types.ts";

/**
 * Construye el ApplicationCreator real. `client` es duck-typed (facilita
 * testing con fakes) pero en producción SIEMPRE es un user_client.
 */
export function make_application_creator(
  // deno-lint-ignore no-explicit-any
  client: { from(table: string): any },
): ApplicationCreator {
  return {
    async create(
      params: CreateApplicationParams,
    ): Promise<CreateApplicationResult> {
      const { data, error } = await client
        .from("agent_applications")
        .insert({
          user_id: params.user_id,
          application_type: "independent",
          reason: params.reason,
        })
        .select("id")
        .single();

      if (error) {
        // SQLSTATE 23505 (unique_violation) → supabase-js mapea a error.code
        // === "23505". Índice agent_app_one_pending_per_user: el caller ya
        // tiene una solicitud pending.
        if (error.code === "23505") {
          return { ok: false, error_code: "DUPLICATE_PENDING_APPLICATION" };
        }
        return { ok: false, error_code: "DB_ERROR", message: error.message };
      }
      if (!data) {
        return {
          ok: false,
          error_code: "DB_ERROR",
          message: "INSERT no devolvió filas",
        };
      }

      return { ok: true, application_id: data.id as string };
    },
  };
}
