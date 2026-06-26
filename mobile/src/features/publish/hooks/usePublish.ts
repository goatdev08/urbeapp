/**
 * usePublish.ts — STUB mínimo para fase RED.
 * No contiene lógica de negocio. Lanza siempre para que los tests fallen
 * por aserción y no por import-error.
 *
 * Contrato (implementar en fase GREEN):
 *   usePublish({ supabase }) → { status, error, property_id, publish }
 *   - publish(): arma payload con get_property_payload(state), invoca
 *     supabase.functions.invoke('publish-property', { body: payload }),
 *     en éxito expone property_id y llama reset(); en error expone mensaje sin reset.
 */

export type PublishStatus = 'idle' | 'submitting' | 'success' | 'error';

export interface UsePublishDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}

export interface UsePublishResult {
  status: PublishStatus;
  error: string | null;
  property_id: string | null;
  publish: () => Promise<void>;
}

// not_implemented — stub para RED. El test importa esto y falla por aserción.
export function usePublish(_deps?: UsePublishDeps): UsePublishResult {
  throw new Error('not_implemented');
}
