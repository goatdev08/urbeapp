// _shared/clients.ts
// Adaptadores de producción: construyen las dependencias del handler a partir del
// cliente supabase-js con service_role. Aquí (y SOLO aquí) se importa supabase-js;
// los handlers y sus tests dependen de las interfaces (DI), no de este módulo.
//
// Variables de entorno disponibles automáticamente en Supabase Edge Functions:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AwsClient } from "aws4fetch";
import { importJWK, SignJWT } from "jose";
import type { VideoUrlMinter } from "../mint-video-url/types.ts";
import type {
  AgencyOwnershipVerifier,
  R2UrlMinter,
  SignedGetItem,
} from "../mint-r2-url/types.ts";

import type { InvitationDb, InvitationTokenRow } from "./invitation.ts";
import type {
  AuthAdminClient,
  CreateUserParams,
  GenerateInviteLinkParams,
  GenerateInviteLinkResponse,
} from "./auth_user.ts";
import type {
  InvitationRedeemer,
  RedeemParams,
  RedeemResult,
} from "./redeem.ts";
import type { AdminVerifier, AdminVerifyResult } from "./admin_auth.ts";
import type {
  AgencyCreateParams,
  AgencyCreateResult,
  AgencyCreator,
} from "./agency.ts";
import type {
  ActiveUploadChecker,
  RegisterUploadingVideoParams,
  StreamDirectUploadParams,
  StreamDirectUploadResult,
  StreamUploadCreator,
  VideoRegistrar,
} from "../mint-upload-url/types.ts";
import type {
  MarkVideoFailedParams,
  MarkVideoReadyParams,
  VideoEventNotifier,
  VideoNotifyEvent,
  VideoStatusUpdater,
} from "../stream-webhook/types.ts";
import type { HlsSignerConfig } from "../mint-video-url/types.ts";
import type { ThumbnailUrlSigner } from "../mint-thumbnail-url/types.ts";
import type {
  ArchivableVideoRow,
  ArchiveUploader,
  ArchiveUploadResult,
  EnableDownloadResult,
  MarkArchivedParams,
  StreamArchiver,
  VideoArchiver,
  VideoLoader,
} from "../archive-video/types.ts";

