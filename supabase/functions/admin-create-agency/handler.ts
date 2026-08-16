// supabase/functions/admin-create-agency/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Esto mantiene los tests rápidos y offline.
//
// Orquestación (7.5 + 168.4):
//   validación de body → validación de payload (+ owner fields si authAdmin) →
//   verificar admin → create_owner_invite (Auth: inviteUserByEmail si está
//   disponible, si no generateInviteLink) → RPC create_atomic →
//   compensación si RPC falla → 201 con agency_id
//   [+ owner_user_id + invite_action_link + email_sent].

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { parse_create_agency_input } from "../_shared/validation.ts";
import type { AdminVerifier } from "../_shared/admin_auth.ts";
import type { AgencyCreator } from "../_shared/agency.ts";
import {
  AGENCY_CREATE_ERROR_MESSAGES,
  AGENCY_CREATE_ERROR_STATUS,
} from "../_shared/agency.ts";
import type { AuthAdminClient } from "../_shared/auth_user.ts";
import { create_owner_invite } from "../_shared/auth_user.ts";
import { generate_invitation_code, sha256_hex } from "../_shared/crypto.ts";

// Regex RFC 5322 simplificado — igual al de validation.ts
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dependencias inyectables del handler (DI pattern).
 * En producción se construyen desde _shared/clients.ts.
 * En tests se inyectan fakes controlados.
 *
 * authAdmin (7.5): cliente para generateInviteLink (crear owner sin password)
 * y deleteUser (compensación si la RPC falla tras crear el owner en Auth).
 */
export interface AdminCreateAgencyDeps {
  adminVerifier?: AdminVerifier;
  agencyCreator?: AgencyCreator;
  /** 7.5: wired en producción para llamar create_owner_invite + compensación. */
  authAdmin?: AuthAdminClient;
}

/**
 * Handler exportado para tests unitarios sin Deno.serve().
 *
 * Payload esperado:
 *   { name, slug, contact_email?, contact_name?, contact_phone?,
 *     owner_email, owner_first_name, owner_last_name }  ← campos owner si authAdmin inyectado
 *
 * Respuestas:
 *   OPTIONS → 200 con headers CORS
 *   GET/PUT/DELETE → 405
 *   POST inválido (body/validación) → 400 { error: { code: "INVALID_INPUT", message } }
 *   POST sin/!admin → 401 UNAUTHENTICATED | 403 FORBIDDEN
 *   POST owner email duplicado → 409 EMAIL_ALREADY_EXISTS
 *   POST admin válido → 201 { agency_id [, owner_user_id, invite_action_link] }
 *                       | 409 SLUG_DUPLICATE | 409 NAME_DUPLICATE
 *                       | 409 ALREADY_ACTIVE_MEMBER | 500
 */
