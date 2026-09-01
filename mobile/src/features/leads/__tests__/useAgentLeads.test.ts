/**
 * Tests fase RED — useAgentLeads hook
 * Archivo SUT: mobile/src/features/leads/hooks/useAgentLeads.ts
 * Subtarea Taskmaster: 15.2 (original) + 28.3 + 30.3 + 75.6 (scoring/actividad visible + mensaje en español)
 *
 * SUT: useAgentLeads(agentId?, sortBy?) → { leads: AgentLead[], loading, error, refetch }
 *
 * Contrato (schema migraciones 0001 + 0006 + 0015 + 20260807000004 + subtareas 30.3/75.6):
 *   - Consulta tabla `leads` con embedded selects (usuarios + origin) + score/level/is_follow_up.
 *   - Filtra: deleted_at IS NULL. RLS (migración 0008) filtra agent_id = auth.uid().
 *   - Ordena (75.6, §19.9): sortBy='score' (DEFAULT) → leads.score DESC, desempate
 *     leads.updated_at DESC. sortBy='last_contact' (botón secundario del PRD) →
 *     leads.last_contact_at DESC con nulls al final (un lead nunca contactado de
 *     vuelta no debe salir arriba), MISMO desempate updated_at DESC.
 *   - select pide también score/level/is_follow_up (75.6) — clasificación por
 *     actividad visible en el CRM (frío/tibio/caliente + bandera de seguimiento).
 *   - Datos del buscador — TODOS desde `users` (subtarea 30.3; antes full_name/
 *     profile_photo_url venían de `user_preferences`, pero el agente NO puede
 *     leer el user_preferences del buscador vía RLS — solo su propia fila):
 *     · phone de `users.phone` (via leads.user_id FK, para WhatsApp #15.5).
 *     · full_name = build_full_name(users.first_name, users.last_name)
 *       (mismo patrón que useAgencyAgents — join con espacio, null si ambos vacíos).
 *     · profile_photo_url = users.avatar_url.
 *   - Propiedad de origen: `lead_origin_properties` (LEFT JOIN) → `properties`
 *     → thumbnail de `property_videos`. Nullable si el lead no tiene origin.
 *   - Estado inicial: loading=true antes de resolver.
 *   - Error de Supabase (75.6, defecto #1/#3 del usuario): mensaje NEUTRO en
 *     español, NUNCA el texto crudo de PostgREST/Postgres — mismo criterio que
 *     useUpdateLeadStatus/useUpdateLeadNote.
 *
 * PATRÓN DE MOCK:
 *   - `@/lib/supabase/client`: mock de módulo con getter sobre objeto mutable
 *     `mock_supabase_holder` (patrón de useAgentProfile.test.tsx).
 *   - `@/features/auth/context` (useAuth): provee el usuario agente autenticado.
 *   - La cadena de query es: from('leads').select(...).is(...).order(...) → Promise.
 *     El extremo `.order(...)` es un objeto CHAINABLE + THENABLE (75.6): soporta
 *     tanto un solo `.order()` (comportamiento histórico, EC-1..10) como una
 *     cadena `.order(primario).order(desempate)` (75.6) sin romper ninguno de
 *     los dos — `await` en cualquier punto de la cadena resuelve al mismo
 *     `query_result`. Ver make_order_chain().
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) mapea_lead_completo_a_AgentLead
 *
 * ### Edge cases del PRD / schema (§CRM migración 0006)
 * - (EC-2) lead_sin_origin_property_campos_origin_nulos_sin_crash
 * - (EC-3) nombre_ambos_null_en_users_full_name_photo_nulos_sin_crash
 *
 * ### Ramas de reglas no obvias
 * - (EC-4) phone_null_en_usuarios_no_rompe
 * - (EC-5) filtra_deleted_at_es_null
 * - (EC-6) ordena_por_score_desc_por_defecto_con_desempate_updated_at [75.6, REESCRITO]
 * - (EC-6b) modo_last_contact_ordena_por_last_contact_at_desc_nulls_last_con_desempate [75.6, NUEVO]
 * - (EC-7) consulta_tabla_leads
 *
 * ### Boundary / error
 * - (EC-8) estado_loading_inicial_true
 * - (EC-9) estado_loading_false_con_leads_tras_resolver
 * - (EC-10) error_cliente_mensaje_en_espanol_no_crudo_leads_vacio [75.6, REESCRITO]
 *
 * ### Subtarea 28.3 — filtro por agentId (semántica AGREGADO, RLS-driven)
 * - (EC-nuevo-1) agentId_string_agrega_filtro_eq_agent_id
 * - (EC-nuevo-2) agentId_null_o_ausente_no_agrega_filtro_eq_agent_id
 * - (EC-nuevo-3) cambiar_agentId_entre_renders_redispara_fetch_con_nuevo_agente
 * - (EC-nuevo-4) transformacion_raw_a_agent_lead_no_cambia_con_filtro_por_agentId
 *
 * ### Subtarea 30.3 — identidad del buscador desde `users` (build_full_name + avatar_url)
 * - (EC-30_3-1) solo_first_name_last_name_null_full_name_es_solo_el_first_name
 * - (EC-30_3-2) avatar_url_null_profile_photo_url_null_con_nombre_presente
 * - (EC-30_3-3) select_lee_first_name_last_name_avatar_url_de_users_no_user_preferences
 *
 * ### Subtarea 75.6 — scoring/actividad visible en el CRM (defecto #3 del usuario)
 * - (EC-nuevo-5) select_pide_score_level_is_follow_up
 * - (EC-nuevo-6) mapea_score_level_is_follow_up_al_agent_lead
 *
 * ORDEN DE ENCADENAMIENTO ASUMIDO PARA EL GREEN (documentado aquí para que la
 * implementación lo respete):
 *   from('leads').select(<embeds+score+level+is_follow_up>).eq('agent_id', agentId)?
 *     .is('deleted_at', null).order(<campo primario>, {ascending:false, nullsFirst?}).order('updated_at', {ascending:false})
 *   — .eq() se inserta SOLO si agentId es string; si es null/undefined se omite.
 *   — El PRIMER .order() es 'score' (default) o 'last_contact_at' (sortBy='last_contact',
 *     con nullsFirst:false); el SEGUNDO .order() es SIEMPRE 'updated_at' desc (desempate).
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useAgentLeads } from '../hooks/useAgentLeads';
import type { AgentLead } from '../types';

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
//     .select(<embeds+score+level+is_follow_up>) ← selects con joins embedded de
//                                   users (first_name, last_name, avatar_url),
//                                   lead_origin_properties, properties,
//                                   property_videos + score/level/is_follow_up (75.6)
//     .is('deleted_at', null)    ← EC-5: filtra leads no borrados
//     .order(<primario>, {...}).order('updated_at', {ascending:false})  ← EC-6/EC-6b (75.6)
//
// El agente_id NO se filtra explícitamente aquí (RLS lo hace, migración 0008).
//
// Cadena con agentId (subtarea 28.3, EC-nuevo-1..4):
//   supabase.from('leads')
//     .select(<embeds>)
//     .eq('agent_id', agentId)   ← SOLO si agentId es string (no null/undefined)
//     .is('deleted_at', null)
//     .order(<primario>, {...}).order('updated_at', {ascending:false})
//
// El mock de .select() retorna un objeto con AMBOS `is` y `eq` para soportar
// las dos cadenas (con y sin filtro). `.eq()` a su vez retorna `{ is }` para
// que la cadena pueda seguir con `.is().order()...` tras el filtro. El extremo
// `.order(...)` es CHAINABLE+THENABLE (75.6, ver make_order_chain()).
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
// La query usa embedded selects de PostgREST/supabase-js (subtarea 30.3 —
// identidad del buscador YA NO viene de user_preferences, sino de users
// directamente, mismo patrón que useAgencyAgents):
//   leads → users!leads_user_id_fkey(phone, first_name, last_name, avatar_url)
//         → lead_origin_properties(property_id, properties(address, property_videos(thumbnail_url, position)))
//
// Relaciones:
//   - users: many-to-one (leads.user_id → users.id) → objeto simple
//   - lead_origin_properties: one-to-many desde leads.id → array (LEFT JOIN)
//   - properties: many-to-one desde lead_origin_properties.property_id → objeto
//   - property_videos: one-to-many desde properties.id → array
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Interface explícita para el shape raw de Supabase (campos nullable correctos)
//
// Se define ANTES de RAW_LEAD_COMPLETO para poder anotar el fixture con ella.
// Esto evita que TypeScript infiera phone/first_name/last_name/avatar_url como
// `string` (no nullable) a partir de los valores literales de RAW_LEAD_COMPLETO,
// lo que causaba TS2322 en RAW_LEAD_SIN_ORIGIN y RAW_LEAD_SIN_PHONE.
// ---------------------------------------------------------------------------

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
  // Scoring/actividad (migración 20260807000004, subtarea 75.6) — not-null en el
  // schema real (triggers los mantienen siempre poblados).
  score: number;
  level: 'frio' | 'tibio' | 'caliente';
  is_follow_up: boolean;
  users: {
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  };
  lead_origin_properties: RawLeadOriginProperties[];
}

/** Lead con todos los datos disponibles: phone, nombre completo, propiedad de origen con thumbnail. */
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
  score: 10,
  level: 'frio',
  is_follow_up: false,
  // Embedded: users (many-to-one vía leads.user_id FK) — subtarea 30.3:
  // full_name/profile_photo_url YA NO vienen de user_preferences.
  users: {
    phone: '+52 55 1234 5678',
    first_name: 'María',
    last_name: 'García López',
    avatar_url: 'https://storage.supabase.co/profile-photos/maria.jpg',
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
    first_name: 'Pedro',
    last_name: 'López Reyes',
    avatar_url: null,
  },
  lead_origin_properties: [], // ← sin propiedad de origen → origin_* debe ser null
};

