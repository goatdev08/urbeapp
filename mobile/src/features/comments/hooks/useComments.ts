/**
 * useComments — lista paginada de comentarios de una propiedad (subtarea
 * 289.7, tarea #289). Fase GREEN — contrato completo y 21 edge cases en
 * mobile/src/features/comments/__tests__/useComments.test.tsx.
 *
 * Decisiones fijadas por el RED (ver header del test):
 *  - Filtro: .eq('property_id', id) + .neq('status','deleted') — RLS decide
 *    el resto por rol, nunca un .in('status', [...]) explícito.
 *  - Paginación keyset (created_at desc, id desc) con LIMIT+1: la carga
 *    INICIAL/refetch descarta la fila extra (has_more exacto, EC-8). Un
 *    load_more NO descarta — dedupea por id y apenda todo lo que llega
 *    (EC-9 tolera que el servidor repita una fila en el borde del cursor).
 *  - Identidad (agent_public_profiles) se resuelve por página vía
 *    .in('user_id', ids únicos), omitida si la página trae 0 filas (EC-10).
 *  - `loading` cubre solo carga inicial/refetch; load_more es silencioso.
 *  - remove/update/prepend son mutaciones locales puras, sin red.
 *
 * 🔴 NO SE DESPRENDE `client.from` del cliente (#205): siempre
 * `client.from(...)`, nunca `const { from } = client`.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { CommentAuthor, CommentItem } from '../types';

export interface UseCommentsOptions {
  /** Tamaño de página — default 20. */
  page_size?: number;
  /** Cliente Supabase inyectado (tests); default: el singleton real. */
  supabase?: unknown;
}

export interface UseCommentsReturn {
  items: CommentItem[];
  loading: boolean;
  error: string | null;
  has_more: boolean;
  load_more(): Promise<void>;
  refetch(): Promise<void>;
  remove(id: string): void;
  update(id: string, patch: Partial<CommentItem>): void;
  prepend(item: CommentItem): void;
}

const DEFAULT_PAGE_SIZE = 20;

// Copy ancla ES — nunca el texto crudo de supabase-js/Postgres (mismo
// invariante que usePostComment.ts/useHideComment.ts/useReportComment.ts;
// hallazgo guardián 289.7 ciclo 1: esta versión propagaba `e.message` crudo).
const GENERIC_ERROR_MESSAGE = 'No se pudieron cargar los comentarios. Intenta de nuevo.';

type Cursor = { created_at: string; id: string };

type CommentRow = {
  id: string;
  property_id: string;
  user_id: string;
  body: string;
  status: CommentItem['status'];
  created_at: string;
};

type ProfileRow = { user_id: string; full_name: string | null; profile_photo_url: string | null };

/** Fetch puro de I/O: una página RAW (sin descartar) + identidad de autores. */
async function fetch_comments_page(
  client: any,
  property_id: string,
  page_size: number,
  cursor: Cursor | null,
): Promise<{ raw_items: CommentItem[]; more: boolean }> {
  let query = client
    .from('comments')
    .select('id, property_id, user_id, body, status, created_at')
    .eq('property_id', property_id)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(page_size + 1);

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message ?? 'Error de red');

  const rows = (data ?? []) as CommentRow[];
  const more = rows.length > page_size;

  if (rows.length === 0) {
    return { raw_items: [], more };
  }

  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles, error: profiles_error } = await client
    .from('agent_public_profiles')
    .select('user_id, full_name, profile_photo_url')
    .in('user_id', ids);
  if (profiles_error) throw new Error(profiles_error.message ?? 'Error de red');

  const profile_map = new Map<string, CommentAuthor>();
  for (const p of (profiles ?? []) as ProfileRow[]) {
    profile_map.set(p.user_id, { full_name: p.full_name, profile_photo_url: p.profile_photo_url });
  }

  const raw_items: CommentItem[] = rows.map((r) => ({ ...r, author: profile_map.get(r.user_id) ?? null }));
  return { raw_items, more };
}