/** Cliente supabase-js con service_role (bypassa RLS y column-grants). */
export function service_client(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Adaptador real de InvitationDb. Busca el token por su HASH y trae la agencia
 * por inner join. Descarta agencias soft-deleted (deleted_at IS NOT NULL) en JS
 * (follow-up de 5.2): una agencia borrada no debe permitir canjes aunque su
 * status sea 'active'.
 */
export function make_invitation_db(client: SupabaseClient): InvitationDb {
  return {
    async find_by_hash(hash: string): Promise<InvitationTokenRow | null> {
      const { data, error } = await client
        .from("agency_invitation_tokens")
        .select(
          "id, agency_id, token, max_uses, current_uses, expires_at, revoked_at, agencies!inner(name, status, deleted_at)",
        )
        .eq("token", hash)
        .maybeSingle();

      if (error || data === null) return null;

      // El filtro de soft-delete se aplica en JS, no como filtro embebido de
      // PostgREST (`.is("agencies.deleted_at", null)`), porque ese filtro sobre
      // el recurso embebido descarta la fila padre y devuelve null para tokens
      // válidos. agencies!inner ya garantiza que la agencia existe.
      const raw_agency = data.agencies as unknown;
      const agency = (Array.isArray(raw_agency) ? raw_agency[0] : raw_agency) as
        | { name: string; status: string; deleted_at: string | null }
        | undefined;
      if (agency === undefined || agency.deleted_at !== null) return null;

      return {
        id: data.id,
        agency_id: data.agency_id,
        token: data.token,
        max_uses: data.max_uses,
        current_uses: data.current_uses,
        expires_at: data.expires_at,
        revoked_at: data.revoked_at,
        agency_name: agency.name,
        agency_status: agency.status,
      };
    },
  };
}

/** Adaptador real de AuthAdminClient sobre supabase.auth.admin. */
export function make_auth_admin(client: SupabaseClient): AuthAdminClient {
  return {
    async createUser(params: CreateUserParams) {
      const { data, error } = await client.auth.admin.createUser(params);
      return {
        data: data?.user ? { user: { id: data.user.id } } : null,
        error: error ? { message: error.message } : null,
      };
    },
    async deleteUser(uid: string) {
      await client.auth.admin.deleteUser(uid);
    },
    async generateInviteLink(
      params: GenerateInviteLinkParams,
    ): Promise<GenerateInviteLinkResponse> {
      const { data, error } = await client.auth.admin.generateLink({
        type: "invite",
        email: params.email,
        options: { data: params.data },
      });
      if (error || !data) {
        return { data: null, error: error ? { message: error.message } : { message: "generateLink devolvió sin data" } };
      }
      return {
        data: {
          user: { id: data.user.id },
          action_link: data.properties.action_link,
        },
        error: null,
      };
    },
  };
}

// Códigos de negocio que la RPC levanta con SQLSTATE P0001 (mensaje = código).
const REDEEM_CODES = [
  "TOKEN_MAX_USES_REACHED",
  "ALREADY_ACTIVE_MEMBER",
  "USER_NOT_FOUND",
  "NO_ACTIVE_TERMS",
  "NO_ACTIVE_PRIVACY",
];

function extract_redeem_code(message: string): string {
  return REDEEM_CODES.find((c) => message.includes(c)) ?? "REDEEM_FAILED";
}

/**
 * Adaptador real de AdminVerifier.
 * Verifica el JWT en el header Authorization usando el service_role client:
 *   1. Extrae el JWT del header "Bearer <token>".
 *   2. Llama client.auth.getUser(jwt) para validar el JWT.
 *   3. Consulta public.users WHERE id = user.id → verifica role = 'admin'.
 */
export function make_admin_verifier(client: SupabaseClient): AdminVerifier {
  return {
    async verify_caller(
      authHeader: string | null,
    ): Promise<AdminVerifyResult> {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }

      const jwt = authHeader.replace(/^Bearer\s+/, "");
      const {
        data: { user },
        error: auth_error,
      } = await client.auth.getUser(jwt);
      if (auth_error || !user) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }

      const { data: user_row, error: user_error } = await client
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (user_error || !user_row) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      if (user_row.role !== "admin") {
        return { ok: false, error_code: "FORBIDDEN" };
      }
      return { ok: true, user_id: user.id };
    },
  };
}

// Códigos de negocio que la RPC admin_create_agency_atomic levanta con SQLSTATE P0001.
const AGENCY_ERROR_CODES = ["SLUG_DUPLICATE", "NAME_DUPLICATE", "CREATED_BY_REQUIRED", "ALREADY_ACTIVE_MEMBER"];

function extract_agency_error_code(message: string): string {
  return AGENCY_ERROR_CODES.find((c) => message.includes(c)) ?? "DB_ERROR";
}

/**
 * Adaptador real de AgencyCreator sobre la RPC admin_create_agency_atomic (migración 0016, 9 params).
 * Llama la versión de 9 parámetros que inserta token + admin_actions en la misma transacción.
 * Mapea los errores P0001 al error_code de negocio correspondiente.
 */
export function make_agency_creator(client: SupabaseClient): AgencyCreator {
  return {
    async create_atomic(
      params: AgencyCreateParams,
    ): Promise<AgencyCreateResult> {
      const { data, error } = await client.rpc("admin_create_agency_atomic", {
        p_name: params.name,
        p_slug: params.slug,
        p_contact_name: params.contact_name ?? null,
        p_contact_phone: params.contact_phone ?? null,
        p_contact_email: params.contact_email ?? null,
        p_created_by_user_id: params.created_by_user_id,
        p_owner_user_id: params.owner_user_id ?? null,
        p_token_hash: params.token_hash ?? null,
        p_token_max_uses: params.token_max_uses ?? null,
      });
      if (error) {
        const error_code = extract_agency_error_code(error.message);
        return { ok: false, error_code };
      }
      // La RPC de 9 params devuelve table(agency_id, agency_member_id, token_id).
      const row = Array.isArray(data) ? data[0] : data;
      return {
        ok: true,
        agency_id: row.agency_id,
        agency_member_id: row.agency_member_id ?? undefined,
        token_id: row.token_id ?? undefined,
      };
    },
  };
}

