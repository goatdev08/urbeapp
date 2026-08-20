// supabase/functions/record-ad-impressions/handler.ts
// GREEN — subtarea 170.6. Orquestación HTTP pura + la lógica de elegibilidad
// (ad existe, status='active', deps.now() BETWEEN starts_at/ends_at) y la
// derivación del id (#193) viven AQUÍ, no detrás de un mock (lección de
// #73/169: el adaptador que las esconde es lo que se escapa con la suite en
// verde). Contrato completo, edge cases y SEAMS: ver types.ts y
// handler.test.ts.
//
// Fail-closed por item, nunca batch-wide: un item inválido/no elegible se
// cuenta como rechazado y el resto del batch se procesa igual (mismo
// criterio que mint-poster-urls / mint-ad-urls). 200 SIEMPRE que el batch
// se procesó (aunque algunos items se rechacen); solo excepciones NO
// controladas (deps ausente, adsRepository/writer que lanzan) llegan a 500.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  AdImpressionEventInput,
  AdRecord,
  ImpressionRow,
  RecordAdImpressionsDeps,
  RecordAdImpressionsResponse,
} from "./types.ts";
import { derive_impression_id, is_ad_viewed } from "./types.ts";

// Fix guardián 170.6 (V4a) — ad_id/session_id son columnas `uuid not null`
// en Postgres, no strings arbitrarios. Validarlas por FORMA aquí (antes de
// fetch_ads/upsert_impressions) es lo que permite el rechazo POR ITEM: un
// string no-uuid nunca llega a los adapters reales, que fallarían la
// llamada COMPLETA (22P02) por una sola fila. Ver
// ads_repo_uuid_validating/writer_uuid_validating en handler.test.ts.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function is_uuid_string(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Validación estructural mínima del item — malformado (ad_id/session_id
 * ausentes o sin formato uuid) se rechaza ANTES de llegar a fetch_ads. */
function is_well_formed_impression(item: unknown): item is AdImpressionEventInput {
  if (typeof item !== "object" || item === null) return false;
  const r = item as Record<string, unknown>;
  return (
    is_uuid_string(r.ad_id) &&
    is_uuid_string(r.session_id) &&
    typeof r.shown_at === "string" &&
    typeof r.watched_ms === "number" &&
    typeof r.lat === "number" &&
    typeof r.lng === "number"
  );
}

function is_well_formed_cta_tap(item: unknown): item is { ad_id: string; session_id: string; cta_tapped_at: string } {
  if (typeof item !== "object" || item === null) return false;
  const r = item as Record<string, unknown>;
  return is_uuid_string(r.ad_id) && is_uuid_string(r.session_id) && typeof r.cta_tapped_at === "string";
}

function is_ad_eligible(ad: AdRecord, now: Date): boolean {
  if (ad.status !== "active") return false;
  const starts_at = new Date(ad.starts_at);
  const ends_at = new Date(ad.ends_at);
  return starts_at.getTime() <= now.getTime() && now.getTime() <= ends_at.getTime();
}

