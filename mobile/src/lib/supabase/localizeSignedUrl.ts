/**
 * Reescribe el origin (scheme://host:port) de una URL firmada por la Edge
 * Function `mint-video-url` para que apunte al mismo host que el cliente Supabase
 * configurado en `EXPO_PUBLIC_SUPABASE_URL`.
 *
 * Por qué: el edge runtime local firma con su host interno de Docker
 * (`http://kong:8000`), inalcanzable desde el emulador Android. El emulador llega
 * al stack vía `http://10.0.2.2:54321`. En remoto el host firmado YA es el host
 * público (== el configurado), así que esto es un no-op.
 *
 * ponytail: regex de origin en vez de `new URL().origin` — el polyfill de URL en
 * Hermes no expone `.origin` de forma fiable. Techo: asume que el video se sirve
 * desde el mismo origin que la API (cierto en Urbea; cambiaría con un CDN aparte).
 */
const ORIGIN_RE = /^https?:\/\/[^/]+/;

const SUPABASE_ORIGIN =
  (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').match(ORIGIN_RE)?.[0] ?? null;

export function localizeSignedUrl(url: string): string {
  if (!SUPABASE_ORIGIN || !url) return url;
  return url.replace(ORIGIN_RE, SUPABASE_ORIGIN);
}
