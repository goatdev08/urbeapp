/**
 * AuthContext — integración con Supabase Auth + perfil de public.users.
 * Subtarea 2.1 — fase GREEN.
 *
 * Contrato expuesto:
 *   AuthProvider  — envuelve la app con el contexto de auth.
 *   useAuth()     — { session, user, isLoading, signIn, signOut }
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/types/database';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type UserProfile = Database['public']['Tables']['users']['Row'];

export interface AuthContextValue {
  session: Session | null;
  user: UserProfile | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
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
    .select('*')
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
    await supabase.auth.signInWithPassword({ email, password });
  };

  const signOut = async (): Promise<void> => {
    await supabase.auth.signOut();
  };

  const value: AuthContextValue = {
    session,
    user,
    isLoading,
    signIn,
    signOut,
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