/** Adaptador real de InvitationRedeemer sobre la RPC redeem_invitation_atomic. */
export function make_redeemer(client: SupabaseClient): InvitationRedeemer {
  return {
    async redeem_atomic(params: RedeemParams): Promise<RedeemResult> {
      const { data, error } = await client.rpc("redeem_invitation_atomic", {
        p_token_id: params.token_id,
        p_user_id: params.user_id,
        p_ip: params.ip ?? null,
      });

      if (error) {
        return { ok: false, error_code: extract_redeem_code(error.message) };
      }
      const row = Array.isArray(data) ? data[0] : data;
      return { ok: true, agency_member_id: row.agency_member_id };
    },
  };
}

/**
 * Firma el JWT RS256 (sub=cloudflare_uid) y resuelve el dominio de Stream para
 * una fila dada. Extraído de sign_stream_hls_url (68.15) para que el manifest
 * HLS y el posterUrl del thumbnail reutilicen el MISMO token+dominio en vez de
 * firmar dos veces — un solo JWT sirve para ambos endpoints de Stream.
 * Lanza si streamSigningJwk no decodifica a un JWK RSA válido — el caller
 * (mint_signed_urls) atrapa el error y excluye solo esa fila (fail-closed).
 */
async function sign_stream_token(
  cloudflare_uid: string,
  hlsConfig: HlsSignerConfig,
): Promise<{ token: string; domain: string }> {
  const jwk = JSON.parse(atob(hlsConfig.streamSigningJwk));
  const private_key = await importJWK(jwk, "RS256");

  const now = Math.floor(Date.now() / 1000);
  const exp = now + hlsConfig.signedUrlTtlSeconds;

  const token = await new SignJWT({
    sub: cloudflare_uid,
    kid: hlsConfig.streamSigningKeyId,
  })
    .setProtectedHeader({ alg: "RS256", kid: hlsConfig.streamSigningKeyId })
    .setExpirationTime(exp)
    .sign(private_key);

  const domain = hlsConfig.streamCustomerSubdomain
    ? `customer-${hlsConfig.streamCustomerSubdomain}.cloudflarestream.com`
    : "videodelivery.net";

  return { token, domain };
}

/**
 * Arma la URL de manifest HLS de Stream a partir de un token+dominio ya
 * firmados (sign_stream_token). No vuelve a firmar.
 *
 * ⚠️ CONTRATO DE CLOUDFLARE (verificado en vivo 2026-07-22, prueba E2E local):
 * en un video con `requireSignedURLs=true` el **token va EN EL PATH, en lugar
 * del uid** — NO como query param. `.../<uid>/manifest/video.m3u8?token=<JWT>`
 * devuelve **401 unauthorized**; `.../<TOKEN>/manifest/video.m3u8` devuelve 200.
 * El uid ya viaja dentro del JWT (claim `sub`), por eso no se repite en la ruta.
 */
function build_hls_url(domain: string, token: string): string {
  return `https://${domain}/${token}/manifest/video.m3u8`;
}

/**
 * Arma la URL de portada (thumbnail) firmada de Stream (68.15), reutilizando
 * el token+dominio ya firmados por sign_stream_token (mismo JWT que el HLS).
 * T = COALESCE(thumbnail_pct,50)/100 × duration_seconds, formateado .toFixed(1).
 * Sin duration_seconds → sin '?time=' (Stream sirve su frame default).
 *
 * ⚠️ Mismo contrato que build_hls_url: el token va en el PATH (ver nota arriba).
 */