/** Lead de buscador sin nombre en users (first_name/last_name null) → full_name/photo null. */
const RAW_LEAD_SIN_NOMBRE = {
  ...RAW_LEAD_COMPLETO,
  id: 'lead-uuid-003-sin-nombre',
  users: {
    phone: '+52 55 5555 0000',
    first_name: null, // ← sin first_name ni last_name → full_name = null
    last_name: null,
    avatar_url: null,
  },
  lead_origin_properties: [],
};

/** Lead de usuario sin phone registrado (users.phone = null). */
const RAW_LEAD_SIN_PHONE = {
  ...RAW_LEAD_COMPLETO,
  id: 'lead-uuid-004-sin-phone',
  users: {
    phone: null, // ← sin phone → AgentLead.phone = null
    first_name: 'Ana',
    last_name: 'Martínez',
    avatar_url: null,
  },
  lead_origin_properties: [],
};

/** Lead de buscador con SOLO first_name (last_name null) → full_name = solo el first_name. */
const RAW_LEAD_SOLO_FIRST_NAME = {
  ...RAW_LEAD_COMPLETO,
  id: 'lead-uuid-005-solo-first-name',
  users: {
    phone: '+52 55 1111 2222',
    first_name: 'Sofia',
    last_name: null, // ← sin apellido → full_name = 'Sofia' (sin espacio colgante)
    avatar_url: null,
  },
  lead_origin_properties: [],
};

