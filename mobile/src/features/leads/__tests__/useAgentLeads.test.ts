/**
 * Tests fase RED — useAgentLeads hook
 * Archivo SUT: mobile/src/features/leads/hooks/useAgentLeads.ts
 * Subtarea Taskmaster: 15.2 — Implement leads query with user info and property origin
 *
 * SUT: useAgentLeads() → { leads: AgentLead[], loading: boolean, error: string | null, refetch: () => void }
 *
 * Contrato (schema migraciones 0001 + 0006 + 0015):
 *   - Consulta tabla `leads` con embedded selects (usuarios + preferencias + origin).
 *   - Filtra: deleted_at IS NULL. RLS (migración 0008) filtra agent_id = auth.uid().
 *   - Ordena: updated_at DESC.
 *   - Datos del buscador:
 *     · phone de `users` (via leads.user_id FK, para WhatsApp #15.5).
 *     · full_name y profile_photo_url de `user_preferences` (migración 0015;
 *       corrección del tarea #14: viene de user_preferences, NO de users).
 *   - Propiedad de origen: `lead_origin_properties` (LEFT JOIN) → `properties`
 *     → thumbnail de `property_videos`. Nullable si el lead no tiene origin.
 *   - Estado inicial: loading=true antes de resolver.
 *   - Error de Supabase: expuesto en error, leads=[].
 *
 * PATRÓN DE MOCK:
 *   - `@/lib/supabase/client`: mock de módulo con getter sobre objeto mutable
 *     `mock_supabase_holder` (patrón de useAgentProfile.test.tsx).
 *   - `@/features/auth/context` (useAuth): provee el usuario agente autenticado.
 *   - La cadena de query es: from('leads').select(...).is(...).order(...) → Promise.
 *
 * EDGE CASES CUBIERTOS (10 casos originales + 4 de la subtarea 28.3):
 *
 * ### Happy path
 * - (EC-1) mapea_lead_completo_a_AgentLead
 *
 * ### Edge cases del PRD / schema (§CRM migración 0006)
 * - (EC-2) lead_sin_origin_property_campos_origin_nulos_sin_crash
 * - (EC-3) user_preferences_null_full_name_photo_nulos_sin_crash
 *
 * ### Ramas de reglas no obvias
 * - (EC-4) phone_null_en_usuarios_no_rompe
 * - (EC-5) filtra_deleted_at_es_null
 * - (EC-6) ordena_por_updated_at_desc
 * - (EC-7) consulta_tabla_leads
 *
 * ### Boundary / error
 * - (EC-8) estado_loading_inicial_true
 * - (EC-9) estado_loading_false_con_leads_tras_resolver
 * - (EC-10) error_cliente_expone_error_leads_vacio
 *
 * ### Subtarea 28.3 — filtro por agentId (semántica AGREGADO, RLS-driven)
 * - (EC-nuevo-1) agentId_string_agrega_filtro_eq_agent_id
 * - (EC-nuevo-2) agentId_null_o_ausente_no_agrega_filtro_eq_agent_id
 * - (EC-nuevo-3) cambiar_agentId_entre_renders_redispara_fetch_con_nuevo_agente
 * - (EC-nuevo-4) transformacion_raw_a_agent_lead_no_cambia_con_filtro_por_agentId
 *
 * ORDEN DE ENCADENAMIENTO ASUMIDO PARA EL GREEN (documentado aquí para que la
 * implementación lo respete):
 *   from('leads').select(<embeds>).eq('agent_id', agentId)?.is('deleted_at', null).order(...)
 *   — .eq() se inserta SOLO si agentId es string; si es null/undefined se omite
 *   y la cadena queda igual que hoy: select().is().order().
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock de useAuth — declara ANTES de cualquier import del SUT.
// El agente autenticado tiene id TEST_AGENT_ID.
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — patrón mock_supabase_holder con getter.
//
// Estrategia:
//   El getter hace que cada acceso a `supabase` en el SUT resuelva el valor
//   actual de mock_supabase_holder.client, incluso después de que beforeEach
//   lo reemplace con un mock nuevo para cada test.
//
// Cadena de query esperada (sin agentId — comportamiento histórico, EC-1..10):
//   supabase.from('leads')
//     .select(<embeds>)          ← selects con joins embedded de users, user_preferences,
//                                   lead_origin_properties, properties, property_videos
//     .is('deleted_at', null)    ← EC-5: filtra leads no borrados
//     .order('updated_at', { ascending: false })  ← EC-6: más reciente primero
//
// El agente_id NO se filtra explícitamente aquí (RLS lo hace, migración 0008).
//
// Cadena con agentId (subtarea 28.3, EC-nuevo-1..4):
//   supabase.from('leads')
//     .select(<embeds>)
//     .eq('agent_id', agentId)   ← SOLO si agentId es string (no null/undefined)
//     .is('deleted_at', null)
//     .order('updated_at', { ascending: false })
//
// El mock de .select() retorna un objeto con AMBOS `is` y `eq` para soportar
// las dos cadenas (con y sin filtro). `.eq()` a su vez retorna `{ is }` para
// que la cadena pueda seguir con `.is().order()` tras el filtro.
// ---------------------------------------------------------------------------

/** Holder mutable — beforeEach lo reemplaza con el mock apropiado por test. */
const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock_leads> } = {
  client: null as never, // se sobrescribe en beforeEach antes de cada test
};

