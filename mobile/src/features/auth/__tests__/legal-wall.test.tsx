/**
 * Tests — LegalWall (mobile/src/features/auth/components/legal-wall.tsx)
 * Subtarea 72.6 (PRD §5.5).
 *
 * Escritos tras la auditoría del guardián, que encontró que el muro descartaba en
 * silencio el error al traer el texto de los documentos: la tarjeta se quedaba en
 * "Cargando el documento…" pero el checkbox seguía marcable y el botón se habilitaba.
 * O sea, se podía "aceptar" un documento que nunca se mostró — exactamente lo contrario
 * del consentimiento INFORMADO que §5.5 existe para sostener.
 *
 * La invariante que fija este archivo: sin texto en pantalla, no hay aceptación posible.
 */
import React from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react-native';

import { supabase } from '@/lib/supabase/client';
import { LegalWall } from '../components/legal-wall';
import type { PendingLegalDocument } from '../hooks/useLegalGate';

jest.mock('@/lib/supabase/client', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({ signOut: jest.fn() }),
}));

const mock_from = supabase.from as jest.MockedFunction<typeof supabase.from>;

const TERMS: PendingLegalDocument = {
  doc_type: 'terms',
  version: '2.0',
  terms_version_id: 'v-terms-2-0',
};

/** Arma supabase.from('terms_versions').select(...).in(...) → {data, error}. */
function setup_contents(
  result: { data: { id: string; content: string }[] | null; error: { message: string } | null }
) {
  const mock_in = jest.fn().mockResolvedValue(result);
  const mock_select = jest.fn().mockReturnValue({ in: mock_in });
  mock_from.mockReturnValue({ select: mock_select } as unknown as ReturnType<typeof supabase.from>);
  return { mock_in, mock_select };
}

type RenderResult = Awaited<ReturnType<typeof render>>;

async function render_wall(accept = jest.fn()): Promise<RenderResult> {
  let q!: RenderResult;
  await act(async () => {
    q = await render(<LegalWall pending={[TERMS]} error={null} accept={accept} />);
  });
  return q;
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('LegalWall — el texto cargó', () => {
  it('muestra el contenido del documento y permite marcarlo y aceptar', async () => {
    setup_contents({ data: [{ id: 'v-terms-2-0', content: 'Texto legal de prueba.' }], error: null });
    const accept = jest.fn().mockResolvedValue(undefined);

    const q = await render_wall(accept);

    expect(q.queryByText('Texto legal de prueba.')).not.toBeNull();

    await act(async () => {
      fireEvent.press(q.getByTestId('accept-terms'));
    });
    await act(async () => {
      fireEvent.press(q.getByTestId('accept-terms-submit'));
    });

    expect(accept).toHaveBeenCalledTimes(1);
  });
});

describe('LegalWall — el texto NO cargó (la invariante de §5.5)', () => {
  it('expone el error en vez de descartarlo', async () => {
    setup_contents({ data: null, error: { message: 'connection timeout' } });

    const q = await render_wall();

    expect(q.queryByTestId('legal-wall-contents-error')).not.toBeNull();
  });

  it('NO permite aceptar un documento cuyo texto nunca se mostró', async () => {
    setup_contents({ data: null, error: { message: 'connection timeout' } });
    const accept = jest.fn().mockResolvedValue(undefined);

    const q = await render_wall(accept);

    // Intento de marcar y enviar: ambos deben ser inertes.
    await act(async () => {
      fireEvent.press(q.getByTestId('accept-terms'));
    });
    await act(async () => {
      fireEvent.press(q.getByTestId('accept-terms-submit'));
    });

    expect(accept).not.toHaveBeenCalled();
  });

  it('ofrece reintentar y, al lograrlo, ya se puede aceptar', async () => {
    // Primera pasada falla, segunda trae el texto.
    const mock_in = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'connection timeout' } })
      .mockResolvedValueOnce({
        data: [{ id: 'v-terms-2-0', content: 'Texto legal recuperado.' }],
        error: null,
      });
    mock_from.mockReturnValue({
      select: jest.fn().mockReturnValue({ in: mock_in }),
    } as unknown as ReturnType<typeof supabase.from>);
    const accept = jest.fn().mockResolvedValue(undefined);

    const q = await render_wall(accept);
    expect(q.queryByTestId('legal-wall-contents-error')).not.toBeNull();

    await act(async () => {
      fireEvent.press(q.getByTestId('legal-wall-contents-retry'));
    });

    expect(q.queryByText('Texto legal recuperado.')).not.toBeNull();

    await act(async () => {
      fireEvent.press(q.getByTestId('accept-terms'));
    });
    await act(async () => {
      fireEvent.press(q.getByTestId('accept-terms-submit'));
    });

    expect(accept).toHaveBeenCalledTimes(1);
  });
});

describe('LegalWall — salida', () => {
  it('la única salida es cerrar sesión', async () => {
    setup_contents({ data: [{ id: 'v-terms-2-0', content: 'Texto.' }], error: null });

    const q = await render_wall();

    expect(q.queryByTestId('accept-terms-signout')).not.toBeNull();
  });
});
