/**
 * Tests — AgentSelector (subtarea 269.6 añade `mode="assign"`; el componente
 * no tenía test propio — el rail de chips `mode="filter"` (default, ya
 * existente desde #28.2) se cubre aquí con un smoke mínimo, junto a la
 * cobertura completa del modo nuevo).
 * Archivo SUT: mobile/src/features/leads/components/AgentSelector.tsx
 *
 * Casos:
 * (EC-1) mode="filter" (default/smoke): chip "Todos" + un chip por agente,
 *   incluido el sufijo "(suspendido)".
 * (EC-2) mode="assign": SIN chip "Todos".
 * (EC-3) mode="assign": solo agentes status==='active' (filtra suspendidos).
 * (EC-4) mode="assign": tap en un agente llama onSelectAgent(id).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AgentSelector } from '../AgentSelector';
import type { Agent } from '../../types';

const ACTIVE: Agent = { id: 'agent-active', full_name: 'Karla Ibarra', profile_photo_url: null, status: 'active' };
const SUSPENDED: Agent = { id: 'agent-susp', full_name: 'Renata Solís', profile_photo_url: null, status: 'suspended' };

describe('AgentSelector', () => {
  it('(EC-1) mode="filter" (default): chip "Todos" + un chip por agente, sufijo "(suspendido)"', async () => {
    await render(<AgentSelector agents={[ACTIVE, SUSPENDED]} selectedAgentId={null} onSelectAgent={jest.fn()} />);

    expect(screen.getByText('Todos')).toBeTruthy();
    expect(screen.getByText('Karla Ibarra')).toBeTruthy();
    expect(screen.getByText('Renata Solís (suspendido)')).toBeTruthy();
  });

  it('(EC-2) mode="assign": sin chip "Todos"', async () => {
    await render(<AgentSelector agents={[ACTIVE]} selectedAgentId={null} onSelectAgent={jest.fn()} mode="assign" />);

    expect(screen.queryByText('Todos')).toBeNull();
  });

  it('(EC-3) mode="assign": filtra a solo status==="active"', async () => {
    await render(<AgentSelector agents={[ACTIVE, SUSPENDED]} selectedAgentId={null} onSelectAgent={jest.fn()} mode="assign" />);

    expect(screen.getByText('Karla Ibarra')).toBeTruthy();
    expect(screen.queryByText(/Renata Solís/)).toBeNull();
  });

  it('(EC-4) mode="assign": tap en un agente llama onSelectAgent(id)', async () => {
    const on_select = jest.fn();
    await render(<AgentSelector agents={[ACTIVE]} selectedAgentId={null} onSelectAgent={on_select} mode="assign" />);

    fireEvent.press(screen.getByLabelText('Asignar a Karla Ibarra'));

    expect(on_select).toHaveBeenCalledWith('agent-active');
  });
});
