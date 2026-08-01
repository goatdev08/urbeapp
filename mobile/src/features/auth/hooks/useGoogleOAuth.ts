/**
 * useGoogleOAuth — login social con Google vía `supabase.auth.signInWithOAuth`
 * + `expo-web-browser` (flujo implícito: los tokens vuelven directo en el
 * fragment del deep link de retorno, sin intercambio de código — ver PLAN
 * REVISADO 2026-07-31 en la subtarea 72.4). Mismo patrón que el hook hermano
 * useSessionFromDeepLink.ts (72.3), pero disparado por el botón en vez de un
 * listener de deep link pasivo.
 *
 * Flujo:
 *  1. signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })
 *     — error → error_message, NO se abre el browser.
 *  2. Con data.url → WebBrowser.openAuthSessionAsync(data.url, redirectTo).
 *  3. 'cancel' / 'dismiss' → no-op silencioso (el usuario se arrepintió).
 *  4. 'success' → parse_session_from_url(result.url) (reusa deep-link-session,
 *     72.3): kind 'tokens' → supabase.auth.setSession; kind 'error' o null →
 *     error_message.
 *
 * Ver EDGE CASES en __tests__/useGoogleOAuth.test.ts (GO-1..GO-5). GO-6
 * (reentrada concurrente) queda diferido — el guard `in_flight` de abajo es
 * defensivo mínimo, no tiene cobertura dedicada.
 */
import { useCallback, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase/client';
import { parse_session_from_url } from '@/features/auth/deep-link-session';
import { map_auth_error } from '@/features/auth/auth-errors';

export interface UseGoogleOAuthReturn {
  sign_in_with_google: () => Promise<void>;
  error_message: string | null;
}

// El callback de Google no siempre viaja como AuthError de Supabase (p.ej. el
// usuario niega el permiso en la pantalla de consentimiento: #error=access_denied
// en el propio deep link) — mensaje genérico en español, no depende de map_auth_error.
const MSG_OAUTH_FAILED = 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.';

export function useGoogleOAuth(): UseGoogleOAuthReturn {
  const [error_message, set_error_message] = useState<string | null>(null);
  // Guard de reentrada simple (GO-6 diferido): ignora una segunda pulsación
  // mientras la primera sigue en vuelo.
  const in_flight = useRef(false);

  const sign_in_with_google = useCallback(async () => {
    if (in_flight.current) return;
    in_flight.current = true;
    set_error_message(null);
    try {
      const redirect_to = Linking.createURL('login');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirect_to, skipBrowserRedirect: true },
      });
      if (error) {
        set_error_message(map_auth_error(error));
        return;
      }
      if (!data.url) return;

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirect_to);
      if (result.type !== 'success') return; // cancel / dismiss → silencio total

      const parsed = parse_session_from_url(result.url);
      if (parsed === null || parsed.kind === 'error') {
        set_error_message(MSG_OAUTH_FAILED);
        return;
      }

      const { error: session_error } = await supabase.auth.setSession({
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
      });
      if (session_error) {
        set_error_message(map_auth_error(session_error));
      }
    } finally {
      in_flight.current = false;
    }
  }, []);

  return { sign_in_with_google, error_message };
}
