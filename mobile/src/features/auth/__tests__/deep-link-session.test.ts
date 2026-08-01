/**
 * Tests fase RED — deep-link-session.ts (subtarea 72.3, verificación real de
 * email). Archivo SUT: mobile/src/features/auth/deep-link-session.ts (stub
 * que LANZA 'not_implemented').
 *
 * Seam bajo test: la firma pública `parse_session_from_url(url)` y
 * `should_redirect_to_verify_email(session)` — dos funciones puras, sin
 * fronteras de sistema que mockear.
 *
 * Contrato (ver bitácora 72.3):
 *   parse_session_from_url:
 *     - tokens en el FRAGMENT (`#access_token=...&refresh_token=...`) → {kind:'tokens', ...}
 *     - también acepta query-style (`?access_token=...&refresh_token=...`)
 *     - falta uno de los dos tokens → null
 *     - URL sin nada de auth → null
 *     - error en fragment/query (`error`/`error_code`) → {kind:'error', error_code}
 *       - sin error_code (solo `error=access_denied`) → error_code cae a 'access_denied'
 *     - tokens + basura extra en la URL → tokens (ignora lo demás)
 *   should_redirect_to_verify_email:
 *     - null → false (el guard de login existente ya cubre "sin sesión")
 *     - session sin email_confirmed_at (undefined) → true
 *     - session con email_confirmed_at null → true
 *     - session con email_confirmed_at con fecha ISO → false
 *
 * EDGE CASES (RED):
 *
 * ### Happy path — parse_session_from_url
 * - DL-1: fragment completo (`urbea://verify-email#access_token=AT&refresh_token=RT&type=signup`) → {kind:'tokens', access_token:'AT', refresh_token:'RT'}
 * - DL-2: query-style (`urbea://verify-email?access_token=AT&refresh_token=RT`) → {kind:'tokens', access_token:'AT', refresh_token:'RT'}
 * - DL-8: tokens + basura extra en fragment (params desconocidos) → igual {kind:'tokens', ...}, ignora el resto
 *
 * ### Boundary — tokens incompletos / URL normal
 * - DL-3: solo access_token (sin refresh_token) → null
 * - DL-4: solo refresh_token (sin access_token) → null
 * - DL-5: URL sin nada de auth (`urbea://feed`) → null
 *
 * ### Error del proveedor (GoTrue)
 * - DL-6: fragment de error con error_code (`#error=access_denied&error_code=otp_expired`) → {kind:'error', error_code:'otp_expired'}
 * - DL-7: error sin error_code (solo `error=access_denied`) → {kind:'error', error_code:'access_denied'} (fallback)
 *
 * ### should_redirect_to_verify_email — ramas de la regla
 * - SR-1: null → false
 * - SR-2: session sin `user` (forma inesperada, defensivo) → false
 * - SR-3: email_confirmed_at undefined → true
 * - SR-4: email_confirmed_at null → true
 * - SR-5: email_confirmed_at con fecha ISO → false
 */
import type { Session } from '@supabase/supabase-js';

import {
  parse_session_from_url,
  should_redirect_to_verify_email,
} from '../deep-link-session';

function make_session(email_confirmed_at: string | null | undefined): Session {
  return {
    access_token: 'at',
    refresh_token: 'rt',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'u1',
      email: 'agente@urbea.mx',
      email_confirmed_at,
    },
  } as unknown as Session;
}

describe('parse_session_from_url', () => {
  it('DL-1: fragment completo → {kind:"tokens", access_token, refresh_token}', () => {
    const url = 'urbea://verify-email#access_token=AT&refresh_token=RT&type=signup';
    expect(parse_session_from_url(url)).toEqual({
      kind: 'tokens',
      access_token: 'AT',
      refresh_token: 'RT',
    });
  });

  it('DL-2: query-style → {kind:"tokens", access_token, refresh_token}', () => {
    const url = 'urbea://verify-email?access_token=AT&refresh_token=RT';
    expect(parse_session_from_url(url)).toEqual({
      kind: 'tokens',
      access_token: 'AT',
      refresh_token: 'RT',
    });
  });

  it('DL-8: tokens con basura extra en el fragment → tokens, ignora lo demás', () => {
    const url =
      'urbea://verify-email#access_token=AT&refresh_token=RT&type=signup&expires_in=3600&token_type=bearer&provider_token=XYZ';
    expect(parse_session_from_url(url)).toEqual({
      kind: 'tokens',
      access_token: 'AT',
      refresh_token: 'RT',
    });
  });

  it('DL-3: solo access_token (falta refresh_token) → null', () => {
    const url = 'urbea://verify-email#access_token=AT&type=signup';
    expect(parse_session_from_url(url)).toBeNull();
  });

  it('DL-4: solo refresh_token (falta access_token) → null', () => {
    const url = 'urbea://verify-email#refresh_token=RT&type=signup';
    expect(parse_session_from_url(url)).toBeNull();
  });

  it('DL-5: URL sin nada de auth → null', () => {
    expect(parse_session_from_url('urbea://feed')).toBeNull();
  });

  it('DL-6: error con error_code → {kind:"error", error_code:"otp_expired"}', () => {
    const url = 'urbea://verify-email#error=access_denied&error_code=otp_expired';
    expect(parse_session_from_url(url)).toEqual({ kind: 'error', error_code: 'otp_expired' });
  });

  it('DL-7: error SIN error_code → error_code cae a "access_denied" (fallback)', () => {
    const url = 'urbea://verify-email#error=access_denied';
    expect(parse_session_from_url(url)).toEqual({ kind: 'error', error_code: 'access_denied' });
  });
});

describe('should_redirect_to_verify_email', () => {
  it('SR-1: sin sesión (null) → false', () => {
    expect(should_redirect_to_verify_email(null)).toBe(false);
  });

  it('SR-2: session sin user (forma inesperada) → false', () => {
    const broken = { access_token: 'at' } as unknown as Session;
    expect(should_redirect_to_verify_email(broken)).toBe(false);
  });

  it('SR-3: email_confirmed_at undefined → true', () => {
    expect(should_redirect_to_verify_email(make_session(undefined))).toBe(true);
  });

  it('SR-4: email_confirmed_at null → true', () => {
    expect(should_redirect_to_verify_email(make_session(null))).toBe(true);
  });

  it('SR-5: email_confirmed_at con fecha ISO → false', () => {
    expect(should_redirect_to_verify_email(make_session('2026-07-31T10:00:00.000Z'))).toBe(false);
  });
});
