/**
 * Tests — PropertyActionMenu, conducta `disabled` (#25)
 * SUT: mobile/src/features/profile/components/PropertyActionMenu.tsx
 *
 * Contexto: #25 cablea isWorking del hook usePropertyActions al menú. Cuando hay
 * una mutación en vuelo, las filas de acción se atenúan y NO disparan (corta el
 * doble-tap por reapertura del menú). Cancelar permanece habilitado para que el
 * usuario siempre pueda cerrar.
 *
 * EDGE CASES:
 * - (EC-1) disabled=true → tap en una acción NO invoca su handler.
 * - (EC-2) disabled=true → tap en la acción destructiva (Eliminar) NO invoca su handler.
 * - (EC-3) disabled=true → Cancelar SIGUE invocando on_dismiss.
 * - (EC-4) disabled ausente (default) → tap en acción invoca su handler 1 vez.
 * - (EC-5) disabled=true → la fila de acción expone accessibilityState.disabled=true.
 *
 * NOTA RNTL v14: render() retorna Promise → tests async + await render(...).
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { PropertyActionMenu, type PropertyActionCallbacks } from '../PropertyActionMenu';
import type { MyProperty } from '@/features/profile/types';

// #143.6: los componentes ahora leen insets (barra de botones de Android) —
// mismo mock que register-user-mode.test.tsx.
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// item mínimo: el menú solo lee item.status para decidir las acciones.
const ITEM = { status: 'active' } as MyProperty;

function make_callbacks(overrides?: Partial<PropertyActionCallbacks>): PropertyActionCallbacks {
  return {
    on_edit: jest.fn(),
    on_toggle_pause: jest.fn(),
    on_close: jest.fn(),
    on_delete: jest.fn(),
    on_promote: jest.fn(),
    ...overrides,
  };
}

describe('PropertyActionMenu — disabled (#25)', () => {
  it('(EC-1) disabled_true_tap_accion_no_invoca_handler: con disabled=true, press en "Pausar" no llama on_toggle_pause', async () => {
    const cb = make_callbacks({ disabled: true });
    const on_dismiss = jest.fn();

    const { getByLabelText } = await render(
      <PropertyActionMenu visible item={ITEM} on_dismiss={on_dismiss} callbacks={cb} />,
    );

    fireEvent.press(getByLabelText('Pausar'));
    expect(cb.on_toggle_pause).not.toHaveBeenCalled();
  });

  it('(EC-2) disabled_true_tap_eliminar_no_invoca_handler: con disabled=true, press en "Eliminar" no llama on_delete', async () => {
    const cb = make_callbacks({ disabled: true });

    const { getByLabelText } = await render(
      <PropertyActionMenu visible item={ITEM} on_dismiss={jest.fn()} callbacks={cb} />,
    );

    fireEvent.press(getByLabelText('Eliminar'));
    expect(cb.on_delete).not.toHaveBeenCalled();
  });

  it('(EC-3) disabled_true_cancelar_sigue_activo: con disabled=true, press en "Cancelar" SÍ llama on_dismiss', async () => {
    const cb = make_callbacks({ disabled: true });
    const on_dismiss = jest.fn();

    const { getByLabelText } = await render(
      <PropertyActionMenu visible item={ITEM} on_dismiss={on_dismiss} callbacks={cb} />,
    );

    fireEvent.press(getByLabelText('Cancelar'));
    expect(on_dismiss).toHaveBeenCalledTimes(1);
  });

  it('(EC-4) disabled_ausente_tap_accion_invoca_handler: sin disabled, press en "Pausar" llama on_toggle_pause 1 vez', async () => {
    const cb = make_callbacks(); // disabled omitido → habilitado
    const on_dismiss = jest.fn();

    const { getByLabelText } = await render(
      <PropertyActionMenu visible item={ITEM} on_dismiss={on_dismiss} callbacks={cb} />,
    );

    fireEvent.press(getByLabelText('Pausar'));
    expect(cb.on_toggle_pause).toHaveBeenCalledTimes(1);
  });

  it('(EC-5) disabled_true_fila_expone_accessibilityState_disabled: la fila "Pausar" tiene accessibilityState.disabled=true', async () => {
    const cb = make_callbacks({ disabled: true });

    const { getByLabelText } = await render(
      <PropertyActionMenu visible item={ITEM} on_dismiss={jest.fn()} callbacks={cb} />,
    );

    expect(getByLabelText('Pausar').props.accessibilityState?.disabled).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 213 — "Promocionar": visible solo con status='active' Y agency_id.
// ───────────────────────────────────────────────────────────────────────────
describe('PropertyActionMenu — 213: acción "Promocionar"', () => {
  it('(EC-PROMOTE-1) status=active + agency_id → "Promocionar" aparece y su tap invoca on_promote', async () => {
    const cb = make_callbacks();
    const item = { status: 'active', agency_id: 'agency-uuid-1' } as MyProperty;

    const { getByLabelText } = await render(
      <PropertyActionMenu visible item={item} on_dismiss={jest.fn()} callbacks={cb} />,
    );

    fireEvent.press(getByLabelText('Promocionar'));
    expect(cb.on_promote).toHaveBeenCalledTimes(1);
  });

  it('(EC-PROMOTE-2) status=active SIN agency_id (agente independiente) → "Promocionar" NO aparece', async () => {
    const cb = make_callbacks();
    const item = { status: 'active', agency_id: null } as MyProperty;

    const { queryByLabelText } = await render(
      <PropertyActionMenu visible item={item} on_dismiss={jest.fn()} callbacks={cb} />,
    );

    expect(queryByLabelText('Promocionar')).toBeNull();
  });

  it('(EC-PROMOTE-3) status=paused CON agency_id → "Promocionar" NO aparece (solo publicaciones activas)', async () => {
    const cb = make_callbacks();
    const item = { status: 'paused', agency_id: 'agency-uuid-1' } as MyProperty;

    const { queryByLabelText } = await render(
      <PropertyActionMenu visible item={item} on_dismiss={jest.fn()} callbacks={cb} />,
    );

    expect(queryByLabelText('Promocionar')).toBeNull();
  });

  it('(EC-PROMOTE-4) disabled=true → tap en "Promocionar" no invoca el handler', async () => {
    const cb = make_callbacks({ disabled: true });
    const item = { status: 'active', agency_id: 'agency-uuid-1' } as MyProperty;

    const { getByLabelText } = await render(
      <PropertyActionMenu visible item={item} on_dismiss={jest.fn()} callbacks={cb} />,
    );

    fireEvent.press(getByLabelText('Promocionar'));
    expect(cb.on_promote).not.toHaveBeenCalled();
  });
});
