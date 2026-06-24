import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { Database } from '@/types/database';

const supabase_url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabase_anon_key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabase_url) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL — add it to .env.local (local dev) or EAS secrets (CI/prod).'
  );
}
if (!supabase_anon_key) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_ANON_KEY — add it to .env.local (local dev) or EAS secrets (CI/prod).'
  );
}

export const supabase = createClient<Database>(supabase_url, supabase_anon_key, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Patrón oficial Supabase + Expo: el auto-refresh del token debe correr solo
// mientras la app está en foreground. AppState pausa el refresh en background
// (ahorra trabajo/red) y lo reanuda al volver. Ver docs de supabase-js en RN.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