/** Lead de buscador con nombre completo pero SIN avatar_url → profile_photo_url = null. */
const RAW_LEAD_AVATAR_NULL = {
  ...RAW_LEAD_COMPLETO,
  id: 'lead-uuid-006-avatar-null',
  users: {
    phone: '+52 55 3333 4444',
    first_name: 'Carlos',
    last_name: 'Zamudio',
    avatar_url: null, // ← sin foto de perfil → profile_photo_url = null
  },
  lead_origin_properties: [],
};

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
//
// Cadena: from('leads').select(...).is('deleted_at', null).order('updated_at', {ascending:false})
// La cadena resuelve directamente a { data, error } (PostgREST/supabase-js v2).
// ---------------------------------------------------------------------------

/**
 * make_order_chain — extremo final de la cadena de query, CHAINABLE + THENABLE
 * (75.6). `.order(...)` puede llamarse UNA vez (comportamiento histórico,
 * EC-1..10 — se awaitea directo) o ENCADENADO dos veces (75.6, primario +
 * desempate) sin que ninguno de los dos caminos rompa al otro: cada llamada
 * a `.order()` se registra en el MISMO jest.fn (`order`) y retorna el propio
 * objeto `chain`; `await chain` resuelve siempre a `query_result` vía `.then`.
 */