export async function handler(req: Request, deps?: RecordAdImpressionsDeps): Promise<Response> {
  // 1. Preflight CORS
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  try {
    // 3. Auth (frontera de confianza): el uid SIEMPRE sale del JWT, nunca
    // del body. Fail-closed antes de tocar cualquier otro dependiente.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return error_response("UNAUTHENTICATED", "No autenticado", 401);
    }
    const caller = await deps!.callerVerifier.verify_caller(authHeader);
    if (!caller.ok) {
      return error_response("UNAUTHENTICATED", "No autenticado", 401);
    }
    const user_id = caller.user_id;

    // 4. Parse body JSON
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return error_response("INVALID_INPUT", "El cuerpo de la solicitud no es JSON válido", 400);
    }

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return error_response("INVALID_INPUT", "El cuerpo debe ser un objeto", 400);
    }
    const body = raw as Record<string, unknown>;

    const impressions_raw = body.impressions ?? [];
    if (!Array.isArray(impressions_raw)) {
      return error_response("INVALID_INPUT", "impressions debe ser un arreglo", 400);
    }
    const cta_taps_raw = body.cta_taps ?? [];
    if (!Array.isArray(cta_taps_raw)) {
      return error_response("INVALID_INPUT", "cta_taps debe ser un arreglo", 400);
    }

    // 5. Cuerpo vacío ({} o ambos []) — 200 sin tocar ningún dependiente.
    if (impressions_raw.length === 0 && cta_taps_raw.length === 0) {
      const empty: RecordAdImpressionsResponse = {
        impressions_accepted: 0,
        impressions_rejected: 0,
        cta_taps_recorded: 0,
        cta_taps_orphaned: 0,
      };
      return json_response(empty, 200);
    }

    // 6. Separar impresiones bien formadas de las malformadas (no llegan a
    // fetch_ads) — se cuentan como rechazadas de una vez.
    const well_formed: AdImpressionEventInput[] = [];
    let malformed_rejected = 0;
    for (const item of impressions_raw) {
      if (is_well_formed_impression(item)) {
        well_formed.push(item);
      } else {
        malformed_rejected++;
      }
    }

    // 7. Traer ads crudos (sin pre-filtrar) para todo el batch de una vez.
    const ad_ids = [...new Set(well_formed.map((i) => i.ad_id))];
    const ads = ad_ids.length > 0 ? await deps!.adsRepository.fetch_ads(ad_ids) : [];
    const ads_by_id = new Map(ads.map((a) => [a.id, a]));

    const now = deps!.now();
    const rows: ImpressionRow[] = [];
    let impressions_rejected = malformed_rejected;

    for (const item of well_formed) {
      const ad = ads_by_id.get(item.ad_id);
      if (!ad || !is_ad_eligible(ad, now)) {
        impressions_rejected++;
        continue;
      }

      let zone: { municipality_id: string | null; neighborhood_id: number | null };
      try {
        zone = await deps!.zoneResolver.resolve_zone(item.lat, item.lng);
      } catch {
        // ponytail: un resolver caído para 1 item rechaza SOLO ese item, no el batch.
        impressions_rejected++;
        continue;
      }

      const watched_ms = item.watched_ms;
      const row: ImpressionRow = {
        id: derive_impression_id(user_id, item.ad_id, item.session_id),
        ad_id: item.ad_id,
        agency_id: ad.agency_id,
        user_id,
        session_id: item.session_id,
        municipality_id: zone.municipality_id,
        neighborhood_id: zone.neighborhood_id,
        shown_at: item.shown_at,
        watched_ms,
        viewed: is_ad_viewed(watched_ms),
        completed: item.completed,
        device: item.device ?? null,
      };
      rows.push(row);
    }

    if (rows.length > 0) {
      await deps!.impressionsWriter.upsert_impressions(rows);
    }

    // 8. cta_taps — método EXCLUSIVO (id, cta_tapped_at); nunca dispara upsert_impressions.
    let cta_taps_recorded = 0;
    let cta_taps_orphaned = 0;
    for (const item of cta_taps_raw) {
      if (!is_well_formed_cta_tap(item)) continue;
      const id = derive_impression_id(user_id, item.ad_id, item.session_id);
      const affected = await deps!.impressionsWriter.record_cta_tap(id, item.cta_tapped_at);
      // #198: se cuenta lo que REALMENTE pasó, no lo que se intentó. Un tap
      // huérfano (0 filas) antes sumaba a cta_taps_recorded y el contador
      // mentía sobre un evento que se factura por clic.
      if (affected > 0) cta_taps_recorded++;
      else cta_taps_orphaned++;
    }

    const response: RecordAdImpressionsResponse = {
      impressions_accepted: rows.length,
      impressions_rejected,
      cta_taps_recorded,
      cta_taps_orphaned,
    };
    return json_response(response, 200);
  } catch {
    return error_response("INTERNAL_ERROR", "Error interno al registrar las impresiones", 500);
  }
}
