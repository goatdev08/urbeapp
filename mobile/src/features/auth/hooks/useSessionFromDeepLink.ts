/**
 * useSessionFromDeepLink — escucha el deep link entrante (cold start y warm,
 * `Linking.useURL()` cubre ambos) y, si trae tokens de sesión (click en el
 * enlace de verify-email o de reset-password), llama `setSession` y dispara
 * `on_success`. Si el proveedor manda un error (enlace expirado/usado),
 * expone `error_message` para que la pantalla lo muestre inline.
 * Subtarea 72.3 (verificación real de email).
 *
 * Parametrizado por `on_success` (no hardcodea la ruta destino) para que
 * 72.5 (reset-password) lo reutilice con su propia navegación post-sesión —
 * ambas pantallas comparten el mismo parseo (deep-link-session.ts) y el
 * mismo `setSession`, solo cambia qué hacer al terminar.
 */
import { useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';

import { supabase } from '@/lib/supabase/client';
import { parse_session_from_url } from '@/features/auth/deep-link-session';

export interface UseSessionFromDeepLinkReturn {
  error_message: string | null;
}

const EXPIRED_LINK_MESSAGE = 'El enlace expiró, reenvía el correo';

export function useSessionFromDeepLink(on_success: () => void): UseSessionFromDeepLinkReturn {
  const url = Linking.useURL();
  const [error_message, set_error_message] = useState<string | null>(null);
  // Ref en vez de dependencia directa: `on_success` suele ser un closure nuevo
  // en cada render del caller (p.ej. `() => router.replace('/')`); metida en
  // el array de deps re-ejecutaría el efecto (y volvería a llamar setSession)
  // en cada render, no solo cuando cambia la URL. Se actualiza en un efecto
  // propio (no durante el render) — el linter de React ('react-hooks/refs')
  // prohíbe mutar un ref fuera de un efecto/handler.
  const on_success_ref = useRef(on_success);
  useEffect(() => {
    on_success_ref.current = on_success;
  });

  useEffect(() => {
    if (url === null) return;
    const parsed = parse_session_from_url(url);
    if (parsed === null) return;

    if (parsed.kind === 'error') {
      // setTimeout, no setState directo: mismo patrón que el cooldown de
      // verify-email.tsx — evita el setState síncrono dentro de un efecto
      // que el linter de React marca como error (cascada de renders).
      const id = setTimeout(() => set_error_message(EXPIRED_LINK_MESSAGE), 0);
      return () => clearTimeout(id);
    }

    let ignore = false;
    void (async () => {
      const { error } = await supabase.auth.setSession({
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
      });
      if (ignore) return;
      if (error) {
        set_error_message(EXPIRED_LINK_MESSAGE);
        return;
      }
      on_success_ref.current();
    })();

    return () => {
      ignore = true;
    };
  }, [url]);

  return { error_message };
}
