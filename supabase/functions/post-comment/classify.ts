// supabase/functions/post-comment/classify.ts
// STUB — fase RED, subtarea 289.5. Lanza SIEMPRE `not_implemented` a propósito: el
// GREEN implementa la lógica real (regex teléfono/email/URL + lista de palabras de
// app_config.comment_filter_words). Solo firma — sin lógica.
//
// Contrato (ver classify.test.ts para la enumeración exhaustiva de casos):
//   classify_comment(body, words) → 'held_for_review' si body matchea teléfono
//   (≥8 dígitos con separadores espacio/guion/punto/paréntesis/+), email
//   (usuario@dominio.tld), URL/dominio (http(s)://, www., o dominio.tld con TLD de
//   la lista mínima com|mx|net|org|io|co|info), o alguna palabra de `words`
//   (case-insensitive, sin acentos, palabra completa) — si no, 'visible'.
//   Función TOTAL: nunca lanza para ningún input string/string[] válido.

export type CommentClassification = "visible" | "held_for_review";

export function classify_comment(
  _body: string,
  _words: string[] = [],
): CommentClassification {
  throw new Error("not_implemented");
}
