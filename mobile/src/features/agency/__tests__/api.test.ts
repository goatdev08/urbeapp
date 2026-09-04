/**
 * Tests de `fetch_agency_members` — tarea #253 (fix del smoke de producción
 * #222 paso 7).
 *
 * Regresión que cubren: la query listaba `agency_members` SIN `.eq('agency_id',
 * …)` confiando en RLS `members_select`, cuya policy incluye
 * `OR private.is_admin()` — un admin de plataforma que además es owner de una
 * agencia veía en Perfil → Miembros a los miembros de TODAS las agencias. El
 * filtro por agencia propia es responsabilidad del cliente; RLS es la 2ª capa.
 *
 * Frontera de sistema mockeada: el query builder de supabase-js
 * (`supabase.from`), que es la llamada HTTP real a PostgREST. `build_full_name`
 * es un colaborador interno propio (features/leads/utils) — NO se mockea.
 * La cadena mock devuelve un objeto nuevo por eslabón y solo el ÚLTIMO es
 * thenable, igual que el builder real: así un `.eq` que no se encadenara
 * rompería el await en vez de pasar en falso.
 *
 * CASOS:
 * - FM-1 filtra_por_agency_id: `.eq` se llama exactamente 1 vez con
 *   ('agency_id', <el id recibido>) — el assert de la regresión.
 * - FM-2 tabla_y_embed_de_users: `from('agency_members')` + `select` con las
 *   columnas y el embed `users(...)`.
 * - FM-3 mapea_nombre_y_foto: fila cruda → AgencyMemberRow (full_name armado,
 *   profile_photo_url desde users.avatar_url).
 * - FM-4 embed_users_nulo: users=null → full_name y profile_photo_url en null.
 * - FM-5 error_de_query_devuelve_null: error !== null → null (no [], para que
 *   la pantalla distinga "falló" de "vacío").
 */
import { fetch_agency_members } from '../api';

// ---------------------------------------------------------------------------
// Mock de frontera — supabase.from(...).select(...).eq(...)
// ---------------------------------------------------------------------------
const mock_from = jest.fn();
const mock_select = jest.fn();
const mock_eq = jest.fn();

/** Resultado que devolverá el último eslabón de la cadena. */
let query_result: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mock_from(...args),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  query_result = { data: [], error: null };

  // Cadena: from → { select } → { eq } → thenable. Solo el último eslabón
  // resuelve; encadenar de más (o de menos) revienta el await.
  mock_eq.mockImplementation(() => Promise.resolve(query_result));
  mock_select.mockImplementation(() => ({
    eq: (...args: unknown[]) => mock_eq(...args),
  }));
  mock_from.mockImplementation(() => ({
    select: (...args: unknown[]) => mock_select(...args),
  }));
});

const AGENCY_ID = '11111111-1111-4111-8111-111111111111';

describe('fetch_agency_members', () => {
  it('(FM-1) filtra_por_agency_id: encadena .eq("agency_id", <id>) exactamente una vez', async () => {
    await fetch_agency_members(AGENCY_ID);

    expect(mock_eq).toHaveBeenCalledTimes(1);
    expect(mock_eq).toHaveBeenCalledWith('agency_id', AGENCY_ID);
  });

  it('(FM-2) tabla_y_embed_de_users: consulta agency_members con el embed users(...)', async () => {
    await fetch_agency_members(AGENCY_ID);

    expect(mock_from).toHaveBeenCalledWith('agency_members');
    expect(mock_select).toHaveBeenCalledWith(
      'id, user_id, member_role, status, users(id, first_name, last_name, avatar_url)',
    );
  });

  it('(FM-3) mapea_nombre_y_foto: arma full_name y toma profile_photo_url de users.avatar_url', async () => {
    query_result = {
      data: [
        {
          id: 'member-1',
          user_id: 'user-1',
          member_role: 'agent',
          status: 'active',
          users: {
            id: 'user-1',
            first_name: 'Vladimir',
            last_name: 'Ramos',
            avatar_url: 'https://cdn.urbea.mx/v.jpg',
          },
        },
      ],
      error: null,
    };

    const rows = await fetch_agency_members(AGENCY_ID);

    expect(rows).toEqual([
      {
        id: 'member-1',
        user_id: 'user-1',
        member_role: 'agent',
        status: 'active',
        full_name: 'Vladimir Ramos',
        profile_photo_url: 'https://cdn.urbea.mx/v.jpg',
      },
    ]);
  });

  it('(FM-4) embed_users_nulo: users=null deja full_name y profile_photo_url en null', async () => {
    query_result = {
      data: [
        {
          id: 'member-2',
          user_id: 'user-2',
          member_role: 'viewer',
          status: 'suspended',
          users: null,
        },
      ],
      error: null,
    };

    const rows = await fetch_agency_members(AGENCY_ID);

    expect(rows).toEqual([
      {
        id: 'member-2',
        user_id: 'user-2',
        member_role: 'viewer',
        status: 'suspended',
        full_name: null,
        profile_photo_url: null,
      },
    ]);
  });

  it('(FM-5) error_de_query_devuelve_null: un error de PostgREST resuelve null, no []', async () => {
    query_result = { data: null, error: { message: 'network down' } };

    const rows = await fetch_agency_members(AGENCY_ID);

    expect(rows).toBeNull();
  });
});
