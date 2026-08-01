/**
 * deep-link-session.ts — parseo puro de deep links de auth + guard de
 * verificación de email (subtarea 72.3, verificación real de email).
 *
 * Ver EDGE CASES en __tests__/deep-link-session.test.ts.
 */
import type { Session } from '@supabase/supabase-js';

export type ParsedSessionFromUrl =
  | { kind: 'tokens'; access_token: string; refresh_token: string }
  | { kind: 'error'; error_code: string }
  | null;

/**
 * Extrae tokens de sesión o un código de error de una URL de deep link de
 * Supabase Auth (`urbea://verify-email#access_token=...&refresh_token=...`,
 * también acepta `?access_token=...` query-style, y errores
 * `#error=...&error_code=...`).
 *
 * ponytail: `URLSearchParams` sobre el substring de params en vez de `new
 * URL(url)` — el polyfill de URL de Hermes no parsea de forma fiable schemes
 * custom como `urbea://` (ver nota en lib/supabase/localizeSignedUrl.ts).
 * `URLSearchParams` solo trocea pares `clave=valor`, sin tocar scheme/host.
 */
export function parse_session_from_url(url: string): ParsedSessionFromUrl {
  const hash_index = url.indexOf('#');
  const query_index = url.indexOf('?');
  // Los tokens/errores de Supabase Auth viajan en el fragment; el fallback a
  // query-style es defensivo (algunos clientes de correo/navegadores comen el
  // fragment antes de reenviar el link).
  const params_index = hash_index !== -1 ? hash_index : query_index;
  if (params_index === -1) return null;

  const params = new URLSearchParams(url.slice(params_index + 1));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token !== null && refresh_token !== null) {
    return { kind: 'tokens', access_token, refresh_token };
  }

  const error = params.get('error');
  if (error !== null) {
    return { kind: 'error', error_code: params.get('error_code') ?? error };
  }

  return null;
}

/**
 * true si la sesión activa pertenece a un usuario cuyo email todavía NO está
 * confirmado (`email_confirmed_at` ausente) — el caller debe redirigir a
 * /verify-email en vez de dejarlo pasar al feed.
 */
export function should_redirect_to_verify_email(session: Session | null): boolean {
  if (session === null || session.user === undefined) return false;
  const email_confirmed_at = session.user.email_confirmed_at;
  return email_confirmed_at === null || email_confirmed_at === undefined;
}