function build_poster_url(
  domain: string,
  token: string,
  thumbnail_pct: number | null | undefined,
  duration_seconds: number | null | undefined,
): string {
  const base = `https://${domain}/${token}/thumbnails/thumbnail.jpg`;
  if (duration_seconds == null) {
    return base;
  }
  const pct = thumbnail_pct ?? 50;
  const time_seconds = (pct / 100) * duration_seconds;
  return `${base}?time=${time_seconds.toFixed(1)}s`;
}

/**
 * Adaptador real de VideoUrlMinter. Opera con service_role (bypassa RLS);
 * los filtros SQL son la ÚNICA barrera de seguridad que impide mintar URLs
 * de propiedades no publicadas (draft/paused/closed) o videos no listos.
 * ponytail: batch degradado — errores de red/storage se excluyen sin lanzar.
 *
 * DUAL-REF (68.6): una fila con `cloudflare_uid` (no nulo) se firma como HLS
 * de Stream (JWT RS256 vía `hlsConfig`); una fila sin `cloudflare_uid` pero con
 * `storage_path` sigue la rama legacy de Supabase Storage. Si una fila tiene
 * ambas refs, gana Stream (migración 20260720000002). Fail-closed: sin
 * `hlsConfig` inyectado, o con `streamSigningJwk` inválido, la fila Stream se
 * EXCLUYE del batch (no se lanza, no rompe las demás filas legacy).
 */
export function make_video_url_minter(
  client: SupabaseClient,
  hlsConfig?: HlsSignerConfig,
): VideoUrlMinter {
  return {
    async mint_signed_urls(property_ids: string[]): Promise<import("../mint-video-url/types.ts").MintedVideo[]> {
      // Defensa: array vacío → no tocar la red
      if (property_ids.length === 0) return [];

      const { data, error } = await client
        .from("property_videos")
        .select(
          "id, property_id, storage_path, cloudflare_uid, thumbnail_pct, duration_seconds, properties!inner(status)",
        )
        .in("property_id", property_ids)
        .eq("status", "ready")
        .eq("properties.status", "active")
        .is("deleted_at", null);

      // Fail-closed: error de red/DB → batch degradado, no lanzar
      if (error) return [];

      const rows = (data as unknown) as Array<{
        id: string;
        property_id: string;
        storage_path: string | null;
        cloudflare_uid?: string | null;
        thumbnail_pct?: number | null;
        duration_seconds?: number | null;
      }>;

      const results: import("../mint-video-url/types.ts").MintedVideo[] = [];
      for (const row of rows) {
        // Precedencia dual-ref: cloudflare_uid gana sobre storage_path.
        if (row.cloudflare_uid) {
          if (!hlsConfig) continue; // fail-closed: sin config, excluir la fila Stream

          try {
            // Un solo JWT (sub=cloudflare_uid) firma AMBOS endpoints — manifest
            // HLS y thumbnail — evitando una segunda llamada de firmado por fila.
            const { token, domain } = await sign_stream_token(row.cloudflare_uid, hlsConfig);
            const signed_url = build_hls_url(domain, token);
            const posterUrl = build_poster_url(
              domain,
              token,
              row.thumbnail_pct,
              row.duration_seconds,
            );
            results.push({
              property_id: row.property_id,
              video_id: row.id,
              signed_url,
              posterUrl,
            });
          } catch {
            // fail-closed: JWK inválido u otro error de firmado → excluir solo esta fila
          }
          continue;
        }

        // Filas sin storage_path (path aún no registrado) → excluir sin llamar storage
        if (!row.storage_path) continue;

        const { data: signed, error: sign_err } = await client.storage
          .from("property-videos")
          .createSignedUrl(row.storage_path, 3600);

        // Error de storage para esta fila → excluir solo ella (no romper el batch)
        if (sign_err || !signed?.signedUrl) continue;

        results.push({
          property_id: row.property_id,
          video_id: row.id,
          signed_url: signed.signedUrl,
          // El poster de Stream no aplica a filas legacy Storage: null explícito.
          posterUrl: null,
        });
      }

      return results;
    },
  };
}

