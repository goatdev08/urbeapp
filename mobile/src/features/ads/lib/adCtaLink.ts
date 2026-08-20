/** STUB (RED de 170.8/#192) — sin implementación. */

export interface CtaTarget {
  kind: 'external_url' | 'whatsapp' | 'phone';
  url: string;
}

export interface DescriptionSegment {
  kind: 'text' | 'link';
  value: string;
  url?: string;
}

export function build_cta_target(_cta_type: string, _cta_value: string | null | undefined): CtaTarget | null {
  return null;
}

export function linkify_description(_text: string | null | undefined): DescriptionSegment[] {
  return [];
}
