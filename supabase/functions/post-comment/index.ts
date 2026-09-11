// supabase/functions/post-comment/index.ts
// Entry point de producción — subtarea 289.5. Construye las dependencias reales
// (supabase-js service_role) e inyecta al handler puro. Se mantiene DELGADO a
// propósito (mismo patrón que moderate-property/mint-video-url): la lógica de
// decisión vive en handler.ts + classify.ts, con su propia suite DI.
//
// Cada EF define su propio seam (types.ts) — no hay _shared/caller_verifier.ts
// compartido en este repo (mismo criterio que contact-agent/property_resolver.ts).

import { handler } from "./handler.ts";
import { service_client } from "../_shared/clients.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  CommentWriteResult,
  CommentWriter,
  CommentWriteParams,
  ConfigReader,
  PropertyFetchResult,
  PropertyFetcher,
} from "./types.ts";

const COMMENT_FILTER_WORDS_KEY = "comment_filter_words";

Deno.serve((req: Request) => {
  // Cliente por request — sin estado persistente entre invocaciones (persistSession: false).
  const client = service_client();

  // ── callerVerifier — JWT → user_id (calco contact-agent/index.ts) ───────────
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

  // ── propertyFetcher — SELECT id, status ──────────────────────────────────────
  const propertyFetcher: PropertyFetcher = {
    async fetch(property_id: string): Promise<PropertyFetchResult> {
      const { data, error } = await client
        .from("properties")
        .select("id, status")
        .eq("id", property_id)
        .is("deleted_at", null) // soft-delete de moderación no cambia status (20260828000004)
        .maybeSingle();
      if (error) return { ok: false, error_code: "DB_ERROR", message: error.message };
      if (!data) return { ok: false, error_code: "PROPERTY_NOT_FOUND" };
      return { ok: true, property: { id: data.id, status: data.status } };
    },
  };

  // ── configReader — app_config.comment_filter_words ───────────────────────────
  // ponytail: fail-open — maybeSingle + try/catch, mismo patrón que
  // build_hls_config en mint-video-url/index.ts. La lista solo calibra falsos
  // positivos (§289.5), no es una barrera de seguridad dura: si app_config no
  // responde, el filtro base (teléfono/email/URL) sigue aplicando sin ella.
  const configReader: ConfigReader = {
    async get_filter_words(): Promise<string[]> {
      try {
        const { data } = await client
          .from("app_config")
          .select("value")
          .eq("key", COMMENT_FILTER_WORDS_KEY)
          .maybeSingle();
        return Array.isArray(data?.value) ? (data!.value as string[]) : [];
      } catch {
        return [];
      }
    },
  };

  // ── commentWriter — INSERT con service_role (comments no tiene policy de
  // INSERT para authenticated, ver 20260910100001_comments.sql §5-6) ───────────
  const commentWriter: CommentWriter = {
    async insert(params: CommentWriteParams): Promise<CommentWriteResult> {
      const { data, error } = await client
        .from("comments")
        .insert({
          property_id: params.property_id,
          user_id: params.user_id,
          body: params.body,
          status: params.status,
        })
        .select("id, property_id, user_id, body, status, created_at")
        .single();
      if (error || !data) {
        return { ok: false, error_code: "DB_ERROR", message: error?.message };
      }
      return {
        ok: true,
        comment: {
          id: data.id,
          property_id: data.property_id,
          user_id: data.user_id,
          body: data.body,
          status: data.status,
          created_at: data.created_at,
        },
      };
    },
  };

  return handler(req, { callerVerifier, propertyFetcher, configReader, commentWriter });
});
