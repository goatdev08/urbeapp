/**
 * Tests fase RED — RadiusSelector (slider continuo + toggle "sin límite")
 * Subtarea Taskmaster: 58.2 — reemplaza el segmented-control de 4 pills
 * (5/10/20/50 km) por un slider continuo (0–50 km, step 1 km) + un toggle
 * "Sin límite" que colapsa el filtro a `radius_m = null` (búsqueda global,
 * #58.1/#58.3/#58.4 ya soportan `null` en feed/mapa/RPC).
 *
 * SUT: mobile/src/features/search/components/RadiusSelector.tsx
 *   export interface RadiusSelectorProps {
 *     value: number | null;              // null = "sin límite"
 *     onChange: (v: number | null) => void;
 *   }
 *
 * CONTRATO EXIGIDO (decisión de test-author — el gesto de drag de
 * react-native-gesture-handler + reanimated NO es simulable de forma
 * confiable en Jest; se exige en su lugar que el componente exponga el
 * slider como un elemento de accesibilidad "adjustable" con
 * accessibilityActions increment/decrement, que sí se puede disparar vía
 * fireEvent(..., 'accessibilityAction', ...) de forma determinista):
 *
 *   - Toggle "Sin límite":
 *       testID="radius_unlimited_toggle"
 *       accessibilityRole="switch"
 *       accessibilityLabel="Sin límite (mostrar todo)"
 *       accessibilityState={{ checked: value === null }}
 *       onPress → si value === null: onChange(DEFAULT_RADIUS_M = 5000)
 *                 si value !== null: onChange(null)
 *
 *   - Label de valor vivo:
 *       testID="radius_value_label"
 *       texto "{value/1000} km" cuando value !== null (p.ej. "5 km")
 *       texto "Sin límite" cuando value === null
 *
 *   - Slider:
 *       testID="radius_slider"
 *       accessibilityRole="adjustable"
 *       accessibilityValue={{ min: 0, max: 50000, now: <valor efectivo>,
 *                              text: "<km> kilómetros" }}
 *       accessibilityState={{ disabled: value === null }}
 *       accessibilityActions incluye { name: 'increment' } y
 *         { name: 'decrement' } (step = 1000 m)
 *       onAccessibilityAction:
 *         - si disabled (value === null): NO invoca onChange.
 *         - si no disabled: invoca onChange(valor ± 1000), clamped a
 *           [0, 50000] — en el límite, NO invoca onChange (no-op, nunca
 *           emite un valor fuera de rango).
 *
 * El RadiusSelector actual (pills 5/10/20/50) no expone ninguno de estos
 * testIDs/roles → todo el archivo debe fallar en RED por aserciones
 * get-by-testid / query-by-testid, NO por error de import/compilación.
 *
 * EDGE CASES (RED):
 * ### Happy path
 * - (EC-SLIDER-1) render_value_5000_muestra_label_5_km
 * ### Edge cases del PRD / spec de la subtarea (58.2)
 * - (EC-SLIDER-2) drag_incrementa_valor_llama_onchange_redondeado_a_step
 * - (EC-SLIDER-2b) drag_decrementa_valor_llama_onchange_redondeado_a_step
 * - (EC-SLIDER-4) toggle_on_desde_valor_numerico_llama_onchange_null_y_deshabilita_slider
 * - (EC-SLIDER-5) toggle_off_desde_null_llama_onchange_5000_default
 * - (EC-SLIDER-7) render_value_null_toggle_activado_y_label_sin_limite
 * ### Boundary / error
 * - (EC-SLIDER-3a) increment_en_el_tope_50000_no_emite_valor_fuera_de_rango
 * - (EC-SLIDER-3b) decrement_en_el_piso_0_no_emite_valor_fuera_de_rango
 * - (EC-SLIDER-4b) slider_deshabilitado_accessibilityAction_no_invoca_onchange
 * ### Accesibilidad
 * - (EC-SLIDER-6a) slider_expone_accessibilityRole_adjustable_y_accessibilityValue_con_km_actual
 * - (EC-SLIDER-6b) toggle_expone_accessibilityRole_switch_con_accessibilityState_checked
 *
 * NOTA RNTL v14: render() retorna Promise → todos los tests son async + await render(...).
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { RadiusSelector } from '../components/RadiusSelector';

const DEFAULT_RADIUS_M = 5000;
const MAX_RADIUS_M = 50000;
const MIN_RADIUS_M = 0;
const STEP_M = 1000;

/** Dispara la accessibilityAction 'increment'/'decrement' sobre el slider. */
// ponytail: `any` deliberado — helper de test, el tipo real (ReactTestInstance)
// no vale la pena importar solo para esta firma interna.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fire_slider_action(slider: any, action_name: 'increment' | 'decrement') {
  fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: action_name } });
}

