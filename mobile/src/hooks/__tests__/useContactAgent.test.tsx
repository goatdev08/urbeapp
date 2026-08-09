/**
 * Tests fase RED — useContactAgent
 * Archivo SUT: mobile/src/hooks/useContactAgent.ts
 * Subtarea Taskmaster: 75.4
 *
 * POR QUÉ EXISTE ESTE HOOK (el defecto que cierra):
 * hasta 75.4 había DOS caminos para "contactar al agente" y solo uno registraba
 * el lead. El botón del detalle pasaba por la EF `contact-agent`; el del feed
 * (VideoFeedItem) y el de la tarjeta de agente (AgentCard) llamaban directo a
 * `open_whatsapp()` con un texto propio. Consecuencia: un usuario podía escribirle
 * al agente por WhatsApp desde el feed y en Urbea NO pasaba nada — sin lead, sin
 * el acceso a datos que §19.2 concede al agente sólo tras el contacto, sin los
 * +10 de scoring y sin fila en el CRM. Los dos call sites tenían un `ponytail:`
 * admitiéndolo ("sin registro de lead CRM — llega en #11"). Aquí llega.
 *
 * Contrato:
 *   - contact_agent(property_id) invoca la EF 'contact-agent' con { propertyId }.
 *   - Éxito → abre WhatsApp con el phone y message que devuelve la EF (template
 *     §19.3, fijo, no editable) y retorna { ok: true }.
 *   - Fallo → NO abre WhatsApp, expone `error` en español y retorna { ok: false }.
 *   - is_contacting: true durante la invocación, false en reposo.
 *
 * PATRÓN DE MOCK (igual que useUpdateLeadStatus.test.ts):
 *   - supabase inyectado como dep.
 *   - open_whatsapp_ef mockeado por módulo (es efecto de plataforma, no lógica).
 *   - FunctionsHttpError REALES para ejercitar extract_error_code de verdad.
 *
 * Los literales de mensajes son INDEPENDIENTES del SUT (no se importan de su
 * mapa): si el GREEN cambia el texto, este test lo caza como regresión.
 *
 * EDGE CASES CUBIERTOS:
 * ### Happy path
 * - (EC-1) invoca la EF con el nombre y el body correctos
 * - (EC-2) éxito → abre WhatsApp con phone y message DE LA EF (no fabricados aquí)
 * - (EC-3) éxito → retorna ok:true y deja error en null
 * ### El lead no se puede saltar
 * - (EC-4) error de la EF → NO abre WhatsApp (si abriera, el agente recibiría el
 *          mensaje sin que exista el lead: justo el defecto que se está cerrando)
 * ### Errores en español
 * - (EC-5) UNAUTHENTICATED → mensaje en español exacto
 * - (EC-6) AGENT_PHONE_MISSING → mensaje en español exacto
 * - (EC-7) error de red (sin código) → mensaje neutro, nunca el crudo de supabase-js
 * ### Estado
 * - (EC-8) is_contacting arranca en false y vuelve a false al terminar
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { useContactAgent } from '../useContactAgent';
import { open_whatsapp_ef } from '@/features/property-detail/utils/whatsapp';

jest.mock('@/features/property-detail/utils/whatsapp', () => ({
  open_whatsapp_ef: jest.fn().mockResolvedValue(undefined),
}));

const mock_open = open_whatsapp_ef as jest.MockedFunction<typeof open_whatsapp_ef>;

const PROPERTY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const EF_PHONE = '5215512345678';
const EF_MESSAGE = 'Hola, vi tu propiedad en Urbea: Casa en Av. Insurgentes Sur 1234, Del Valle. Me interesa conocer más detalles.';

/** FunctionsHttpError real con el cuerpo { error: { code, message } } de la EF. */
function make_http_error(code: string): FunctionsHttpError {
  const response = new Response(JSON.stringify({ error: { code, message: 'x' } }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
  return new FunctionsHttpError(response);
}

function make_supabase_ok() {
  return {
    functions: {
      invoke: jest.fn().mockResolvedValue({
        data: { success: true, phone: EF_PHONE, message: EF_MESSAGE, lead_id: 'l1', property_id: PROPERTY_ID },
        error: null,
      }),
    },
  };
}

function make_supabase_error(error: unknown) {
  return {
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: null, error }),
    },
  };
}

