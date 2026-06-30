/**
 * Tab "CRM" — visible solo para agentes.
 *
 * Subtarea 15.1 — scaffold + role guard.
 * Guard inline: user?.role === 'agent'. Si no es agente, redirige a
 * /(protected) (misma convención que admin-layout.tsx).
 *
 * El tab ya está oculto en _layout.tsx para no-agentes (href: null),
 * pero el Redirect aquí protege la ruta en caso de navegación directa.
 */
import React from 'react';
import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/context';
import { CRMScreen } from '@/features/leads/screens/CRMScreen';

export default function CRMTab(): React.ReactElement {
  const { user, isLoading } = useAuth();

  // Mientras carga el perfil — no renderizar nada (el guard de (protected)
  // ya garantiza que hay sesión; esto evita un flash de redirección).
  if (isLoading) {
    return <></>;
  }

  // No es agente → redirige al home de la app
  if (user?.role !== 'agent') {
    return <Redirect href="/(protected)" />;
  }

  return <CRMScreen />;
}
