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
 * Patrón: useFocusEffect (expo-router) + useCallback para re-fetchear al recuperar
 * foco (anti-stale tras editar el perfil y volver con router.back()).
 * useFocusEffect reemplaza a useEffect — el primer foco coincide con mount.
 * Con useCallback([agent_id]) la identidad del callback es estable entre re-renders,
 * por lo que useFocusEffect no produce loop infinito en producción.
 *
 * ponytail: sin AbortController — el flag `ignore` es suficiente para esta
 * lectura de baja frecuencia. Sin set_state({ loading: true }) en re-fetches:
 * muestra data stale sin spinner de ActivityIndicator mientras carga la data fresca,
 * evitando parpadeo en cada vuelta de navegación. El estado inicial loading: true
 * cubre el spinner del primer fetch.
 */

import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

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

/**
 * Forma de la fila de agent_public_profiles relevante para el perfil.
 * `has_phone` (migración 20260905200003, #255): derivado, no requiere leer
 * users.phone crudo.
 */
type PrefsRow = {
  full_name: string | null;
  profile_photo_url: string | null;
  has_phone: boolean;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Carga el perfil público de un agente identificado por `agent_id`.
 * Re-fetches automáticamente cuando la pantalla recupera el foco
 * (anti-stale tras editar y volver con router.back()) o si `agent_id` cambia.
 */
export function useAgentProfile(agent_id: string): UseAgentProfileState {
  const [state, set_state] = useState<UseAgentProfileState>({
    loading: true,
    error: null,
    data: null,
  });

  useFocusEffect(
    useCallback(() => {
      // Flag de cancelación — evita setState tras desmontaje o pérdida de foco.
      let ignore = false;

      async function fetch_profile(): Promise<void> {
        // Sin set_state({ loading: true }) antes del primer await:
        //   - Primer fetch: el estado inicial loading: true ya muestra el spinner.
        //   - Re-fetches (foco): muestra data stale sin ActivityIndicator, evitando
        //     parpadeo en cada vuelta de navegación (editar → volver).

        // Query 1: datos tipados — users + join agencies(name).
        // Desambiguación obligatoria: existen dos FK entre users y agencies
        // (users.agency_id → agencies, y agencies.owner_user_id → users), así que
        // PostgREST exige nombrar la constraint del embed o falla con
        // "more than one relationship was found".
        // #255: `phone` YA NO se pide aquí — el crudo de users.phone dejaba
        // de servir para decidir el botón de WhatsApp en cuanto RLS oculta la
        // fila (#250), y el perfil público ya no lo necesita para nada más.
        // Menos exposición: ese teléfono ahora solo sale por
        // whatsapp_phone_for_profile (RPC, server-side, al pulsar).
        const user_query = supabase
          .from('users')
          .select('bio, created_at, agencies!users_agency_id_fkey(name)')
          .eq('id', agent_id)
          .maybeSingle();

        // Query 2 (#145.3): identidad pública vía la VISTA agent_public_profiles.
        // Antes leía user_preferences directo y la RLS ("solo tu fila o admin")
        // devolvía 0 filas EN SILENCIO para perfiles ajenos — el nombre y la
        // foto de otros agentes jamás se mostraban. La vista brinca la RLS solo
        // en estas columnas (migración 20260810000001; has_phone sumado en
        // 20260905200003, #255).
        const prefs_query = supabase
          .from('agent_public_profiles')
          .select('full_name, profile_photo_url, has_phone')
          .eq('user_id', agent_id)
          .maybeSingle();

        const [user_result, prefs_result] = await Promise.all([user_query, prefs_query]);

        if (ignore) return;

        const { data: user_data, error: user_error } = user_result;
        const { data: raw_prefs, error: prefs_error } = prefs_result;

        if (prefs_error) {
          set_state({ loading: false, error: prefs_error.message, data: null });
          return;
        }

        // Cast seguro: PostgREST garantiza la forma; el cast es solo para TypeScript.
        const prefs = raw_prefs as PrefsRow | null;

        // #250: `users` es FAIL-SOFT. La fila de un publicador admin es
        // invisible para cualquier no-admin (users_select solo abre la rama
        // pública a role='agent' verificado) y antes eso tumbaba TODA la
        // pantalla: el perfil público de Vladimir salía vacío aunque su
        // identidad estuviera disponible en la vista. Sin fila, los campos que
        // solo viven en users quedan null y la identidad igual se muestra.
        // Solo si NI users NI la vista traen nada, el perfil no existe.
        if (!user_data && !prefs) {
          set_state({ loading: false, error: 'Agente no encontrado', data: null });
          return;
        }
        if (user_error && !prefs) {
          set_state({ loading: false, error: user_error.message, data: null });
          return;
        }

        // `agencies` viene como objeto (many-to-one via FK nullable) o null.
        const raw_agency = (user_data?.agencies ?? null) as { name: string } | null;

        set_state({
          loading: false,
          error: null,
          data: {
            full_name: prefs?.full_name ?? null,
            profile_photo_url: prefs?.profile_photo_url ?? null,
            bio: user_data?.bio ?? null,
            // Fail-closed: sin fila de la vista (agente sin onboarding), no
            // hay teléfono que ofrecer — mismo trato que full_name/foto null.
            has_phone: prefs?.has_phone ?? false,
            member_since: user_data?.created_at ?? null,
            agency_name: raw_agency?.name ?? null,
          },
        });
      }

      void fetch_profile();

      return () => {
        ignore = true;
      };
    }, [agent_id])
  );

  return state;
}
