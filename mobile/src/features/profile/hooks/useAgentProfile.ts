/**
 * useAgentProfile — hook de lectura para el perfil de un agente.
 *
 * Devuelve { loading, error, data } con los datos del agente para la pantalla
 * de perfil público. Lectura pura (SELECT); sin mutaciones.
 *
 * Estrategia de fetch (dos queries en paralelo vía Promise.all):
 *   1. `users` + join `agencies(name)` — columnas tipadas en el esquema generado.
 *   2. `user_preferences` — columnas `full_name` y `profile_photo_url` añadidas
 *      por migración 0015; no están en los tipos generados aún.
 *      Cast idéntico al de OnboardingScreen.tsx y profileService.ts.
 *
 * Patrón: useState + useEffect con flag `ignore` para evitar actualizaciones
 * de estado en componentes desmontados.
 *
 * ponytail: sin AbortController — el flag `ignore` es suficiente para esta
 * lectura de baja frecuencia.
 */

import { useState, useEffect } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { AgentProfile } from '../types';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface UseAgentProfileState {
  loading: boolean;
  error: string | null;
  data: AgentProfile | null;
}

// ---------------------------------------------------------------------------
// Tipos locales para los casts de columnas no generadas (migración 0015)
// ---------------------------------------------------------------------------

/** Forma de la fila de user_preferences relevante para el perfil. */
type PrefsRow = {
  full_name: string | null;
  profile_photo_url: string | null;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Carga el perfil público de un agente identificado por `agent_id`.
 * Re-fetches automáticamente si `agent_id` cambia.
 */
export function useAgentProfile(agent_id: string): UseAgentProfileState {
  const [state, set_state] = useState<UseAgentProfileState>({
    loading: true,
    error: null,
    data: null,
  });

  useEffect(() => {
    // Flag de cancelación — evita setState en componente ya desmontado.
    let ignore = false;

    async function fetch_profile(): Promise<void> {
      set_state({ loading: true, error: null, data: null });

      // Query 1: datos tipados — users + join agencies(name).
      // Desambiguación obligatoria: existen dos FK entre users y agencies
      // (users.agency_id → agencies, y agencies.owner_user_id → users), así que
      // PostgREST exige nombrar la constraint del embed o falla con
      // "more than one relationship was found".
      const user_query = supabase
        .from('users')
        .select('bio, created_at, agencies!users_agency_id_fkey(name)')
        .eq('id', agent_id)
        .single();

      // Query 2: columnas de migración 0015 (no en tipos generados).
      // ponytail: cast por tipos 0015 sin regenerar — mismo patrón que profileService
      // y OnboardingScreen: .select('full_name') + cast `as PrefsRow | null`.
      const prefs_query = supabase
        .from('user_preferences')
        .select('full_name, profile_photo_url' as never)
        .eq('user_id', agent_id)
        .maybeSingle();

      const [user_result, prefs_result] = await Promise.all([user_query, prefs_query]);

      if (ignore) return;

      const { data: user_data, error: user_error } = user_result;
      const { data: raw_prefs, error: prefs_error } = prefs_result;

      if (user_error) {
        set_state({ loading: false, error: user_error.message, data: null });
        return;
      }
      if (prefs_error) {
        set_state({ loading: false, error: prefs_error.message, data: null });
        return;
      }
      if (!user_data) {
        set_state({ loading: false, error: 'Agente no encontrado', data: null });
        return;
      }

      // Cast seguro: PostgREST garantiza la forma; el cast es solo para TypeScript.
      const prefs = raw_prefs as PrefsRow | null;

      // `agencies` viene como objeto (many-to-one via FK nullable) o null.
      const raw_agency = user_data.agencies as { name: string } | null;

      set_state({
        loading: false,
        error: null,
        data: {
          full_name: prefs?.full_name ?? null,
          profile_photo_url: prefs?.profile_photo_url ?? null,
          bio: user_data.bio,
          member_since: user_data.created_at,
          agency_name: raw_agency?.name ?? null,
        },
      });
    }

    void fetch_profile();

    return () => {
      ignore = true;
    };
  }, [agent_id]);

  return state;
}
