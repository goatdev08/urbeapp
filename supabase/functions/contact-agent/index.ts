// supabase/functions/contact-agent/index.ts
// Entry point de producción — GREEN 14.9.
// Reemplaza los 4 stubs not_implemented con adapters reales (service_role client, RLS bypass).
// Deploy + smoke E2E pendientes de autorización.

import { make_contact_agent_handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  FindActiveLeadResult,
  IncrementContactCountResult,
  InsertLeadResult,
  InsertOriginResult,
  LeadRepo,
  OriginRepo,
  PropertyResolver,
  PropertyResolveResult,
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

  // ── 2. propertyResolver — SELECT properties + JOIN users (owner) ───────────
  // Hint de FK: users!properties_owner_user_id_fkey (análogo a usePropertyDetail.ts:115).
  // Columnas requeridas por handler: id, address, price, status, operation_type,
  // owner_user_id, agent_id (= u.id), agent_name (CONCAT), agent_phone (u.phone).
  const propertyResolver: PropertyResolver = {
    async resolve(propertyId: string): Promise<PropertyResolveResult> {
      const { data, error } = await client
        .from("properties")
        .select(
          `id, address, price, status, operation_type, owner_user_id,
           users!properties_owner_user_id_fkey(id, first_name, last_name, phone)`,
        )
        .eq("id", propertyId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) return { ok: false, error_code: "DB_ERROR" };
      if (!data) return { ok: false, error_code: "PROPERTY_NOT_FOUND" };

      // PostgREST retorna to-one join como objeto; guard de array por robustez
      // (mismo patrón que make_invitation_db en _shared/clients.ts).
      const raw_user = data.users;
      const agent_user = (Array.isArray(raw_user) ? raw_user[0] : raw_user) as
        | { id: string; first_name: string; last_name: string; phone: string | null }
        | undefined;

      // Propiedad sin dueño en users → tratar como no encontrada
      if (!agent_user) return { ok: false, error_code: "PROPERTY_NOT_FOUND" };

      return {
        ok: true,
        data: {
          id: data.id,
          address: data.address,
          price: data.price,
          status: data.status,
          operation_type: data.operation_type,
          owner_user_id: data.owner_user_id,
          agent_id: agent_user.id,
          agent_name: `${agent_user.first_name} ${agent_user.last_name}`,
          agent_phone: agent_user.phone,
          // ponytail: video_id omitido — JOIN a property_videos complicaría la query;
          // el mensaje no lo usa y handler lo pasa undefined a insert_origin (campo opcional).
        },
      };
    },
  };

  // ── 3. leadRepo — SELECT + INSERT idempotente sobre leads ─────────────────
  // Índice único parcial leads_agent_user_unique_active (WHERE deleted_at IS NULL)
  // garantiza 1 lead activo por par (agent_id, user_id).
  // SQLSTATE 23505 (unique_violation) → error.code === "23505" en supabase-js.
  const leadRepo: LeadRepo = {
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
        .insert({ agent_id, user_id, status: "new" })
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
