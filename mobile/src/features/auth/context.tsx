/**
 * AuthContext — integración con Supabase Auth + perfil de public.users.
 * Subtarea 2.1 — fase GREEN.
 *
 * Contrato expuesto:
 *   AuthProvider  — envuelve la app con el contexto de auth.
 *   useAuth()     — { session, user, isLoading, signIn, signOut }
 *
 * signUp/SignUpProfile se retiraron en 93.3: el registro libre (§5.1) ya no
 * pasa por supabase.auth.signUp — usa la EF `register` (features/auth/api.ts,
 * register_user) + signIn. El contrato de metadata que signUp armaba para el
 * trigger handle_new_user vive ahora del lado de la EF (ver
 * supabase/functions/register/handler.ts y su handler.test.ts).
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/types/database';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

// #116 (expand → migrate → contract, paso 1 EXPAND): el perfil que viaja al
// cliente NO incluye `date_of_birth`. Nadie la lee en la app (solo se ESCRIBE en
// el registro vía register-user); sacarla de aquí es lo que permite que el paso
// 2 (migración) revoque el grant de esa columna sin romper el login de las apps
// instaladas. Cuando esta versión haya llegado por OTA, el backend cierra la
// columna. Si la ves reaparecer aquí, el paso 2 vuelve a ser imposible.
export type UserProfile = Omit<Database['public']['Tables']['users']['Row'], 'date_of_birth'>;

/** Columnas de public.users que el cliente pide — todas MENOS date_of_birth (#116). */
export const USER_PROFILE_COLUMNS =
  'id, email, first_name, last_name, phone, role, agency_id, avatar_url, bio, city, state, state_id, municipality_id, is_verified_agent, last_login_at, deletion_pending_at, deleted_at, created_at, updated_at';

export interface AuthContextValue {
  session: Session | null;
  user: UserProfile | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Recuperación de contraseña (§5.3, subtarea 72.5). Dispara el correo con el
   * enlace de recuperación; NUNCA revela si la cuenta existe — es
   * responsabilidad de quien llama (forgot-password.tsx) mostrar SIEMPRE el
   * mismo mensaje de éxito, atrape o no un error de este wrapper.
   * Bloqueado end-to-end hasta que 72.3 configure el SMTP Resend — hoy los
   * correos salen por el mailer default de Supabase (rate-limited).
   */
  requestPasswordReset: (email: string) => Promise<void>;
  /** Cambia la contraseña de la sesión activa (flujo de recuperación, §5.3). */
  updatePassword: (password: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context — undefined como default activa el guard del hook
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Helper: carga el perfil de public.users para un auth user id dado.
// Devuelve null si la query falla o no hay fila.
// ---------------------------------------------------------------------------

async function load_user_profile(user_id: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select(USER_PROFILE_COLUMNS)
    .eq('id', user_id)
    .single();

  if (error) {
    console.warn('[AuthContext] Error al cargar perfil de public.users:', error.message);
    return null;
  }

  return data;
}

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, set_session] = useState<Session | null>(null);
  const [user, set_user] = useState<UserProfile | null>(null);
  const [isLoading, set_is_loading] = useState<boolean>(true);

  // Ref para evitar setear estado tras desmontaje
  const is_mounted = useRef(true);

  useEffect(() => {
    is_mounted.current = true;

    // 1. Carga inicial: resuelve la sesión activa
    const initialize = async () => {
      const { data } = await supabase.auth.getSession();
      const initial_session = data.session;

      if (!is_mounted.current) return;

      if (initial_session) {
        const profile = await load_user_profile(initial_session.user.id);
        if (!is_mounted.current) return;
        set_session(initial_session);
        set_user(profile);
      } else {
        set_session(null);
        set_user(null);
      }

      set_is_loading(false);
    };

    // 2. Listener de cambios de estado de auth
    const { data } = supabase.auth.onAuthStateChange(async (event, changed_session) => {
      if (!is_mounted.current) return;

      if (changed_session) {
        // SIGNED_IN o TOKEN_REFRESHED — recarga el perfil
        const profile = await load_user_profile(changed_session.user.id);
        if (!is_mounted.current) return;
        set_session(changed_session);
        set_user(profile);
      } else {
        // SIGNED_OUT o sesión expirada
        set_session(null);
        set_user(null);
      }
    });

    initialize();

    // 3. Cleanup: cancela el listener y marca el componente como desmontado
    return () => {
      is_mounted.current = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<void> => {
    // supabase-js v2 NO lanza en credenciales inválidas — devuelve { error }.
    // Sin este throw, login.tsx cree que el login tuvo éxito y navega a '/'.
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }
  };

  const signOut = async (): Promise<void> => {
    await supabase.auth.signOut();
  };

  // redirectTo: deep link propio (scheme 'urbea', app.config.js) — el correo de
  // recuperación abre la app directo en /reset-password. La sesión de
  // recuperación que Supabase adjunta a ese link NO se procesa todavía (sin
  // SMTP real no hay forma de probar el viaje completo, ver 72.3); queda
  // documentado en reset-password.tsx dónde engancharla.
  const requestPasswordReset = async (email: string): Promise<void> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: Linking.createURL('reset-password'),
    });
    if (error) {
      throw error;
    }
  };

  const updatePassword = async (password: string): Promise<void> => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      throw error;
    }
  };

  const value: AuthContextValue = {
    session,
    user,
    isLoading,
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// useAuth — guard: lanza si se usa fuera de AuthProvider
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
