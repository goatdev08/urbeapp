/**
 * STUB MÍNIMO — fase RED (TDD).
 * Este archivo es solo un esqueleto para que los imports resuelvan.
 * NO contiene lógica de negocio. La fase GREEN lo implementará.
 *
 * El stub devuelve valores placeholder que hacen FALLAR las aserciones de los tests,
 * NO devuelve undefined para que result.current esté disponible.
 */
import React from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type UserProfile = Database['public']['Tables']['users']['Row'];

export interface AuthContextValue {
  session: Session | null;
  user: UserProfile | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

// Stub: valores placeholder que deliberadamente NO satisfacen el contrato real
const STUB_VALUE: AuthContextValue = {
  session: 'NOT_IMPLEMENTED' as unknown as Session,
  user: 'NOT_IMPLEMENTED' as unknown as UserProfile,
  isLoading: false, // Incorrecto: debería ser true inicialmente
  signIn: async (_email: string, _password: string) => {
    throw new Error('not_implemented: signIn');
  },
  signOut: async () => {
    throw new Error('not_implemented: signOut');
  },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Stub: no hace getSession, no se suscribe, no carga perfil
  return (
    <AuthContext.Provider value={STUB_VALUE}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  // Stub: no lanza error descriptivo — la implementación real sí debe lanzar
  // Esto hace fallar el EC-9 (guard) por aserción correctamente
  return ctx as AuthContextValue;
}