/**
 * Adaptador real de AgencyOwnershipVerifier (subtarea 69.2).
 * Resuelve "¿el usuario es owner activo de alguna agencia? ¿de cuál?" en una
 * sola consulta a agency_members. status='active' + member_role='owner' es
 * la definición de "owner activo" (migración 0003 — agencies_and_agents).
 */
export function make_agency_ownership_verifier(
  client: SupabaseClient,
): AgencyOwnershipVerifier {
  return {
    async get_owned_agency_id(user_id: string): Promise<string | null> {
      const { data, error } = await client
        .from("agency_members")
        .select("agency_id")
        .eq("user_id", user_id)
        .eq("member_role", "owner")
        .eq("status", "active")
        .maybeSingle();

      if (error || !data) return null;
      return data.agency_id as string;
    },
  };
}

/**
 * Adaptador real de R2UrlMinter (subtarea 69.2): firma presigned URLs S3v4
 * contra el endpoint S3-compatible de Cloudflare R2 usando aws4fetch.
 *
 * NUNCA se ejercita en unit tests (SEAM del RED): el handler solo depende de
 * la interfaz R2UrlMinter, inyectada como fake en handler.test.ts.
 *
 * Variables de entorno requeridas: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT.
 */
export function make_r2_url_minter(): R2UrlMinter {
  function r2_config() {
    const account_id = Deno.env.get("R2_ACCOUNT_ID");
    const access_key_id = Deno.env.get("R2_ACCESS_KEY_ID");
    const secret_access_key = Deno.env.get("R2_SECRET_ACCESS_KEY");
    const bucket = Deno.env.get("R2_BUCKET");
    const endpoint = Deno.env.get("R2_ENDPOINT");
    if (!account_id || !access_key_id || !secret_access_key || !bucket || !endpoint) {
      throw new Error(
        "Faltan variables de entorno R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_ENDPOINT",
      );
    }
    return { access_key_id, secret_access_key, bucket, endpoint };
  }

  async function sign(key: string, method: "PUT" | "GET", ttl_seconds: number): Promise<string> {
    const { access_key_id, secret_access_key, bucket, endpoint } = r2_config();
    const aws = new AwsClient({
      accessKeyId: access_key_id,
      secretAccessKey: secret_access_key,
      service: "s3",
      region: "auto",
    });

    const url = new URL(`${endpoint}/${bucket}/${key}`);
    url.searchParams.set("X-Amz-Expires", String(ttl_seconds));

    const signed_request = await aws.sign(url.toString(), {
      method,
      aws: { signQuery: true },
    });
    return signed_request.url;
  }

  return {
    async sign_put(key: string, ttl_seconds: number): Promise<string> {
      return await sign(key, "PUT", ttl_seconds);
    },
    async sign_get_batch(
      keys: string[],
      ttl_seconds: number,
    ): Promise<SignedGetItem[]> {
      const items: SignedGetItem[] = [];
      for (const key of keys) {
        const url = await sign(key, "GET", ttl_seconds);
        items.push({ key, url, expires: ttl_seconds });
      }
      return items;
    },
  };
}

/**
 * Adaptador real de ActiveUploadChecker (subtarea 68.3, invariante §13.2).
 * Cuenta, con service_role, los videos del agente en 'uploading' o 'processing'
 * (soft-delete excluido). El WHERE ... IN (...) es la barrera real: al fake de
 * los tests solo le importa el count agregado.
 */
export function make_active_upload_checker(client: SupabaseClient): ActiveUploadChecker {
  return {
    async count_active_uploads(agent_id: string): Promise<number> {
      const { count, error } = await client
        .from("property_videos")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agent_id)
        .in("status", ["uploading", "processing"])
        .is("deleted_at", null);

      if (error) {
        // Fail-closed: un error de red/DB al chequear concurrencia no debe
        // permitir un upload que quizás sí colisione — se trata como "hay 1".
        return 1;
      }
      return count ?? 0;
    },
  };
}