beforeEach(() => {
  mock_open.mockClear();
});

describe('useContactAgent — un solo camino para contactar (75.4)', () => {
  it('(EC-1) invoca la EF contact-agent con { propertyId }', async () => {
    const supabase = make_supabase_ok();
    const { result } = await renderHook(() => useContactAgent({ supabase: supabase as never }));

    await act(async () => { await result.current.contact_agent(PROPERTY_ID); });

    expect(supabase.functions.invoke).toHaveBeenCalledWith('contact-agent', {
      body: { propertyId: PROPERTY_ID },
    });
  });

  it('(EC-2) éxito: abre WhatsApp con el phone y el message que devolvió la EF', async () => {
    const supabase = make_supabase_ok();
    const { result } = await renderHook(() => useContactAgent({ supabase: supabase as never }));

    await act(async () => { await result.current.contact_agent(PROPERTY_ID); });

    // El template lo manda el servidor (§19.3 "no editable por el agente"):
    // el cliente no debe inventar ni retocar el texto.
    expect(mock_open).toHaveBeenCalledWith(EF_PHONE, EF_MESSAGE);
  });

  it('(EC-3) éxito: retorna ok:true y deja error en null', async () => {
    const supabase = make_supabase_ok();
    const { result } = await renderHook(() => useContactAgent({ supabase: supabase as never }));

    let outcome: { ok: boolean } | undefined;
    await act(async () => { outcome = await result.current.contact_agent(PROPERTY_ID); });

    expect(outcome?.ok).toBe(true);
    await waitFor(() => { expect(result.current.error).toBeNull(); });
  });

  it('(EC-4) error de la EF: NO abre WhatsApp (el lead no se puede saltar)', async () => {
    const supabase = make_supabase_error(make_http_error('DB_ERROR'));
    const { result } = await renderHook(() => useContactAgent({ supabase: supabase as never }));

    await act(async () => { await result.current.contact_agent(PROPERTY_ID); });

    expect(mock_open).not.toHaveBeenCalled();
  });

  it('(EC-5) UNAUTHENTICATED → mensaje en español', async () => {
    const supabase = make_supabase_error(make_http_error('UNAUTHENTICATED'));
    const { result } = await renderHook(() => useContactAgent({ supabase: supabase as never }));

    await act(async () => { await result.current.contact_agent(PROPERTY_ID); });

    await waitFor(() => {
      expect(result.current.error).toBe('Debes iniciar sesión para contactar al agente.');
    });
  });

  it('(EC-6) AGENT_PHONE_MISSING → mensaje en español', async () => {
    const supabase = make_supabase_error(make_http_error('AGENT_PHONE_MISSING'));
    const { result } = await renderHook(() => useContactAgent({ supabase: supabase as never }));

    await act(async () => { await result.current.contact_agent(PROPERTY_ID); });

    await waitFor(() => {
      expect(result.current.error).toBe('El agente no tiene número de WhatsApp registrado.');
    });
  });

  it('(EC-7) error de red sin código → mensaje neutro, nunca el crudo de supabase-js', async () => {
    const supabase = make_supabase_error(new Error('Network request failed'));
    const { result } = await renderHook(() => useContactAgent({ supabase: supabase as never }));

    await act(async () => { await result.current.contact_agent(PROPERTY_ID); });

    await waitFor(() => {
      expect(result.current.error).toBe(
        'No se pudo conectar. Verifica tu conexión e intenta de nuevo.',
      );
    });
    expect(result.current.error).not.toContain('Network request failed');
  });

  it('(EC-8) is_contacting arranca en false y vuelve a false al terminar', async () => {
    const supabase = make_supabase_ok();
    const { result } = await renderHook(() => useContactAgent({ supabase: supabase as never }));

    expect(result.current.is_contacting).toBe(false);
    await act(async () => { await result.current.contact_agent(PROPERTY_ID); });
    await waitFor(() => { expect(result.current.is_contacting).toBe(false); });
  });
});