jest.mock('@/lib/supabase/client', () => ({
  // Getter: cada acceso a `supabase` en el SUT resuelve el valor actual.
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useAgentLeads } from '../hooks/useAgentLeads';
import type { AgentLead } from '../types';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_AGENT_ID = 'agente-uuid-crm-test-15';
const TEST_USER_ID = 'buscador-uuid-lead-001';
const TEST_LEAD_ID = 'lead-uuid-001-crm-test';
const TEST_PROPERTY_ID = 'propiedad-uuid-origen-001';

// ---------------------------------------------------------------------------
// Helper — cast tipado de mock
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Datos de prueba — shape de la respuesta raw de Supabase con embedded selects
//
// La query usa embedded selects de PostgREST/supabase-js:
//   leads → users!leads_user_id_fkey(phone, user_preferences(full_name, profile_photo_url))
//         → lead_origin_properties(property_id, properties(address, property_videos(thumbnail_url, position)))
//
// Relaciones:
//   - users: many-to-one (leads.user_id → users.id) → objeto simple
//   - user_preferences: one-to-many desde users.id → array (PostgREST retorna array
//     incluso para relaciones de facto 1:1 como user_preferences con unique user_id)
//   - lead_origin_properties: one-to-many desde leads.id → array (LEFT JOIN)
//   - properties: many-to-one desde lead_origin_properties.property_id → objeto
//   - property_videos: one-to-many desde properties.id → array
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Interface explícita para el shape raw de Supabase (campos nullable correctos)
//
// Se define ANTES de RAW_LEAD_COMPLETO para poder anotar el fixture con ella.
// Esto evita que TypeScript infiera phone/profile_photo_url como `string`
// (no nullable) a partir de los valores literales de RAW_LEAD_COMPLETO,
// lo que causaba TS2322 en RAW_LEAD_SIN_ORIGIN y RAW_LEAD_SIN_PHONE.
// ---------------------------------------------------------------------------

interface RawLeadUserPrefs {
  full_name: string | null;
  profile_photo_url: string | null;
}

interface RawLeadPropertyVideo {
  thumbnail_url: string | null;
  position: number;
}

interface RawLeadOriginProperties {
  property_id: string;
  properties: {
    address: string;
    property_videos: RawLeadPropertyVideo[];
  };
}

interface RawLeadRow {
  id: string;
  user_id: string;
  agent_id: string;
  status: string;
  internal_notes: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
  users: {
    phone: string | null;
    user_preferences: RawLeadUserPrefs[];
  };
  lead_origin_properties: RawLeadOriginProperties[];
}

/** Lead con todos los datos disponibles: phone, prefs, propiedad de origen con thumbnail. */
const RAW_LEAD_COMPLETO: RawLeadRow = {
  id: TEST_LEAD_ID,
  user_id: TEST_USER_ID,
  agent_id: TEST_AGENT_ID,
  status: 'new',
  internal_notes: null,
  first_contact_at: '2026-06-01T10:00:00Z',
  last_contact_at: '2026-06-28T14:30:00Z',
  updated_at: '2026-06-28T14:30:00Z',
  created_at: '2026-06-01T10:00:00Z',
  deleted_at: null,
  // Embedded: users (many-to-one vía leads.user_id FK)
  users: {
    phone: '+52 55 1234 5678',
    // Embedded: user_preferences (one-to-many desde users.id; migración 0015)
    user_preferences: [
      {
        full_name: 'María García López',
        profile_photo_url: 'https://storage.supabase.co/profile-photos/maria.jpg',
      },
    ],
  },
  // Embedded: lead_origin_properties (one-to-many vía lead_origin_properties.lead_id)
  lead_origin_properties: [
    {
      property_id: TEST_PROPERTY_ID,
      // Embedded: properties (many-to-one vía property_id)
      properties: {
        address: 'Av. Insurgentes Sur 1602, Col. Florida, CDMX',
        // Embedded: property_videos (one-to-many vía property_id)
        property_videos: [
          {
            thumbnail_url: 'https://storage.supabase.co/property-videos/thumb001.jpg',
            position: 1,
          },
        ],
      },
    },
  ],
};

/** Lead sin propiedad de origen registrada (lead_origin_properties vacío). */
const RAW_LEAD_SIN_ORIGIN = {
  ...RAW_LEAD_COMPLETO,
  id: 'lead-uuid-002-sin-origin',
  users: {
    phone: '+52 55 9876 5432',
    user_preferences: [
      { full_name: 'Pedro López Reyes', profile_photo_url: null },
    ],
  },
  lead_origin_properties: [], // ← sin propiedad de origen → origin_* debe ser null
};

/** Lead de usuario sin onboarding (user_preferences vacío → full_name/photo null). */
const RAW_LEAD_SIN_PREFS = {
  ...RAW_LEAD_COMPLETO,
  id: 'lead-uuid-003-sin-prefs',
  users: {
    phone: '+52 55 5555 0000',
    user_preferences: [], // ← sin preferencias → full_name/photo null
  },
  lead_origin_properties: [],
};

/** Lead de usuario sin phone registrado (users.phone = null). */
const RAW_LEAD_SIN_PHONE = {
  ...RAW_LEAD_COMPLETO,
  id: 'lead-uuid-004-sin-phone',
  users: {
    phone: null, // ← sin phone → AgentLead.phone = null
    user_preferences: [
      { full_name: 'Ana Martínez', profile_photo_url: null },
    ],
  },
  lead_origin_properties: [],
};

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
//
// Cadena: from('leads').select(...).is('deleted_at', null).order('updated_at', {ascending:false})
// La cadena resuelve directamente a { data, error } (PostgREST/supabase-js v2).
// ---------------------------------------------------------------------------

function make_supabase_mock_leads(opts: {
  query_result?: { data: RawLeadRow[] | null; error: { message: string } | null };
} = {}) {
  const {
    query_result = { data: [RAW_LEAD_COMPLETO], error: null },
  } = opts;

  // Extremo final de la cadena: .order(...) → Promise<{ data, error }>
  const mock_order = jest.fn().mockResolvedValue(query_result);
  // .is('deleted_at', null) → retorna { order }
  const mock_is = jest.fn().mockReturnValue({ order: mock_order });
  // .eq('agent_id', id) → retorna { is } (subtarea 28.3 — solo si agentId es string)
  const mock_eq = jest.fn().mockReturnValue({ is: mock_is });
  // .select(...) → retorna { is, eq } — soporta ambas cadenas (con y sin filtro)
  const mock_select = jest.fn().mockReturnValue({ is: mock_is, eq: mock_eq });
  // from('leads') → retorna { select }
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    // Expuestos para aserciones directas
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_eq: mock_eq,
    _mock_is: mock_is,
    _mock_order: mock_order,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock_leads();
  mock_use_auth.mockReturnValue({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: { id: TEST_AGENT_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgentLeads', () => {

  // ── (EC-1) Happy path — mapeo completo de raw a AgentLead ────────────────

  it('(EC-1) mapea_lead_completo_a_AgentLead: raw con users.phone, user_preferences[0] y lead_origin_properties[0] → AgentLead con todos los campos correctos', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_COMPLETO], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads());

    // El hook debe devolver exactamente 1 lead
    expect(result.current.leads).toHaveLength(1);

    const lead = result.current.leads[0] as AgentLead;

    // Campos base del lead
    expect(lead.id).toBe(TEST_LEAD_ID);
    expect(lead.user_id).toBe(TEST_USER_ID);
    expect(lead.status).toBe('new');
    expect(lead.updated_at).toBe('2026-06-28T14:30:00Z');

    // Usuario interesado — phone de users
    expect(lead.phone).toBe('+52 55 1234 5678');

    // Usuario interesado — full_name y profile_photo_url de user_preferences (migración 0015)
    expect(lead.full_name).toBe('María García López');
    expect(lead.profile_photo_url).toBe(
      'https://storage.supabase.co/profile-photos/maria.jpg'
    );

    // Propiedad de origen
    expect(lead.origin_property_id).toBe(TEST_PROPERTY_ID);
    expect(lead.origin_property_address).toBe('Av. Insurgentes Sur 1602, Col. Florida, CDMX');
    expect(lead.origin_property_thumbnail_url).toBe(
      'https://storage.supabase.co/property-videos/thumb001.jpg'
    );

    // Sin error
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-2) Lead sin propiedad de origen ──────────────────────────────────
  //
  // Regla: lead_origin_properties puede estar vacío (LEFT JOIN). En ese caso,
  // origin_property_id, origin_property_address y origin_property_thumbnail_url
  // deben ser null, sin crash.

  it('(EC-2) lead_sin_origin_property_campos_origin_nulos_sin_crash: lead con lead_origin_properties:[] → origin_property_id/address/thumbnail_url son null, leads[0] existe', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_SIN_ORIGIN], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads());

    expect(result.current.leads).toHaveLength(1);

    const lead = result.current.leads[0] as AgentLead;

    // Campos de origen deben ser null — no crash
    expect(lead.origin_property_id).toBeNull();
    expect(lead.origin_property_address).toBeNull();
    expect(lead.origin_property_thumbnail_url).toBeNull();

    // Pero el resto del lead sí tiene datos
    expect(lead.id).toBe('lead-uuid-002-sin-origin');
    expect(lead.full_name).toBe('Pedro López Reyes');
    expect(lead.phone).toBe('+52 55 9876 5432');

    expect(result.current.error).toBeNull();
  });

  // ── (EC-3) Usuario sin user_preferences (sin onboarding) ─────────────────
  //
  // Regla: user_preferences puede no existir (array vacío desde PostgREST).
  // full_name y profile_photo_url deben ser null, sin crash.

  it('(EC-3) user_preferences_null_full_name_photo_nulos_sin_crash: lead con users.user_preferences:[] → full_name=null y profile_photo_url=null, sin crash', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_SIN_PREFS], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads());

    expect(result.current.leads).toHaveLength(1);

    const lead = result.current.leads[0] as AgentLead;

    // Sin user_preferences → full_name y profile_photo_url son null
    expect(lead.full_name).toBeNull();
    expect(lead.profile_photo_url).toBeNull();

    // El phone sigue siendo accesible desde users.phone
    expect(lead.phone).toBe('+52 55 5555 0000');

    expect(result.current.error).toBeNull();
  });

  // ── (EC-4) Usuario sin phone ──────────────────────────────────────────────
  //
  // Regla: users.phone es nullable en el schema (migración 0002). El hook debe
  // mapearlo a null sin crash, no lanzar undefined.

  it('(EC-4) phone_null_en_usuarios_no_rompe: lead con users.phone=null → AgentLead.phone=null, sin crash', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_SIN_PHONE], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads());

    expect(result.current.leads).toHaveLength(1);

    const lead = result.current.leads[0] as AgentLead;

    // phone es null exactamente (no undefined, no string vacío)
    expect(lead.phone).toBeNull();

    // El resto de los campos sigue disponible
    expect(lead.full_name).toBe('Ana Martínez');
    expect(lead.id).toBe('lead-uuid-004-sin-phone');
  });

  // ── (EC-5) Filtro deleted_at IS NULL ─────────────────────────────────────
  //
  // Regla del schema (migración 0006): el unique index de leads usa
  // WHERE deleted_at IS NULL — leads borrados (soft-delete) no deben aparecer.
  // La query DEBE llamar .is('deleted_at', null).

  it('(EC-5) filtra_deleted_at_es_null: la query llama .is("deleted_at", null) para excluir leads soft-deleted', async () => {
    await renderHook(() => useAgentLeads());

    // La query debe haber llamado .is('deleted_at', null)
    expect(mock_supabase_holder.client._mock_is).toHaveBeenCalledWith('deleted_at', null);
  });

  // ── (EC-6) Orden por updated_at DESC ─────────────────────────────────────
  //
  // Regla del contrato: ORDER BY updated_at DESC — el lead más recientemente
  // actualizado aparece primero en la lista CRM.

  it('(EC-6) ordena_por_updated_at_desc: la query llama .order("updated_at", { ascending: false })', async () => {
    await renderHook(() => useAgentLeads());

    // Verifica que el orden es exactamente updated_at DESC
    expect(mock_supabase_holder.client._mock_order).toHaveBeenCalledWith(
      'updated_at',
      { ascending: false }
    );
  });

  // ── (EC-7) Consulta la tabla leads ───────────────────────────────────────
  //
  // Verificación básica: el hook debe partir de from('leads'), no de otra tabla.

  it('(EC-7) consulta_tabla_leads: la query parte de supabase.from("leads")', async () => {
    await renderHook(() => useAgentLeads());

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledWith('leads');
  });

  // ── (EC-8) Estado loading inicial ────────────────────────────────────────
  //
  // Antes de que el fetch async resuelva, el hook debe exponer loading=true.
  // Patrón: mock con promesa pendiente (nunca resuelve en este test).
  // act() de React 18 no espera promesas pendientes iniciadas dentro de useEffect
  // → await renderHook completa sin que la promesa resuelva → loading sigue true.
  //
  // RED: stub retorna loading=false sin llamar supabase → falla la aserción.
  // GREEN: hook inicializa useState({loading: true}) → mantiene true con fetch pendiente.

  it('(EC-8) estado_loading_inicial_true: loading=true mientras el fetch async está pendiente (promesa pendiente, act no espera)', async () => {
    // Promesa que nunca resuelve en este test — simula fetch en progreso.
    // act() de RNTL finaliza sin esperarla (comportamiento de React 18 con Promises arbitrarias).
    const pending_query = new Promise<{ data: RawLeadRow[]; error: null }>(() => {});

    mock_supabase_holder.client = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          is: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue(pending_query),
          }),
        }),
      }),
      // Propiedades de aserción para compatibilidad con el tipo del holder
      _mock_from: jest.fn(),
      _mock_select: jest.fn(),
      _mock_is: jest.fn(),
      _mock_order: jest.fn(),
    } as unknown as ReturnType<typeof make_supabase_mock_leads>;

    // await renderHook — completa sin que la promesa resuelva.
    // El stub no llama supabase → loading queda false → falla RED.
    // La implementación real: loading=true (inicial) + fetch pendiente → loading=true → GREEN.
    const { result } = await renderHook(() => useAgentLeads());

    expect(result.current.loading).toBe(true);
  });

  // ── (EC-9) Estado resuelto — loading false con datos ─────────────────────

  it('(EC-9) estado_loading_false_con_leads_tras_resolver: await renderHook → loading=false y leads[] tiene los datos del raw', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_COMPLETO], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads());

    // Después de resolver, loading debe ser false
    expect(result.current.loading).toBe(false);
    // Y leads debe tener exactamente 1 elemento (el mock tiene 1 raw lead)
    expect(result.current.leads).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  // ── (EC-10) Error del cliente Supabase ───────────────────────────────────
  //
  // Si Supabase retorna error (red, RLS, etc.), el hook debe exponerlo en
  // error (string), no tragar el error, y leads debe ser [] (no null/undefined).

  it('(EC-10) error_cliente_expone_error_leads_vacio: query devuelve {error:{message}} → error!=null, leads=[], no crashea', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: {
        data: null,
        error: { message: 'RLS policy violation: no tienes acceso a estos leads' },
      },
    });

    const { result } = await renderHook(() => useAgentLeads());

    // El error debe estar expuesto, no tragado
    expect(result.current.error).toBe('RLS policy violation: no tienes acceso a estos leads');
    // leads debe ser array vacío (no null ni undefined) para no romper el render
    expect(result.current.leads).toEqual([]);
    // loading resuelto
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-nuevo-1) agentId string → agrega filtro .eq('agent_id', …) ──────
  //
  // Subtarea 28.3: cuando se pasa un agentId concreto (caso owner viendo los
  // leads de un agente específico de su agencia), la query debe encadenar
  // .eq('agent_id', agentId) además de is/order.

  it('(EC-nuevo-1) agentId_string_agrega_filtro_eq_agent_id: useAgentLeads("agent-123") encadena .eq("agent_id", "agent-123") en la query', async () => {
    const mock_client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_COMPLETO], error: null },
    });
    mock_supabase_holder.client = mock_client;

    await renderHook(() => useAgentLeads('agent-123'));

    expect(mock_client._mock_eq).toHaveBeenCalledWith('agent_id', 'agent-123');
  });

  // ── (EC-nuevo-2) agentId null/ausente → NO agrega filtro .eq ────────────
  //
  // Semántica AGREGADO / RLS-driven: sin agentId explícito (null o ausente),
  // NO se llama .eq('agent_id', …) — el filtro lo hace RLS (owner ve todos
  // los leads de su agencia con "Todos los agentes"; agente normal ve solo
  // los suyos, idéntico al comportamiento histórico EC-1..10).

  it('(EC-nuevo-2) agentId_null_o_ausente_no_agrega_filtro_eq_agent_id: useAgentLeads(null) y useAgentLeads() no llaman .eq("agent_id", …) — RLS decide', async () => {
    const mock_client_null = make_supabase_mock_leads();
    mock_supabase_holder.client = mock_client_null;

    await renderHook(() => useAgentLeads(null));

    expect(mock_client_null._mock_eq).not.toHaveBeenCalled();

    const mock_client_sin_arg = make_supabase_mock_leads();
    mock_supabase_holder.client = mock_client_sin_arg;

    await renderHook(() => useAgentLeads());

    expect(mock_client_sin_arg._mock_eq).not.toHaveBeenCalled();
  });

  // ── (EC-nuevo-3) cambiar agentId entre renders redispara el fetch ───────
  //
  // agentId debe estar en las deps del useEffect: al re-renderizar el hook
  // con un agentId distinto (p.ej. el owner cambia de agente seleccionado en
  // el filtro del CRM), la query se vuelve a disparar y refleja los leads
  // del nuevo agente.

  it('(EC-nuevo-3) cambiar_agentId_entre_renders_redispara_fetch_con_nuevo_agente: rerender con agentId distinto vuelve a llamar la query y actualiza leads con los del nuevo agente', async () => {
    const RAW_LEAD_AGENTE_A: RawLeadRow = {
      ...RAW_LEAD_COMPLETO,
      id: 'lead-uuid-agente-a',
      agent_id: 'agent-aaa',
    };
    const RAW_LEAD_AGENTE_B: RawLeadRow = {
      ...RAW_LEAD_COMPLETO,
      id: 'lead-uuid-agente-b',
      agent_id: 'agent-bbb',
      users: {
        phone: '+52 55 0000 1111',
        user_preferences: [{ full_name: 'Otro Agente Leads', profile_photo_url: null }],
      },
      lead_origin_properties: [],
    };

    const mock_client_a = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_AGENTE_A], error: null },
    });
    mock_supabase_holder.client = mock_client_a;

    const { result, rerender } = await renderHook(
      ({ agentId }: { agentId: string }) => useAgentLeads(agentId),
      { initialProps: { agentId: 'agent-aaa' } }
    );

    expect(result.current.leads).toHaveLength(1);
    expect(result.current.leads[0]?.id).toBe('lead-uuid-agente-a');
    expect(mock_client_a._mock_eq).toHaveBeenCalledWith('agent_id', 'agent-aaa');

    // Reemplaza el cliente mockeado con los datos del nuevo agente antes del rerender.
    const mock_client_b = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_AGENTE_B], error: null },
    });
    mock_supabase_holder.client = mock_client_b;

    await act(async () => {
      rerender({ agentId: 'agent-bbb' });
    });

    // El rerender con agentId distinto debe haber vuelto a llamar from('leads')
    // sobre el NUEVO cliente mockeado — prueba de que el fetch se re-disparó.
    expect(mock_client_b._mock_from).toHaveBeenCalledWith('leads');
    expect(mock_client_b._mock_eq).toHaveBeenCalledWith('agent_id', 'agent-bbb');
    expect(result.current.leads).toHaveLength(1);
    expect(result.current.leads[0]?.id).toBe('lead-uuid-agente-b');
  });

  // ── (EC-nuevo-4) transformación raw→AgentLead no cambia con el filtro ───
  //
  // Smoke: la transformación de datos (phone, full_name, origin_*) sigue
  // intacta cuando se filtra por agentId — el filtro solo afecta la cláusula
  // WHERE, no el mapeo de la fila resultante.

  it('(EC-nuevo-4) transformacion_raw_a_agent_lead_no_cambia_con_filtro_por_agentId: useAgentLeads("agent-123") sigue mapeando phone/full_name/origin igual que sin filtro', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_COMPLETO], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads('agent-123'));

    expect(result.current.leads).toHaveLength(1);
    const lead = result.current.leads[0] as AgentLead;

    expect(lead.phone).toBe('+52 55 1234 5678');
    expect(lead.full_name).toBe('María García López');
    expect(lead.profile_photo_url).toBe(
      'https://storage.supabase.co/profile-photos/maria.jpg'
    );
    expect(lead.origin_property_id).toBe(TEST_PROPERTY_ID);
    expect(lead.origin_property_address).toBe('Av. Insurgentes Sur 1602, Col. Florida, CDMX');
    expect(result.current.error).toBeNull();
  });

});
