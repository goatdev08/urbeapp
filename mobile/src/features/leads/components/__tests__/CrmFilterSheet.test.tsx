/**
 * Tests — CrmFilterSheet (subtarea 271.3, ensanchado desde CrmSearchSheet #267.7).
 * Archivo SUT: mobile/src/features/leads/components/CrmFilterSheet.tsx
 *
 * SEAM bajo test: el componente completo, sin mocks — FilterChipGroup y
 * Switch son los reales de RN/cross-feature (ya tienen su propia cobertura,
 * FilterChipGroup no se reinventa aquí).
 *
 * Casos (del PLAN de la subtarea):
 * (EC-1) Seleccionar 2 estados manda los 2 en onSubmit.
 * (EC-2) Ningún chip seleccionado manda status: null, NUNCA [] (D-STATUSEMPTY:
 *   [] es "cero estados elegidos" y la RPC lo resuelve como 0 filas).
 * (EC-3) Limpiar deja los 3 filtros en su valor neutro, incluida la búsqueda,
 *   y aplica de inmediato (onSubmit con el objeto neutro + cierra).
 * (EC-4) Reabrir la hoja precarga los filtros ACTIVOS (initialFilters), no un
 *   borrador abandonado de una apertura anterior sin aplicar.
 *
 * RNTL v14: render()/rerender() son async → SIEMPRE con `await`. Switch no
 * responde a `fireEvent.press` (no dispara onValueChange) — se togglea con
 * `fireEvent(element, 'valueChange', next)`, molde oficial de RNTL para Switch.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { CrmFilterSheet, type CrmFilters } from '../CrmFilterSheet';

const NEUTRAL_FILTERS: CrmFilters = { query: null, status: null, followUp: null };

/**
 * fireEvent es SÍNCRONO, pero RNTL v14 envuelve act() como async — sin
 * `await`, el update queda encolado y no se refleja antes de la siguiente
 * aserción (mismo patrón que CRMScreen.test.tsx).
 */
async function press(element: ReturnType<typeof screen.getByText>): Promise<void> {
  await act(async () => {
    fireEvent.press(element);
  });
}

async function change_text(element: ReturnType<typeof screen.getByText>, text: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(element, text);
  });
}

async function toggle_switch(element: ReturnType<typeof screen.getByText>, next: boolean): Promise<void> {
  await act(async () => {
    fireEvent(element, 'valueChange', next);
  });
}

describe('CrmFilterSheet', () => {
  it('(EC-1) seleccionar 2 estados manda los 2 en onSubmit', async () => {
    const on_submit = jest.fn();
    await render(
      <CrmFilterSheet visible initialFilters={NEUTRAL_FILTERS} onClose={jest.fn()} onSubmit={on_submit} />,
    );

    await press(screen.getByRole('checkbox', { name: 'Nuevo' }));
    await press(screen.getByRole('checkbox', { name: 'Visita' }));
    await press(screen.getByRole('button', { name: 'Aplicar' }));

    expect(on_submit).toHaveBeenCalledWith({ query: null, status: ['nuevo', 'visita'], followUp: null });
  });

  it('(EC-2) ningún chip seleccionado manda status: null, nunca []', async () => {
    const on_submit = jest.fn();
    await render(
      <CrmFilterSheet visible initialFilters={NEUTRAL_FILTERS} onClose={jest.fn()} onSubmit={on_submit} />,
    );

    await press(screen.getByRole('button', { name: 'Aplicar' }));

    expect(on_submit).toHaveBeenCalledWith(expect.objectContaining({ status: null }));
    const submitted = on_submit.mock.calls[0]?.[0] as CrmFilters;
    expect(submitted.status).not.toEqual([]);
  });

  it('(EC-3) Limpiar deja los 3 filtros neutros, incluida la búsqueda', async () => {
    const on_submit = jest.fn();
    const on_close = jest.fn();
    await render(
      <CrmFilterSheet
        visible
        initialFilters={{ query: 'andrea', status: ['nuevo'], followUp: true }}
        onClose={on_close}
        onSubmit={on_submit}
      />,
    );

    await press(screen.getByRole('button', { name: 'Limpiar' }));

    expect(on_submit).toHaveBeenCalledWith(NEUTRAL_FILTERS);
    expect(on_close).toHaveBeenCalled();
  });

  it('(EC-4) reabrir la hoja precarga los filtros ACTIVOS, no un borrador de una apertura anterior', async () => {
    const initial: CrmFilters = { query: 'andrea', status: ['nuevo', 'visita'], followUp: true };
    const { rerender } = await render(
      <CrmFilterSheet visible initialFilters={initial} onClose={jest.fn()} onSubmit={jest.fn()} />,
    );

    // El agente arma un borrador y lo abandona (cierra sin Aplicar) — el
    // padre en la vida real solo actualiza `initialFilters` cuando onSubmit
    // se llama, así que esta simulación mantiene `initial` fijo a propósito.
    await press(screen.getByRole('checkbox', { name: 'Cerrado' }));
    await change_text(screen.getByPlaceholderText('Buscar por nombre'), 'otro texto sin aplicar');
    await toggle_switch(screen.getByLabelText('En seguimiento'), false);

    await rerender(<CrmFilterSheet visible={false} initialFilters={initial} onClose={jest.fn()} onSubmit={jest.fn()} />);
    await rerender(<CrmFilterSheet visible initialFilters={initial} onClose={jest.fn()} onSubmit={jest.fn()} />);

    expect(screen.getByPlaceholderText('Buscar por nombre').props.value).toBe('andrea');
    expect(screen.getByRole('checkbox', { name: 'Nuevo' }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Visita' }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Cerrado' }).props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText('En seguimiento').props.value).toBe(true);
  });
});