describe('RadiusSelector — slider continuo + toggle "sin límite" (#58.2)', () => {
  // ── (EC-SLIDER-1) Happy path: value=5000 → label "5 km" ──────────────────

  it('(EC-SLIDER-1) render_value_5000_muestra_label_5_km: value=5000 → testID="radius_value_label" muestra "5 km"', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={5000} onChange={on_change} />);

    expect(getByTestId('radius_value_label').props.children).toEqual(
      expect.stringContaining('5 km')
    );
  });

  // ── (EC-SLIDER-2) Drag/increment → onChange con el valor nuevo (step) ────

  it('(EC-SLIDER-2) drag_incrementa_valor_llama_onchange_redondeado_a_step: value=10000 → accessibilityAction "increment" llama onChange(11000)', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={10000} onChange={on_change} />);

    fire_slider_action(getByTestId('radius_slider'), 'increment');

    expect(on_change).toHaveBeenCalledWith(11000);
  });

  it('(EC-SLIDER-2b) drag_decrementa_valor_llama_onchange_redondeado_a_step: value=10000 → accessibilityAction "decrement" llama onChange(9000)', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={10000} onChange={on_change} />);

    fire_slider_action(getByTestId('radius_slider'), 'decrement');

    expect(on_change).toHaveBeenCalledWith(9000);
  });

  // ── (EC-SLIDER-3) Clamp a [0, 50000] — no emite valores fuera de rango ───

  it('(EC-SLIDER-3a) increment_en_el_tope_50000_no_emite_valor_fuera_de_rango: value=50000 → accessibilityAction "increment" NUNCA invoca onChange con >50000', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={MAX_RADIUS_M} onChange={on_change} />);

    fire_slider_action(getByTestId('radius_slider'), 'increment');

    for (const call of on_change.mock.calls) {
      expect(call[0]).toBeLessThanOrEqual(MAX_RADIUS_M);
    }
    expect(on_change).not.toHaveBeenCalledWith(MAX_RADIUS_M + STEP_M);
  });

  it('(EC-SLIDER-3b) decrement_en_el_piso_0_no_emite_valor_fuera_de_rango: value=0 → accessibilityAction "decrement" NUNCA invoca onChange con <0', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={MIN_RADIUS_M} onChange={on_change} />);

    fire_slider_action(getByTestId('radius_slider'), 'decrement');

    for (const call of on_change.mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(MIN_RADIUS_M);
    }
    expect(on_change).not.toHaveBeenCalledWith(MIN_RADIUS_M - STEP_M);
  });

  // ── (EC-SLIDER-4) Toggle ON (desde numérico) → onChange(null) + disabled ─

  it('(EC-SLIDER-4) toggle_on_desde_valor_numerico_llama_onchange_null_y_deshabilita_slider: value=15000, press toggle → onChange(null)', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={15000} onChange={on_change} />);

    fireEvent.press(getByTestId('radius_unlimited_toggle'));

    expect(on_change).toHaveBeenCalledWith(null);
  });

  it('(EC-SLIDER-4b) slider_deshabilitado_accessibilityAction_no_invoca_onchange: value=null → accessibilityAction "increment" en el slider NO invoca onChange', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={null} onChange={on_change} />);

    fire_slider_action(getByTestId('radius_slider'), 'increment');

    expect(on_change).not.toHaveBeenCalled();
  });

  // ── (EC-SLIDER-5) Toggle OFF (desde null) → onChange(5000 default) ───────

  it('(EC-SLIDER-5) toggle_off_desde_null_llama_onchange_5000_default: value=null, press toggle → onChange(5000)', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={null} onChange={on_change} />);

    fireEvent.press(getByTestId('radius_unlimited_toggle'));

    expect(on_change).toHaveBeenCalledWith(DEFAULT_RADIUS_M);
  });

  // ── (EC-SLIDER-7) render value=null → toggle activado + label "Sin límite" ─

  it('(EC-SLIDER-7) render_value_null_toggle_activado_y_label_sin_limite: value=null → toggle accessibilityState.checked=true y label muestra "Sin límite"', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={null} onChange={on_change} />);

    expect(getByTestId('radius_unlimited_toggle').props.accessibilityState?.checked).toBe(true);
    expect(getByTestId('radius_value_label').props.children).toEqual(
      expect.stringContaining('Sin límite')
    );
  });

  // ── (EC-SLIDER-6) Accesibilidad ───────────────────────────────────────────

  it('(EC-SLIDER-6a) slider_expone_accessibilityRole_adjustable_y_accessibilityValue_con_km_actual: value=20000 → accessibilityRole="adjustable" y accessibilityValue.text contiene "20"', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={20000} onChange={on_change} />);

    const slider = getByTestId('radius_slider');
    expect(slider.props.accessibilityRole).toBe('adjustable');
    expect(slider.props.accessibilityValue?.text).toEqual(expect.stringContaining('20'));
  });

  it('(EC-SLIDER-6b) toggle_expone_accessibilityRole_switch_con_accessibilityState_checked: value=10000 (numérico) → toggle accessibilityRole="switch" y accessibilityState.checked=false', async () => {
    const on_change = jest.fn();
    const { getByTestId } = await render(<RadiusSelector value={10000} onChange={on_change} />);

    const toggle = getByTestId('radius_unlimited_toggle');
    expect(toggle.props.accessibilityRole).toBe('switch');
    expect(toggle.props.accessibilityState?.checked).toBe(false);
  });
});
