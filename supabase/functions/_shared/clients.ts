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

import type {
  DuplicateCheckResult,
  DuplicatePropertyChecker,
  VideoStatusCheckResult,
  VideoStatusChecker,
} from "../publish-property/types.ts";
import type { InvitationDb, InvitationTokenRow } from "./invitation.ts";
import type {
  AuthAdminClient,
  CreateUserParams,
  GenerateInviteLinkParams,
  GenerateInviteLinkResponse,
  InviteByEmailParams,
  InviteByEmailResponse,
} from "./auth_user.ts";
import type {
  InvitationRedeemer,
  RedeemParams,
  RedeemResult,
} from "./redeem.ts";
import type {
  CreateUserParams as RegisterCreateUserParams,
  RegisterAtomicParams,
  RegisterAtomicResult,
  RegisterAtomicRunner,
  RegisterAuthAdmin,
} from "../register/types.ts";
import type { AdminVerifier, AdminVerifyResult } from "./admin_auth.ts";
import type {
  AgencyCreateParams,
  AgencyCreateResult,
  AgencyCreator,
} from "./agency.ts";
import type {
  ActiveUploadChecker,
  PendingUploadCanceller,
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
  MintedPoster,
  PosterUrlMinter,
} from "../mint-poster-urls/types.ts";
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
import type {
  ModerationWriteParams,
  ModerationWriter,
  PropertyFetcher,
  RevisionFinder,
} from "../moderate-property/types.ts";
import type {
  ActiveAdUploadChecker,
  AdCreativeRegistrar,
  AdvertiserAuthorizeResult,
  AdvertiserAuthorizer,
  RegisterUploadingAdCreativeParams,
} from "../mint-ad-upload-url/types.ts";
import type { AdUrlMinter, MintedAdUrl } from "../mint-ad-urls/types.ts";

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
 * Cliente supabase-js con ANON key + el JWT del caller reenviado en el header
 * Authorization (subtarea 71.3, Camino B de request-agent-upgrade). A
 * diferencia de service_client(), este cliente SÍ respeta RLS — auth.uid()
 * dentro de las políticas resuelve al usuario dueño del JWT. Se usa cuando la
 * lógica de negocio quiere delegar la autorización a una política RLS ya
 * probada (agent_app_insert) en vez de reimplementar el chequeo en JS.
 */
export function user_client(authHeader: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anon_key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon_key) {
    throw new Error("Faltan SUPABASE_URL / SUPABASE_ANON_KEY en el entorno");
  }
  return createClient(url, anon_key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
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

// 168.4: destino del deep link que GoTrue anexa al correo real de invitación
// (el token de sesión viaja en el fragmento de la URL, mismo mecanismo que
// requestPasswordReset en mobile/src/features/auth/context.tsx). Sin ruta
// dedicada de aceptación de invitación todavía (168.5), se apunta a la raíz
// de la app — dentro del patrón permitido `urbea://*` (supabase/config.toml
// additional_redirect_urls). Cambiar aquí cuando 168.5 defina la pantalla.
const OWNER_INVITE_REDIRECT_TO = "urbea://";

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
        return {
          data: null,
          error: error
            ? { message: error.message }
            : { message: "generateLink devolvió sin data" },
        };
      }
      return {
        data: {
          user: { id: data.user.id },
          action_link: data.properties.action_link,
        },
        error: null,
      };
    },
    /**
     * 168.4: envío REAL del correo de invitación (plantilla "Invite user" de
     * GoTrue + el SMTP configurado — Mailpit en local, Resend en remoto tras
     * 168.6). A diferencia de generateLink, inviteUserByEmail NO devuelve
     * action_link en su respuesta (el link solo viaja en el correo que GoTrue
     * ya mandó) — se recupera un link de RESPALDO con un segundo
     * generateLink(type:'magiclink') sobre el usuario que acaba de crearse
     * ('invite' fallaría aquí con "already registered", porque el usuario ya
     * existe a esta altura). Fail-open en el backup: si ese segundo link no
     * se puede generar, el correo YA se mandó (email_sent:true igual) y el
     * link de respaldo queda como cadena vacía en vez de tumbar el flujo.
     */
    async inviteUserByEmail(
      params: InviteByEmailParams,
    ): Promise<InviteByEmailResponse> {
      const { data, error } = await client.auth.admin.inviteUserByEmail(
        params.email,
        {
          redirectTo: params.redirectTo ?? OWNER_INVITE_REDIRECT_TO,
          data: params.data,
        },
      );
      if (error || !data?.user) {
        return {
          data: null,
          error: error
            ? { message: error.message }
            : { message: "inviteUserByEmail devolvió sin data" },
        };
      }
      const backup = await client.auth.admin.generateLink({
        type: "magiclink",
        email: params.email,
      });
      return {
        data: {
          user: { id: data.user.id },
          action_link: backup.data?.properties?.action_link ?? "",
          email_sent: true,
        },
        error: null,
      };
    },
  };
}

