/**
 * Smoke tests — ThumbnailPicker component (components/ThumbnailPicker.tsx)
 * Subtarea Taskmaster: 68.7 — pieza NO crítica (UI). Verificación ligera:
 * monta sin crashear en los 3 estados principales del video linkeado.
 *
 * SUT: <ThumbnailPicker cloudflareUid videoStatus initialPct? />
 *
 * Patrón de mock: igual que ActionButtons.test.tsx — se mockea el módulo del
 * hook (useThumbnail) para controlar fetch_source/save_pct sin red real.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { useThumbnail } from '../hooks/useThumbnail';
import { ThumbnailPicker } from '../components/ThumbnailPicker';

jest.mock('../hooks/useThumbnail', () => ({
  useThumbnail: jest.fn(),
}));

const TEST_UID = 'cf-uid-thumbnail-picker-test';

const mock_use_thumbnail = useThumbnail as jest.MockedFunction<typeof useThumbnail>;
const mock_fetch_source = jest.fn();
const mock_save_pct = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_thumbnail.mockReturnValue({
    fetch_source: mock_fetch_source,
    save_pct: mock_save_pct,
    error: null,
  });
});

describe('ThumbnailPicker', () => {
  it('videoStatus=processing: muestra el aviso de "se está procesando" y no llama fetch_source', async () => {
    const { queryByText } = await render(
      <ThumbnailPicker cloudflareUid={TEST_UID} videoStatus="processing" />
    );

    expect(queryByText(/se está procesando/i)).not.toBeNull();
    expect(mock_fetch_source).not.toHaveBeenCalled();
  });

  it('videoStatus=failed: no renderiza la sección (spec §3 Decisión A)', async () => {
    const { queryByText } = await render(
      <ThumbnailPicker cloudflareUid={TEST_UID} videoStatus="failed" />
    );

    expect(queryByText('Portada del video')).toBeNull();
  });

  it('videoStatus=ready: llama fetch_source con el cloudflareUid y renderiza los 3 sugeridos', async () => {
    mock_fetch_source.mockResolvedValue({
      baseUrl: 'https://customer-x.cloudflarestream.com/uid/thumbnails/thumbnail.jpg',
      token: 'signed-token',
      durationSeconds: 92,
    });

    const { findByLabelText } = await render(
      <ThumbnailPicker cloudflareUid={TEST_UID} videoStatus="ready" initialPct={50} />
    );

    expect(mock_fetch_source).toHaveBeenCalledWith(TEST_UID);
    expect(await findByLabelText('Usar frame al 25 por ciento')).not.toBeNull();
    expect(await findByLabelText('Usar frame al 50 por ciento')).not.toBeNull();
    expect(await findByLabelText('Usar frame al 75 por ciento')).not.toBeNull();
  });

  it('videoStatus=ready y fetch_source falla: muestra el placeholder de reintentar (fail-soft)', async () => {
    mock_fetch_source.mockResolvedValue(null);

    const { findByLabelText } = await render(
      <ThumbnailPicker cloudflareUid={TEST_UID} videoStatus="ready" />
    );

    expect(await findByLabelText('Reintentar cargar portada')).not.toBeNull();
  });
});
