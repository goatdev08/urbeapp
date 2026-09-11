/**
 * helpers.ts — dobles de test compartidos por mobile/src/features/comments/__tests__/*.
 * NO es un archivo de test (sin ".test." en el nombre, jest no lo recoge).
 *
 * make_query_builder: doble MÍNIMO del query builder encadenable de
 * supabase-js (.select().eq().neq().order().limit().or().in() → thenable que
 * resuelve {data, error}). Registra cada llamada de método para assertions.
 * Los métodos de la CADENA (select/eq/...) no necesitan guard de `this`
 * desprendido (candado #205): el código bajo test los invoca siempre
 * encadenados de forma fluida, nunca los desestructura — el candado real de
 * #205 aplica a client.from/rpc/functions.invoke, cubierto por
 * make_binding_sensitive_supabase_mock (test-utils/supabaseMock.ts).
 */

export type BuilderCall = { method: string; args: unknown[] };

export interface MockQueryBuilder {
  builder: Record<string, unknown>;
  calls: BuilderCall[];
}

const CHAIN_METHODS = ['select', 'eq', 'neq', 'order', 'limit', 'or', 'in', 'update', 'single'];

/**
 * `result` puede ser un valor fijo o una función (para simular una respuesta
 * distinta según cuándo se resuelva el builder — no se usa en el RED actual
 * pero deja la puerta abierta sin over-engineering).
 */
export function make_query_builder(result: {
  data: unknown;
  error: { message?: string; code?: string } | null;
}): MockQueryBuilder {
  const calls: BuilderCall[] = [];
  const builder: Record<string, unknown> = {};

  for (const method of CHAIN_METHODS) {
    builder[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }

  // Thenable: `await client.from(...).select(...).eq(...)` funciona igual
  // que el builder real de supabase-js (PostgrestFilterBuilder es thenable).
  (builder as { then: unknown }).then = (
    resolve: (value: typeof result) => void,
    reject?: (reason: unknown) => void,
  ) => Promise.resolve(result).then(resolve, reject);

  return { builder, calls };
}

/**
 * make_from_queue — dispatcher de `client.from(table)` con una COLA de
 * resultados por tabla: cada llamada a from(table) crea un builder NUEVO
 * (como el supabase-js real) que resuelve con el siguiente resultado de la
 * cola de esa tabla (el último se repite si se agota). Necesario para
 * useComments (2 tablas: comments + agent_public_profiles, y load_more hace
 * una 2ª llamada a from('comments') con un resultado distinto al de la 1ª
 * página).
 */
export function make_from_queue(queues: Record<string, { data: unknown; error: unknown }[]>): {
  from: (table: string) => Record<string, unknown>;
  /** calls[table] = lista de llamadas de CADA invocación de from(table), en orden. */
  calls: Record<string, BuilderCall[][]>;
} {
  const counters: Record<string, number> = {};
  const calls: Record<string, BuilderCall[][]> = {};

  const from = (table: string): Record<string, unknown> => {
    const queue = queues[table] ?? [];
    const idx = counters[table] ?? 0;
    counters[table] = idx + 1;
    const result = (queue[idx] ?? queue[queue.length - 1] ?? { data: null, error: null }) as {
      data: unknown;
      error: { message?: string; code?: string } | null;
    };
    const qb = make_query_builder(result);
    calls[table] = calls[table] ?? [];
    calls[table].push(qb.calls);
    return qb.builder;
  };

  return { from, calls };
}

/** user autenticado por defecto para los mocks de useAuth() de esta carpeta. */
export function make_auth_user(id: string) {
  return {
    user: { id } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  };
}
