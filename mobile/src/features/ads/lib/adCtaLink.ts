/**
 * adCtaLink — destino del CTA de un anuncio y autolinkificación de su
 * descripción. Subtarea 170.8 + ampliación #192.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 DECISIÓN 1 DE #192 (Abraham, 2026-08-18): la descripción es TEXTO PLANO
 * con URLs detectadas, NUNCA markdown. EL TEXTO VISIBLE ES EL DESTINO.
 *
 * La razón no es estética. En un anuncio pagado, un markdown permitiría
 * `[tu banco de confianza](http://otra-cosa.example)`, que es exactamente el
 * vector de engaño contra el que el badge "Patrocinado" no alcanza a proteger.
 * Si lo que se ve es lo que se abre, no queda nada que falsificar. El
 * invariante está fijado por EC-10 (value === url en todo segmento link).
 *
 * 🔴 LA ALLOWLIST NO SE REIMPLEMENTA. Cada candidato a link pasa por
 * `validate_ad_cta('external_url', …)` — la función real de 169.6. Una segunda
 * regex de esquemas sería una segunda cosa que se puede desincronizar, y este
 * repo ya aprendió la lección con el literal AD_DURATION_INVALID compartido
 * entre cliente y servidor.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ponytail: sin dependencia de linkify — una regex de candidatos + la
 * validación que ya existe. Techo conocido: no detecta URLs sin esquema
 * ("ejemplo.mx" a secas) a propósito; adivinar el esquema sería inventar un
 * destino que el anunciante no escribió.
 */

import { validate_ad_cta } from './validation';

export interface CtaTarget {
  kind: 'external_url' | 'whatsapp' | 'phone';
  url: string;
}

export interface DescriptionSegment {
  kind: 'text' | 'link';
  value: string;
  url?: string;
}

/**
 * Destino real del botón del CTA, o null si el valor no es utilizable — en
 * cuyo caso el componente NO pinta el botón (mejor sin CTA que con un botón
 * que no abre nada).
 */
export function build_cta_target(
  cta_type: string,
  cta_value: string | null | undefined,
): CtaTarget | null {
  if (cta_type === 'external_url') {
    const check = validate_ad_cta('external_url', cta_value);
    return check.valid && check.normalized_value
      ? { kind: 'external_url', url: check.normalized_value }
      : null;
  }

  if (cta_type === 'whatsapp' || cta_type === 'phone') {
    // validate_ad_cta normaliza a solo dígitos y exige 10-15.
    const check = validate_ad_cta(cta_type, cta_value);
    if (!check.valid || !check.normalized_value) return null;
    // wa.me abre la app si está instalada y la web si no — mismo criterio que
    // features/property-detail/utils/whatsapp.ts, que ya lo razonó.
    return cta_type === 'whatsapp'
      ? { kind: 'whatsapp', url: `https://wa.me/${check.normalized_value}` }
      : { kind: 'phone', url: `tel:${check.normalized_value}` };
  }

  // cta_type llega como string desde la RPC: un valor fuera del enum es dato
  // corrupto, no una excepción. Sin CTA es un estado válido del componente.
  return null;
}

// Candidatos a link: una corrida sin espacios que arranque con http:// o
// https://. La validación real la hace validate_ad_cta; esto solo RECORTA.
const LINK_CANDIDATE = /https?:\/\/\S+/gi;

// Puntuación que casi siempre pertenece a la ORACIÓN, no a la URL. Se recorta
// del final del candidato para no abrir "https://ejemplo.mx." (EC-12). Los
// paréntesis y comillas de cierre entran por el mismo motivo.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»…]+$/;

/**
 * Parte la descripción en segmentos de texto y de link.
 *
 * 🔒 INVARIANTE (EC-14): concatenar los `value` de todos los segmentos
 * devuelve el texto original byte por byte. Nada se pierde, nada se duplica,
 * nada se reescribe — que es lo que hace verificable la promesa de "el texto
 * visible es el destino".
 */
export function linkify_description(text: string | null | undefined): DescriptionSegment[] {
  if (!text) return [];

  const segments: DescriptionSegment[] = [];
  let cursor = 0;

  // exec en bucle sobre una regex /g: se reinicia lastIndex creando la regex
  // por llamada, para que la función sea pura entre invocaciones.
  const pattern = new RegExp(LINK_CANDIDATE.source, 'gi');
  let match = pattern.exec(text);

  const push_text = (value: string): void => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === 'text') last.value += value;
    else segments.push({ kind: 'text', value });
  };

  while (match !== null) {
    const raw = match[0];
    const start = match.index;
    const candidate = raw.replace(TRAILING_PUNCTUATION, '');
    const check = validate_ad_cta('external_url', candidate);

    push_text(text.slice(cursor, start));

    if (check.valid && check.normalized_value === candidate) {
      // El texto visible ES el destino: se guarda el MISMO string en ambos.
      segments.push({ kind: 'link', value: candidate, url: candidate });
      push_text(raw.slice(candidate.length)); // la puntuación que se recortó
    } else {
      // No pasó la allowlist: se queda como texto plano, tal cual venía.
      push_text(raw);
    }

    cursor = start + raw.length;
    match = pattern.exec(text);
  }

  push_text(text.slice(cursor));
  return segments;
}
