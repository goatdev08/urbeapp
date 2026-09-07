/**
 * Tests — AssignLeadSheet (subtarea 269.6).
 * Archivo SUT: mobile/src/features/leads/components/AssignLeadSheet.tsx
 *
 * `reassign` viaja como prop (no se mockea el módulo useReassignLead) — el
 * componente es presentacional puro sobre esa función, mismo criterio que
 * CrmSearchSheet (sin hooks de datos propios).
 *
 * Casos:
 * (EC-1) elegir un agente llama reassign(lead_id, agent_id) y, en éxito,
 *   muestra el banner de éxito y llama onAssigned.
 * (EC-2) en error, muestra el banner de error con el `message` del resultado
 *   y NO llama onAssigned.
 * (EC-3) reabrir para OTRO lead limpia el feedback anterior.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { AssignLeadSheet } from '../AssignLeadSheet';
import type { Agent } from '../../types';

const AGENT_A: Agent = { id: 'agent-a', full_name: 'Karla Ibarra', profile_photo_url: null, status: 'active' };
const AGENT_B: Agent = { id: 'agent-b', full_name: 'Fernando Reyes', profile_photo_url: null, status: 'active' };

async function press(element: ReturnType<typeof screen.getByText>): Promise<void> {
  await act(async () => {
    fireEvent.press(element);
  });
}

describe('AssignLeadSheet', () => {
  it('(EC-1) elegir un agente llama reassign(lead_id, agent_id); éxito → banner + onAssigned', async () => {
    const reassign = jest.fn().mockResolvedValue({ ok: true });
    const on_assigned = jest.fn();

    await render(
      <AssignLeadSheet
        visible
        lead={{ lead_id: 'lead-1', lead_display_name: 'Diego Martínez' }}
        agents={[AGENT_A, AGENT_B]}
        reassign={reassign}
        onClose={jest.fn()}
        onAssigned={on_assigned}
      />,
    );

    await press(screen.getByLabelText('Asignar a Karla Ibarra'));

    expect(reassign).toHaveBeenCalledWith('lead-1', 'agent-a');
    expect(on_assigned).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Diego Martínez ahora es de Karla Ibarra')).toBeTruthy();
  });

  it('(EC-2) error → banner con el mensaje del resultado, sin onAssigned', async () => {
    const reassign = jest.fn().mockResolvedValue({ ok: false, message: 'Ese agente ya no está activo en la inmobiliaria.' });
    const on_assigned = jest.fn();

    await render(
      <AssignLeadSheet
        visible
        lead={{ lead_id: 'lead-1', lead_display_name: 'Diego Martínez' }}
        agents={[AGENT_A]}
        reassign={reassign}
        onClose={jest.fn()}
        onAssigned={on_assigned}
      />,
    );

    await press(screen.getByLabelText('Asignar a Karla Ibarra'));

    expect(screen.getByText('Ese agente ya no está activo en la inmobiliaria.')).toBeTruthy();
    expect(on_assigned).not.toHaveBeenCalled();
  });

  it('(EC-3) reabrir la hoja para OTRO lead limpia el feedback anterior', async () => {
    const reassign = jest.fn().mockResolvedValue({ ok: true });

    const { rerender } = await render(
      <AssignLeadSheet
        visible
        lead={{ lead_id: 'lead-1', lead_display_name: 'Diego Martínez' }}
        agents={[AGENT_A]}
        reassign={reassign}
        onClose={jest.fn()}
        onAssigned={jest.fn()}
      />,
    );

    await press(screen.getByLabelText('Asignar a Karla Ibarra'));
    expect(screen.getByText('Diego Martínez ahora es de Karla Ibarra')).toBeTruthy();

    // Cierra y reabre para OTRO lead — el feedback del anterior no debe arrastrarse.
    await act(async () => {
      rerender(
        <AssignLeadSheet
          visible={false}
          lead={null}
          agents={[AGENT_A]}
          reassign={reassign}
          onClose={jest.fn()}
          onAssigned={jest.fn()}
        />,
      );
    });
    await act(async () => {
      rerender(
        <AssignLeadSheet
          visible
          lead={{ lead_id: 'lead-2', lead_display_name: 'Ana Torres' }}
          agents={[AGENT_A]}
          reassign={reassign}
          onClose={jest.fn()}
          onAssigned={jest.fn()}
        />,
      );
    });

    expect(screen.queryByText('Diego Martínez ahora es de Karla Ibarra')).toBeNull();
  });
});
