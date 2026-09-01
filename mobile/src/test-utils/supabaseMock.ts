/**
 * supabaseMock.ts — doble del cliente Supabase SENSIBLE AL BINDING, reusable
 * entre suites (candado #233.3, origen #205/170.4).
 *
 * POR QUÉ EXISTE: el SupabaseClient real lee `this` dentro de rpc()/from()/
 * functions.invoke() (p.ej. `return this.rest.rpc(...)`) — desprenderlo
 * (`const { rpc } = client; rpc(...)`) rompe en producción. Un doble de
 * OBJETO PLANO (`{ rpc: jest.fn() }`) es CIEGO a ese bug: un `jest.fn()` no
 * lee `this`, así que el mutante «desprender el método» sobrevive con la
 * suite en verde (precedente real: #205/170.4, useFeedProperties nunca
 * funcionó en producción pese a 36 tests verdes).
 *
 * Antes de este helper, cada archivo de test reproducía su propia versión
 * de este guard (o, más frecuente, usaba un objeto plano sin guard — el
 * hallazgo de #233: 40+ tests de hooks de admin y de búsqueda con el mutante
 * vivo). Este archivo lo fija UNA vez.
 *
 * Diseño: cada método público (`rpc`, `from`, `functions.invoke`) es una
 * función que lee `this` vía un marcador (`__bound_marker`) y LANZA si se
 * invoca desprendida — más simple que replicar el modo de fallo asimétrico
 * real (rpc lanza / functions.invoke devuelve error mudo, ver
 * useFeedProperties.binding.test.tsx): aquí el objetivo es que el mutante
 * MUERA en cualquier suite que use este helper, no diagnosticar el fallo en
 * producción.
 *
 * El resultado de cada método lo decide un jest.fn() inyectable
 * (`_mock_rpc`/`_mock_from`/`_mock_invoke`) — las aserciones de la suite se
 * hacen sobre ESE jest.fn(), nunca sobre `client.rpc` directo (que ya no es
 * un jest.fn, es el método sensible al binding).
 */

// Doble de test, forma deliberadamente laxa (any) — no aplica no-explicit-any en este repo.
type AnyFn = (...args: any[]) => any;

interface BoundMarker {
  __bound_marker?: 'client' | 'functions';
}

export interface BindingSensitiveSupabaseMockOptions {
  /** Implementación de rpc(fn, params) — default: resuelve {data:null,error:null}. */
  rpc?: AnyFn;
  /** Implementación de from(table) — default: undefined (el caller casi siempre la define). */
  from?: AnyFn;
  /** Implementación de functions.invoke(name, opts) — default: resuelve {data:null,error:null}. */
  invoke?: AnyFn;
}

export interface BindingSensitiveSupabaseMock {
  /** El cliente a inyectar como `deps.supabase` (o vía jest.mock del módulo). */
  client: any;
  /** Spy sobre las llamadas ligadas a rpc() — usar en `expect(...).toHaveBeenCalledWith`. */
  _mock_rpc: jest.Mock;
  /** Spy sobre las llamadas ligadas a from(). */
  _mock_from: jest.Mock;
  /** Spy sobre las llamadas ligadas a functions.invoke(). */
  _mock_invoke: jest.Mock;
}

const DEFAULT_RESULT = { data: null, error: null };

export function make_binding_sensitive_supabase_mock(
  options: BindingSensitiveSupabaseMockOptions = {},
): BindingSensitiveSupabaseMock {
  const _mock_rpc = jest.fn(options.rpc ?? (() => Promise.resolve(DEFAULT_RESULT)));
  const _mock_from = jest.fn(options.from ?? (() => undefined));
  const _mock_invoke = jest.fn(options.invoke ?? (() => Promise.resolve(DEFAULT_RESULT)));

  const functions: BoundMarker & { invoke: AnyFn } = {
    __bound_marker: 'functions',
    invoke(this: BoundMarker | undefined, ...args: unknown[]) {
      if (this?.__bound_marker !== 'functions') {
        throw new TypeError(
          'functions.invoke() llamado desprendido del cliente (candado #205/#233.3)',
        );
      }
      return _mock_invoke(...args);
    },
  };

  const client: BoundMarker & { rpc: AnyFn; from: AnyFn; functions: typeof functions } = {
    __bound_marker: 'client',
    rpc(this: BoundMarker | undefined, ...args: unknown[]) {
      if (this?.__bound_marker !== 'client') {
        throw new TypeError('rpc() llamado desprendido del cliente (candado #205/#233.3)');
      }
      return _mock_rpc(...args);
    },
    from(this: BoundMarker | undefined, ...args: unknown[]) {
      if (this?.__bound_marker !== 'client') {
        throw new TypeError('from() llamado desprendido del cliente (candado #205/#233.3)');
      }
      return _mock_from(...args);
    },
    functions,
  };

  return { client, _mock_rpc, _mock_from, _mock_invoke };
}
