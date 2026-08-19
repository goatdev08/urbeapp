import { createHash } from 'node:crypto';

// supabase/functions/record-ad-impressions/types.ts
// Tipos y contratos de DI para la Edge Function record-ad-impressions —
// subtarea 170.6. Solo interfaces + funciones PURAS (stub RED, sin lógica);
// sin imports de supabase-js (los adapters reales van en index.ts, GREEN).
// Calco deliberado del patrón DI de mint-ad-urls/types.ts (169.5).
//
// Responsabilidad de la EF (base FACTURABLE de #172 CPM/CPC) — contrato
// completo, edge cases y las decisiones de contrato: ver la cabecera de
// handler.test.ts (SEAMS + EDGE CASES) y la bitácora de la subtarea 170.6.
//
// Resumen:
//   1. Auth: uid SIEMPRE del JWT (CallerVerifier), nunca del body.
//   2. Batch fire-and-forget con DOS listas independientes: `impressions` y
//      `cta_taps`.
//   3. 🔴 #193: el `id` de cada fila se DERIVA (derive_impression_id), NUNCA
//      lo manda el cliente. `id`/`user_id` en el payload se ignoran en
//      silencio.
//   4. Elegibilidad (ad existe, status='active', deps.now() BETWEEN
//      starts_at/ends_at) vive EN el handler — AdsRepository solo trae
//      datos crudos, sin pre-filtrar.
//   5. Zona SIEMPRE recalculada vía ZoneResolver.resolve_zone(lat, lng); lo
//      que declare el cliente se descarta.
//   6. `viewed` SIEMPRE derivado de is_ad_viewed(watched_ms).
//   7. Escritura por DOS métodos con firmas distintas: upsert_impressions
//      (fila completa) y record_cta_tap(id, cta_tapped_at) — este último
//      estructuralmente no puede tocar watched_ms/viewed/completed.
//   8. Fail-closed POR ITEM, nunca batch-wide; 200 siempre, nunca revela
//      "fila nueva" vs "fila ya existente".

