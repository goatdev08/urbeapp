/**
 * Smoke RNTL — PlaceSearch (#232.2)
 * Archivo SUT: mobile/src/features/map/components/PlaceSearch.tsx
 *
 * Componente NO crítico (CLAUDE.md §5) — verificación ligera: monta, la
 * selección de catálogo dispara on_select_place, la sección "Direcciones"
 * respeta la disponibilidad de key, y una dirección resuelta reusa
 * on_select_place (mismo flujo que catálogo, #232). La lógica async
 * (debounce, anti-stale, geocode→RPC) ya está cubierta por los tests de
 * lib/hooks — aquí solo se verifica el cableado.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { PlaceSearch } from '../PlaceSearch';
import type { PlaceSuggestion } from '../../lib/placeSearch';

const mock_fetch_address_predictions = jest.fn();
const mock_has_google_places_key = jest.fn();
const mock_resolve_address_to_zone = jest.fn();

jest.mock('../../lib/addressPlaces', () => ({
  fetch_address_predictions: (...args: unknown[]) => mock_fetch_address_predictions(...args),
  has_google_places_key: (...args: unknown[]) => mock_has_google_places_key(...args),
}));

jest.mock('../../lib/resolveAddressZone', () => ({
  resolve_address_to_zone: (...args: unknown[]) => mock_resolve_address_to_zone(...args),
}));

const NEIGHBORHOOD: PlaceSuggestion = {
  kind: 'neighborhood',
  id: '42',
  name: 'Providencia',
  context: 'Guadalajara, Jal.',
  bbox: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mock_has_google_places_key.mockReturnValue(false); // sin key por defecto
});

describe('PlaceSearch — buscador unificado (#232, smoke)', () => {
  it('sin contenido → no renderiza nada', async () => {
    const { toJSON } = await render(
      <PlaceSearch query="" suggestions={[]} on_select_place={jest.fn()} />,
    );

    expect(toJSON()).toBeNull();
  });

  it('lista de catálogo: tap en una fila dispara on_select_place con esa sugerencia', async () => {
    const on_select_place = jest.fn();
    const { getByLabelText } = await render(
      <PlaceSearch query="provi" suggestions={[NEIGHBORHOOD]} on_select_place={on_select_place} />,
    );

    fireEvent.press(getByLabelText('Buscar Providencia, Guadalajara, Jal.'));

    expect(on_select_place).toHaveBeenCalledWith(NEIGHBORHOOD);
  });

  it('sin API key configurada, la sección "Direcciones" no aparece', async () => {
    const { queryByText } = await render(
      <PlaceSearch query="Av. Chapultepec 123" suggestions={[]} on_select_place={jest.fn()} />,
    );

    expect(queryByText('Direcciones')).toBeNull();
  });

  it('con API key, una dirección resuelta a zona reusa on_select_place (mismo flujo que catálogo)', async () => {
    mock_has_google_places_key.mockReturnValue(true);
    mock_fetch_address_predictions.mockResolvedValue([
      { place_id: 'place-1', main_text: 'Av. Chapultepec 123', secondary_text: 'Guadalajara, Jal.' },
    ]);
    mock_resolve_address_to_zone.mockResolvedValue({
      kind: 'resolved',
      zone: NEIGHBORHOOD,
      point: { lat: 20.7, lng: -103.37 },
    });

    const on_select_place = jest.fn();
    const { findByLabelText } = await render(
      <PlaceSearch
        query="Av. Chapultepec 123"
        suggestions={[]}
        on_select_place={on_select_place}
        deps={{ address: { api_key: 'test-key' } }}
      />,
    );

    const address_row = await findByLabelText('Usar dirección Av. Chapultepec 123');
    await act(async () => {
      fireEvent.press(address_row);
      await Promise.resolve();
    });

    expect(on_select_place).toHaveBeenCalledWith(NEIGHBORHOOD);
  });

  it('dirección fuera de cobertura llama on_address_out_of_coverage y NO on_select_place', async () => {
    mock_has_google_places_key.mockReturnValue(true);
    mock_fetch_address_predictions.mockResolvedValue([
      { place_id: 'place-2', main_text: 'Calle Remota 1', secondary_text: null },
    ]);
    mock_resolve_address_to_zone.mockResolvedValue({
      kind: 'out_of_coverage',
      point: { lat: 32.5, lng: -117.0 },
    });

    const on_select_place = jest.fn();
    const on_out_of_coverage = jest.fn();
    const { findByLabelText } = await render(
      <PlaceSearch
        query="Calle Remota 1"
        suggestions={[]}
        on_select_place={on_select_place}
        on_address_out_of_coverage={on_out_of_coverage}
        deps={{ address: { api_key: 'test-key' } }}
      />,
    );

    const address_row = await findByLabelText('Usar dirección Calle Remota 1');
    await act(async () => {
      fireEvent.press(address_row);
      await Promise.resolve();
    });

    expect(on_out_of_coverage).toHaveBeenCalledWith({ lat: 32.5, lng: -117.0 });
    expect(on_select_place).not.toHaveBeenCalled();
  });
});