/**
 * Adaptador real de StreamUploadCreator (subtarea 68.3): Direct Creator Upload
 * de Cloudflare Stream (POST simple, NO tus). Lanza si la respuesta no es 2xx
 * o success:false — el handler lo traduce a 502 STREAM_UPLOAD_FAILED.
 * Variables de entorno requeridas: STREAM_ACCOUNT_ID, STREAM_API_TOKEN.
 */
export function make_stream_upload_creator(): StreamUploadCreator {
  return {
    async create_direct_upload(
      params: StreamDirectUploadParams,
    ): Promise<StreamDirectUploadResult> {
      const account_id = Deno.env.get("STREAM_ACCOUNT_ID");
      const api_token = Deno.env.get("STREAM_API_TOKEN");
      if (!account_id || !api_token) {
        throw new Error("Faltan variables de entorno STREAM_ACCOUNT_ID/STREAM_API_TOKEN");
      }

      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account_id}/stream/direct_upload`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${api_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            maxDurationSeconds: params.maxDurationSeconds,
            requireSignedURLs: params.requireSignedURLs,
            creator: params.creator,
          }),
        },
      );

      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(
          `Cloudflare Stream direct_upload falló: ${res.status} ${JSON.stringify(json.errors ?? json)}`,
        );
      }

      return {
        uploadURL: json.result.uploadURL,
        uid: json.result.uid,
      };
    },
  };
}

/**
 * Adaptador real de VideoRegistrar (subtarea 68.3): inserta la fila
 * 'uploading' upload-first (property_id NULL) con service_role.
 */
export function make_video_registrar(client: SupabaseClient): VideoRegistrar {
  return {
    async register_uploading_video(params: RegisterUploadingVideoParams): Promise<void> {
      const { error } = await client.from("property_videos").insert({
        agent_id: params.agent_id,
        property_id: params.property_id,
        status: params.status,
        position: params.position,
        cloudflare_uid: params.cloudflare_uid,
        tus_upload_url: params.tus_upload_url,
      });
      if (error) {
        throw new Error(`Insert en property_videos falló: ${error.message}`);
      }
    },
  };
}

/**
 * Adaptador real de VideoStatusUpdater (subtarea 68.5, webhook de Cloudflare Stream).
 * Filtra SIEMPRE por cloudflare_uid (NUNCA por property_id: upload-first admite
 * videos sin propiedad todavía) y excluye soft-deleted. `.select("id")` tras el
 * UPDATE es lo que permite distinguir 0 filas afectadas (uid desconocido, o
 * re-entrega de una transición ya aplicada) — la idempotencia vive en el conteo,
 * no en un error: el handler responde 200 aunque affected_rows sea 0.
 */
export function make_video_status_updater(client: SupabaseClient): VideoStatusUpdater {
  return {
    async mark_ready(params: MarkVideoReadyParams): Promise<number> {
      const { data, error } = await client
        .from("property_videos")
        .update({
          status: "ready",
          ready_at: new Date().toISOString(),
          thumbnail_url: params.thumbnail_url,
          duration_seconds: params.duration_seconds,
        })
        .eq("cloudflare_uid", params.cloudflare_uid)
        .is("deleted_at", null)
        .select("id");
      if (error) {
        throw new Error(`UPDATE property_videos (mark_ready) falló: ${error.message}`);
      }
      return data?.length ?? 0;
    },
    async mark_failed(params: MarkVideoFailedParams): Promise<number> {
      const { data, error } = await client
        .from("property_videos")
        .update({ status: "failed", failure_reason: params.failure_reason })
        .eq("cloudflare_uid", params.cloudflare_uid)
        .is("deleted_at", null)
        .select("id");
      if (error) {
        throw new Error(`UPDATE property_videos (mark_failed) falló: ${error.message}`);
      }
      return data?.length ?? 0;
    },
  };
}

/**
 * Adaptador real de VideoEventNotifier (subtarea 68.5). Ola 0: SOLO el gancho —
 * registra el evento con log estructurado. El envío real de push (FCM/APNs)
 * llega en Ola 2 (notificaciones); no existe aún tabla/cola de notificaciones
 * pendientes que valga la pena escribir para un evento que nadie consume todavía.
 * ponytail: no-op observable (console.log) en vez de infraestructura prematura.
 */
export function make_video_event_notifier(): VideoEventNotifier {
  return {
    notify_video_event(event: VideoNotifyEvent, cloudflare_uid: string): Promise<void> {
      console.log(JSON.stringify({ event, cloudflare_uid, at: new Date().toISOString() }));
      return Promise.resolve();
    },
  };
}

/**
 * Adaptador real de VideoLoader (subtarea 68.8): carga la fila a archivar por id,
 * con service_role (bypassa RLS — la autorización de negocio vive en el handler,
 * comparando agent_id contra el caller). Excluye soft-deleted.
 */
export function make_video_loader(client: SupabaseClient): VideoLoader {
  return {
    async load(property_video_id: string): Promise<ArchivableVideoRow | null> {
      const { data, error } = await client
        .from("property_videos")
        .select("id, agent_id, cloudflare_uid, status")
        .eq("id", property_video_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error || !data) return null;
      return data as ArchivableVideoRow;
    },
  };
}

/**
 * Adaptador real de StreamArchiver (subtarea 68.8): habilita/descarga/borra el
 * video original en Cloudflare Stream vía la Downloads API.
 *
 * ponytail: el shape exacto de la respuesta de la Stream Downloads API
 * (`result.default.{status,percentComplete,url}`) se documenta en la API de
 * Cloudflare pero no se pudo verificar en vivo en esta subtarea (credenciales
 * bloqueadas, ver bitácora 68.8) — el mapeo de abajo sigue la doc pública; el
 * seam bajo test es la interfaz StreamArchiver, no esta llamada real.
 * Variables de entorno requeridas: STREAM_ACCOUNT_ID, STREAM_API_TOKEN.
 */
export function make_stream_archiver(): StreamArchiver {
  function stream_headers(): Record<string, string> {
    const api_token = Deno.env.get("STREAM_API_TOKEN");
    if (!api_token) {
      throw new Error("Falta la variable de entorno STREAM_API_TOKEN");
    }
    return { "Authorization": `Bearer ${api_token}` };
  }

  function account_id(): string {
    const id = Deno.env.get("STREAM_ACCOUNT_ID");
    if (!id) {
      throw new Error("Falta la variable de entorno STREAM_ACCOUNT_ID");
    }
    return id;
  }

  return {
    async enable_download(cloudflare_uid: string): Promise<EnableDownloadResult> {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account_id()}/stream/${cloudflare_uid}/downloads`,
        { method: "POST", headers: stream_headers() },
      );
      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(
          `Cloudflare Stream enable_download falló: ${res.status} ${JSON.stringify(json.errors ?? json)}`,
        );
      }
      const default_download = json.result?.default ?? {};
      return {
        state: default_download.status === "ready" ? "ready" : "inprogress",
        url: default_download.url,
        percentComplete: default_download.percentComplete !== undefined
          ? Number(default_download.percentComplete)
          : undefined,
      };
    },
    async fetch_mp4(url: string): Promise<Uint8Array> {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Descarga del MP4 de Cloudflare Stream falló: ${res.status}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete_video(cloudflare_uid: string): Promise<void> {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account_id()}/stream/${cloudflare_uid}`,
        { method: "DELETE", headers: stream_headers() },
      );
      if (!res.ok) {
        throw new Error(`Cloudflare Stream delete_video falló: ${res.status}`);
      }
    },
  };
}

/**
 * Adaptador real de ArchiveUploader (subtarea 68.8): firma un presigned PUT con
 * make_r2_url_minter (mismo mecanismo que mint-r2-url, kind=archive) y sube los
 * bytes descargados de Stream. Lanza si el PUT no es 2xx — el handler lo traduce
 * a 502 R2_UPLOAD_FAILED.
 */
export function make_archive_uploader(): ArchiveUploader {
  const R2_ARCHIVE_PUT_TTL_SECONDS = 15 * 60; // mismo TTL que mint-r2-url op=put

  return {
    async upload(key: string, body: Uint8Array): Promise<ArchiveUploadResult> {
      const put_url = await make_r2_url_minter().sign_put(key, R2_ARCHIVE_PUT_TTL_SECONDS);
      const res = await fetch(put_url, { method: "PUT", body: body as BodyInit });
      if (!res.ok) {
        throw new Error(`PUT a R2 falló: ${res.status}`);
      }
      return { ok: true, key };
    },
  };
}

/**
 * Adaptador real de VideoArchiver (subtarea 68.8): escritura final tras el
 * ordering seguro (R2 confirmado -> Stream borrado -> este UPDATE). Limpia
 * cloudflare_uid (el video ya no vive en Stream) y deja el rastro en R2.
 */
export function make_video_archiver(client: SupabaseClient): VideoArchiver {
  return {
    async mark_archived(params: MarkArchivedParams): Promise<void> {
      const { error } = await client
        .from("property_videos")
        .update({
          status: "archived",
          archived_at: new Date().toISOString(),
          r2_archive_key: params.r2_archive_key,
          cloudflare_uid: null,
        })
        .eq("id", params.property_video_id);
      if (error) {
        throw new Error(`UPDATE property_videos (mark_archived) falló: ${error.message}`);
      }
    },
  };
}

/**
 * Adaptador real de ThumbnailUrlSigner (subtarea 68.14): firma un JWT RS256
 * para el token de thumbnail de Cloudflare Stream con la MISMA mecánica que
 * sign_stream_hls_url (header { alg: RS256, kid }, payload { sub: cloudflare_uid,
 * kid, exp }), cambiando solo la baseUrl a .../<uid>/thumbnails/thumbnail.jpg
 * (en vez de .../manifest/video.m3u8). Lanza si streamSigningJwk no decodifica
 * a un JWK RSA válido — el handler lo traduce a 500 INTERNAL_ERROR (fail-closed,
 * nunca una URL/token a medias).
 */
export function make_thumbnail_url_signer(hlsConfig: HlsSignerConfig): ThumbnailUrlSigner {
  return {
    async sign(cloudflare_uid: string): Promise<import("../mint-thumbnail-url/types.ts").ThumbnailSignResult> {
      const jwk = JSON.parse(atob(hlsConfig.streamSigningJwk));
      const private_key = await importJWK(jwk, "RS256");

      const now = Math.floor(Date.now() / 1000);
      const exp = now + hlsConfig.signedUrlTtlSeconds;

      const token = await new SignJWT({
        sub: cloudflare_uid,
        kid: hlsConfig.streamSigningKeyId,
      })
        .setProtectedHeader({ alg: "RS256", kid: hlsConfig.streamSigningKeyId })
        .setExpirationTime(exp)
        .sign(private_key);

      const domain = hlsConfig.streamCustomerSubdomain
        ? `customer-${hlsConfig.streamCustomerSubdomain}.cloudflarestream.com`
        : "videodelivery.net";

      // ⚠️ El token va EN EL PATH (contrato de Cloudflare para requireSignedURLs;
      // verificado en vivo 2026-07-22: `/<uid>/...?token=` → 401, `/<token>/...` → 200).
      // baseUrl queda listo para usarse: el cliente solo le agrega `?time=<N>s`.
      return {
        baseUrl: `https://${domain}/${token}/thumbnails/thumbnail.jpg`,
        token,
        expiresIn: hlsConfig.signedUrlTtlSeconds,
      };
    },
  };
}
