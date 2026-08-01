/**
 * useGoogleOAuth — login social con Google vía `supabase.auth.signInWithOAuth`
 * + `expo-web-browser` (flujo "authorization code" en navegador del sistema,
 * PKCE lo maneja supabase-js). Subtarea 72.4.
 *
 * STUB — fase RED. El prerequisito externo (Google Cloud OAuth client) no
 * existe todavía (ver feature-flags.ts): esta es solo la firma pública
 * acordada para que useGoogleOAuth.test.ts pueda importar el módulo. La
 * lógica real (paso GREEN) se implementa cuando se aborde esa fase.
 *
 * Contrato (ver EDGE CASES en __tests__/useGoogleOAuth.test.ts):
 *  1. sign_in_with_google() llama supabase.auth.signInWithOAuth({ provider:
 *     'google', options: { redirectTo: Linking.createURL('login'),
 *     skipBrowserRedirect: true } }).
 *  2. Con data.url, abre WebBrowser.openAuthSessionAsync(data.url, redirectTo).
 *  3. type 'success' con tokens en el fragment → supabase.auth.setSession.
 *  4. type 'cancel'/'dismiss' → no-op silencioso (sin error_message).
 *  5. Cualquier error (signInWithOAuth, callback #error=, setSession) → se
 *     expone en `error_message`.
 */
export interface UseGoogleOAuthReturn {
  sign_in_with_google: () => Promise<void>;
  error_message: string | null;
}

export function useGoogleOAuth(): UseGoogleOAuthReturn {
  return {
    error_message: null,
    sign_in_with_google: async () => {
      throw new Error('not_implemented');
    },
  };
}
