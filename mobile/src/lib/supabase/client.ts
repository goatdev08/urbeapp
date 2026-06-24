import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

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