function make_order_chain(query_result: {
  data: RawLeadRow[] | null;
  error: { message: string } | null;
}) {
  const chain: {
    order: jest.Mock;
    then: (resolve: (v: typeof query_result) => void) => void;
  } = {
    order: jest.fn(() => chain),
    then: (resolve) => resolve(query_result),
  };
  return chain;
}

function make_supabase_mock_leads(opts: {
  query_result?: { data: RawLeadRow[] | null; error: { message: string } | null };
} = {}) {
  const {
    query_result = { data: [RAW_LEAD_COMPLETO], error: null },
  } = opts;

  // Extremo final de la cadena: .order(...) [.order(...)] → thenable (75.6)
  const order_chain = make_order_chain(query_result);
  // .is('deleted_at', null) → retorna el order_chain directo
  const mock_is = jest.fn().mockReturnValue(order_chain);
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
    // jest.fn compartido por TODAS las llamadas a .order() de la cadena —
    // .mock.calls[0]/[1] da los argumentos de la 1ª/2ª llamada (75.6).
    _mock_order: order_chain.order,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock_leads();
  mock_use_auth.mockReturnValue({
     
    user: { id: TEST_AGENT_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgentLeads', () => {

  // ── (EC-1) Happy path — mapeo completo de raw a AgentLead ────────────────

  it('(EC-1) mapea_lead_completo_a_AgentLead: raw con users.phone/first_name/last_name/avatar_url y lead_origin_properties[0] → AgentLead con todos los campos correctos', async () => {
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

    // Usuario interesado — full_name (build_full_name) y profile_photo_url desde
    // `users` directamente (subtarea 30.3 — ya NO desde user_preferences)
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

  // ── (EC-embed) Desambiguación de la FK users ─────────────────────────────
  //
  // Regresión: `leads` tiene DOS FKs a `users` (agent_id y user_id). Un embed
  // `users(...)` sin desambiguar hace que PostgREST devuelva en runtime
  // "Could not embed because more than one relationship was found for 'leads'
  // and 'users'". El embed DEBE nombrar la FK del buscador (leads.user_id):
  // `users!leads_user_id_fkey(...)`. Los mocks no atrapan esto → lock explícito.

  it('(EC-embed) el select desambigua la FK del buscador con users!leads_user_id_fkey', async () => {
    await renderHook(() => useAgentLeads());

    const select_arg = mock_supabase_holder.client._mock_select.mock.calls[0]?.[0] as string;
    expect(select_arg).toContain('users!leads_user_id_fkey(');
    // y NO el embed ambiguo `users(` (que rompería en runtime)
    expect(select_arg).not.toMatch(/[ ,]users\(/);
  });

  // ── (EC-30_3-3) El select lee first_name/last_name/avatar_url de users ──
  //
  // Subtarea 30.3: el embed de users debe pedir first_name, last_name y
  // avatar_url (patrón useAgencyAgents) y ya NO debe embeber user_preferences
  // — el agente no puede leer el user_preferences ajeno del buscador vía RLS.

  it('(EC-30_3-3) select_lee_first_name_last_name_avatar_url_de_users_no_user_preferences: el embed de users pide first_name/last_name/avatar_url y no anida user_preferences(', async () => {
    await renderHook(() => useAgentLeads());

    const select_arg = mock_supabase_holder.client._mock_select.mock.calls[0]?.[0] as string;
    expect(select_arg).toContain('first_name');
    expect(select_arg).toContain('last_name');
    expect(select_arg).toContain('avatar_url');
    expect(select_arg).not.toContain('user_preferences(');
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

  // ── (EC-3) Buscador sin nombre en users (first_name/last_name null) ─────
  //
  // Regla (subtarea 30.3): first_name/last_name de `users` pueden ser null
  // (usuario que no completó su perfil). build_full_name debe devolver null
  // cuando ambos están vacíos, sin crash. avatar_url null → profile_photo_url null.

  it('(EC-3) nombre_ambos_null_en_users_full_name_photo_nulos_sin_crash: lead con users.first_name/last_name/avatar_url null → full_name=null y profile_photo_url=null, sin crash', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_SIN_NOMBRE], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads());

    expect(result.current.leads).toHaveLength(1);

    const lead = result.current.leads[0] as AgentLead;

    // Sin first_name/last_name → full_name y profile_photo_url son null
    expect(lead.full_name).toBeNull();
    expect(lead.profile_photo_url).toBeNull();

    // El phone sigue siendo accesible desde users.phone
    expect(lead.phone).toBe('+52 55 5555 0000');

    expect(result.current.error).toBeNull();
  });

  // ── (EC-30_3-1) Buscador con SOLO first_name (last_name null) ───────────
  //
  // Regla (mismo patrón que useAgencyAgents.build_full_name): si solo hay
  // first_name, full_name debe ser exactamente ese first_name — sin espacio
  // colgante ni literal 'null' concatenado.

  it('(EC-30_3-1) solo_first_name_last_name_null_full_name_es_solo_el_first_name: lead con users.last_name=null → full_name es exactamente el first_name, sin espacio colgante', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_SOLO_FIRST_NAME], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads());

    expect(result.current.leads).toHaveLength(1);

    const lead = result.current.leads[0] as AgentLead;

    expect(lead.full_name).toBe('Sofia');
    expect(lead.phone).toBe('+52 55 1111 2222');
    expect(result.current.error).toBeNull();
  });

  // ── (EC-30_3-2) Buscador con nombre completo pero sin avatar_url ────────
  //
  // Regla: avatar_url null es independiente de full_name — un buscador puede
  // tener nombre completo y no tener foto de perfil. profile_photo_url debe
  // ser null sin afectar full_name.

  it('(EC-30_3-2) avatar_url_null_profile_photo_url_null_con_nombre_presente: lead con users.avatar_url=null y first_name/last_name presentes → profile_photo_url=null pero full_name sigue mapeado', async () => {
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_AVATAR_NULL], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads());

    expect(result.current.leads).toHaveLength(1);

    const lead = result.current.leads[0] as AgentLead;

    expect(lead.full_name).toBe('Carlos Zamudio');
    expect(lead.profile_photo_url).toBeNull();
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

  // ── (EC-6) Orden por SCORE DESC por defecto, con desempate por updated_at ──
  //
  // §19.9 (75.6, defecto #3 del usuario: "la clasificación por actividad no se
  // ve"): el orden por defecto de la lista CRM cambia de updated_at DESC a
  // score DESC — el lead más "caliente" aparece primero. Desempate ESTABLE
  // (decisión documentada para el GREEN): updated_at DESC — dos leads con el
  // mismo score muestran primero el tocado más recientemente. La query llama
  // .order() DOS veces: primero el campo primario, luego el desempate.

  it('(EC-6) ordena_por_score_desc_por_defecto_con_desempate_updated_at: sin sortBy explícito, la query llama .order("score",{ascending:false}) y LUEGO .order("updated_at",{ascending:false}) como desempate', async () => {
    await renderHook(() => useAgentLeads());

    expect(mock_supabase_holder.client._mock_order).toHaveBeenCalledTimes(2);
    expect(mock_supabase_holder.client._mock_order.mock.calls[0]).toEqual([
      'score',
      { ascending: false },
    ]);
    expect(mock_supabase_holder.client._mock_order.mock.calls[1]).toEqual([
      'updated_at',
      { ascending: false },
    ]);
  });

  // ── (EC-6b) Modo alternativo — orden por fecha de último contacto ────────
  //
  // §19.9 ("botón secundario"): un modo de orden alternativo por actividad
  // reciente de contacto — leads.last_contact_at DESC. nullsFirst:false
  // (decisión documentada): un lead sin seguimiento posterior al contacto
  // inicial (last_contact_at aún null) NO debe aparecer arriba de la lista.
  // Mismo desempate que el modo score: updated_at DESC.

  it('(EC-6b) modo_last_contact_ordena_por_last_contact_at_desc_nulls_last_con_desempate: useAgentLeads(undefined,"last_contact") llama .order("last_contact_at",{ascending:false,nullsFirst:false}) y LUEGO .order("updated_at",{ascending:false})', async () => {
    await renderHook(() => useAgentLeads(undefined, 'last_contact'));

    expect(mock_supabase_holder.client._mock_order).toHaveBeenCalledTimes(2);
    expect(mock_supabase_holder.client._mock_order.mock.calls[0]).toEqual([
      'last_contact_at',
      { ascending: false, nullsFirst: false },
    ]);
    expect(mock_supabase_holder.client._mock_order.mock.calls[1]).toEqual([
      'updated_at',
      { ascending: false },
    ]);
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

    // #226: la cadena SIEMPRE lleva .eq (alcance explícito) antes del .is.
    mock_supabase_holder.client = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue(pending_query),
            }),
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

  // ── (EC-10) Error del cliente Supabase — mensaje en español, no crudo ────
  //
  // 75.6 (defecto #1/#3 del usuario): si Supabase retorna error (red, RLS,
  // etc.), el hook debe exponer un mensaje NEUTRO EN ESPAÑOL (nunca el texto
  // crudo de PostgREST/Postgres, que suele venir en inglés o con jerga de
  // base de datos) y leads debe ser [] (no null/undefined). Mismo criterio
  // que useUpdateLeadStatus/useUpdateLeadNote (punto 1).

  it('(EC-10) error_cliente_mensaje_en_espanol_no_crudo_leads_vacio: query devuelve {error:{message}} → error es un mensaje neutro en español (NO el texto crudo de PostgREST), leads=[], no crashea', async () => {
    const RAW_PG_MESSAGE = 'RLS policy violation: no tienes acceso a estos leads';
    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: {
        data: null,
        error: { message: RAW_PG_MESSAGE },
      },
    });

    const { result } = await renderHook(() => useAgentLeads());

    // El error debe estar expuesto en ESPAÑOL, nunca el texto crudo
    expect(result.current.error).toBe('No se pudieron cargar los leads. Intenta de nuevo.');
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
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

  // ── (EC-nuevo-2, REESCRITO por #226) agentId null/ausente → filtro EXPLÍCITO ──
  //
  // 🔴 #226 mata la semántica "RLS decide" de 28.3: en producción, para un
  // usuario con users.role='admin', "RLS decide" significó "todo" — la cuenta
  // admin de Abraham veía el pipeline completo de Tu Casa con Vlad, teléfono
  // del buscador incluido. Regla ya aprendida (memoria FlatList/mis-X): "mis X"
  // SIEMPRE filtra explícito aunque RLS "ya filtre" — RLS es la 2ª capa, no el
  // alcance. Sin agentId y sin scope de equipo → .eq('agent_id', <uid propio>).

  it('(EC-nuevo-2) agentId_null_o_ausente_filtra_explicito_por_el_uid_propio: useAgentLeads(null) y useAgentLeads() llaman .eq("agent_id", <uid de sesión>) — nunca query sin alcance (#226)', async () => {
    const mock_client_null = make_supabase_mock_leads();
    mock_supabase_holder.client = mock_client_null;

    await renderHook(() => useAgentLeads(null));

    expect(mock_client_null._mock_eq).toHaveBeenCalledWith('agent_id', TEST_AGENT_ID);

    const mock_client_sin_arg = make_supabase_mock_leads();
    mock_supabase_holder.client = mock_client_sin_arg;

    await renderHook(() => useAgentLeads());

    expect(mock_client_sin_arg._mock_eq).toHaveBeenCalledWith('agent_id', TEST_AGENT_ID);
  });

  // ── #226 — scope de equipo explícito (tercer parámetro) ──────────────────
  //
  // CRMScreen ya resuelve el rol con useAgencyRole; se lo pasa al hook como
  // `scope` para que el alcance del AGREGADO sea explícito:
  //   - canViewTeam && agencyId → .eq('agency_id', agencyId)  (owner/admin de
  //     inmobiliaria ve el pipeline de SU organización — nunca de otras).
  //   - si no → .eq('agent_id', <uid propio>).
  //   - scope.loading=true → NO se dispara ninguna query (evita un primer
  //     fetch sin alcance mientras la membresía resuelve).
  //   - agentId string GANA sobre el scope (owner filtrando un agente).

  it('(EC-226-1) scope_equipo_filtra_por_agency_id: canViewTeam=true + agencyId → .eq("agency_id", agencyId) y NUNCA .eq("agent_id", …)', async () => {
    const mock_client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_COMPLETO], error: null },
    });
    mock_supabase_holder.client = mock_client;

    await renderHook(() =>
      useAgentLeads(null, 'score', { loading: false, canViewTeam: true, agencyId: 'agencia-x-226' }),
    );

    expect(mock_client._mock_eq).toHaveBeenCalledWith('agency_id', 'agencia-x-226');
    expect(mock_client._mock_eq).not.toHaveBeenCalledWith('agent_id', expect.anything());
  });

  it('(EC-226-2) scope_sin_equipo_filtra_por_uid_propio: canViewTeam=false → .eq("agent_id", <uid de sesión>)', async () => {
    const mock_client = make_supabase_mock_leads();
    mock_supabase_holder.client = mock_client;

    await renderHook(() =>
      useAgentLeads(null, 'score', { loading: false, canViewTeam: false, agencyId: null }),
    );

    expect(mock_client._mock_eq).toHaveBeenCalledWith('agent_id', TEST_AGENT_ID);
  });

  it('(EC-226-3) scope_cargando_no_dispara_query: loading=true → from() no se llama y el hook queda en loading', async () => {
    const mock_client = make_supabase_mock_leads();
    mock_supabase_holder.client = mock_client;

    const { result } = await renderHook(() =>
      useAgentLeads(null, 'score', { loading: true, canViewTeam: false, agencyId: null }),
    );

    expect(mock_client.from).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    expect(result.current.leads).toEqual([]);
  });

  it('(EC-226-4) agentId_explicito_gana_sobre_el_scope: useAgentLeads("agent-zzz", …, scope de equipo) filtra por ese agente, no por agencia', async () => {
    const mock_client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_COMPLETO], error: null },
    });
    mock_supabase_holder.client = mock_client;

    await renderHook(() =>
      useAgentLeads('agent-zzz', 'score', { loading: false, canViewTeam: true, agencyId: 'agencia-x-226' }),
    );

    expect(mock_client._mock_eq).toHaveBeenCalledWith('agent_id', 'agent-zzz');
    expect(mock_client._mock_eq).not.toHaveBeenCalledWith('agency_id', expect.anything());
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
        first_name: 'Otro',
        last_name: 'Buscador Leads',
        avatar_url: null,
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

  // ═══════════════════════════════════════════════════════════════════════
  // 75.6 — scoring/actividad visible en el CRM (defecto #3 del usuario)
  // ═══════════════════════════════════════════════════════════════════════

  // ── (EC-nuevo-5) El select pide score/level/is_follow_up ─────────────────

  it('(EC-nuevo-5) select_pide_score_level_is_follow_up: el string de select() pide explícitamente score, level e is_follow_up', async () => {
    await renderHook(() => useAgentLeads());

    const select_arg = mock_supabase_holder.client._mock_select.mock.calls[0]?.[0] as string;
    expect(select_arg).toContain('score');
    expect(select_arg).toContain('level');
    expect(select_arg).toContain('is_follow_up');
  });

  // ── (EC-nuevo-6) Mapea score/level/is_follow_up al AgentLead ─────────────

  it('(EC-nuevo-6) mapea_score_level_is_follow_up_al_agent_lead: un lead con score=42/level="caliente"/is_follow_up=true se mapea 1:1 al AgentLead resultante', async () => {
    const RAW_LEAD_CALIENTE: RawLeadRow = {
      ...RAW_LEAD_COMPLETO,
      id: 'lead-uuid-caliente-75-6',
      score: 42,
      level: 'caliente',
      is_follow_up: true,
    };

    mock_supabase_holder.client = make_supabase_mock_leads({
      query_result: { data: [RAW_LEAD_CALIENTE], error: null },
    });

    const { result } = await renderHook(() => useAgentLeads());

    expect(result.current.leads).toHaveLength(1);
    const lead = result.current.leads[0] as AgentLead;

    expect(lead.score).toBe(42);
    expect(lead.level).toBe('caliente');
    expect(lead.is_follow_up).toBe(true);
  });

});
