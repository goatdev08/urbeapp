/**
 * Tests fase RED — useVideoReady (#126, fix 73.4).
 * SUT: mobile/src/features/publish/hooks/useVideoReady.ts
 *
 * Contrato: pollea el status real de property_videos (checker inyectable)
 * hasta 'ready' o 'failed'; uid null → 'idle' sin pollear; deja de pollear
 * al llegar a un estado final y al desmontar.
 *
 * Técnica: checker fake que consume una secuencia de estados; interval_ms
 * chico (5 ms) + waitFor — sin fake timers (el poll encadena awaits y los
 * fake timers de jest pelean con promesas encadenadas; mismo criterio que
 * useVideoUpload.test con su verify poll).
 *
 * NOTA API: @testing-library/react-native v14 — renderHook es ASYNC.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useVideoReady } from '@/features/publish/hooks/useVideoReady';
import type { VideoCheckStatus } from '@/features/publish/hooks/useVideoUpload';

const UID = 'cf-uid-ready-test';

/** Checker fake: consume `sequence` en orden; al agotarse repite el último. */
function make_checker(sequence: VideoCheckStatus[]) {
  const calls: string[] = [];
  const checker = (uid: string): Promise<VideoCheckStatus> => {
    calls.push(uid);
    const idx = Math.min(calls.length - 1, sequence.length - 1);
    return Promise.resolve(sequence[idx] ?? 'missing');
  };
  return { checker, calls };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('useVideoReady', () => {
  it('uid null → idle y NUNCA llama al checker', async () => {
    const { checker, calls } = make_checker(['ready']);
    const { result } = await renderHook(() =>
      useVideoReady(null, { check_video_status: checker, interval_ms: 5 }),
    );

    await sleep(30);
    expect(result.current.status).toBe('idle');
    expect(calls.length).toBe(0);
  });

  it('video ya ready en el primer poll → status ready', async () => {
    const { checker } = make_checker(['ready']);
    const { result } = await renderHook(() =>
      useVideoReady(UID, { check_video_status: checker, interval_ms: 5 }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('uploading → uploading → ready: pasa por waiting y termina en ready', async () => {
    const { checker, calls } = make_checker(['uploading', 'uploading', 'ready']);
    const { result } = await renderHook(() =>
      useVideoReady(UID, { check_video_status: checker, interval_ms: 5 }),
    );

    // Mientras la fila siga 'uploading', el hook reporta 'waiting'.
    await waitFor(() => expect(result.current.status).toBe('waiting'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("'failed' → status failed", async () => {
    const { checker } = make_checker(['uploading', 'failed']);
    const { result } = await renderHook(() =>
      useVideoReady(UID, { check_video_status: checker, interval_ms: 5 }),
    );

    await waitFor(() => expect(result.current.status).toBe('failed'));
  });

  it('al llegar a ready DEJA de pollear', async () => {
    const { checker, calls } = make_checker(['ready']);
    const { result } = await renderHook(() =>
      useVideoReady(UID, { check_video_status: checker, interval_ms: 5 }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    const count_at_ready = calls.length;
    await sleep(40);
    expect(calls.length).toBe(count_at_ready);
  });

  it('al desmontar DEJA de pollear (cleanup del timer)', async () => {
    const { checker, calls } = make_checker(['uploading']);
    const { unmount } = await renderHook(() =>
      useVideoReady(UID, { check_video_status: checker, interval_ms: 5 }),
    );

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    unmount();
    const count_at_unmount = calls.length;
    await sleep(40);
    expect(calls.length).toBe(count_at_unmount);
  });

  it('error transitorio del checker NO mata el poll — sigue esperando y llega a ready', async () => {
    const calls: string[] = [];
    const checker = (uid: string): Promise<VideoCheckStatus> => {
      calls.push(uid);
      if (calls.length === 1) return Promise.reject(new Error('red caída'));
      return Promise.resolve('ready');
    };
    const { result } = await renderHook(() =>
      useVideoReady(UID, { check_video_status: checker, interval_ms: 5 }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("'missing' (fila aún no insertada) sigue esperando, no falla", async () => {
    const { checker } = make_checker(['missing', 'ready']);
    const { result } = await renderHook(() =>
      useVideoReady(UID, { check_video_status: checker, interval_ms: 5 }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
