/**
 * Reescribe el origin (scheme://host:port) de una URL firmada de **Supabase
 * Storage** para que apunte al host que el cliente tiene configurado en
 * `EXPO_PUBLIC_SUPABASE_URL`.
 *
 * Por qué: el edge runtime local firma con su host interno de Docker
 * (`http://kong:8000`), inalcanzable desde el emulador Android. El emulador llega
 * al stack vía `http://10.0.2.2:54321`. En remoto el host firmado YA es el host
 * público (== el configurado), así que esto es un no-op.
 *
 * 🔴 SOLO se localizan URLs de Supabase Storage (path `/storage/v1/`). Cualquier
 * otro origin —en particular el CDN de Cloudflare Stream, `videodelivery.net`—
 * se devuelve INTACTO. Antes se reescribía el origin de CUALQUIER URL, lo cual
 * era inofensivo mientras el video vivía en Storage (mismo origin que la API),
 * pero al migrar el video a Stream (#68) convirtió cada URL HLS en un 404: el
 * feed y el detalle quedaron sin video en local Y en remoto (#68.16). El 402 del
 * gateway remoto mantuvo el daño invisible.
 *
 * ponytail: regex de origin en vez de `new URL().origin` — el polyfill de URL en
 * Hermes no expone `.origin` de forma fiable.
 */
const ORIGIN_RE = /^https?:\/\/[^/]+/;

/** Marca inequívoca de una URL servida por el propio Supabase Storage. */
const STORAGE_URL_RE = /^https?:\/\/[^/]+\/storage\/v1\//;

const SUPABASE_ORIGIN =
  (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').match(ORIGIN_RE)?.[0] ?? null;

export function localizeSignedUrl(url: string): string {
  if (!SUPABASE_ORIGIN || !url) return url;
  if (!STORAGE_URL_RE.test(url)) return url;
  return url.replace(ORIGIN_RE, SUPABASE_ORIGIN);
}
