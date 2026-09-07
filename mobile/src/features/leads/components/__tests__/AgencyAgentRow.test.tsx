/**
 * Tests — AgencyAgentRow (subtarea 269.6).
 * Archivo SUT: mobile/src/features/leads/components/AgencyAgentRow.tsx
 *
 * Casos:
 * (EC-1) flag='pierde_leads' → badge "PIERDE LEADS", métricas con valor real.
 * (EC-2) flag='acumula' → badge "ACUMULA".
 * (EC-3) sin flag y con métricas en 0/null → badge "SIN LEADS", métricas en "—".
 * (EC-4) sin flag y CON métricas → sin ningún badge.
 * (EC-5) tap en la fila llama onPress.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AgencyAgentRow } from '../AgencyAgentRow';
import type { AgencyAgentRow as AgencyAgentRowData } from '../../types';

function make_row(overrides: Partial<AgencyAgentRowData> = {}): AgencyAgentRowData {
  return {
    agent_id: 'agent-1',
    agent_name: 'Fernando Reyes',
    untouched_count: 2,
    response_hours: 6,
    avg_temperature: 41,
    flag: null,
    ...overrides,
  };
}

describe('AgencyAgentRow', () => {
  it('(EC-1) flag=pierde_leads → badge "PIERDE LEADS" y métricas reales', async () => {
    await render(<AgencyAgentRow row={make_row({ flag: 'pierde_leads', untouched_count: 4 })} onPress={jest.fn()} />);

    expect(screen.getByText('PIERDE LEADS')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.queryByText('SIN LEADS')).toBeNull();
  });

  it('(EC-2) flag=acumula → badge "ACUMULA"', async () => {
    await render(<AgencyAgentRow row={make_row({ flag: 'acumula' })} onPress={jest.fn()} />);

    expect(screen.getByText('ACUMULA')).toBeTruthy();
  });

  it('(EC-3) sin flag y 0 leads (untouched=0, avg_temperature/response_hours null) → badge "SIN LEADS" y métricas en "—"', async () => {
    await render(
      <AgencyAgentRow
        row={make_row({ flag: null, untouched_count: 0, avg_temperature: null, response_hours: null })}
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByText('SIN LEADS')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('(EC-4) sin flag y CON leads → sin ningún badge', async () => {
    await render(<AgencyAgentRow row={make_row({ flag: null, untouched_count: 1 })} onPress={jest.fn()} />);

    expect(screen.queryByText('SIN LEADS')).toBeNull();
    expect(screen.queryByText('PIERDE LEADS')).toBeNull();
    expect(screen.queryByText('ACUMULA')).toBeNull();
  });

  it('(EC-5) tap en la fila llama onPress', async () => {
    const on_press = jest.fn();
    await render(<AgencyAgentRow row={make_row()} onPress={on_press} />);

    fireEvent.press(screen.getByText('Fernando Reyes'));

    expect(on_press).toHaveBeenCalledTimes(1);
  });
});
