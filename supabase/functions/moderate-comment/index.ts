// supabase/functions/moderate-comment/index.ts
// Entry point de producción — subtarea 289.6. Construye las dependencias
// reales e inyecta al handler puro. Se mantiene DELGADO a propósito (mismo
// patrón que moderate-property/index.ts, post-comment/index.ts): la lógica de
// decisión vive en handler.ts, con su propia suite DI.
//
// adminVerifier reusa make_admin_verifier (_shared/clients.ts) SIN cambios —
// MISMO adaptador que moderate-property, sobre service_client() (lee
// public.users con service_role). Es solo un chequeo fail-fast de UX en el
// borde: la RPC vuelve a verificar private.is_admin() de forma independiente.
//
// resolutionWriter es NUEVO: llama resolve_comment_reports_atomic con
// user_client(admin_jwt) — el JWT del caller reenviado tal cual — porque la
// RPC (20260910200001) NO recibe p_admin_id: el actor es SIEMPRE auth.uid()
// (decisión (d) de la migración). NUNCA service_client() + un p_admin_id
// aparte (a diferencia de make_reports_resolution_writer para propiedades).

import { handler } from "./handler.ts";
import {
  make_admin_verifier,
  service_client,
  user_client,
} from "../_shared/clients.ts";
import type {
  CommentResolutionErrorCode,
  CommentResolutionWriteParams,
  CommentResolutionWriteResult,
  CommentResolutionWriter,
  ModerateCommentDeps,
} from "./types.ts";

// Códigos de negocio que resolve_comment_reports_atomic levanta con SQLSTATE
// P0001 (mensaje = código, calco extract_register_code/extract_redeem_code
// de _shared/clients.ts). Cualquier mensaje que no matchee ninguno cae en
// 'DB_ERROR' — fail-closed, el handler ya lo traduce a 500 genérico.
const COMMENT_RESOLUTION_CODES: CommentResolutionErrorCode[] = [
  "ADMIN_REQUIRED",
  "COMMENT_NOT_FOUND",
  "INVALID_ACTION",
];

function extract_comment_resolution_code(
  message: string,
): CommentResolutionErrorCode {
  return COMMENT_RESOLUTION_CODES.find((c) => message.includes(c)) ??
    "DB_ERROR";
}

function make_comment_resolution_writer(): CommentResolutionWriter {
  return {
    async resolve(
      params: CommentResolutionWriteParams,
    ): Promise<CommentResolutionWriteResult> {
      const client = user_client(params.admin_jwt);
      const { error } = await client.rpc("resolve_comment_reports_atomic", {
        p_comment_id: params.comment_id,
        p_action: params.action,
        p_reason: params.reason,
      });
      if (error) {
        return {
          ok: false,
          error_code: extract_comment_resolution_code(error.message),
          message: error.message,
        };
      }
      return { ok: true };
    },
  };
}

Deno.serve((req: Request) => {
  const deps: ModerateCommentDeps = {
    adminVerifier: make_admin_verifier(service_client()),
    resolutionWriter: make_comment_resolution_writer(),
  };
  return handler(req, deps);
});
