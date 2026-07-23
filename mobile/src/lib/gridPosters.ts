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
 * GREEN — subtarea 89.2 (Taskmaster).
 */

interface SupabaseFunctionsClient {
  functions: {
    invoke: (
      name: string,
      opts: { body: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
}

interface MintPosterUrlsData {
  posters: { property_id: string; posterUrl: string }[];
}

export async function fetch_grid_posters(
  supabase: SupabaseFunctionsClient,
  property_ids: string[],
): Promise<Map<string, string>> {
  if (property_ids.length === 0) return new Map();

  try {
    const { data, error } = await supabase.functions.invoke('mint-poster-urls', {
      body: { property_ids },
    });

    if (error) return new Map();

    const posters = (data as MintPosterUrlsData | null)?.posters;
    if (!posters) return new Map();

    return new Map(posters.map((p) => [p.property_id, p.posterUrl]));
  } catch {
    return new Map();
  }
}
