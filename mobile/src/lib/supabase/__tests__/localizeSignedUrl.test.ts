/**
 * Tests fase RED — localizeSignedUrl (localizeSignedUrl.ts)
 * Subtarea Taskmaster: 68.16 — helper de frontera (CRÍTICA, src/lib/**)
 *
 * SUT: localizeSignedUrl(url: string): string
 *
 * POR QUÉ EXISTE ESTE HELPER (commit 829ab55, 2026-06-29):
 *   El stack local de Supabase corre en Docker y el edge runtime firma las URLs
 *   de Storage con su host INTERNO (`http://kong:8000`), inalcanzable desde un
 *   emulador o un teléfono. El helper reescribe ese origin al que sí alcanza el
 *   cliente (EXPO_PUBLIC_SUPABASE_URL).
 *
 * POR QUÉ SE ROMPIÓ (#68, Cloudflare Stream):
 *   El helper reescribía el origin de CUALQUIER URL. Cuando #68 movió el video a
 *   Cloudflare Stream, `https://videodelivery.net/<token>/manifest/video.m3u8`
 *   pasaba a `http://localhost:54321/<token>/manifest/video.m3u8` → HTTP 404 y el
 *   feed entero sin video. Rompía local Y remoto (allí quedaba apuntando al
 *   dominio de Supabase); el 402 del gateway lo mantuvo invisible.
 *
 * CONTRATO CORRECTO:
 *   Localizar SOLO las URLs servidas por el propio Supabase Storage (`/storage/v1/`).
 *   Cualquier otro origin —un CDN como Cloudflare Stream— se devuelve INTACTO.
 *
 * EDGE CASES CUBIERTOS (RED):
 *   EC-1  URL de Cloudflare Stream (HLS) → intacta                    [el bug]
 *   EC-2  URL de portada de Cloudflare (thumbnails) → intacta         [el bug]
 *   EC-3  URL de Storage firmada con el host interno de Docker → localizada
 *   EC-4  URL de Storage ya en el host configurado → idempotente
 *   EC-5  string vacío → devuelto tal cual (sin crash)
 *   EC-6  sin EXPO_PUBLIC_SUPABASE_URL → no-op (no hay a dónde localizar)
 */

const CLOUDFLARE_HLS =
  'https://videodelivery.net/eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhYmMifQ.firma/manifest/video.m3u8';
const CLOUDFLARE_POSTER =
  'https://videodelivery.net/eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhYmMifQ.firma/thumbnails/thumbnail.jpg?time=13.1s';
const STORAGE_PATH = '/storage/v1/object/sign/property-videos/uid/vid.mp4?token=abc';

/** Importa el SUT con el env dado — el origin se calcula al cargar el módulo. */
function load_sut(supabase_url?: string) {
  let sut!: typeof import('../localizeSignedUrl');
  jest.isolateModules(() => {
    const prev = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (supabase_url === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = supabase_url;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- el origin se calcula al cargar el módulo; hay que re-importarlo por cada env.
    sut = require('../localizeSignedUrl');
    if (prev === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = prev;
  });
  return sut.localizeSignedUrl;
}

describe('localizeSignedUrl', () => {
  describe('URLs de CDN externo (Cloudflare Stream) — NUNCA se tocan', () => {
    it('EC-1: deja intacta la URL HLS de Cloudflare Stream', () => {
      const localize = load_sut('http://localhost:54321');
      expect(localize(CLOUDFLARE_HLS)).toBe(CLOUDFLARE_HLS);
    });

    it('EC-2: deja intacta la URL de portada de Cloudflare Stream', () => {
      const localize = load_sut('http://localhost:54321');
      expect(localize(CLOUDFLARE_POSTER)).toBe(CLOUDFLARE_POSTER);
    });

    it('EC-1b: tampoco la toca apuntando a un Supabase remoto', () => {
      const localize = load_sut('https://mvpvqmyhrrkwbnpctpuq.supabase.co');
      expect(localize(CLOUDFLARE_HLS)).toBe(CLOUDFLARE_HLS);
    });
  });

  describe('URLs de Supabase Storage — se localizan (razón de ser del helper)', () => {
    it('EC-3: reescribe el host interno de Docker al host configurado', () => {
      const localize = load_sut('http://10.0.2.2:54321');
      expect(localize(`http://kong:8000${STORAGE_PATH}`)).toBe(
        `http://10.0.2.2:54321${STORAGE_PATH}`,
      );
    });

    it('EC-4: es idempotente si ya está en el host configurado', () => {
      const localize = load_sut('http://10.0.2.2:54321');
      const ya_localizada = `http://10.0.2.2:54321${STORAGE_PATH}`;
      expect(localize(ya_localizada)).toBe(ya_localizada);
    });
  });

  describe('bordes', () => {
    it('EC-5: devuelve el string vacío sin lanzar', () => {
      const localize = load_sut('http://localhost:54321');
      expect(localize('')).toBe('');
    });

    it('EC-6: sin EXPO_PUBLIC_SUPABASE_URL es no-op', () => {
      const localize = load_sut(undefined);
      expect(localize(`http://kong:8000${STORAGE_PATH}`)).toBe(
        `http://kong:8000${STORAGE_PATH}`,
      );
      expect(localize(CLOUDFLARE_HLS)).toBe(CLOUDFLARE_HLS);
    });
  });
});
