/**
 * Ruta /onboarding — pantalla de configuración inicial de perfil del agente.
 *
 * Expo Router registra esta ruta automáticamente por estar en app/.
 * El Stack padre (app/_layout.tsx) usa headerShown:false globalmente.
 *
 * Protección: redirige a /login si no hay sesión activa (al igual que
 * el grupo (protected)). La lógica de navegación post-onboarding se
 * implementa en 6.6 (handle_continue → router.replace('/') o similar).
 *
 * Subtareas pendientes que añaden lógica a esta pantalla:
 *   6.2 — image picker + permisos
 *   6.4 — compresión de imagen
 *   6.5 — upload a Supabase Storage
 *   6.6 — validación + guardado en public.users + navegación
 */
import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/context';
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen';

export default function OnboardingRoute() {
  const { session, isLoading } = useAuth();

  // Mientras carga la sesión no renderizamos nada (evita flash de redirección)
  if (isLoading) {
    return null;
  }

  // Si no hay sesión, al login
  if (session === null) {
    return <Redirect href="/login" />;
  }

  return <OnboardingScreen />;
}
