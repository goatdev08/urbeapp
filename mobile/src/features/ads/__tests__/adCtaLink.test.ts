/**
 * RED — subtarea 170.8 + #192: destino del CTA y autolinkificación de la
 * descripción del anuncio.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DECISIÓN 1 DE #192 (Abraham, 2026-08-18): la descripción es TEXTO PLANO con
 * URLs detectadas, NO markdown. 🔴 El texto visible tiene que SER el destino.
 * La razón no es estética: en un anuncio pagado, un `[banco seguro](http://
 * otra-cosa)` es exactamente el vector de engaño que un markdown permitiría, y
 * el badge "Patrocinado" no alcanza para compensarlo. Si lo que se ve es lo
 * que se abre, no hay nada que falsificar.
 *
 * 🔴 MISMA ALLOWLIST, NO UNA COPIA: cada link candidato pasa por
 * `validate_ad_cta('external_url', …)` — la función real de 169.6, no una
 * regex paralela. Una segunda implementación de la allowlist es una segunda
 * cosa que se puede desincronizar, y el precedente del repo es claro
 * (`AD_DURATION_INVALID` compartido cliente/servidor).
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── Edge cases ──────────────────────────────────────────────────────────────
 *  build_cta_target
 *   EC-1  external_url válida → se abre tal cual (normalizada por la allowlist).
 *   EC-2  🔒 external_url con esquema prohibido (javascript:, data:) → null.
 *   EC-3  whatsapp → wa.me con SOLO los dígitos.
 *   EC-4  phone → tel: con solo los dígitos.
 *   EC-5  valor inválido en cualquiera de los tres → null (el CTA no se pinta).
 *   EC-6  cta_type desconocido (la columna es un enum de la base, pero llega
 *         como string al cliente) → null, nunca throw.
 *
 *  linkify_description
 *   EC-7  texto sin URLs → un solo segmento de texto.
 *   EC-8  URL al inicio, en medio y al final.
 *   EC-9  dos URLs en el mismo texto.
 *   EC-10 🔒 EL TEXTO VISIBLE ES EL DESTINO: para TODO segmento link,
 *         value === url. Es el invariante de la decisión 1.
 *   EC-11 🔒 javascript: y data: NO se linkifican — quedan como texto.
 *   EC-12 puntuación final pegada a la URL no se traga.
 *   EC-13 vacío / null → [].
 *   EC-14 🔒 RECONSTRUCCIÓN EXACTA: concatenar los `value` de todos los
 *         segmentos devuelve el texto original, byte por byte. Sin esto, un
 *         bug que se comiera o duplicara un fragmento pasaría desapercibido.
 */

import { build_cta_target, linkify_description } from '../lib/adCtaLink';

describe('build_cta_target', () => {
  it('(EC-1) external_url válida se abre tal cual', () => {
    expect(build_cta_target('external_url', 'https://ejemplo.mx/promo')).toEqual({
      kind: 'external_url',
      url: 'https://ejemplo.mx/promo',
    });
  });

  it('(EC-1b) recorta los extremos, igual que la allowlist', () => {
    expect(build_cta_target('external_url', '  https://ejemplo.mx/promo  ')?.url).toBe(
      'https://ejemplo.mx/promo',
    );
  });

  it('(EC-2) 🔒 esquema prohibido → null, el CTA no se pinta', () => {
    expect(build_cta_target('external_url', 'javascript:alert(1)')).toBeNull();
    expect(build_cta_target('external_url', 'data:text/html,<script>')).toBeNull();
    expect(build_cta_target('external_url', 'https://')).toBeNull();
  });

  it('(EC-3) whatsapp → wa.me con solo los dígitos', () => {
    expect(build_cta_target('whatsapp', '+52 33 1234 5678')).toEqual({
      kind: 'whatsapp',
      url: 'https://wa.me/523312345678',
    });
  });

  it('(EC-4) phone → tel: con solo los dígitos', () => {
    expect(build_cta_target('phone', '+52 (33) 1234-5678')).toEqual({
      kind: 'phone',
      url: 'tel:523312345678',
    });
  });

  it('(EC-5) valores inválidos → null en los tres tipos', () => {
    expect(build_cta_target('external_url', '')).toBeNull();
    expect(build_cta_target('whatsapp', '123')).toBeNull();
    expect(build_cta_target('phone', null)).toBeNull();
  });

  it('(EC-6) cta_type desconocido → null, nunca lanza', () => {
    expect(build_cta_target('carrier_pigeon', 'https://ejemplo.mx')).toBeNull();
  });
});

