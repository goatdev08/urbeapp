/**
 * Tests — AdsLayout (mobile/app/(protected)/ads/_layout.tsx)
 * Subtarea Taskmaster: 169.8 — gate de CAPACIDAD por RUTA.
 *
 * 🔴 Por qué existe este archivo (guardián, 2026-08-16): mutar `_layout.tsx`
 * para que monte el `Slot` durante `loading`, o para que deje de redirigir
 * y solo oculte contenido, pasaba las 1190 pruebas previas — nada custodiaba
 * la mitad del criterio de aceptación ("sin la capacidad la RUTA no
 * existe"). El smoke con deep link que pide la subtarea es HOY inejecutable
 * (ads/ solo tiene _layout.tsx, sin pantallas hijas — 169.9 las agrega — así
 * que <Slot/> no resuelve a nada y cualquier smoke sería un "✅" ficticio).
 * Estos 3 tests son el sustituto verificable mientras tanto.
 *
 * SEAM BAJO TEST: el componente de ruta `AdsLayout` (default export de
 * `_layout.tsx`), con `useCanAdvertise` (169.8, ya tiene sus 21 tests
 * propios) MOCKEADO — aquí solo se prueba la DECISIÓN de render a partir de
 * { can_advertise, loading }, no la resolución de la capacidad.
 *
 * Patrón calcado de mobile/src/features/admin/__tests__/admin-layout.test.tsx
 * (el gate que el GREEN de esta subtarea usó como referencia): holder mutable
 * para el hook mockeado + mock de expo-router que CAPTURA el href real de
 * `<Redirect>` (un mock que solo renderizara "algo" no distinguiría
 * "redirige a X" de "redirige a cualquier otro lado" ni de "oculta
 * contenido sin redirigir" — el criterio exige que un deep link REBOTE).
 *
 * EDGE CASES CUBIERTOS:
 *
 * - (EC-AD1) loading_true_no_monta_slot_ni_redirige: mientras se resuelve la
 *   capacidad, el Slot NUNCA se monta (ni siquiera con can_advertise=true
 *   simultáneo — loading tiene prioridad absoluta, mismo criterio que
 *   AdminLayout EC-AL2) y tampoco hay Redirect — solo el indicador de carga.
 * - (EC-AD2) sin_capacidad_redirige_de_verdad_no_solo_oculta: loading=false,
 *   can_advertise=false → SE RENDERIZA `<Redirect>` con su destino real
 *   capturado (no una ausencia de contenido) — un deep link a `ads/algo`
 *   rebota, no cae en una pantalla vacía procesable.
 * - (EC-AD3) con_capacidad_monta_el_slot: loading=false, can_advertise=true
 *   → se monta `<Slot/>`, sin Redirect ni indicador de carga.
 */

import React from 'react';
import { render, act, cleanup } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock de useCanAdvertise — holder mutable, ANTES de importar el SUT.
// ---------------------------------------------------------------------------

const mock_can_advertise_state: { can_advertise: boolean; loading: boolean } = {
  can_advertise: false,
  loading: true,
};

jest.mock('@/features/ads/hooks/useCanAdvertise', () => ({
  useCanAdvertise: () => ({
    can_advertise: mock_can_advertise_state.can_advertise,
    loading: mock_can_advertise_state.loading,
  }),
}));

// Captura el href real que recibe <Redirect> — un mock que solo devolviera
// "algo" no distinguiría "redirige a X" de "oculta contenido sin redirigir".
let captured_redirect_href: string | null = null;

jest.mock('expo-router', () => {
  const { View, Text } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => {
      captured_redirect_href = href;
      return (
        <View testID="redirect-component">
          <Text testID="redirect-href">{href}</Text>
        </View>
      );
    },
    Slot: () => <View testID="slot-content" />,
  };
});

// ---------------------------------------------------------------------------
// SUT — importado DESPUÉS de los mocks
// ---------------------------------------------------------------------------

import AdsLayout from '../_layout';

type RenderResult = Awaited<ReturnType<typeof render>>;

beforeEach(() => {
  captured_redirect_href = null;
  mock_can_advertise_state.can_advertise = false;
  mock_can_advertise_state.loading = true;
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-AD1) loading=true — NO Slot, NO Redirect, solo el indicador
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-AD1: loading_true_no_monta_slot_ni_redirige', () => {
  it('loading=true (con can_advertise=true simultáneo) → indicador de carga presente; Slot AUSENTE; Redirect AUSENTE', async () => {
    // can_advertise=true a propósito: prueba que loading manda incluso si
    // la capacidad ya "diría que sí" — mata el mutante que monta el Slot
    // en cuanto can_advertise es true, sin esperar a que loading baje.
    mock_can_advertise_state.loading = true;
    mock_can_advertise_state.can_advertise = true;

    let q!: RenderResult;
    await act(async () => {
      q = await render(<AdsLayout />);
    });

    expect(q.getByTestId('ads-gate-loading')).toBeTruthy();
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('redirect-component')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-AD2) loading=false, can_advertise=false — Redirect REAL, no solo ocultar
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-AD2: sin_capacidad_redirige_de_verdad_no_solo_oculta', () => {
  it('loading=false, can_advertise=false → SE RENDERIZA <Redirect> con destino capturado; Slot AUSENTE; loading AUSENTE', async () => {
    mock_can_advertise_state.loading = false;
    mock_can_advertise_state.can_advertise = false;

    let q!: RenderResult;
    await act(async () => {
      q = await render(<AdsLayout />);
    });

    // El criterio de la subtarea es "la RUTA no existe" — un deep link debe
    // REBOTAR a un destino real, no solo dejar la pantalla sin contenido.
    expect(q.getByTestId('redirect-component')).toBeTruthy();
    expect(typeof captured_redirect_href).toBe('string');
    expect((captured_redirect_href as string).length).toBeGreaterThan(0);
    expect(q.getByTestId('redirect-href').props.children).toBe(captured_redirect_href);
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('ads-gate-loading')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-AD3) loading=false, can_advertise=true — Slot montado
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-AD3: con_capacidad_monta_el_slot', () => {
  it('loading=false, can_advertise=true → Slot presente; Redirect AUSENTE; loading AUSENTE', async () => {
    mock_can_advertise_state.loading = false;
    mock_can_advertise_state.can_advertise = true;

    let q!: RenderResult;
    await act(async () => {
      q = await render(<AdsLayout />);
    });

    expect(q.getByTestId('slot-content')).toBeTruthy();
    expect(q.queryByTestId('redirect-component')).toBeNull();
    expect(q.queryByTestId('ads-gate-loading')).toBeNull();
  });
});
