/**
 * AuthContext — integración con Supabase Auth + perfil de public.users.
 * Subtarea 2.1 — fase GREEN.
 *
 * Contrato expuesto:
 *   AuthProvider  — envuelve la app con el contexto de auth.
 *   useAuth()     — { session, user, isLoading, signIn, signUp, signOut }
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/types/database';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type UserProfile = Database['public']['Tables']['users']['Row'];

/**
 * Campos de perfil opcionales del registro libre (§5.1). Viajan en
 * options.data de supabase.auth.signUp → raw_user_meta_data; el trigger
 * handle_new_user (migración #72.2) los persiste con estas claves EXACTAS —
 * cambiarlas rompe el registro en silencio (el trigger ignora lo que no
 * reconoce y guarda null).
 */
export interface SignUpProfile {
  first_name?: string;
  last_name?: string;
  /** Único por cuenta activa — índice parcial users_phone_unique_active. */
  phone?: string;
  /** ISO 'YYYY-MM-DD'; el CHECK users_mayoria_de_edad la valida server-side. */
  date_of_birth?: string;
  /** Clave INEGI de 2 dígitos (catálogo mx_states). */
  state_id?: string;
  /** Clave INEGI (cvegeo) de 5 dígitos (catálogo mx_municipalities). */
  municipality_id?: string;
}

export interface AuthContextValue {
  session: Session | null;
  user: UserProfile | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, profile?: SignUpProfile) => Promise<void>;
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
    // supabase-js v2 NO lanza en credenciales inválidas — devuelve { error }.
    // Sin este throw, login.tsx cree que el login tuvo éxito y navega a '/'.
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }
  };

  // Registro libre (rol 'user' por default vía trigger handle_new_user).
  // Con autoconfirm activo en el proyecto, signUp devuelve sesión directa y el
  // listener onAuthStateChange de arriba carga el perfil — no hace falta signIn.
  const signUp = async (
    email: string,
    password: string,
    profile?: SignUpProfile,
  ): Promise<void> => {
    // Solo viajan los campos con valor: un string vacío no debe pisar el
    // coalesce-a-null del trigger con un '' guardado a propósito.
    const metadata: Record<string, string> = {};
    if (profile?.first_name) metadata.first_name = profile.first_name;
    if (profile?.last_name) metadata.last_name = profile.last_name;
    if (profile?.phone) metadata.phone = profile.phone;
    if (profile?.date_of_birth) metadata.date_of_birth = profile.date_of_birth;
    if (profile?.state_id) metadata.state_id = profile.state_id;
    if (profile?.municipality_id) metadata.municipality_id = profile.municipality_id;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      ...(Object.keys(metadata).length > 0 ? { options: { data: metadata } } : {}),
    });
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
    signUp,
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
