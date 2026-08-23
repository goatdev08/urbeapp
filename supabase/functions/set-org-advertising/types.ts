// supabase/functions/set-org-advertising/types.ts
// Contrato DI de la Edge Function set-org-advertising (subtarea #209.1).
//
// 🔴 QUÉ **NO** VIVE AQUÍ, A PROPÓSITO. `set_org_advertising_atomic`
// (20260815000002, extendida en 20260816000003) es la ÚNICA autoridad sobre
// si encender `can_advertise` es válido: exige `advertiser_category` cuando
// `p_enabled=true` (CHECK `agencies_categoria_requerida_para_anunciar`) y
// audita en `admin_actions` en la MISMA transacción. Este handler manda UNA
// llamada al writer y traduce lo que conteste — igual que moderate-ad/types.ts
// con `moderate_ad_atomic`. Reimplementar "si enabled entonces category
// requerida" en TypeScript crearía una segunda copia de una regla que ya vive
// en un CHECK + un `raise exception` explícito en la RPC.

import type { AdminVerifier } from "../_shared/admin_auth.ts";

/**
 * Valores del enum `public.advertiser_category` (20260815000001:23-24). Se
 * fija aquí SOLO para poder rechazar un string que jamás podría ser un valor
 * válido del enum ANTES de gastar un roundtrip a la base — nunca para decidir
 * si la categoría es obligatoria (esa es la RPC, vía ADVERTISER_CATEGORY_REQUIRED).
 */
export const ADVERTISER_CATEGORIES = [
  "credito_hipotecario",
  "seguros",
  "mudanzas",
  "limpieza",
  "notaria",
  "avaluos",
  "otro",
] as const;

export type AdvertiserCategory = typeof ADVERTISER_CATEGORIES[number];

export interface SetOrgAdvertisingInput {
  agency_id: string;
  enabled: boolean;
  /** Requerida si y solo si enabled === true (CHECK agencies_categoria_requerida_para_anunciar). */
  category?: AdvertiserCategory;
}

/**
 * Códigos que el WRITER puede devolver. Nacen de la base: la RPC los lanza
 * como P0001 y el adaptador los reconoce. `DB_ERROR` es el cajón de todo lo
 * demás (→ 500).
 */
export type OrgAdvertisingErrorCode =
  | "AGENCY_NOT_FOUND"
  | "ADVERTISER_CATEGORY_REQUIRED"
  | "DB_ERROR";

export type OrgAdvertisingResult =
  | { ok: true }
  | { ok: false; error_code: OrgAdvertisingErrorCode };

export interface OrgAdvertisingWriteParams {
  agency_id: string;
  enabled: boolean;
  /** null cuando el body no la mandó — la RPC decide si eso es válido. */
  category: AdvertiserCategory | null;
  /** Admin resuelto por el verificador; la RPC lo usa vía resolve_admin_actor. */
  admin_id: string;
}

export interface OrgAdvertisingWriter {
  set(params: OrgAdvertisingWriteParams): Promise<OrgAdvertisingResult>;
}

export interface SetOrgAdvertisingDeps {
  adminVerifier: AdminVerifier;
  orgAdvertisingWriter: OrgAdvertisingWriter;
}
