/**
 * gridPosters.ts — helper compartido de LECTURA para portadas firmadas del grid.
 *
 * fetch_grid_posters(supabase, property_ids) invoca la Edge Function
 * `mint-poster-urls` (subtarea 89.1) con el batch de property_ids visibles y
 * devuelve un Map<property_id, posterUrl> con SOLO los ids autorizados
 * (dueño-o-activo) y con video Stream listo — la EF omite (fail-closed) el
 * resto, nunca los rellena con null.
 *
 * Contrato (ver mobile/src/lib/__tests__/gridPosters.test.ts):
 *   - property_ids vacío → Map vacío, SIN invocar la EF.
 *   - Éxito → Map de property_id → posterUrl a partir de data.posters.
 *   - Fail-soft: error de la EF / data ausente o malformada / excepción de
 *     red → Map vacío, NUNCA lanza (la lista de propiedades no debe romperse
 *     por falta de portada).
 *
 * STUB — subtarea 89.2 (Taskmaster). Fase RED: solo signature, sin lógica.
 */

interface SupabaseFunctionsClient {
  functions: {
    invoke: (
      name: string,
      opts: { body: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
}

export async function fetch_grid_posters(
  _supabase: SupabaseFunctionsClient,
  _property_ids: string[],
): Promise<Map<string, string>> {
  throw new Error('not_implemented');
}
