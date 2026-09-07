/**
 * Tests fase RED — useLeadRawFields (subtarea 275.1, tarea #275
 * "hardening(267.6)"; renombrado de useLeadPhone, subtarea 267.6 original).
 * Archivo SUT: mobile/src/features/leads/hooks/useLeadRawFields.ts
 * (STUB RED: el select real y el `status` expuesto faltan a propósito — la
 * implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useLeadRawFields(leadId) → { phone, status, loading, error, refetch }
 * — y la cadena EXACTA de PostgREST vía el embed:
 *   supabase.from('leads')
 *     .select('status, users!leads_user_id_fkey(phone)')
 *     .eq('id', leadId)
 *     .is('deleted_at', null)
 *     .maybeSingle()
 * Extraído de useAgentLeads.ts (el flujo viejo, se borró en 267.7). El hint
 * `users!leads_user_id_fkey` es OBLIGATORIO: `leads` tiene DOS FKs a `users`
 * (agent_id y user_id) — sin el hint PostgREST no sabe cuál usar y falla.
 * Ya probado bajo RLS (`users_select` expone la identidad del buscador con
 * relación de lead vigente) — este hook solo extrae esa lectura puntual del
 * teléfono y ahora también del status crudo, no reintroduce lógica de RLS
 * nueva.
 *
 * DECISIÓN 275.1 (Abraham, /tm-plan 2026-09-07): el status crudo se saca por
 * el cliente ensanchando ESTE select (ya se monta siempre en
 * LeadInlineDetail.tsx) en vez de por migración/DROP+CREATE de
 * crm_leads_page — 0 migraciones, 0 contrato publicado tocado.
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX; D-SEQ/D-EMBED-EXACTO/D-MAP/
 * D-SINFILA/D-ERROR heredadas intactas de 267.6, ahora también cubren
 * `status`):
 * - D-INITIAL: loading = Boolean(leadId) en el primer render (sonda), igual
 *   que useCrmLeadDetail/useCrmSuggestedMessage; `status` arranca null.
 * - D-EMBED-EXACTO: el string de `.select(...)` se asertea LITERAL —
 *   'status, users!leads_user_id_fkey(phone)' — porque un typo o la pérdida
 *   del hint/columna rompe la query en producción sin que TypeScript lo
 *   detecte (PostgREST resuelve el hint y las columnas en runtime).
 * - D-MAP: `phone = data?.users?.phone ?? null` y `status = data?.status ??
 *   null` — dos ramas INDEPENDIENTES del mismo row: el embed many-to-one
 *   `users` puede ser null (usuario borrado) sin que `status` deje de venir,
 *   y viceversa. Nunca se asume que una rama vacía implica la otra vacía.
 * - D-SINFILA: sin fila (RLS, `deleted_at` no nulo, o el lead no existe) →
 *   `phone` Y `status` null SIN error — fail-closed silencioso, anti-IDOR,
 *   mismo criterio D-SINFILA de useCrmLeadDetail (nunca se distingue "no
 *   existe" de "no es tuyo").
 * - D-ERROR: error de red/PostgREST → mensaje neutro en español
 *   'No se pudo cargar el teléfono del lead.' — nunca el texto crudo; ambos
 *   campos vuelven a null.
 *
 * PATRÓN DE MOCK: '@/lib/supabase/client' con mock_supabase_holder + getter
 * (idéntico a useCrmSuggestedMessage.test.ts), pero aquí la cadena es
 * from().select().eq().is().maybeSingle() — un jest.fn() POR MÉTODO
 * (molde useAgentLeads.test.ts / make_supabase_mock_leads) para poder
 * asertar los argumentos exactos de cada eslabón. `.maybeSingle()` es el
 * extremo: resuelve directo a `{ data, error }` (no es chainable+thenable
 * como `.order()` en useAgentLeads — aquí no hay doble encadenamiento).
 * renderHook/act con `await` (RNTL 14); unmount() dentro de act(); reloj
 * fijo con jest.useFakeTimers().setSystemTime en TODOS los casos (regla del
 * repo, tests-bomba-de-fecha) — la sonda del estado inicial (EC-1) lee el
 * PRIMER render vía useProbe, nunca el estado tras el efecto.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### SEAMS
 * - (EC-2) cadena_exacta_select_incluye_status_y_users_phone_con_hint_fk_literal
 *
 * ### Happy path
 * - (EC-1) estado_inicial_antes_del_efecto_phone_status_null_loading_true_sin_error
 * - (EC-3) exito_mapea_data_users_phone_y_status_crudo_D_MAP
 * - (EC-12) status_crudo_se_mapea_tal_cual_para_cada_valor_del_enum_lead_status
 *
 * ### Ramas de reglas no obvias
 * - (EC-4) data_null_sin_fila_phone_y_status_null_sin_error_D_SINFILA
 * - (EC-5) data_con_users_null_status_presente_phone_null_status_intacto_ramas_independientes
 * - (EC-6) error_de_postgrest_mensaje_neutro_en_espanol_phone_y_status_null_D_ERROR
 * - (EC-14) recuperacion_tras_error_un_refetch_exitoso_limpia_el_error_y_puebla_status
 * - (EC-15) error_tras_exito_previo_limpia_phone_y_status_previos_no_vacuo
 *
 * ### Boundary / error
 * - (EC-7) rerender_con_el_mismo_leadId_no_dispara_otra_llamada
 * - (EC-8) cambiar_leadId_dispara_una_llamada_nueva_y_reinicia_phone_y_status
 * - (EC-8b) cambiar_a_un_lead_sin_fila_visible_reinicia_phone_y_status_a_null_D_SINFILA
 * - (EC-8c) respuesta_tardia_de_un_leadId_anterior_no_pisa_ni_phone_ni_status_del_actual_D_SEQ
 * - (EC-6b) rechazo_real_de_red_termina_con_error_neutro_phone_y_status_null_loading_false
 * - (EC-9) leadId_null_o_undefined_no_llama_supabase_phone_y_status_null_sin_error_loading_false
 * - (EC-13) leadId_pasa_a_null_tras_estar_poblado_reinicia_phone_y_status_a_null
 * - (EC-10) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning
 * - (EC-11) refetch_manual_redispara_la_query
 *
 * ### Extensión RED post-guardian (2026-09-07, subtarea 275.1 tras FAIL)
 * - EC-13 (nuevo): guardian confirmó por mutación que el guard `if
 *   (!leadId)` (useLeadRawFields.ts:66-71) resetea phone/loading/error pero
 *   NO status — bug real de producción. EC-9 solo cubre el estado inicial
 *   con leadId null, nunca la TRANSICIÓN poblado→null. Este test DEBE
 *   fallar hasta que el arreglo (fuera de este archivo) agregue
 *   `set_status(null)` a ese guard.
 * - EC-15 (nuevo): el guardian borró `set_status(null)` Y `set_phone(null)`
 *   de la rama `if (query_result.error)` y la suite siguió 26/26 verde
 *   porque EC-6/EC-6b/EC-14 llegan al error desde el estado inicial (ambos
 *   campos ya null — aserción vacua). EC-15 puebla primero con un fetch
 *   exitoso y fuerza un segundo fetch que falla, así SÍ puede ver la caída
 *   a null. Pasa ya (el código de producción sí resetea); su valor es matar
 *   los mutantes M5/M6. Verificado por mutación manual (ver bitácora
 *   275.1): borrar `set_status(null)` → EC-15 muere; restaurado; borrar
 *   `set_phone(null)` → EC-15 muere; restaurado (re-escritura del archivo,
 *   nunca git checkout/restore — GREEN sin commitear, incidente 219.3).
 *
 * ### Extensión RED (subtarea 275.4, tarea #275 "hardening(267.6)",
 * 2026-09-07): EC-13 ya cubre la TRANSICIÓN leadId poblado -> null (fijada en
 * 275.1) — no se duplica. Falta el segundo aspecto del mismo guard,
 * confirmado por el guardian en 275.3 sobre los otros hooks: el branch `if
 * (!leadId)` NO incrementa seq_ref, así que una query en vuelo del leadId
 * ANTERIOR que resuelve DESPUÉS de la transición a null pasa el guard del
 * token y repuebla phone/status.
 * - (EC-16) query_en_vuelo_del_leadId_anterior_resuelve_tras_la_transicion_a_null_y_no_repuebla_ni_phone_ni_status_D_SEQ
 */