// ── CallerVerifier — mismo contrato que mint-ad-urls / mint-poster-urls ────

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── Derivación pura del id (#193) ───────────────────────────────────────────

/**
 * Namespace fijo del proyecto para uuid v5 (RFC 4122) — constante, jamás
 * cambia una vez desplegado: cambiarla invalidaría de golpe la idempotencia
 * de TODAS las impresiones ya escritas (el mismo trío produciría un id
 * distinto). Generada una sola vez para esta subtarea (170.6).
 */
export const AD_IMPRESSION_ID_NAMESPACE = "45eeb944-da5b-442f-8139-0a2bc3efe50b";


function uuid_string_to_bytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytes_to_uuid_string(bytes: Uint8Array): string {
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * id = uuid_v5(AD_IMPRESSION_ID_NAMESPACE, `${user_id}:${ad_id}:${session_id}`).
 * `user_id` SIEMPRE es el `sub` del JWT del caller, NUNCA un valor del
 * payload. Determinista: el mismo trío produce SIEMPRE el mismo id;
 * cambiar cualquiera de los tres produce un id distinto (RFC 4122 §4.3).
 * Valores esperados verificados de forma independiente con
 * `python3 -c "import uuid; print(uuid.uuid5(...))"` — ver handler.test.ts.
 */
export function derive_impression_id(user_id: string, ad_id: string, session_id: string): string {
  const namespace_bytes = uuid_string_to_bytes(AD_IMPRESSION_ID_NAMESPACE);
  const name_bytes = new TextEncoder().encode(`${user_id}:${ad_id}:${session_id}`);
  const combined = new Uint8Array(namespace_bytes.length + name_bytes.length);
  combined.set(namespace_bytes);
  combined.set(name_bytes, namespace_bytes.length);

  const hash = new Uint8Array(createHash('sha1').update(combined).digest());
  const uuid_bytes = hash.slice(0, 16);
  // RFC 4122 §4.3: version 5, variant RFC 4122.
  uuid_bytes[6] = (uuid_bytes[6] & 0x0f) | 0x50;
  uuid_bytes[8] = (uuid_bytes[8] & 0x3f) | 0x80;
  return bytes_to_uuid_string(uuid_bytes);
}

// ── Umbral de "viewed" (#193 — la EF es la fuente de verdad, no existía) ───

/** watched_ms >= este umbral ⇒ viewed=true. Paridad con YouTube (cuenta vista a los 3s). */
export const VIEWED_THRESHOLD_MS = 3000;

/** true solo si watched_ms es un número finito >= VIEWED_THRESHOLD_MS. */
export function is_ad_viewed(watched_ms: number): boolean {
  return Number.isFinite(watched_ms) && watched_ms >= VIEWED_THRESHOLD_MS;
}

// ── Ads — datos crudos, sin pre-filtrar (la decisión de elegibilidad vive en el handler) ──

export interface AdRecord {
  id: string;
  agency_id: string;
  status: "draft" | "pending_review" | "active" | "paused" | "expired" | "rejected";
  starts_at: string; // ISO
  ends_at: string; // ISO
}

export interface AdsRepository {
  /** Trae los ads solicitados TAL CUAL están en la tabla `ads`, sin filtrar
   * por status ni vigencia. Un ad_id que no existe simplemente NO aparece
   * en el array devuelto (el handler lo trata como inexistente). */
  fetch_ads(ad_ids: string[]): Promise<AdRecord[]>;
}

// ── Zona — SIEMPRE recalculada por coordenadas ──────────────────────────────

export interface ResolvedZone {
  municipality_id: string | null;
  neighborhood_id: number | null;
}

export interface ZoneResolver {
  /** Resuelve SIEMPRE por coordenadas (lat, lng) — nunca recibe ni conoce
   * el municipality_id/neighborhood_id que el cliente haya declarado. */
  resolve_zone(lat: number, lng: number): Promise<ResolvedZone>;
}

// ── Escritura — dos métodos con firmas deliberadamente distintas ───────────

export interface ImpressionRow {
  id: string;
  ad_id: string;
  agency_id: string;
  user_id: string;
  session_id: string;
  municipality_id: string | null;
  neighborhood_id: number | null;
  shown_at: string;
  watched_ms: number;
  viewed: boolean;
  completed: boolean;
  device: string | null;
}

export interface ImpressionsWriter {
  /** Upsert del batch de impresiones (fila completa). Idempotente por id
   * derivado + unique(user_id, ad_id, session_id) — reenviar el mismo
   * batch NUNCA duplica ni reescribe una fila ya escrita (ver
   * supabase/tests/54_*). */
  upsert_impressions(rows: ImpressionRow[]): Promise<void>;
  /** Upsert EXCLUSIVO del tap al CTA. La firma SOLO acepta (id,
   * cta_tapped_at): estructuralmente no puede tocar watched_ms/viewed/
   * completed porque el método no los recibe. */
  record_cta_tap(id: string, cta_tapped_at: string): Promise<void>;
}

// ── Input crudo del cliente (batch) ─────────────────────────────────────────

export interface AdImpressionEventInput {
  ad_id: string;
  session_id: string;
  shown_at: string; // ISO, informativo — la elegibilidad usa deps.now(), NUNCA shown_at
  watched_ms: number;
  completed: boolean;
  lat: number;
  lng: number;
  device?: string | null;
  // Campos que el cliente PUEDE mandar pero la EF ignora en silencio (#193):
  id?: unknown;
  user_id?: unknown;
  viewed?: unknown;
  municipality_id?: unknown;
  neighborhood_id?: unknown;
}

export interface AdCtaTapInput {
  ad_id: string;
  session_id: string;
  cta_tapped_at: string; // ISO
  // Ignorados en silencio, igual que en AdImpressionEventInput:
  id?: unknown;
  user_id?: unknown;
}

export interface RecordAdImpressionsInput {
  impressions: AdImpressionEventInput[];
  cta_taps: AdCtaTapInput[];
}

// ── Deps inyectables del handler ────────────────────────────────────────────

export interface RecordAdImpressionsDeps {
  callerVerifier: CallerVerifier;
  adsRepository: AdsRepository;
  zoneResolver: ZoneResolver;
  impressionsWriter: ImpressionsWriter;
  /** Reloj inyectable — la elegibilidad por vigencia (now BETWEEN starts_at
   * AND ends_at) debe ser determinista y testeable en el boundary exacto. */
  now: () => Date;
}

// ── Shape de respuesta 200 — NUNCA distingue fila nueva de fila ya existente ─

export interface RecordAdImpressionsResponse {
  impressions_accepted: number;
  impressions_rejected: number;
  cta_taps_recorded: number;
}
