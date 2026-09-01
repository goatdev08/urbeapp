/**
 * Tests — make_binding_sensitive_supabase_mock (candado #233.3)
 * SUT: mobile/src/test-utils/supabaseMock.ts
 *
 * Ancla el contrato del helper en sí: ligado no lanza y delega al jest.fn()
 * inyectado; desprendido SIEMPRE lanza (rpc/from/functions.invoke). Sin este
 * archivo, un futuro refactor del helper podría reintroducir un objeto
 * plano sin que ninguna suite lo note (las suites que lo CONSUMEN solo
 * verifican su propio hook, no el guard en sí).
 */
import { make_binding_sensitive_supabase_mock } from '../supabaseMock';

describe('make_binding_sensitive_supabase_mock', () => {
  it('rpc ligado no lanza y delega al mock inyectado', async () => {
    const { client, _mock_rpc } = make_binding_sensitive_supabase_mock({
      rpc: () => Promise.resolve({ data: [{ id: 1 }], error: null }),
    });
    const result = await client.rpc('some_fn', { p_x: 1 });
    expect(result).toEqual({ data: [{ id: 1 }], error: null });
    expect(_mock_rpc).toHaveBeenCalledWith('some_fn', { p_x: 1 });
  });

  it('rpc DESPRENDIDO lanza — el mutante «const { rpc } = client» muere', () => {
    const { client } = make_binding_sensitive_supabase_mock();
    const detached = client.rpc as (...args: unknown[]) => unknown;
    expect(() => detached('some_fn')).toThrow(TypeError);
  });

  it('from ligado no lanza y delega al mock inyectado', () => {
    const builder = { eq: jest.fn() };
    const { client, _mock_from } = make_binding_sensitive_supabase_mock({
      from: () => builder,
    });
    expect(client.from('agencies')).toBe(builder);
    expect(_mock_from).toHaveBeenCalledWith('agencies');
  });

  it('from DESPRENDIDO lanza', () => {
    const { client } = make_binding_sensitive_supabase_mock();
    const detached = client.from as (...args: unknown[]) => unknown;
    expect(() => detached('agencies')).toThrow(TypeError);
  });

  it('functions.invoke ligado no lanza y delega al mock inyectado', async () => {
    const { client, _mock_invoke } = make_binding_sensitive_supabase_mock({
      invoke: () => Promise.resolve({ data: { ok: true }, error: null }),
    });
    const result = await client.functions.invoke('some-fn', { body: {} });
    expect(result).toEqual({ data: { ok: true }, error: null });
    expect(_mock_invoke).toHaveBeenCalledWith('some-fn', { body: {} });
  });

  it('functions.invoke DESPRENDIDO lanza', () => {
    const { client } = make_binding_sensitive_supabase_mock();
    const detached = client.functions.invoke as (...args: unknown[]) => unknown;
    expect(() => detached('some-fn', { body: {} })).toThrow(TypeError);
  });
});