function cursor_from(items: CommentItem[]): Cursor | null {
  const last = items[items.length - 1];
  return last ? { created_at: last.created_at, id: last.id } : null;
}

// Lazy para que jest.mock intercepte / evita eval a nivel de módulo cuando no
// hay cliente inyectado.
function get_default_client(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as typeof import('@/lib/supabase/client')).supabase;
}

export function useComments(property_id: string, opts?: UseCommentsOptions): UseCommentsReturn {
  const page_size = opts?.page_size ?? DEFAULT_PAGE_SIZE;
  const client: any = opts?.supabase !== undefined ? opts.supabase : get_default_client();

  // ponytail: estado en refs + force_update (no useState) — mismo patrón que
  // useReportProperty.ts/useUpdateLeadNote.ts: remove/update/prepend deben
  // leerse SÍNCRONAMENTE justo tras dispararse (act(() => {...}) sin await),
  // y un getter sobre una ref siempre da el valor fresco sin depender de que
  // ya haya corrido un re-render.
  const items_ref = useRef<CommentItem[]>([]);
  const loading_ref = useRef(true);
  const error_ref = useRef<string | null>(null);
  const has_more_ref = useRef(false);
  const cursor_ref = useRef<Cursor | null>(null);
  const load_more_busy_ref = useRef(false);
  const mounted_ref = useRef(true);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  const load_first_page = useCallback(async () => {
    loading_ref.current = true;
    error_ref.current = null;
    force_update();
    try {
      const page = await fetch_comments_page(client, property_id, page_size, null);
      if (!mounted_ref.current) return;
      const final_items = page.more ? page.raw_items.slice(0, page_size) : page.raw_items;
      items_ref.current = final_items;
      cursor_ref.current = cursor_from(final_items);
      has_more_ref.current = page.more;
      loading_ref.current = false;
      force_update();
    } catch (e) {
      if (!mounted_ref.current) return;
      void e;
      error_ref.current = GENERIC_ERROR_MESSAGE;
      loading_ref.current = false;
      force_update();
    }
  }, [client, property_id, page_size]);

  useEffect(() => {
    void load_first_page();
  }, [load_first_page]);

  const load_more = useCallback(async () => {
    if (!has_more_ref.current || load_more_busy_ref.current) return;
    load_more_busy_ref.current = true;
    try {
      const page = await fetch_comments_page(client, property_id, page_size, cursor_ref.current);
      if (!mounted_ref.current) return;
      const existing_ids = new Set(items_ref.current.map((i) => i.id));
      const new_items = page.raw_items.filter((i) => !existing_ids.has(i.id));
      items_ref.current = [...items_ref.current, ...new_items];
      cursor_ref.current = cursor_from(items_ref.current);
      has_more_ref.current = page.more;
      force_update();
    } catch (e) {
      if (!mounted_ref.current) return;
      void e;
      error_ref.current = GENERIC_ERROR_MESSAGE;
      force_update();
    } finally {
      load_more_busy_ref.current = false;
    }
  }, [client, property_id, page_size]);

  const remove = useCallback((id: string) => {
    items_ref.current = items_ref.current.filter((i) => i.id !== id);
    force_update();
  }, []);

  const update = useCallback((id: string, patch: Partial<CommentItem>) => {
    items_ref.current = items_ref.current.map((i) => (i.id === id ? { ...i, ...patch } : i));
    force_update();
  }, []);

  const prepend = useCallback((item: CommentItem) => {
    if (items_ref.current.some((i) => i.id === item.id)) return;
    items_ref.current = [item, ...items_ref.current];
    force_update();
  }, []);

  return useMemo(() => {
    const r: UseCommentsReturn = {
      get items() {
        return items_ref.current;
      },
      get loading() {
        return loading_ref.current;
      },
      get error() {
        return error_ref.current;
      },
      get has_more() {
        return has_more_ref.current;
      },
      load_more,
      refetch: load_first_page,
      remove,
      update,
      prepend,
    };
    return r;
  }, [load_more, load_first_page, remove, update, prepend]);
}