/**
 * Adaptador real de RegisterAuthAdmin (subtarea 93.2) sobre supabase.auth.admin.
 * Mismo wrapping que make_auth_admin (createUser/deleteUser): se separa como
 * función hermana en vez de reusar AuthAdminClient porque su user_metadata
 * (register/types.ts, 6 campos §5.1) es un tipo distinto y más rico que el de
 * la invitación de agente (solo first_name/last_name) — ningún cambio en
 * auth_user.ts, cero riesgo de romper redeem-invitation.
 */
export function make_register_auth_admin(
  client: SupabaseClient,
): RegisterAuthAdmin {
  return {
    async createUser(params: RegisterCreateUserParams) {
      const { data, error } = await client.auth.admin.createUser(params);
      return {
        data: data?.user ? { user: { id: data.user.id } } : null,
        // code viaja junto al message: la rama email_exists del handler lo
        // necesita (versiones nuevas de GoTrue identifican por code, no por
        // el texto del mensaje).
        error: error ? { message: error.message, code: error.code } : null,
      };
    },
    async deleteUser(uid: string) {
      await client.auth.admin.deleteUser(uid);
    },
  };
}

/**
 * Adaptador real de RegisterDeps.phone_exists (renegociación 2026-07-30):
 * pre-check ANTES de createUser que replica la semántica del índice parcial
 * users_phone_unique_active (migración 20260727000002) — solo cuentas activas
 * (deleted_at IS NULL). GoTrue nunca expone ese índice violado (colapsa en un
 * 500 genérico), así que este SELECT es la única señal utilizable para dar
 * PHONE_TAKEN en vez de un 500 opaco.
 * Fail-open a propósito: si la query falla, se deja pasar (false) — el índice
 * único de la DB sigue siendo el backstop real (createUser fallaría con el
 * 500 genérico AUTH_CREATE_FAILED, sin fuga). Sin esto un error de red en el
 * pre-check bloquearía registros legítimos con un falso PHONE_TAKEN.
 */
export function make_phone_exists(
  client: SupabaseClient,
): (phone: string) => Promise<boolean> {
  return async (phone: string): Promise<boolean> => {
    const { data, error } = await client
      .from("users")
      .select("id")
      .eq("phone", phone)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      console.error("register: phone_exists falló, fail-open (false)", error);
      return false;
    }
    return data !== null;
  };
}

// Códigos de negocio que register_user_atomic levanta con SQLSTATE P0001
// (migración 20260729000001, subtarea 93.1).
const REGISTER_ERROR_CODES = [
  "FIELDS_INCOMPLETE",
  "NO_ACTIVE_TERMS",
  "NO_ACTIVE_PRIVACY",
];

function extract_register_code(message: string): string {
  return REGISTER_ERROR_CODES.find((c) => message.includes(c)) ??
    "REGISTER_FAILED";
}

