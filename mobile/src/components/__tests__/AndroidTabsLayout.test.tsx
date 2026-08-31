/**
 * Tests — AndroidTabsLayout (mobile/src/components/AndroidTabsLayout.tsx)
 * Tarea Taskmaster: 224 — `admin` es SUPERCONJUNTO de `agent`.
 *
 * 🔴 Por qué existe este archivo: el 4º slot de la barra se comparte —Leads
 * para agentes, Guardados para todos los demás— y la decisión salía de
 * `user?.role === 'agent'`, comparación estricta. Un `admin` caía del lado
 * "no-agente": perdía el tab de Leads y le aparecía Guardados en su lugar.
 * Detectado al volver administradores a dos agentes reales en producción
 * (2026-08-31).
 *
 * SEAM BAJO TEST: `<Tabs>` y `<Tabs.Screen>` de expo-router están MOCKEADOS
 * por stubs que REGISTRAN el `name` y las `options` con las que el layout los
 * invoca. Se mide la CONFIGURACIÓN que produce el layout (¿este tab lleva
 * `href: null`?), no el render del navigator real — que bajo Jest exigiría
 * todo el runtime de react-navigation sin aportar nada a esta decisión.
 * Mismo criterio de "registrar props" que PropertyDetailScreen.test.tsx
 * (220.6): ahí el hueco fue justamente medir el componente hijo en vez de
 * medir lo que el padre le pasa.
 *
 * `href: null` es el mecanismo real de ocultado en expo-router, así que el
 * assert mira EXACTAMENTE eso: su presencia/ausencia en `options`.
 *
 * EDGE CASES:
 * - (EC-AT1) 🔴 role='admin' → el tab `crm` NO lleva `href: null` (visible) y
 *   `saved` SÍ. Mata el mutante "volver a la comparación estricta".
 * - (EC-AT2) no-regresión: role='agent' → idéntico a EC-AT1.
 * - (EC-AT3) role='user' → invertido: `crm` oculto, `saved` visible.
 * - (EC-AT4) sin sesión (user=null) → como 'user' (el `?.` no truena).
 * - (EC-AT5) invariante estructural: los 6 tabs se declaran SIEMPRE, en
 *   cualquier rol — el rol cambia la visibilidad, nunca la existencia de la
 *   ruta (sin esto, un "fix" que borrara el <Tabs.Screen name="crm"> para
 *   no-agentes dejaría EC-AT3 en verde y rompería el deep link).
 *
 * GOTCHAS RNTL ya pagados (rntl14_renderhook_async): `render` es async →
 * SIEMPRE con `await`.
 */

import React from 'react';
import { render, cleanup } from '@testing-library/react-native';

import { AndroidTabsLayout } from '../AndroidTabsLayout';

// ---------------------------------------------------------------------------
// Mocks — babel-plugin-jest-hoist los iza por encima de los imports.
// ---------------------------------------------------------------------------

const mock_auth_role: { role: string | null } = { role: null };

/** name → options con las que el layout declaró cada Tabs.Screen. */
const declared_screens: { name: string; options: Record<string, unknown> }[] = [];

jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  function Tabs({ children }: { children: React.ReactNode }) {
    return R.createElement(R.Fragment, null, children);
  }
  Tabs.Screen = function TabsScreen({
    name,
    options,
  }: { name: string; options?: Record<string, unknown> }) {
    declared_screens.push({ name, options: options ?? {} });
    return null;
  };
  return {
    Tabs,
    useRouter: () => ({ push: jest.fn() }),
    useSegments: () => [],
  };
});

jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    user: mock_auth_role.role === null ? null : { id: 'u1', role: mock_auth_role.role },
  }),
}));

jest.mock('@/components/GlassTabBar', () => ({ GlassTabBar: () => null }));

/** ¿El layout declaró este tab como oculto (href: null)? */
function is_hidden(name: string): boolean {
  const screen = declared_screens.find((s) => s.name === name);
  if (screen === undefined) throw new Error(`el layout no declaró el tab "${name}"`);
  return 'href' in screen.options && screen.options.href === null;
}

beforeEach(() => {
  mock_auth_role.role = null;
  declared_screens.length = 0;
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe('AndroidTabsLayout — slot 4 compartido Leads/Guardados', () => {
  it('EC-AT1: role="admin" ve Leads y no Guardados', async () => {
    mock_auth_role.role = 'admin';

    await render(<AndroidTabsLayout />);

    expect(is_hidden('crm')).toBe(false);
    expect(is_hidden('saved')).toBe(true);
  });

  it('EC-AT2: role="agent" ve Leads y no Guardados (no-regresión)', async () => {
    mock_auth_role.role = 'agent';

    await render(<AndroidTabsLayout />);

    expect(is_hidden('crm')).toBe(false);
    expect(is_hidden('saved')).toBe(true);
  });

  it('EC-AT3: role="user" ve Guardados y no Leads', async () => {
    mock_auth_role.role = 'user';

    await render(<AndroidTabsLayout />);

    expect(is_hidden('crm')).toBe(true);
    expect(is_hidden('saved')).toBe(false);
  });

  it('EC-AT4: sin sesión se comporta como no-agente', async () => {
    mock_auth_role.role = null;

    await render(<AndroidTabsLayout />);

    expect(is_hidden('crm')).toBe(true);
    expect(is_hidden('saved')).toBe(false);
  });

  it('EC-AT5: los 6 tabs se declaran SIEMPRE — el rol cambia visibilidad, no existencia', async () => {
    mock_auth_role.role = 'user';

    await render(<AndroidTabsLayout />);

    expect(declared_screens.map((s) => s.name)).toEqual([
      'index',
      'map',
      'publish',
      'crm',
      'saved',
      'profile',
    ]);
  });
});
