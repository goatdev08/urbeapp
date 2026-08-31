/**
 * Tests — IosNativeTabsLayout (mobile/src/components/IosNativeTabsLayout.tsx)
 * Tarea Taskmaster: 224 — `admin` es SUPERCONJUNTO de `agent`.
 *
 * Espejo iOS de AndroidTabsLayout.test.tsx: el mismo 4º slot compartido, pero
 * el mecanismo de ocultado aquí es la prop `hidden` de `<NativeTabs.Trigger>`
 * en vez de `href: null`. La comparación estricta contra 'agent' dejaba al
 * admin sin el tab de Leads también en iOS.
 *
 * SEAM BAJO TEST: `NativeTabs` y sus subcomponentes están MOCKEADOS por stubs
 * que REGISTRAN `name` y `hidden` de cada Trigger. `useLocalTabIcons` depende
 * de `expo-asset` (useAssets) — se mockea `expo-asset` para que devuelva
 * assets resueltos sin tocar el bundler.
 *
 * EDGE CASES:
 * - (EC-IT1) 🔴 role='admin' → Trigger `crm` con hidden=false y `saved` con
 *   hidden=true. Mata el mutante "volver a la comparación estricta".
 * - (EC-IT2) no-regresión: role='agent' → idéntico a EC-IT1.
 * - (EC-IT3) role='user' → invertido.
 * - (EC-IT4) sin sesión → como 'user'.
 *
 * GOTCHAS RNTL ya pagados (rntl14_renderhook_async): `render` es async →
 * SIEMPRE con `await`.
 */

import React from 'react';
import { render, cleanup } from '@testing-library/react-native';

import { IosNativeTabsLayout } from '../IosNativeTabsLayout';

// ---------------------------------------------------------------------------
// Mocks — babel-plugin-jest-hoist los iza por encima de los imports.
// ---------------------------------------------------------------------------

const mock_auth_role: { role: string | null } = { role: null };

/** name → hidden con el que el layout declaró cada Trigger. */
const declared_triggers: { name: string; hidden: boolean }[] = [];

jest.mock('expo-router/unstable-native-tabs', () => {
  const R = jest.requireActual('react');
  function NativeTabs({ children }: { children: React.ReactNode }) {
    return R.createElement(R.Fragment, null, children);
  }
  function Trigger({ name, hidden }: { name: string; hidden?: boolean }) {
    declared_triggers.push({ name, hidden: hidden === true });
    return null;
  }
  Trigger.Icon = function TriggerIcon() {
    return null;
  };
  Trigger.Label = function TriggerLabel() {
    return null;
  };
  NativeTabs.Trigger = Trigger;
  return { NativeTabs };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('expo-asset', () => ({
  useAssets: () => [undefined, undefined, undefined],
}));

jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    user: mock_auth_role.role === null ? null : { id: 'u1', role: mock_auth_role.role },
  }),
}));

/** ¿El layout declaró este trigger como oculto? */
function is_hidden(name: string): boolean {
  const trigger = declared_triggers.find((t) => t.name === name);
  if (trigger === undefined) throw new Error(`el layout no declaró el trigger "${name}"`);
  return trigger.hidden;
}

beforeEach(() => {
  mock_auth_role.role = null;
  declared_triggers.length = 0;
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe('IosNativeTabsLayout — slot 4 compartido Leads/Guardados', () => {
  it('EC-IT1: role="admin" ve Leads y no Guardados', async () => {
    mock_auth_role.role = 'admin';

    await render(<IosNativeTabsLayout />);

    expect(is_hidden('crm')).toBe(false);
    expect(is_hidden('saved')).toBe(true);
  });

  it('EC-IT2: role="agent" ve Leads y no Guardados (no-regresión)', async () => {
    mock_auth_role.role = 'agent';

    await render(<IosNativeTabsLayout />);

    expect(is_hidden('crm')).toBe(false);
    expect(is_hidden('saved')).toBe(true);
  });

  it('EC-IT3: role="user" ve Guardados y no Leads', async () => {
    mock_auth_role.role = 'user';

    await render(<IosNativeTabsLayout />);

    expect(is_hidden('crm')).toBe(true);
    expect(is_hidden('saved')).toBe(false);
  });

  it('EC-IT4: sin sesión se comporta como no-agente', async () => {
    mock_auth_role.role = null;

    await render(<IosNativeTabsLayout />);

    expect(is_hidden('crm')).toBe(true);
    expect(is_hidden('saved')).toBe(false);
  });
});
