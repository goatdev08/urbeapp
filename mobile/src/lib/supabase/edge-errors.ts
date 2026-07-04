/**
 * edge-errors.ts — extracción del error_code de una Edge Function.
 *
 * Las EFs devuelven errores de negocio como { error: { code, message } } con
 * status 4xx/5xx; supabase-js los entrega como FunctionsHttpError cuyo cuerpo
 * parseamos (best-effort) para recuperar el `code`.
 *
 * Extraído de registration/api.ts (34.2) para reusarlo desde cualquier feature
 * que invoque EFs (registration, agency, …).
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

/** Extrae el error_code del cuerpo de un FunctionsHttpError (best-effort). */
export async function extract_error_code(error: unknown): Promise<string | undefined> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      const code = body?.error?.code;
      return typeof code === 'string' ? code : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