describe('linkify_description', () => {
  it('(EC-7) texto sin URLs → un solo segmento de texto', () => {
    expect(linkify_description('Créditos hipotecarios a tu medida.')).toEqual([
      { kind: 'text', value: 'Créditos hipotecarios a tu medida.' },
    ]);
  });

  it('(EC-8) URL en medio del texto', () => {
    expect(linkify_description('Visita https://ejemplo.mx hoy')).toEqual([
      { kind: 'text', value: 'Visita ' },
      { kind: 'link', value: 'https://ejemplo.mx', url: 'https://ejemplo.mx' },
      { kind: 'text', value: ' hoy' },
    ]);
  });

  it('(EC-8b) URL al inicio y al final', () => {
    const at_start = linkify_description('https://ejemplo.mx es el sitio');
    expect(at_start[0]).toEqual({ kind: 'link', value: 'https://ejemplo.mx', url: 'https://ejemplo.mx' });

    const at_end = linkify_description('el sitio es https://ejemplo.mx');
    expect(at_end[at_end.length - 1]).toEqual({
      kind: 'link',
      value: 'https://ejemplo.mx',
      url: 'https://ejemplo.mx',
    });
  });

  it('(EC-9) dos URLs en el mismo texto', () => {
    const segments = linkify_description('a https://uno.mx b http://dos.mx c');
    expect(segments.filter((s) => s.kind === 'link').map((s) => s.value)).toEqual([
      'https://uno.mx',
      'http://dos.mx',
    ]);
  });

  it('(EC-10) 🔒 EL TEXTO VISIBLE ES EL DESTINO — value === url en todo link', () => {
    const segments = linkify_description('a https://uno.mx b http://dos.mx c https://tres.mx');
    const links = segments.filter((s) => s.kind === 'link');
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.url).toBe(link.value);
    }
  });

  it('(EC-11) 🔒 javascript: y data: NO se linkifican — se quedan como texto', () => {
    // ⚠️ HONESTIDAD SOBRE ESTE ASSERT: pasa por la regex de CANDIDATOS (que
    // solo reconoce http/https), no por la allowlist. Verificado por mutación:
    // quitar la validación deja este test en verde. Sigue valiendo la pena
    // —fija que el esquema peligroso no se abre— pero el assert que defiende
    // la allowlist es el EC-11b de abajo.
    const segments = linkify_description('ojo javascript:alert(1) y data:text/html,x');
    expect(segments.filter((s) => s.kind === 'link')).toHaveLength(0);
  });

  it('(EC-11b) 🔒 un candidato http SIN HOST no se linkifica — este SÍ depende de la allowlist', () => {
    // "https://" a secas pasa la regex de candidatos y solo lo rechaza
    // validate_ad_cta. Es el assert que muere si alguien quita esa validación.
    const segments = linkify_description('roto: https://. fin');
    expect(segments.filter((s) => s.kind === 'link')).toHaveLength(0);
    expect(segments.map((s) => s.value).join('')).toBe('roto: https://. fin');
  });

  it('(EC-12) la puntuación final no se traga en el link', () => {
    const segments = linkify_description('Entra a https://ejemplo.mx.');
    const link = segments.find((s) => s.kind === 'link');
    expect(link?.value).toBe('https://ejemplo.mx');
    expect(segments[segments.length - 1]).toEqual({ kind: 'text', value: '.' });
  });

  it('(EC-13) vacío o null → []', () => {
    expect(linkify_description('')).toEqual([]);
    expect(linkify_description(null)).toEqual([]);
    expect(linkify_description(undefined)).toEqual([]);
  });

  it('(EC-14) 🔒 RECONSTRUCCIÓN EXACTA: unir los value devuelve el texto original', () => {
    const originals = [
      'Créditos hipotecarios a tu medida.',
      'Visita https://ejemplo.mx hoy',
      'a https://uno.mx b http://dos.mx c',
      'Entra a https://ejemplo.mx.',
      'ojo javascript:alert(1) y data:text/html,x',
      'https://ejemplo.mx',
    ];
    for (const original of originals) {
      expect(linkify_description(original).map((s) => s.value).join('')).toBe(original);
    }
  });
});
