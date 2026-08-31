/**
 * Tests — CRMTab (mobile/app/(protected)/(tabs)/crm.tsx)
 * Tarea Taskmaster: 224 — `admin` es SUPERCONJUNTO de `agent`.
 *
 * 🔴 Por qué existe este archivo: el guard comparaba por igualdad estricta
 * (`user?.role !== 'agent'`), así que un usuario con `role='admin'` —que en
 * el BACKEND sí puede todo lo que puede un agente: la RLS `properties_insert`
 * acepta `ARRAY['agent','admin']` y la EF `publish-property` verifica
 * `role IN ('agent','admin')`— era EXPULSADO de su propio CRM al abrirlo.
 * Detectado al volver administradores a dos agentes reales en producción
 * (2026-08-31): ganaban el panel de admin y perdían sus leads.
 *
 * SEAM BAJO TEST: el componente de ruta `CRMTab` (default export), con
 * `useAuth` mockeado (holder mutable) y `CRMScreen` reemplazado por un stub
 * inerte — aquí solo se prueba la DECISIÓN de render a partir del rol, no el
 * CRM en sí (que tiene su propia cobertura).
 *
 * El mock de `expo-router` CAPTURA el `href` real del `<Redirect>`: un mock
 * que solo renderizara "algo" no distinguiría "rebota al home" de "renderiza
 * una pantalla vacía" — y el criterio exige que un deep link REBOTE.
 *
 * EDGE CASES:
 * - (EC-CRM1) 🔴 el que motiva la tarea: role='admin' → monta el CRM, NO
 *   redirige. Mata el mutante "volver a la comparación estricta con 'agent'".
 * - (EC-CRM2) no-regresión: role='agent' → monta el CRM (el caso que ya
 *   funcionaba; sin este assert, un fix que invirtiera la condición y solo
 *   dejara pasar a 'admin' quedaría verde).
 * - (EC-CRM3) role='user' → redirige DE VERDAD, con su destino real.
 * - (EC-CRM4) isLoading=true → ni CRM ni Redirect, aunque el rol ya sea
 *   'admin' (loading tiene prioridad: evita el flash de redirección).
 * - (EC-CRM5) user=null sin loading → redirige (el `?.` no truena).
 *
 * GOTCHAS RNTL ya pagados (rntl14_renderhook_async): `render` es async →
 * SIEMPRE con `await`.
 */

import React from 'react';
import { render, cleanup } from '@testing-library/react-native';

import CRMTab from '../crm';

// ---------------------------------------------------------------------------
// Mocks — babel-plugin-jest-hoist los iza por encima de los imports.
// ---------------------------------------------------------------------------

const mock_auth_state: { role: string | null; isLoading: boolean } = {
  role: null,
  isLoading: false,
};

const redirect_hrefs: unknown[] = [];

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: unknown }) => {
    redirect_hrefs.push(href);
    return null;
  },
}));

jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    user: mock_auth_state.role === null ? null : { id: 'u1', role: mock_auth_state.role },
    isLoading: mock_auth_state.isLoading,
  }),
}));

jest.mock('@/features/leads/screens/CRMScreen', () => {
  const { Text: T } = jest.requireActual('react-native');
  const R = jest.requireActual('react');
  return { CRMScreen: () => R.createElement(T, { testID: 'crm-screen' }, 'CRM') };
});

beforeEach(() => {
  mock_auth_state.role = null;
  mock_auth_state.isLoading = false;
  redirect_hrefs.length = 0;
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe('CRMTab — guard de rol', () => {
  it('EC-CRM1: role="admin" monta el CRM y NO redirige', async () => {
    mock_auth_state.role = 'admin';

    const { queryByTestId } = await render(<CRMTab />);

    expect(queryByTestId('crm-screen')).not.toBeNull();
    expect(redirect_hrefs).toHaveLength(0);
  });

  it('EC-CRM2: role="agent" monta el CRM y NO redirige (no-regresión)', async () => {
    mock_auth_state.role = 'agent';

    const { queryByTestId } = await render(<CRMTab />);

    expect(queryByTestId('crm-screen')).not.toBeNull();
    expect(redirect_hrefs).toHaveLength(0);
  });

  it('EC-CRM3: role="user" redirige al home, con su destino real', async () => {
    mock_auth_state.role = 'user';

    const { queryByTestId } = await render(<CRMTab />);

    expect(queryByTestId('crm-screen')).toBeNull();
    expect(redirect_hrefs).toEqual(['/(protected)']);
  });

  it('EC-CRM4: isLoading=true no monta el CRM ni redirige, aunque el rol sea admin', async () => {
    mock_auth_state.role = 'admin';
    mock_auth_state.isLoading = true;

    const { queryByTestId } = await render(<CRMTab />);

    expect(queryByTestId('crm-screen')).toBeNull();
    expect(redirect_hrefs).toHaveLength(0);
  });

  it('EC-CRM5: sin sesión (user=null) redirige', async () => {
    mock_auth_state.role = null;

    const { queryByTestId } = await render(<CRMTab />);

    expect(queryByTestId('crm-screen')).toBeNull();
    expect(redirect_hrefs).toEqual(['/(protected)']);
  });
});
