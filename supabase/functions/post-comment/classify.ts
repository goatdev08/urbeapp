// supabase/functions/post-comment/classify.ts
// GREEN — subtarea 289.5. Filtro determinista mínimo: teléfono, email, URL/dominio,
// lista de palabras (app_config.comment_filter_words). Función PURA y TOTAL — sin I/O,
// nunca lanza. Ver classify.test.ts para la enumeración exhaustiva de edge cases (RED).

export type CommentClassification = "visible" | "held_for_review";

// ── Teléfono ───────────────────────────────────────────────────────────────────
// ≥8 dígitos en una misma "corrida" de caracteres permitidos: dígito, +, espacio,
// guion, punto, paréntesis. Cualquier otro carácter (letra, coma) CORTA la corrida
// — así "$2,500,000" (FP4) nunca acumula 8 dígitos en un mismo tramo y "2 recámaras
// y 3 baños" (FP2) queda en dos corridas de 1 dígito cada una.
const PHONE_RUN_CHARS = /[\d+().\-\s]+/g;
const PHONE_MIN_DIGITS = 8;

function has_phone(body: string): boolean {
  const runs = body.match(PHONE_RUN_CHARS);
  if (!runs) return false;
  return runs.some((run) => run.replace(/\D/g, "").length >= PHONE_MIN_DIGITS);
}

// ── Email ──────────────────────────────────────────────────────────────────────
// local@dominio.algo — sin whitelist de TLD (a diferencia de la regla de URL/dominio
// de abajo); EMAIL3 exige que el arroba tenga un LOCAL-PART y un DOMINIO con punto
// pegados, sin espacios de por medio.
const EMAIL_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/;

// ── URL / dominio ──────────────────────────────────────────────────────────────
// http(s)://, www., o "etiqueta.tld" con TLD de la lista mínima documentada en el RED
// (com|mx|net|org|io|co|info). El TLD debe ir PEGADO al punto (sin espacio) — así
// "p. ej." / "ok. perfecto" (FPURL1/2, con espacio tras el punto) y "5.5" (FPURL3,
// "5" no es un TLD de la lista) no matchean.
const URL_SCHEME_REGEX = /https?:\/\/\S+/i;
const WWW_REGEX = /\bwww\.\S+/i;
const BARE_DOMAIN_REGEX =
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|mx|net|org|io|co|info)\b/i;

function has_url_or_domain(body: string): boolean {
  return URL_SCHEME_REGEX.test(body) || WWW_REGEX.test(body) ||
    BARE_DOMAIN_REGEX.test(body);
}

// ── Lista de palabras (app_config.comment_filter_words) ────────────────────────
// Case-insensitive, sin acentos, palabra COMPLETA (\b...\b — "pago" no matchea
// "empapelado", WORD3).

function strip_diacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function escape_regex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function has_forbidden_word(body: string, words: string[]): boolean {
  if (words.length === 0) return false;
  const normalized_body = strip_diacritics(body.toLowerCase());
  for (const raw of words) {
    const word = strip_diacritics(raw.toLowerCase()).trim();
    if (word === "") continue;
    const pattern = new RegExp(`\\b${escape_regex(word)}\\b`);
    if (pattern.test(normalized_body)) return true;
  }
  return false;
}

// ── classify_comment ─────────────────────────────────────────────────────────
// Total: cualquier combinación de string/string[] (incluidos vacíos) devuelve un
// resultado, nunca lanza. Basta UNA regla para ir a 'held_for_review' (COMBO1).

export function classify_comment(
  body: string,
  words: string[] = [],
): CommentClassification {
  if (has_phone(body)) return "held_for_review";
  if (EMAIL_REGEX.test(body)) return "held_for_review";
  if (has_url_or_domain(body)) return "held_for_review";
  if (has_forbidden_word(body, words)) return "held_for_review";
  return "visible";
}