export async function handler(
  req: Request,
  deps?: AdminCreateAgencyDeps,
): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // Solo POST permitido
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // Leer body — 400 si no es JSON válido
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response(
      "INVALID_INPUT",
      "El cuerpo de la petición no es JSON válido",
      400,
    );
  }

  // Validar payload base (name, slug, contact_*)
  const parsed = parse_create_agency_input(raw);
  if (!parsed.success) {
    return error_response(parsed.error.code, parsed.error.message, 400);
  }

  const { name, slug, contact_email, contact_name, contact_phone } =
    parsed.data;

  // Params de capacidad (168.3): reenviados a la RPC SOLO si el admin los
  // manda en el payload, como boolean explícito. undefined si el payload no
  // los trae (payload viejo de un build instalado) — la RPC usa su propio
  // DEFAULT (mismo default que la columna), el EF no fuerza ningún valor.
  const rawBody = raw as Record<string, unknown>;
  const can_publish_properties =
    typeof rawBody.can_publish_properties === "boolean"
      ? rawBody.can_publish_properties
      : undefined;
  const can_advertise = typeof rawBody.can_advertise === "boolean"
    ? rawBody.can_advertise
    : undefined;
  // advertiser_category (168.7): mismo criterio — undefined si el payload no
  // la trae, para que la RPC use su propio DEFAULT (null) en vez de un valor
  // forzado desde el EF.
  const advertiser_category =
    typeof rawBody.advertiser_category === "string"
      ? rawBody.advertiser_category
      : undefined;

  // Validación de campos owner — solo cuando authAdmin está inyectado (flujo 7.5)
  let owner_email: string | undefined;
  let owner_first_name: string | undefined;
  let owner_last_name: string | undefined;

  if (deps?.authAdmin) {
    const obj = raw as Record<string, unknown>;

    // owner_email: requerido, formato email válido
    if (
      obj.owner_email === undefined ||
      obj.owner_email === null ||
      typeof obj.owner_email !== "string" ||
      obj.owner_email.trim().length === 0
    ) {
      return error_response(
        "INVALID_INPUT",
        "owner_email es requerido",
        400,
      );
    }
    if (!EMAIL_REGEX.test(obj.owner_email)) {
      return error_response(
        "INVALID_INPUT",
        "owner_email no tiene un formato válido",
        400,
      );
    }
    owner_email = obj.owner_email;

    // owner_first_name: requerido, no vacío
    if (
      obj.owner_first_name === undefined ||
      obj.owner_first_name === null ||
      typeof obj.owner_first_name !== "string" ||
      obj.owner_first_name.trim().length === 0
    ) {
      return error_response(
        "INVALID_INPUT",
        "owner_first_name es requerido",
        400,
      );
    }
    owner_first_name = obj.owner_first_name;

    // owner_last_name: requerido, no vacío
    if (
      obj.owner_last_name === undefined ||
      obj.owner_last_name === null ||
      typeof obj.owner_last_name !== "string" ||
      obj.owner_last_name.trim().length === 0
    ) {
      return error_response(
        "INVALID_INPUT",
        "owner_last_name es requerido",
        400,
      );
    }
    owner_last_name = obj.owner_last_name;
  }

  // Verificar admin — 401 UNAUTHENTICATED | 403 FORBIDDEN
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.adminVerifier!.verify_caller(authHeader);
  if (!verifyResult.ok) {
    const status = verifyResult.error_code === "UNAUTHENTICATED" ? 401 : 403;
    const message =
      verifyResult.error_code === "UNAUTHENTICATED"
        ? "Se requiere autenticación de administrador"
        : "Acceso denegado: se requiere rol de administrador";
    return error_response(verifyResult.error_code, message, status);
  }

  // Crear owner vía invitación (7.5) — solo cuando authAdmin está inyectado
  let owner_user_id: string | undefined;
  let invite_action_link: string | undefined;
  // 168.4: presente (boolean) solo cuando create_owner_invite usó el seam
  // inviteUserByEmail (correo real). Con el authAdmin viejo (generateInviteLink
  // solamente) queda undefined — aditivo, no se manda en la respuesta.
  let email_sent: boolean | undefined;

  if (deps?.authAdmin && owner_email && owner_first_name && owner_last_name) {
    const invite_result = await create_owner_invite(deps.authAdmin, {
      email: owner_email,
      first_name: owner_first_name,
      last_name: owner_last_name,
    });

    if (!invite_result.ok) {
      const status =
        invite_result.error_code === "EMAIL_ALREADY_EXISTS" ? 409 : 500;
      return error_response(
        invite_result.error_code,
        invite_result.message,
        status,
      );
    }

    owner_user_id = invite_result.user_id;
    invite_action_link = invite_result.action_link;
    email_sent = invite_result.email_sent;
  }

  // Generar token inicial de invitación (7.6): plano → se devuelve al admin; hash → se persiste.
  const plain_token = generate_invitation_code(8);
  const token_hash = await sha256_hex(plain_token);

  // Crear agencia atómicamente (RPC)
  const createResult = await deps!.agencyCreator!.create_atomic({
    name,
    slug,
    contact_name,
    contact_phone,
    contact_email,
    created_by_user_id: verifyResult.user_id,
    owner_user_id,
    token_hash,
    can_publish_properties,
    can_advertise,
    advertiser_category,
  });

  if (!createResult.ok) {
    // Compensación: si se creó el owner en Auth pero la RPC falló, eliminar el usuario.
    if (owner_user_id && deps?.authAdmin) {
      try {
        await deps.authAdmin.deleteUser(owner_user_id);
      } catch {
        // best-effort: el error de compensación no reemplaza el error original
      }
    }

    const status = AGENCY_CREATE_ERROR_STATUS[createResult.error_code] ?? 500;
    if (status >= 500) {
      return error_response(
        createResult.error_code,
        "Error interno al crear la agencia",
        500,
      );
    }
    const message =
      AGENCY_CREATE_ERROR_MESSAGES[createResult.error_code] ??
      "Error al crear la agencia";
    return error_response(createResult.error_code, message, status);
  }

  // Construir respuesta de éxito (7.5: owner_user_id + invite_action_link;
  // 7.6: plain_token + token_id; 168.4: email_sent aditivo)
  const response_body: Record<string, string | boolean> = {
    agency_id: createResult.agency_id,
  };
  if (owner_user_id !== undefined) {
    response_body.owner_user_id = owner_user_id;
  }
  if (invite_action_link !== undefined) {
    response_body.invite_action_link = invite_action_link;
  }
  if (email_sent !== undefined) {
    response_body.email_sent = email_sent;
  }
  // plain_token: se devuelve al admin SOLO en la respuesta; NUNCA se persiste en BD.
  response_body.plain_token = plain_token;
  if (createResult.token_id !== undefined) {
    response_body.token_id = createResult.token_id;
  }

  return json_response(response_body, 201);
}