import { renderHook, act } from '@testing-library/react-native';

import { useLeadRawFields } from '../hooks/useLeadRawFields';
import type { LeadStatus } from '../types';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — cadena from().select().eq().is().maybeSingle()
// con UN jest.fn() por eslabón (molde useAgentLeads.test.ts:
// make_supabase_mock_leads), para asertar los argumentos exactos de cada uno.
// ---------------------------------------------------------------------------

type QueryResult = {
  data: { status: LeadStatus | null; users: { phone: string | null } | null } | null;
  error: { message: string } | null;
};

type MockSupabaseClient = {
  from: jest.Mock;
  _mock_from: jest.Mock;
  _mock_select: jest.Mock;
  _mock_eq: jest.Mock;
  _mock_is: jest.Mock;
  _mock_maybe_single: jest.Mock;
};

const mock_supabase_holder: { client: MockSupabaseClient } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEAD_ID = 'lead-uuid-267-6-phone';
const TELEFONO = '+525512345678';
const STATUS_DEFAULT: LeadStatus = 'contacted';

// Fuente independiente del código bajo test: los 11 valores literales del
// enum lead_status tal como los declara types.ts (3 legacy + 8 vigentes de
// ALL_LEAD_STATUSES en lead_status_meta.ts) — NO se importa el array del
// propio código de producción para evitar un test tautológico.
const TODOS_LOS_LEAD_STATUS: LeadStatus[] = [
  'new',
  'in_progress',
  'closed_won',
  'whatsapp_opened',
  'contacted',
  'interested',
  'visit_scheduled',
  'closed_won_rent',
  'closed_won_sale',
  'closed_lost',
  'discarded',
];