/** Adaptador real de RegisterAtomicRunner sobre la RPC register_user_atomic (subtarea 93.1). */
export function make_registrar(client: SupabaseClient): RegisterAtomicRunner {
  return {
    async register_atomic(
      params: RegisterAtomicParams,
    ): Promise<RegisterAtomicResult> {
      const { error } = await client.rpc("register_user_atomic", {
        p_user_id: params.user_id,
        p_ip: params.ip ?? null,
      });
      if (error) {
        return { ok: false, error_code: extract_register_code(error.message) };
      }
      return { ok: true };
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
const AGENCY_ERROR_CODES = [
  "SLUG_DUPLICATE",
  "NAME_DUPLICATE",
  "CREATED_BY_REQUIRED",
  "ALREADY_ACTIVE_MEMBER",
];

function extract_agency_error_code(message: string): string {
  return AGENCY_ERROR_CODES.find((c) => message.includes(c)) ?? "DB_ERROR";
}

/**
 * Adaptador real de AgencyCreator sobre la RPC admin_create_agency_atomic
 * (168.3: 20260816000001, 11 params; 168.7: 20260816000004, 12 params con
 * p_advertiser_category). Llama la versión que inserta token + admin_actions
 * en la misma transacción.
 * Mapea los errores P0001 al error_code de negocio correspondiente.
 */
export function make_agency_creator(client: SupabaseClient): AgencyCreator {
  return {
    async create_atomic(
      params: AgencyCreateParams,
    ): Promise<AgencyCreateResult> {
      // 168.3: can_publish_properties/can_advertise SOLO se incluyen en la
      // llamada cuando vienen definidos — si el payload no los trae, la
      // RPC debe usar su propio DEFAULT (mismo default que la columna), no
      // un null explícito forzado desde el EF.
      const rpc_params: Record<string, unknown> = {
        p_name: params.name,
        p_slug: params.slug,
        p_contact_name: params.contact_name ?? null,
        p_contact_phone: params.contact_phone ?? null,
        p_contact_email: params.contact_email ?? null,
        p_created_by_user_id: params.created_by_user_id,
        p_owner_user_id: params.owner_user_id ?? null,
        p_token_hash: params.token_hash ?? null,
        p_token_max_uses: params.token_max_uses ?? null,
      };
      if (params.can_publish_properties !== undefined) {
        rpc_params.p_can_publish_properties = params.can_publish_properties;
      }
      if (params.can_advertise !== undefined) {
        rpc_params.p_can_advertise = params.can_advertise;
      }
      // 168.7: mismo criterio — solo se incluye si el payload la trae.
      if (params.advertiser_category !== undefined) {
        rpc_params.p_advertiser_category = params.advertiser_category;
      }
      const { data, error } = await client.rpc(
        "admin_create_agency_atomic",
        rpc_params,
      );
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
    async mint_signed_urls(
      property_ids: string[],
    ): Promise<import("../mint-video-url/types.ts").MintedVideo[]> {
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
            const { token, domain } = await sign_stream_token(
              row.cloudflare_uid,
              hlsConfig,
            );
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
    if (
      !account_id || !access_key_id || !secret_access_key || !bucket ||
      !endpoint
    ) {
      throw new Error(
        "Faltan variables de entorno R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_ENDPOINT",
      );
    }
    return { access_key_id, secret_access_key, bucket, endpoint };
  }

  async function sign(
    key: string,
    method: "PUT" | "GET",
    ttl_seconds: number,
  ): Promise<string> {
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
 * Adaptador real de ActiveUploadChecker (subtarea 68.3, invariante §13.2;
 * ventana de expiración — reaper — añadida en 103.1 parte B).
 * Cuenta, con service_role, los videos activos del agente:
 *   - 'processing' SIEMPRE bloquea (si Stream ya recibió los bytes y está
 *     transcodificando, el webhook lo resuelve solo — no hay fila colgada).
 *   - 'uploading' SOLO bloquea si es reciente (created_at > stale_before). Una
 *     fila 'uploading' más vieja que stale_before es un upload que nunca llegó
 *     a Stream (bug #103 derivado de 68.4/90) y no debe bloquear reintentos.
 * Soft-delete excluido. El fake de los tests del handler solo le importa el
 * count agregado y el argumento stale_before capturado.
 */
export function make_active_upload_checker(
  client: SupabaseClient,
): ActiveUploadChecker {
  return {
    async count_active_uploads(agent_id: string, stale_before: string): Promise<number> {
      const { count, error } = await client
        .from("property_videos")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agent_id)
        .is("deleted_at", null)
        .or(`status.eq.processing,and(status.eq.uploading,created_at.gt.${stale_before})`);

      if (error) {
        // Fail-closed: un error de red/DB al chequear concurrencia no debe
        // permitir un upload que quizás sí colisione — se trata como "hay 1".
        // O3 (guardian, 103.1): logueado para que un PGRST100 (p.ej. sintaxis
        // del .or() interpolado) no se confunda con concurrencia real — sin
        // esto, un 409 permanente para todos los agentes sería indistinguible
        // del camino normal y mudo en los logs de la Edge Function.
        console.error("count_active_uploads: query falló, fail-closed (1)", error);
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
        throw new Error(
          "Faltan variables de entorno STREAM_ACCOUNT_ID/STREAM_API_TOKEN",
        );
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
          `Cloudflare Stream direct_upload falló: ${res.status} ${
            JSON.stringify(json.errors ?? json)
          }`,
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
    async register_uploading_video(
      params: RegisterUploadingVideoParams,
    ): Promise<void> {
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
 * Adaptador real de PendingUploadCanceller (quick fix 2026-08-15, "Cambiar
 * video"): soft-borra los videos del agente que aún NO pertenecen a ninguna
 * propiedad (property_id IS NULL) y siguen en uploading/processing. Es lo que
 * el wizard tenía "en curso"; al pedir un slot nuevo con replace:true dejan
 * de contar para la invariante §13.2. Devuelve filas afectadas. Lanza si el
 * UPDATE falla (el handler → 500). El binario en Stream, si llegó, queda
 * huérfano — se limpia con el mismo criterio que cualquier soft-delete.
 */
export function make_pending_upload_canceller(client: SupabaseClient): PendingUploadCanceller {
  return {
    async cancel_unattached_uploads(agent_id: string): Promise<number> {
      const { data, error } = await client
        .from("property_videos")
        .update({ deleted_at: new Date().toISOString() })
        .eq("agent_id", agent_id)
        .is("property_id", null)
        .is("deleted_at", null)
        .in("status", ["uploading", "processing"])
        .select("id");
      if (error) {
        throw new Error(`Cancelar uploads pendientes falló: ${error.message}`);
      }
      return data?.length ?? 0;
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
export function make_video_status_updater(
  client: SupabaseClient,
): VideoStatusUpdater {
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
        throw new Error(
          `UPDATE property_videos (mark_ready) falló: ${error.message}`,
        );
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
        throw new Error(
          `UPDATE property_videos (mark_failed) falló: ${error.message}`,
        );
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
    notify_video_event(
      event: VideoNotifyEvent,
      cloudflare_uid: string,
    ): Promise<void> {
      console.log(
        JSON.stringify({ event, cloudflare_uid, at: new Date().toISOString() }),
      );
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
    async enable_download(
      cloudflare_uid: string,
    ): Promise<EnableDownloadResult> {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account_id()}/stream/${cloudflare_uid}/downloads`,
        { method: "POST", headers: stream_headers() },
      );
      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(
          `Cloudflare Stream enable_download falló: ${res.status} ${
            JSON.stringify(json.errors ?? json)
          }`,
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
        throw new Error(
          `Descarga del MP4 de Cloudflare Stream falló: ${res.status}`,
        );
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
      const put_url = await make_r2_url_minter().sign_put(
        key,
        R2_ARCHIVE_PUT_TTL_SECONDS,
      );
      const res = await fetch(put_url, {
        method: "PUT",
        body: body as BodyInit,
      });
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
        throw new Error(
          `UPDATE property_videos (mark_archived) falló: ${error.message}`,
        );
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
export function make_thumbnail_url_signer(
  hlsConfig: HlsSignerConfig,
): ThumbnailUrlSigner {
  return {
    async sign(
      cloudflare_uid: string,
    ): Promise<import("../mint-thumbnail-url/types.ts").ThumbnailSignResult> {
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

/** Fila cruda de la query property_videos ⋈ properties usada por make_poster_url_minter. */
interface PosterVideoRow {
  id: string;
  property_id: string;
  cloudflare_uid: string | null;
  thumbnail_pct: number | null;
  duration_seconds: number | null;
  position: number;
  properties:
    | { owner_user_id: string; status: string }
    | { owner_user_id: string; status: string }[]
    | null;
}

/**
 * Adaptador real de PosterUrlMinter (subtarea 89.1): batch de portadas firmadas
 * (posterUrl) del grid de propiedades, con auth por-item combinada
 * dueño-o-active. service_role bypassa RLS — el filtro de abajo, hecho en JS,
 * es la ÚNICA barrera de seguridad (fail-closed, nunca se olvida).
 *
 * 1. Trae property_videos ⋈ properties!inner (owner_user_id, status) filtrando
 *    status='ready' AND deleted_at IS NULL (de la fila del video) AND
 *    properties.deleted_at IS NULL AND property_id IN (property_ids).
 * 2. Por propiedad, se queda con el video de menor `position` (el primero).
 * 3. Autoriza cada fila: owner_user_id === caller_id (cualquier status) O
 *    status === 'active' (público). No autorizado → se OMITE.
 * 4. Sin cloudflare_uid, sin hlsConfig, o error de firma (JWK inválido) →
 *    se OMITE esa fila, SIN lanzar — el batch nunca se rompe por un item.
 * 5. Firma reusando sign_stream_token/build_poster_url (mismo mecanismo que
 *    make_video_url_minter, 68.15): token EN EL PATH, time =
 *    COALESCE(thumbnail_pct,50)/100 × duration_seconds.
 *
 * ponytail: batch degradado — un error de red/DB en la query devuelve []
 * en vez de lanzar, mismo patrón que make_video_url_minter.
 */
export function make_poster_url_minter(
  client: SupabaseClient,
  hlsConfig?: HlsSignerConfig,
): PosterUrlMinter {
  return {
    async mint_posters(
      property_ids: string[],
      caller_id: string,
    ): Promise<MintedPoster[]> {
      if (property_ids.length === 0) return [];

      const { data, error } = await client
        .from("property_videos")
        .select(
          "id, property_id, cloudflare_uid, thumbnail_pct, duration_seconds, position, properties!inner(owner_user_id, status, deleted_at)",
        )
        .in("property_id", property_ids)
        .eq("status", "ready")
        .is("deleted_at", null)
        .is("properties.deleted_at", null)
        .order("position", { ascending: true });

      if (error) return [];

      const rows = (data as unknown) as PosterVideoRow[];

      // Primer video ready por propiedad = el de menor `position`.
      const first_by_property = new Map<string, PosterVideoRow>();
      for (const row of rows) {
        const current = first_by_property.get(row.property_id);
        if (!current || row.position < current.position) {
          first_by_property.set(row.property_id, row);
        }
      }

      const results: MintedPoster[] = [];
      for (const row of first_by_property.values()) {
        const raw_properties = row.properties;
        const properties = (Array.isArray(raw_properties)
          ? raw_properties[0]
          : raw_properties) as
            | { owner_user_id: string; status: string }
            | undefined
            | null;
        if (!properties) {
          continue;
        }

        const authorized = properties.owner_user_id === caller_id ||
          properties.status === "active";
        if (!authorized) {
          continue;
        }

        if (!row.cloudflare_uid || !hlsConfig) {
          continue;
        }

        try {
          const { token, domain } = await sign_stream_token(
            row.cloudflare_uid,
            hlsConfig,
          );
          const posterUrl = build_poster_url(
            domain,
            token,
            row.thumbnail_pct,
            row.duration_seconds,
          );
          results.push({ property_id: row.property_id, posterUrl });
        } catch {
          // fail-closed: JWK inválido u otro error de firmado → excluir solo esta fila
        }
      }

      return results;
    },
  };
}

/**
 * Adaptador real de VideoStatusChecker (73.4, pipeline de moderación PRD §15.2;
 * contrato revisado en #126). Consulta property_videos por (cloudflare_uid,
 * agent_id) — el video en vuelo upload-first (68.12). Sin fila (uid ajeno,
 * inexistente o soft-deleted) → VIDEO_NOT_FOUND.
 *
 * #126 — el gate viejo exigía 'ready' + duración en rango, pero la fila nace
 * 'uploading' y solo el webhook la pasa a 'ready': publicar recién subido daba
 * 409, y un 'ready' sin duración reportada daba 400 sin salida posible.
 * Contrato nuevo, alineado con la RPC publish_property_atomic (que enlaza
 * videos con status in ('processing','ready')):
 *   - status fuera de ('processing','ready') → VIDEO_NOT_READY.
 *   - duration_seconds se valida SOLO cuando se conoce: fuera de [10,120]
 *     (inclusive, #149 — antes [60,120]) → VIDEO_DURATION_INVALID; null → pasa
 *     (el cliente valida la duración al elegir el video, antes de subir).
 */
export function make_video_status_checker(
  client: SupabaseClient,
): VideoStatusChecker {
  return {
    async check(
      cloudflare_uid: string,
      agent_id: string,
    ): Promise<VideoStatusCheckResult> {
      const { data, error } = await client
        .from("property_videos")
        .select("status, duration_seconds")
        .eq("cloudflare_uid", cloudflare_uid)
        .eq("agent_id", agent_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !data) {
        return { ok: false, error_code: "VIDEO_NOT_FOUND" };
      }
      if (data.status !== "ready" && data.status !== "processing") {
        return { ok: false, error_code: "VIDEO_NOT_READY" };
      }
      const duration = data.duration_seconds as number | null;
      // #149: mínimo 10 s (antes 60) — espejo de MIN/MAX_VIDEO_DURATION_SECONDS
      // en mobile/src/features/publish/validation.ts; cambiar SIEMPRE ambos.
      if (duration !== null && (duration < 10 || duration > 120)) {
        return { ok: false, error_code: "VIDEO_DURATION_INVALID" };
      }
      return { ok: true, duration_seconds: duration };
    },
  };
}

// Estados de properties que NO cuentan como duplicado (73.4, regla exacta en
// publish-property/types.ts): una publicación rechazada o eliminada del mismo
// owner+dirección no bloquea — el agente puede resubir.
// #151 (origen 73): 'draft' excluido — el autosave del wizard guarda un draft
// con la dirección ya capturada y el propio borrador del agente bloqueaba su
// publish con 409 en todos los intentos (el descarte #135 solo corre tras el
// éxito → deadlock). Un borrador no es una publicación.
const DUPLICATE_EXCLUDED_STATUSES = [
  "draft",
  "rejected",
  "deleted_soft",
  "deleted_hard",
];

/**
 * Adaptador real de DuplicatePropertyChecker (73.4, pipeline de moderación PRD
 * §15.2). Trae las direcciones NO borradas del mismo owner_user_id cuyo status
 * no esté en DUPLICATE_EXCLUDED_STATUSES, y compara en JS con
 * lower(trim(...)) en AMBOS lados — evita depender de ilike (trata % y _ como
 * comodines, inseguro con direcciones arbitrarias) para una comparación que en
 * realidad es de igualdad normalizada, no de patrón.
 * Fail-open (isDuplicate: false) ante error de red/DB — mismo criterio que
 * make_phone_exists: un falso bloqueo por un timeout transitorio es peor que
 * dejar pasar una publicación que, en el peor caso, un admin revisa en el
 * pipeline de moderación de todas formas (pending_review, nunca auto-active).
 */
export function make_duplicate_property_checker(
  client: SupabaseClient,
): DuplicatePropertyChecker {
  return {
    async check(user_id: string, address: string): Promise<DuplicateCheckResult> {
      const normalized_address = address.trim().toLowerCase();

      const { data, error } = await client
        .from("properties")
        .select("address")
        .eq("owner_user_id", user_id)
        .is("deleted_at", null)
        .not(
          "status",
          "in",
          `(${DUPLICATE_EXCLUDED_STATUSES.join(",")})`,
        );

      if (error || !data) {
        console.error(
          "duplicate_property_checker: query falló, fail-open (isDuplicate=false)",
          error,
        );
        return { isDuplicate: false };
      }

      const isDuplicate = (data as Array<{ address: string }>).some(
        (row) => row.address.trim().toLowerCase() === normalized_address,
      );
      return { isDuplicate };
    },
  };
}

/**
 * Adaptador real de PropertyFetcher (subtarea 73.9, moderate-property). Trae
 * id+status; excluye soft-deleted (deleted_at IS NOT NULL ya no debería
 * moderarse — la propiedad quedó fuera del pipeline).
 */
export function make_property_fetcher(client: SupabaseClient): PropertyFetcher {
  return {
    async fetch(property_id: string) {
      const { data, error } = await client
        .from("properties")
        .select("id, status")
        .eq("id", property_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) {
        return { ok: false, error_code: "DB_ERROR", message: error.message };
      }
      if (!data) {
        return { ok: false, error_code: "PROPERTY_NOT_FOUND" };
      }
      return { ok: true, property: { id: data.id, status: data.status } };
    },
  };
}

/**
 * Adaptador real de RevisionFinder (subtarea 73.9). Busca la revisión ACTIVA
 * (status IN pending|needs_changes) — el índice único parcial de 73.2
 * (property_revisions_one_active_per_property) garantiza a lo más una fila.
 */
export function make_revision_finder(client: SupabaseClient): RevisionFinder {
  return {
    async find_active(property_id: string) {
      const { data, error } = await client
        .from("property_revisions")
        .select("id, status, changed_fields")
        .eq("property_id", property_id)
        .in("status", ["pending", "needs_changes"])
        .maybeSingle();

      if (error) {
        return { ok: false, error_code: "DB_ERROR", message: error.message };
      }
      if (!data) {
        return { ok: true, revision: null };
      }
      return {
        ok: true,
        revision: {
          id: data.id,
          status: data.status,
          changed_fields: data.changed_fields,
        },
      };
    },
  };
}

/**
 * Adaptador real de ModerationWriter (#130). UNA llamada a la RPC
 * moderate_property_atomic (20260809000007), que ejecuta en la MISMA
 * transacción: snapshot de la revisión sobre `properties` (semántica por
 * presencia de clave — el whitelist de columnas vive en la RPC, no aquí),
 * transición de status, resolución de property_revisions y el INSERT de
 * auditoría en admin_actions. Reemplaza a los tres adaptadores previos
 * (make_property_updater / make_revision_resolver / make_admin_action_recorder),
 * cuyos round-trips sueltos dejaban propiedades activas sin rastro de
 * auditoría cuando el último paso fallaba.
 */
export function make_moderation_writer(client: SupabaseClient): ModerationWriter {
  return {
    async apply(params: ModerationWriteParams) {
      const { error } = await client.rpc("moderate_property_atomic", {
        p_admin_id: params.admin_id,
        p_property_id: params.property_id,
        p_action_type: params.action_type,
        p_old_values: params.old_values,
        p_new_values: params.new_values,
        p_reason: params.reason,
        p_new_property_status: params.new_property_status ?? null,
        p_changed_fields: params.changed_fields ?? null,
        p_revision_id: params.revision_id ?? null,
        p_revision_status: params.revision_status ?? null,
        p_revision_reason: params.revision_reason ?? null,
      });
      if (error) {
        return { ok: false as const, error_code: "DB_ERROR" as const, message: error.message };
      }
      return { ok: true as const };
    },
  };
}

/**
 * Adaptador real de AdvertiserAuthorizer (subtarea 169.4, mint-ad-upload-url).
 * Resuelve la organización ACTIVA del caller con una query directa por
 * user_id — mismo patrón que make_agency_ownership_verifier (69.2), NO el
 * helper SQL private.agency_role_of (ese lee `(select auth.uid())`, que no
 * resuelve nada aquí porque este cliente corre con service_role, sin sesión
 * JWT). El índice único agency_members_one_active_per_user (20260604000003)
 * garantiza a lo más 1 fila.
 *
 * Colapsa TRES causas en el MISMO 403 FORBIDDEN (fail-closed, nunca 404 ni
 * 500): (a) sin membresía activa, (b) miembro pero no owner/admin, (c) owner/
 * admin de una organización real pero sin la capacidad de anunciar.
 *
 * ⚠️ FIX del guardián (2026-08-16, sonda contra el stack local): la capacidad
 * se resuelve vía `public.org_can_advertise` (20260816000008), un wrapper que
 * DELEGA en `private.org_can_advertise` (168.1) — PostgREST/`client.rpc()` NO
 * puede alcanzar el esquema `private` directo (ésa es su función; ver
 * 20260815000001), así que llamar el nombre de la función privada devolvía
 * SIEMPRE PGRST202 (función no encontrada) y colapsaba el authorize en
 * FORBIDDEN para el 100% de los anunciantes, sin importar sus datos. El
 * wrapper está restringido a `service_role` (revoke explícito de
 * public/anon/authenticated en la propia migración) — no abre a PostgREST una
 * capacidad que hasta ahora era privada. El agency_id SIEMPRE sale de esta
 * resolución server-side — nunca del body.
 */
export function make_advertiser_authorizer(
  client: SupabaseClient,
): AdvertiserAuthorizer {
  return {
    async authorize_advertiser(user_id: string): Promise<AdvertiserAuthorizeResult> {
      const { data, error } = await client
        .from("agency_members")
        .select("agency_id, member_role")
        .eq("user_id", user_id)
        .eq("status", "active")
        .maybeSingle();

      if (error || !data) {
        return { ok: false, error_code: "FORBIDDEN" };
      }
      if (data.member_role !== "owner" && data.member_role !== "admin") {
        return { ok: false, error_code: "FORBIDDEN" };
      }

      // Wrapper público (20260816000008) — NUNCA el nombre de la función
      // private.* directo, PostgREST no lo resuelve (PGRST202, ver docblock).
      const { data: can_advertise, error: rpc_error } = await client.rpc(
        "org_can_advertise",
        { p_agency_id: data.agency_id },
      );
      if (rpc_error || can_advertise !== true) {
        return { ok: false, error_code: "FORBIDDEN" };
      }

      return { ok: true, agency_id: data.agency_id as string };
    },
  };
}

/**
 * Adaptador real de ActiveAdUploadChecker (subtarea 169.4). Calco del reaper
 * de make_active_upload_checker (103.1 parte B) con tabla y clave PROPIAS:
 * `ad_creatives` keyeado por agency_id — NUNCA property_videos/agent_id, por
 * diseño (separación por dominio, ver mint-ad-upload-url/types.ts). Misma
 * semántica de ventana: 'processing' siempre bloquea (el webhook, 169.5, lo
 * resuelve solo); 'uploading' solo bloquea si es más reciente que
 * stale_before (bug #103 heredado, evita el 409 permanente). `ad_creatives`
 * no tiene columna deleted_at (20260816000005) — sin filtro de soft-delete,
 * a diferencia de property_videos.
 */
export function make_active_ad_upload_checker(
  client: SupabaseClient,
): ActiveAdUploadChecker {
  return {
    async count_active_ad_uploads(
      agency_id: string,
      stale_before: string,
    ): Promise<number> {
      const { count, error } = await client
        .from("ad_creatives")
        .select("id", { count: "exact", head: true })
        .eq("agency_id", agency_id)
        .or(
          `status.eq.processing,and(status.eq.uploading,created_at.gt.${stale_before})`,
        );

      if (error) {
        // Fail-closed: mismo criterio que make_active_upload_checker — un
        // error de red/DB al chequear concurrencia no debe permitir un
        // upload que quizás sí colisione.
        console.error(
          "count_active_ad_uploads: query falló, fail-closed (1)",
          error,
        );
        return 1;
      }
      return count ?? 0;
    },
  };
}

/**
 * Adaptador real de AdCreativeRegistrar (subtarea 169.4): inserta la fila
 * 'uploading' en ad_creatives. Shape MÁS ANGOSTO que VideoRegistrar (sin
 * property_id/position/tus_upload_url, que ad_creatives no tiene — schema de
 * 169.1, 20260816000005_ads_schema.sql).
 */
export function make_ad_creative_registrar(
  client: SupabaseClient,
): AdCreativeRegistrar {
  return {
    async register_uploading_ad_creative(
      params: RegisterUploadingAdCreativeParams,
    ): Promise<void> {
      const { error } = await client.from("ad_creatives").insert({
        agency_id: params.agency_id,
        status: params.status,
        cloudflare_uid: params.cloudflare_uid,
      });
      if (error) {
        throw new Error(`Insert en ad_creatives falló: ${error.message}`);
      }
    },
  };
}

/**
 * STUB RED — subtarea 169.5. Implementación real pendiente (GREEN): calco de
 * make_poster_url_minter (89.1) reusando sign_stream_token/build_poster_url,
 * pero contra ad_creatives (ownership por agency_id directo + resolución de la
 * agencia del caller vía agency_members, mismo mecanismo que
 * make_advertiser_authorizer) en vez de property_videos⋈properties. Ver el
 * contrato completo y las decisiones de diseño documentadas en
 * _shared/ad_url_minter.test.ts y mint-ad-urls/types.ts.
 */
export function make_ad_url_minter(
  _client: SupabaseClient,
  _hlsConfig?: HlsSignerConfig,
): AdUrlMinter {
  return {
    mint_ad_urls(_creative_ids: string[], _caller_id: string): Promise<MintedAdUrl[]> {
      throw new Error("not_implemented");
    },
  };
}
