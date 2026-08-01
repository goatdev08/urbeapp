/**
 * deep-link-session.ts — parseo puro de deep links de auth + guard de
 * verificación de email (subtarea 72.3, verificación real de email).
 *
 * STUB fase RED: ambas funciones lanzan `not_implemented`. Sin lógica real —
 * la implementa la fase GREEN. Ver EDGE CASES en
 * __tests__/deep-link-session.test.ts.
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
 */
export function parse_session_from_url(_url: string): ParsedSessionFromUrl {
  throw new Error('not_implemented');
}

/**
 * true si la sesión activa pertenece a un usuario cuyo email todavía NO está
 * confirmado (`email_confirmed_at` ausente) — el caller debe redirigir a
 * /verify-email en vez de dejarlo pasar al feed.
 */
export function should_redirect_to_verify_email(_session: Session | null): boolean {
  throw new Error('not_implemented');
}