function make_supabase_mock(
  maybe_single_impl: jest.Mock = jest
    .fn()
    .mockResolvedValue({ data: { status: STATUS_DEFAULT, users: { phone: TELEFONO } }, error: null }),
): MockSupabaseClient {
  const mock_maybe_single = maybe_single_impl;
  const mock_is = jest.fn().mockReturnValue({ maybeSingle: mock_maybe_single });
  const mock_eq = jest.fn().mockReturnValue({ is: mock_is });
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_eq: mock_eq,
    _mock_is: mock_is,
    _mock_maybe_single: mock_maybe_single,
  };
}

beforeEach(() => {
  // Reloj fijo en TODOS los casos (regla del repo) — evita un test-bomba-de-
  // fecha si este hook llega a incorporar fecha relativa más adelante.
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-06T12:00:00Z'));
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLeadRawFields', () => {
  it('(EC-1) estado_inicial_antes_del_efecto_phone_status_null_loading_true_sin_error', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const render_states: ReturnType<typeof useLeadRawFields>[] = [];
    function useProbe() {
      const state = useLeadRawFields(LEAD_ID);
      render_states.push(state);
      return state;
    }

    await renderHook(() => useProbe());

    // Sonda del PRIMER render (memoria tests_bomba_de_fecha_y_estado_inicial):
    // NO se lee el estado tras el efecto, que ya resolvería la promesa.
    const first = render_states[0]!;
    expect(first.phone).toBeNull();
    expect(first.status).toBeNull();
    expect(first.loading).toBe(true);
    expect(first.error).toBeNull();
  });

  it('(EC-2) cadena_exacta_select_incluye_status_y_users_phone_con_hint_fk_literal', async () => {
    await renderHook(() => useLeadRawFields(LEAD_ID));

    const client = mock_supabase_holder.client;
    expect(client._mock_from).toHaveBeenCalledWith('leads');
    expect(client._mock_select).toHaveBeenCalledWith('status, users!leads_user_id_fkey(phone)');
    expect(client._mock_eq).toHaveBeenCalledWith('id', LEAD_ID);
    expect(client._mock_is).toHaveBeenCalledWith('deleted_at', null);
    expect(client._mock_maybe_single).toHaveBeenCalledTimes(1);
  });

  it('(EC-3) exito_mapea_data_users_phone_y_status_crudo_D_MAP', async () => {
    const { result } = await renderHook(() => useLeadRawFields(LEAD_ID));

    expect(result.current.phone).toBe(TELEFONO);
    expect(result.current.status).toBe(STATUS_DEFAULT);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it.each(TODOS_LOS_LEAD_STATUS)(
    '(EC-12) status_crudo_se_mapea_tal_cual_para_cada_valor_del_enum_lead_status: %s',
    async (status) => {
      mock_supabase_holder.client = make_supabase_mock(
        jest.fn().mockResolvedValue({ data: { status, users: { phone: TELEFONO } }, error: null }),
      );

      const { result } = await renderHook(() => useLeadRawFields(LEAD_ID));

      expect(result.current.status).toBe(status);
      expect(result.current.error).toBeNull();
    },
  );

  it('(EC-4) data_null_sin_fila_phone_y_status_null_sin_error_D_SINFILA', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: null, error: null }));

    const { result } = await renderHook(() => useLeadRawFields(LEAD_ID));

    expect(result.current.phone).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-5) data_con_users_null_status_presente_phone_null_status_intacto_ramas_independientes', async () => {
    // Guardian: sin este caso, un GREEN que sacara `status` DEL embed `users`
    // (en vez de la columna hermana del mismo row) pasaría en falso siempre
    // que `users` viniera poblado, y fallaría en silencio justo cuando el
    // usuario referenciado se borra — que es el caso que este test aísla.
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: { status: STATUS_DEFAULT, users: null }, error: null }),
    );

    const { result } = await renderHook(() => useLeadRawFields(LEAD_ID));

    expect(result.current.phone).toBeNull();
    expect(result.current.status).toBe(STATUS_DEFAULT);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-6) error_de_postgrest_mensaje_neutro_en_espanol_phone_y_status_null_D_ERROR', async () => {
    const RAW_PG_MESSAGE = 'permission denied for relation leads';
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: null, error: { message: RAW_PG_MESSAGE } }),
    );

    const { result } = await renderHook(() => useLeadRawFields(LEAD_ID));

    expect(result.current.error).toBe('No se pudo cargar el teléfono del lead.');
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
    expect(result.current.phone).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-14) recuperacion_tras_error_un_refetch_exitoso_limpia_el_error_y_puebla_status', async () => {
    const maybe_single = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'permission denied for relation leads' } })
      .mockResolvedValueOnce({ data: { status: STATUS_DEFAULT, users: { phone: TELEFONO } }, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result } = await renderHook(() => useLeadRawFields(LEAD_ID));
    expect(result.current.error).toBe('No se pudo cargar el teléfono del lead.');
    expect(result.current.status).toBeNull();

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe(STATUS_DEFAULT);
    expect(result.current.phone).toBe(TELEFONO);
  });

  it('(EC-15) error_tras_exito_previo_limpia_phone_y_status_previos_no_vacuo', async () => {
    // Guardian 275 (M5/M6): un mutante que borrara `set_status(null)` o
    // `set_phone(null)` de la rama `if (query_result.error)` seguía
    // 26/26 verde porque EC-6/EC-6b/EC-14 llegan al error desde el estado
    // inicial, donde ambos campos YA son null (aserción vacua). Aquí se
    // puebla primero con un fetch exitoso y el SEGUNDO fetch (otro leadId,
    // molde EC-8b) falla — la caída a null sí puede fallar.
    const maybe_single = jest
      .fn()
      .mockResolvedValueOnce({ data: { status: STATUS_DEFAULT, users: { phone: TELEFONO } }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'permission denied for relation leads' } });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadRawFields(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(result.current.phone).toBe(TELEFONO);
    expect(result.current.status).toBe(STATUS_DEFAULT);

    await rerender({ leadId: 'lead-uuid-275-error-tras-exito' });

    expect(result.current.error).toBe('No se pudo cargar el teléfono del lead.');
    expect(result.current.phone).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-7) rerender_con_el_mismo_leadId_no_dispara_otra_llamada', async () => {
    const maybe_single = jest
      .fn()
      .mockResolvedValue({ data: { status: STATUS_DEFAULT, users: { phone: TELEFONO } }, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadRawFields(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(maybe_single).toHaveBeenCalledTimes(1);

    await rerender({ leadId: LEAD_ID });

    expect(maybe_single).toHaveBeenCalledTimes(1);
  });

  it('(EC-8) cambiar_leadId_dispara_una_llamada_nueva_y_reinicia_phone_y_status', async () => {
    const OTRO_TELEFONO = '+525587654321';
    const OTRO_STATUS: LeadStatus = 'visit_scheduled';
    const maybe_single = jest
      .fn()
      .mockResolvedValueOnce({ data: { status: STATUS_DEFAULT, users: { phone: TELEFONO } }, error: null })
      .mockResolvedValueOnce({ data: { status: OTRO_STATUS, users: { phone: OTRO_TELEFONO } }, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadRawFields(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(result.current.phone).toBe(TELEFONO);
    expect(result.current.status).toBe(STATUS_DEFAULT);

    await rerender({ leadId: 'lead-uuid-267-6-otro' });

    expect(maybe_single).toHaveBeenCalledTimes(2);
    expect(mock_supabase_holder.client._mock_eq).toHaveBeenLastCalledWith('id', 'lead-uuid-267-6-otro');
    expect(result.current.phone).toBe(OTRO_TELEFONO);
    expect(result.current.status).toBe(OTRO_STATUS);
  });

  it('(EC-8b) cambiar_a_un_lead_sin_fila_visible_reinicia_phone_y_status_a_null_D_SINFILA', async () => {
    // Guardian 267.6: sin este caso, un hook que conservara el teléfono
    // anterior cuando no hay fila (RLS / deleted_at / lead ajeno) pasaría la
    // suite — y el botón de WhatsApp marcaría al contacto EQUIVOCADO (PII
    // cruzada entre leads). Extendido a status: el StatusPicker marcaría un
    // ✓ que ya no corresponde al lead mostrado. EC-4 arranca desde null y no
    // puede verlo.
    const maybe_single = jest
      .fn()
      .mockResolvedValueOnce({ data: { status: STATUS_DEFAULT, users: { phone: TELEFONO } }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadRawFields(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(result.current.phone).toBe(TELEFONO);
    expect(result.current.status).toBe(STATUS_DEFAULT);

    await rerender({ leadId: 'lead-uuid-267-6-sin-fila' });

    expect(maybe_single).toHaveBeenCalledTimes(2);
    expect(result.current.phone).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-8c) respuesta_tardia_de_un_leadId_anterior_no_pisa_ni_phone_ni_status_del_actual_D_SEQ', async () => {
    // Guardian 267.6 (obs. 1): LEAD-A lento, LEAD-B rápido. Resuelve B, luego
    // llega A tardío — el hook ya representa a B y NO debe volver ni a
    // TEL-A ni a STATUS-A.
    const TEL_A = '+525511111111';
    const TEL_B = '+525522222222';
    const STATUS_A: LeadStatus = 'interested';
    const STATUS_B: LeadStatus = 'closed_lost';
    let resolve_a!: (value: QueryResult) => void;
    const pending_a = new Promise<QueryResult>((resolve) => {
      resolve_a = resolve;
    });
    const maybe_single = jest
      .fn()
      .mockReturnValueOnce(pending_a)
      .mockResolvedValueOnce({ data: { status: STATUS_B, users: { phone: TEL_B } }, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadRawFields(leadId), {
      initialProps: { leadId: 'lead-a' },
    });
    await rerender({ leadId: 'lead-b' });
    expect(result.current.phone).toBe(TEL_B);
    expect(result.current.status).toBe(STATUS_B);

    await act(async () => {
      resolve_a({ data: { status: STATUS_A, users: { phone: TEL_A } }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.phone).toBe(TEL_B);
    expect(result.current.status).toBe(STATUS_B);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-6b) rechazo_real_de_red_termina_con_error_neutro_phone_y_status_null_loading_false', async () => {
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockRejectedValue(new TypeError('Network request failed')),
    );

    const { result } = await renderHook(() => useLeadRawFields(LEAD_ID));

    expect(result.current.error).toBe('No se pudo cargar el teléfono del lead.');
    expect(result.current.phone).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-9) leadId_null_o_undefined_no_llama_supabase_phone_y_status_null_sin_error_loading_false', async () => {
    const { result: result_null } = await renderHook(() => useLeadRawFields(null));
    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result_null.current.phone).toBeNull();
    expect(result_null.current.status).toBeNull();
    expect(result_null.current.loading).toBe(false);
    expect(result_null.current.error).toBeNull();

    const { result: result_undefined } = await renderHook(() => useLeadRawFields(undefined));
    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result_undefined.current.phone).toBeNull();
    expect(result_undefined.current.status).toBeNull();
  });

  it('(EC-13) leadId_pasa_a_null_tras_estar_poblado_reinicia_phone_y_status_a_null', async () => {
    // Guardian 275 — bug real de producción confirmado por mutación:
    // useLeadRawFields.ts:66-71 (`if (!leadId)`) resetea phone/loading/error
    // pero deja `status` con el valor del lead anterior. Sonda del
    // guardian: montar 'lead-a' (status "closed_won_sale"), rerender a
    // null -> phone=null pero status="closed_won_sale" (RANCIO). EC-9 solo
    // cubre el estado inicial con leadId null, nunca esta TRANSICIÓN. El
    // StatusPicker de la subtarea 275.2 pintaría el ✓ del lead anterior en
    // el primer frame al cerrar una ficha y abrir otra. Este test DEBE
    // fallar hasta que el arreglo de producción agregue
    // `set_status(null)` a ese guard.
    const STATUS_RANCIO: LeadStatus = 'closed_won_sale';
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: { status: STATUS_RANCIO, users: { phone: TELEFONO } }, error: null }),
    );

    const { result, rerender } = await renderHook(
      ({ leadId }: { leadId: string | null }) => useLeadRawFields(leadId),
      { initialProps: { leadId: 'lead-a' } },
    );
    expect(result.current.phone).toBe(TELEFONO);
    expect(result.current.status).toBe(STATUS_RANCIO);

    await rerender({ leadId: null });

    expect(result.current.phone).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-10) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning', async () => {
    let resolve_maybe_single!: (value: QueryResult) => void;
    const pending = new Promise<QueryResult>((resolve) => {
      resolve_maybe_single = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderHook(() => useLeadRawFields(LEAD_ID));

    let unmount_threw = false;
    try {
      await act(async () => {
        unmount();
      });
    } catch {
      unmount_threw = true;
    }
    expect(unmount_threw).toBe(false);

    await act(async () => {
      resolve_maybe_single({ data: { status: STATUS_DEFAULT, users: { phone: TELEFONO } }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console_error_spy).not.toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  it('(EC-11) refetch_manual_redispara_la_query', async () => {
    const maybe_single = jest
      .fn()
      .mockResolvedValue({ data: { status: STATUS_DEFAULT, users: { phone: TELEFONO } }, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result } = await renderHook(() => useLeadRawFields(LEAD_ID));
    expect(maybe_single).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(maybe_single).toHaveBeenCalledTimes(2);
  });

  it('(EC-16) query_en_vuelo_del_leadId_anterior_resuelve_tras_la_transicion_a_null_y_no_repuebla_ni_phone_ni_status_D_SEQ', async () => {
    let resolve_a!: (value: QueryResult) => void;
    const pending_a = new Promise<QueryResult>((resolve) => {
      resolve_a = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending_a));

    const { result, rerender } = await renderHook(
      ({ leadId }: { leadId: string | null }) => useLeadRawFields(leadId),
      { initialProps: { leadId: LEAD_ID } },
    );

    await rerender({ leadId: null });
    expect(result.current.phone).toBeNull();
    expect(result.current.status).toBeNull();

    await act(async () => {
      resolve_a({ data: { status: STATUS_DEFAULT, users: { phone: TELEFONO } }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.phone).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
