/**
 * Tests — AdsLayout (mobile/app/(protected)/ads/_layout.tsx)
 * Subtarea Taskmaster: 169.8 — gate de CAPACIDAD por RUTA. Ampliado en 212.5
 * con el fallback "≥1 anuncio propio" (exploración 040).
 *
 * 🔴 Por qué existe este archivo (guardián, 2026-08-16): mutar `_layout.tsx`
 * para que monte el `Slot` durante `loading`, o para que deje de redirigir
 * y solo oculte contenido, pasaba las 1190 pruebas previas — nada custodiaba
 * la mitad del criterio de aceptación ("sin la capacidad la RUTA no
 * existe"). El smoke con deep link que pide la subtarea es HOY inejecutable
 * (ads/ solo tiene _layout.tsx, sin pantallas hijas — 169.9 las agrega — así
 * que <Slot/> no resuelve a nada y cualquier smoke sería un "✅" ficticio).
 * Estos tests son el sustituto verificable mientras tanto.
 *
 * SEAM BAJO TEST: el componente de ruta `AdsLayout` (default export de
 * `_layout.tsx`), con `useCanAdvertise` (169.8, ya tiene sus 21 tests
 * propios) y `useMyAds` (171.3, 18 tests propios) MOCKEADOS — aquí solo se
 * prueba la DECISIÓN de render a partir de { can_advertise, loading } +
 * { ads, loading }, no la resolución de ninguno de los dos.
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
 *   capacidad, el navigator NUNCA se monta (ni siquiera con can_advertise=true
 *   simultáneo — loading tiene prioridad absoluta, mismo criterio que
 *   AdminLayout EC-AL2) y tampoco hay Redirect — solo el indicador de carga.
 * - (EC-AD2) sin_capacidad_ni_anuncios_redirige_de_verdad_no_solo_oculta:
 *   capability loading=false/can_advertise=false Y my_ads loading=false/
 *   ads=[] → SE RENDERIZA `<Redirect>` con su destino real capturado (no una
 *   ausencia de contenido) — un deep link a `ads/algo` rebota, no cae en una
 *   pantalla vacía procesable.
 * - (EC-AD3) con_capacidad_monta_el_stack_sin_esperar_my_ads: capability
 *   loading=false/can_advertise=true, con `my_ads.loading=true` (a
 *   propósito) → el <Stack/> se monta DE INMEDIATO — la capacidad sola ya
 *   autoriza, esperar a useMyAds() aquí solo agregaría latencia a la ruta
 *   más común (anunciante activo). Mata el mutante que hace depender el
 *   camino rápido del estado de `my_ads`.
 * - (EC-AD4) sin_capacidad_pero_con_anuncios_previos_monta_el_stack (212.5,
 *   decisión de exploración 040): can_advertise=false pero
 *   `my_ads.ads.length > 0` → <Stack/> — una capacidad revocada después de
 *   haber anunciado no debe esconder el historial de sus propias
 *   estadísticas.
 * - (EC-AD5) sin_capacidad_my_ads_cargando_no_decide_aun: can_advertise=false
 *   y `my_ads.loading=true` → solo el indicador de carga (ni Stack ni
 *   Redirect) — el fallback no puede decidir "no hay anuncios" antes de que
 *   la consulta resuelva.
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

// useMyAds — 212.5, fallback "≥1 anuncio propio". Se invoca SIEMPRE (reglas
// de hooks), su resultado solo importa cuando can_advertise=false.
const mock_my_ads_state: { ads: { id: string }[]; loading: boolean } = {
  ads: [],
  loading: true,
};

jest.mock('@/features/ads/hooks/useMyAds', () => ({
  useMyAds: () => ({
    ads: mock_my_ads_state.ads,
    agency_id: null,
    loading: mock_my_ads_state.loading,
    error: null,
  }),
}));

// Captura el href real que recibe <Redirect> — un mock que solo devolviera
// "algo" no distinguiría "redirige a X" de "oculta contenido sin redirigir".
let captured_redirect_href: string | null = null;

// `Stack` y `Slot` conviven en el mock A PROPÓSITO (#251): el gate debe montar
// un NAVIGATOR CON CHROME (Stack) y no un <Slot/> — con Slot, el
// `<Stack.Screen options={{ headerShown: true }}>` de index.tsx / [id].tsx le
// hablaba a un navigator que no pinta header y la pantalla arrancaba en y=0,
// bajo el reloj y los íconos de estado. Si ambos no estuvieran mockeados aquí,
// un regreso a <Slot/> pasaría los tests sin que nadie lo notara.
let captured_stack_options: Record<string, unknown> | null = null;

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
    Stack: ({ screenOptions }: { screenOptions?: Record<string, unknown> }) => {
      captured_stack_options = screenOptions ?? null;
      return <View testID="stack-content" />;
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
  captured_stack_options = null;
  mock_can_advertise_state.can_advertise = false;
  mock_can_advertise_state.loading = true;
  mock_my_ads_state.ads = [];
  mock_my_ads_state.loading = true;
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-AD1) loading=true — NO Slot, NO Redirect, solo el indicador
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-AD1: loading_true_no_monta_slot_ni_redirige', () => {
  it('loading=true (con can_advertise=true simultáneo) → indicador de carga presente; Stack AUSENTE; Redirect AUSENTE', async () => {
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
    expect(q.queryByTestId('stack-content')).toBeNull();
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('redirect-component')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-AD2) sin capacidad NI anuncios — Redirect REAL, no solo ocultar
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-AD2: sin_capacidad_ni_anuncios_redirige_de_verdad_no_solo_oculta', () => {
  it('can_advertise=false, my_ads.ads=[] (ambos resueltos) → SE RENDERIZA <Redirect> con destino capturado; Stack AUSENTE; loading AUSENTE', async () => {
    mock_can_advertise_state.loading = false;
    mock_can_advertise_state.can_advertise = false;
    mock_my_ads_state.loading = false;
    mock_my_ads_state.ads = [];

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
    expect(q.queryByTestId('stack-content')).toBeNull();
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('ads-gate-loading')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-AD3) can_advertise=true — Stack montado SIN esperar a useMyAds
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-AD3: con_capacidad_monta_el_stack_sin_esperar_my_ads', () => {
  it('loading=false, can_advertise=true, con my_ads.loading=true (a propósito) → Stack presente DE INMEDIATO; Redirect AUSENTE; loading AUSENTE', async () => {
    mock_can_advertise_state.loading = false;
    mock_can_advertise_state.can_advertise = true;
    // A propósito TODAVÍA cargando — la capacidad sola ya autoriza; el gate
    // no debe esperar a useMyAds() para montar el Slot (mata el mutante que
    // hace depender el camino rápido del estado de my_ads).
    mock_my_ads_state.loading = true;

    let q!: RenderResult;
    await act(async () => {
      q = await render(<AdsLayout />);
    });

    expect(q.getByTestId('stack-content')).toBeTruthy();
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('redirect-component')).toBeNull();
    expect(q.queryByTestId('ads-gate-loading')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-AD4) sin capacidad PERO con ≥1 anuncio propio — fallback 040
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-AD4: sin_capacidad_pero_con_anuncios_previos_monta_el_stack', () => {
  it('can_advertise=false, my_ads resuelto con ≥1 anuncio → Stack presente; Redirect AUSENTE (exploración 040)', async () => {
    mock_can_advertise_state.loading = false;
    mock_can_advertise_state.can_advertise = false;
    mock_my_ads_state.loading = false;
    mock_my_ads_state.ads = [{ id: 'ad-1' }];

    let q!: RenderResult;
    await act(async () => {
      q = await render(<AdsLayout />);
    });

    expect(q.getByTestId('stack-content')).toBeTruthy();
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('redirect-component')).toBeNull();
    expect(q.queryByTestId('ads-gate-loading')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-AD5) sin capacidad, my_ads AÚN cargando — no decide todavía
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-AD5: sin_capacidad_my_ads_cargando_no_decide_aun', () => {
  it('can_advertise=false (resuelto), my_ads.loading=true → solo el indicador de carga; ni Stack ni Redirect', async () => {
    mock_can_advertise_state.loading = false;
    mock_can_advertise_state.can_advertise = false;
    mock_my_ads_state.loading = true;

    let q!: RenderResult;
    await act(async () => {
      q = await render(<AdsLayout />);
    });

    expect(q.getByTestId('ads-gate-loading')).toBeTruthy();
    expect(q.queryByTestId('stack-content')).toBeNull();
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('redirect-component')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-AD6, #251) el contenido autorizado es un Stack con chrome, no un Slot
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-AD6: el_contenido_autorizado_es_un_stack_con_header_apagado_por_defecto', () => {
  it('con capacidad → se monta <Stack/> (nunca <Slot/>) y sus screenOptions traen headerShown:false — el wizard ads/new/ conserva su WizardHeader y las pantallas que piden headerShown:true lo obtienen de ESTE navigator', async () => {
    mock_can_advertise_state.loading = false;
    mock_can_advertise_state.can_advertise = true;

    let q!: RenderResult;
    await act(async () => {
      q = await render(<AdsLayout />);
    });

    expect(q.getByTestId('stack-content')).toBeTruthy();
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(captured_stack_options).not.toBeNull();
    expect((captured_stack_options as Record<string, unknown>).headerShown).toBe(false);
  });
});
