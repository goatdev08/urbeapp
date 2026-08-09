// supabase/functions/contact-agent/index.ts
// Entry point de producción — GREEN 14.9, leadRepo extraído a lead_repo.ts en 75.1.
// Reemplaza los 4 stubs not_implemented con adapters reales (service_role client, RLS bypass).
// Deploy + smoke E2E pendientes de autorización.

import { make_contact_agent_handler } from "./handler.ts";
import { make_lead_repo } from "./lead_repo.ts";
import { make_property_resolver } from "./property_resolver.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  IncrementContactCountResult,
  InsertOriginResult,
  OriginRepo,
} from "./types.ts";
import { service_client } from "../_shared/clients.ts";

Deno.serve((req: Request) => {
  // Crear client por request — sin estado persistente entre invocaciones (persistSession: false).
  const client = service_client();

  // ── 1. callerVerifier — JWT → user_id ─────────────────────────────────────
  // Patrón idéntico a update-property-status/index.ts: Bearer header → auth.getUser.
  const callerVerifier: CallerVerifier = {
    async verify_caller(authHeader: string | null): Promise<CallerVerifyResult> {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      const jwt = authHeader.replace(/^Bearer\s+/, "");
      const { data: { user }, error: auth_error } = await client.auth.getUser(jwt);
      if (auth_error || !user) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      return { ok: true, user_id: user.id };
    },
  };

  // ── 2. propertyResolver — SELECT properties + JOIN users (owner) + videos ──
  // Implementación real en property_resolver.ts (75.4) — extraída de aquí para ser
  // testeable con un fake client, igual que leadRepo en 75.1. La versión inline que
  // vivía en este closure omitía `video_id` con un `ponytail:` que resultó ser un
  // hueco de §9.6: lead_origin_properties.property_video_id quedaba NULL siempre.
  const propertyResolver = make_property_resolver(client);

  // ── 3. leadRepo — SELECT + INSERT idempotente sobre leads ─────────────────
  // Índice único parcial leads_agent_user_unique_active (WHERE deleted_at IS NULL)
  // garantiza 1 lead activo por par (agent_id, user_id). Implementación real en
  // lead_repo.ts (75.1) — extraída de aquí para ser testeable con un fake client.
  const leadRepo = make_lead_repo(client);

  // ── 4. originRepo — lead_origin_properties + contact_count ─────────────────
  // insert_origin: upsert con ignoreDuplicates=true implementa ON CONFLICT DO NOTHING.
  //   data retornado: [] si conflicto (no-op, inserted=false); [row] si fila nueva (inserted=true).
  // increment_contact_count: read-then-write (ponytail) — PostgREST no admite
  //   expresiones SQL en body de PATCH. Aceptable para demo (baja concurrencia).
  //   Alternativa production-grade: RPC con UPDATE ... SET contact_count = contact_count + 1.
  const originRepo: OriginRepo = {
    async insert_origin(
      lead_id: string,
      property_id: string,
      property_video_id?: string,
    ): Promise<InsertOriginResult> {
      const { data, error } = await client
        .from("lead_origin_properties")
        .upsert(
          {
            lead_id,
            property_id,
            property_video_id: property_video_id ?? null,
            // contacted_at: DEFAULT now() en schema
          },
          { onConflict: "lead_id,property_id", ignoreDuplicates: true },
        )
        .select("lead_id");

      if (error) return { ok: false, error_code: "DB_ERROR" };

      // ignoreDuplicates=true + Prefer:resolution=ignore-duplicates:
      //   fila nueva   → data = [{ lead_id }]  → inserted = true
      //   conflicto    → data = []              → inserted = false
      const inserted = Array.isArray(data) && data.length > 0;
      return { ok: true, inserted };
    },

    async increment_contact_count(property_id: string): Promise<IncrementContactCountResult> {
      // ponytail: read-then-write (2 queries) — PostgREST no admite expresiones en UPDATE body.
      // La carrera es improbable en demo con pocos usuarios; contact_count es analítica no transaccional.
      // Para producción con alta concurrencia: migrar a RPC con UPDATE ... SET contact_count = contact_count + 1.
      const { data: row, error: read_err } = await client
        .from("properties")
        .select("contact_count")
        .eq("id", property_id)
        .maybeSingle();

      if (read_err || row === null) return { ok: false, error_code: "DB_ERROR" };

      const { error: update_err } = await client
        .from("properties")
        .update({ contact_count: row.contact_count + 1 })
        .eq("id", property_id);

      if (update_err) return { ok: false, error_code: "DB_ERROR" };
      return { ok: true };
    },
  };

  const handle = make_contact_agent_handler({
    callerVerifier,
    propertyResolver,
    leadRepo,
    originRepo,
  });

  return handle(req);
});
