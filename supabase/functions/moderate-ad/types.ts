// supabase/functions/moderate-ad/types.ts
// Contrato DI de la Edge Function moderate-ad (subtarea #208.1).
//
// 🔴 QUÉ **NO** VIVE AQUÍ, A PROPÓSITO. La validez de una transición de estado
// de un anuncio NO se decide en TypeScript. La única autoridad es el trigger
// `handle_ad_status_change()` (20260816000006 + 20260818000001): valida el
// grafo {draft→pending_review, pending_review→active, active→{paused,expired,
// rejected}, paused→active}, bloquea activar bajo una organización suspendida,
// aplica D2 "pausar el reloj" y escribe `admin_actions` en la MISMA
// transacción. Esta EF hace UN UPDATE y traduce lo que el trigger conteste.
//
// Duplicar el grafo acá crearía dos copias de una regla de negocio que ya se
// desincronizaron una vez en este repo (#183, la ventana del reaper). Y
// escribir `admin_actions` desde la EF duplicaría la fila que el trigger ya
// inserta — la auditoría quedaría contando doble sobre un acto facturable.

import type { AdminVerifier } from "../_shared/admin_auth.ts";

/**
 * Las decisiones que un admin toma sobre un anuncio. `approve`/`reject` nacen
 * de la moderación de `pending_review` (#208.1). `pause`/`resume` son el
 * takedown de un anuncio YA `active` (#210): pausar no es lo mismo que
 * rechazar (rechazar es terminal, pausar es reversible) y por eso es acción
 * propia — aunque a nivel de grafo `approve` y `resume` manden el MISMO
 * next_status ('active'), son código de acción distinto porque la semántica
 * de origen difiere (aprobar desde pending_review vs. reanudar desde paused).
 */
export type ModerateAdAction = "approve" | "reject" | "pause" | "resume";

export interface ModerateAdInput {
  ad_id: string;
  action: ModerateAdAction;
  /** Obligatorio si y solo si action === 'reject' (CHECK ads_rejection_reason_matches_status). */
  rejection_reason?: string;
}

/**
 * Códigos que el WRITER puede devolver. Nacen de la base: el trigger los lanza
 * como P0001 y el adaptador los reconoce. `DB_ERROR` es el cajón de todo lo
 * demás (→ 500).
 */
export type AdModerationErrorCode =
  | "AD_NOT_FOUND"
  | "INVALID_AD_STATUS_TRANSITION"
  | "ORGANIZATION_SUSPENDED"
  /**
   * #210.2: el trigger `handle_ad_status_change()` (20260823000002) lanza
   * P0001 con este código cuando `resume` intenta reactivar un anuncio con
   * `paused_by_suspension=true` — esa reactivación es EXCLUSIVA de la
   * cascada de organización (#211), no de un click de admin sobre el anuncio.
   */
  | "AD_PAUSED_BY_SUSPENSION"
  | "DB_ERROR";

export type AdModerationResult =
  | { ok: true; status: "active" | "rejected" | "paused" }
  | { ok: false; error_code: AdModerationErrorCode };

export interface AdModerationWriteParams {
  ad_id: string;
  /** Estado destino. `rejected` viaja siempre acompañado de rejection_reason. */
  next_status: "active" | "rejected" | "paused";
  /** null cuando se aprueba — el CHECK de la base lo exige así. */
  rejection_reason: string | null;
  /** Admin resuelto por el verificador; el trigger lo usa vía resolve_admin_actor. */
  admin_id: string;
}

export interface AdModerationWriter {
  moderate(params: AdModerationWriteParams): Promise<AdModerationResult>;
}

export interface ModerateAdDeps {
  adminVerifier: AdminVerifier;
  moderationWriter: AdModerationWriter;
}
