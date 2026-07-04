/**
 * Tests fase RED — useCreateInvitation hook
 * Archivo SUT: mobile/src/features/agency/hooks/useCreateInvitation.ts
 * Subtarea Taskmaster: 34.2 — API cliente + hook useCreateInvitation
 *
 * SUT: useCreateInvitation() → {
 *   create: (input: { max_uses: number | null; expires_at: string | null }) => Promise<void>,
 *   invitation: CreateInvitationOk['invitation'] | null,
 *   loading: boolean,
 *   error_code: string | null,   // code del backend, o undefined→'UNKNOWN'
 *   reset: () => void,
 * }
 *
 * El hook envuelve create_invitation de features/agency/api.ts (mockeado aquí —
 * el api es glue de supabase.functions.invoke, mismo precedente que
 * registration/api.ts que tampoco se testea directo).
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) create ok → invitation seteada, loading=false, error_code=null
 *
 * ### Error de negocio
 * - (EC-2) create con error → error_code seteado, invitation=null
 * - (EC-3) error sin code (red) → error_code='UNKNOWN' (nunca null en fallo)
 *
 * ### Estados intermedios / limpieza
 * - (EC-4) loading=true mientras la promesa está en vuelo
 * - (EC-5) reset() limpia invitation y error_code
 * - (EC-6) un create tras un fallo limpia el error_code anterior
 */

import { act, renderHook } from '@testing-library/react-native';

import { create_invitation } from '../api';
import { useCreateInvitation } from '../hooks/useCreateInvitation';

jest.mock('../api', () => ({
  create_invitation: jest.fn(),
}));

const mock_create_invitation = create_invitation as jest.MockedFunction<
  typeof create_invitation
>;

const INVITATION = {
  token_id: 'token-uuid-34',
  plain_token: 'Ab3dEf7h',
  agency_id: 'agencia-uuid-34',
  max_uses: 5,
  expires_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useCreateInvitation', () => {
  it('EC-1: create ok → invitation seteada, loading=false, error_code=null', async () => {
    mock_create_invitation.mockResolvedValue({ ok: true, invitation: INVITATION });

    const { result } = await renderHook(() => useCreateInvitation());

    await act(async () => {
      await result.current.create({ max_uses: 5, expires_at: null });
    });

    expect(result.current.invitation).toEqual(INVITATION);
    expect(result.current.loading).toBe(false);
    expect(result.current.error_code).toBeNull();
    expect(mock_create_invitation).toHaveBeenCalledWith({ max_uses: 5, expires_at: null });
  });

  it('EC-2: create con error de negocio → error_code seteado, invitation=null', async () => {
    mock_create_invitation.mockResolvedValue({ ok: false, code: 'NOT_AGENCY_OWNER' });

    const { result } = await renderHook(() => useCreateInvitation());

    await act(async () => {
      await result.current.create({ max_uses: null, expires_at: null });
    });

    expect(result.current.error_code).toBe('NOT_AGENCY_OWNER');
    expect(result.current.invitation).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("EC-3: error sin code (red) → error_code='UNKNOWN'", async () => {
    mock_create_invitation.mockResolvedValue({ ok: false, code: undefined });

    const { result } = await renderHook(() => useCreateInvitation());

    await act(async () => {
      await result.current.create({ max_uses: null, expires_at: null });
    });

    expect(result.current.error_code).toBe('UNKNOWN');
  });

  it('EC-4: loading=true mientras la promesa está en vuelo', async () => {
    let resolve_fn: (v: Awaited<ReturnType<typeof create_invitation>>) => void;
    mock_create_invitation.mockReturnValue(
      new Promise((resolve) => {
        resolve_fn = resolve;
      }),
    );

    const { result } = await renderHook(() => useCreateInvitation());

    let create_promise: Promise<void>;
    await act(async () => {
      create_promise = result.current.create({ max_uses: null, expires_at: null });
    });

    // La promesa del mock sigue pendiente → loading debe ser true
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolve_fn!({ ok: true, invitation: INVITATION });
      await create_promise;
    });

    expect(result.current.loading).toBe(false);
  });

  it('EC-5: reset() limpia invitation y error_code', async () => {
    mock_create_invitation.mockResolvedValue({ ok: true, invitation: INVITATION });

    const { result } = await renderHook(() => useCreateInvitation());

    await act(async () => {
      await result.current.create({ max_uses: 5, expires_at: null });
    });
    expect(result.current.invitation).toEqual(INVITATION);

    await act(async () => {
      result.current.reset();
    });

    expect(result.current.invitation).toBeNull();
    expect(result.current.error_code).toBeNull();
  });

  it('EC-6: un create tras un fallo limpia el error_code anterior', async () => {
    mock_create_invitation.mockResolvedValueOnce({ ok: false, code: 'AGENCY_INACTIVE' });
    mock_create_invitation.mockResolvedValueOnce({ ok: true, invitation: INVITATION });

    const { result } = await renderHook(() => useCreateInvitation());

    await act(async () => {
      await result.current.create({ max_uses: null, expires_at: null });
    });
    expect(result.current.error_code).toBe('AGENCY_INACTIVE');

    await act(async () => {
      await result.current.create({ max_uses: null, expires_at: null });
    });

    expect(result.current.error_code).toBeNull();
    expect(result.current.invitation).toEqual(INVITATION);
  });
});
