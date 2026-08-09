/**
 * useContactAgent — el ÚNICO camino para "contactar al agente" (75.4).
 *
 * POR QUÉ ES UN HOOK COMPARTIDO Y NO LÓGICA DENTRO DEL BOTÓN:
 * hasta 75.4 convivían dos caminos y solo uno registraba el lead. El CTA del
 * detalle pasaba por la EF `contact-agent`; el botón de WhatsApp del feed
 * (VideoFeedItem) y el de la tarjeta de agente (AgentCard) llamaban directo a
 * `open_whatsapp()` con un texto propio. Un usuario podía escribirle al agente
 * desde el feed y en Urbea no quedaba rastro: sin lead, sin el acceso a datos que
 * §19.2 concede al agente SOLO tras el contacto, sin los +10 de scoring y sin fila
 * en el CRM. Con la lógica aquí, los tres call sites comparten la misma llamada,
 * el mismo template del servidor y el mismo manejo de errores.
 *
 * Contrato:
 *   contact_agent(property_id) → invoca la EF, y si responde 200 abre WhatsApp
 *   con el `phone` y el `message` que ella devuelve. El texto NO se arma aquí:
 *   §19.3 dice que el template es del sistema y no editable, así que vive en la EF.
 */
import { useCallback, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { extract_error_code } from '@/lib/supabase/edge-errors';
import { open_whatsapp_ef } from '@/features/property-detail/utils/whatsapp';

/** Respuesta 200 de la EF `contact-agent` (supabase/functions/contact-agent/handler.ts). */
interface ContactAgentSuccessBody {
  success: true;
  phone: string;
  message: string;
  lead_id: string;
  property_id: string;
}

/**
 * Códigos de error de la EF → mensajes en español.
 * Se exporta porque ContactAgentButton los consume: un solo mapa, no dos copias.
 */
export const CONTACT_AGENT_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Debes iniciar sesión para contactar al agente.',
  INVALID_INPUT: 'Datos incorrectos. Intenta de nuevo.',
  NOT_FOUND: 'Propiedad no encontrada.',
  INVALID_PROPERTY_STATE: 'Esta propiedad no está disponible para contacto.',
  AGENT_PHONE_MISSING: 'El agente no tiene número de WhatsApp registrado.',
  CANNOT_CONTACT_SELF: 'No puedes contactarte a ti mismo.',
  DB_ERROR: 'Error interno. Intenta de nuevo.',
};

/** Código desconocido y fallo de red caen a mensajes neutros, nunca al crudo de supabase-js. */
export function map_contact_agent_error(code: string | undefined): string {
  if (code === undefined) return 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
  return CONTACT_AGENT_ERROR_MESSAGES[code] ?? 'Ocurrió un error. Intenta de nuevo.';
}

export interface UseContactAgentDeps {
  supabase?: SupabaseClient;
}

export interface UseContactAgentResult {
  contact_agent: (property_id: string) => Promise<{ ok: boolean }>;
  is_contacting: boolean;
  error: string | null;
}

export function useContactAgent(deps: UseContactAgentDeps = {}): UseContactAgentResult {
  const [is_contacting, set_is_contacting] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  // ponytail: ref y no el state para el candado del doble tap — con el state en
  // las deps, contact_agent se recrearía en cada cambio y los call sites que lo
  // memorizan (el feed recicla ítems) se quedarían con una versión vieja.
  const in_flight = useRef(false);

  const contact_agent = useCallback(
    async (property_id: string): Promise<{ ok: boolean }> => {
      if (in_flight.current) return { ok: false };
      in_flight.current = true;
      set_is_contacting(true);
      set_error(null);

      // Resolución del cliente DENTRO de la acción, no en el render: el singleton
      // revienta si falta EXPO_PUBLIC_SUPABASE_URL, y montar el hook (lo hace cada
      // ítem del feed) no tiene por qué depender de eso. Además deja que jest.mock
      // intercepte. Mismo espíritu que useUpdateLeadStatus.ts#get_client.
      const client: SupabaseClient = deps.supabase ??
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('@/lib/supabase/client') as { supabase: SupabaseClient }).supabase;

      const { data, error: ef_error } = await client.functions.invoke<ContactAgentSuccessBody>(
        'contact-agent',
        { body: { propertyId: property_id } },
      );

      in_flight.current = false;
      set_is_contacting(false);

      if (ef_error !== null && ef_error !== undefined) {
        set_error(map_contact_agent_error(await extract_error_code(ef_error)));
        return { ok: false };
      }

      if (data === null || data === undefined) {
        set_error('Ocurrió un error inesperado. Intenta de nuevo.');
        return { ok: false };
      }

      // El lead ya quedó registrado (la EF es quien lo crea): recién ahora se abre
      // WhatsApp. Si la EF falla, NO se abre — contactar sin lead es el defecto
      // que este hook cierra.
      await open_whatsapp_ef(data.phone, data.message);
      return { ok: true };
    },
    [deps.supabase],
  );

  return { contact_agent, is_contacting, error };
}
