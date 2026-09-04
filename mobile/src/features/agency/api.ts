/**
 * api.ts — cliente de las Edge Functions de la feature agency.
 *
 * create-invitation: el OWNER autenticado genera un código de invitación para
 * SU agencia (la EF deriva la agencia de la membresía owner del JWT — el
 * payload solo lleva max_uses/expires_at). El código plano viaja UNA sola vez
 * en la respuesta; en BD queda solo el hash.
 *
 * register-agency (subtarea 71.4, tramo mobile): un usuario autenticado
 * (prospecto) funda una inmobiliaria propia — flujo SEPARADO de "Convertirme
 * en agente" (features/upgrade, que une la cuenta a una agencia EXISTENTE).
 * La agencia nace SIEMPRE 'pending_approval'; created_by_user_id sale del JWT
 * en el servidor (nunca viaja en el payload). logo_url es opcional — sin
 * pieza reutilizable de subida en mobile todavía (ver comentario ponytail en
 * register.tsx), se omite del payload cuando no hay valor.
 *
 * manage-agency-member + listado de miembros (subtarea 71.6, tramo mobile):
 * el owner o admin de una agencia gestiona (suspende/reactiva/da de baja) a
 * sus miembros. La EF (types.ts/handler.ts, backend ya en GREEN) valida
 * autorización server-side — el cliente NUNCA decide si la acción es válida,
 * solo la propone y mapea el error_code devuelto. El listado de miembros NO
 * pasa por una EF: se consulta la tabla directo con RLS `members_select`
 * (migración 20260805000003) como 2ª capa.
 *
 * 🔴 #253 — el filtro `.eq('agency_id', …)` lo pone el CLIENTE, no RLS. El
 * docblock anterior afirmaba que bastaba con RLS ("lo hace por fila, igual que
 * useAgencyRole") y era falso: la policy `members_select` incluye
 * `OR private.is_admin()`, así que para un admin de plataforma que además es
 * owner de una agencia (swacg08 en «Desarrolladora») devolvía los miembros de
 * TODAS las agencias — detectado en el smoke de producción #222 paso 7. Regla
 * de producto: Perfil → Miembros = SOLO mi inmobiliaria; lo cross-agencia vive
 * en Panel de administrador → Inmobiliarias → agencia (app/admin/agencies/[id],
 * que sí lista sin filtrar a propósito). Patrón general del repo: una vista de
 * "mis X" filtra SIEMPRE por el id propio aunque RLS "ya filtre".
 *
 * Nombre/foto: mismo gotcha que useAgencyAgents (leads/hooks)
 * — user_preferences es de lectura propia SOLO, así que se lee desde `users`
 * (RLS users_select vía is_agency_owner_of para el owner; agentes verificados
 * son públicos igual); si RLS no deja ver el embed, el nombre queda null — no
 * se inventa una vista nueva.
 *
 * Mismo patrón que registration/api.ts y upgrade/api.ts: invoke con la sesión
 * del usuario, errores de negocio como { error: { code } } extraídos vía
 * edge-errors.
 */
import { supabase } from '@/lib/supabase/client';
import { extract_error_code } from '@/lib/supabase/edge-errors';
import { build_full_name } from '@/features/leads/utils/full_name';

export interface CreatedInvitation {
  token_id: string;
  plain_token: string;
  agency_id: string;
  max_uses: number | null;
  expires_at: string | null;
}

export interface CreateInvitationOk {
  ok: true;
  invitation: CreatedInvitation;
}

export interface ApiError {
  ok: false;
  /** error_code del backend (NOT_AGENCY_OWNER, AGENCY_INACTIVE, …) o undefined si fue red. */
  code: string | undefined;
}

export interface CreateInvitationInput {
  max_uses: number | null;
  expires_at: string | null;
}

export async function create_invitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationOk | ApiError> {
  const { data, error } = await supabase.functions.invoke('create-invitation', {
    body: {
      max_uses: input.max_uses,
      expires_at: input.expires_at,
    },
  });

  if (error !== null) {
    return { ok: false, code: await extract_error_code(error) };
  }
  return { ok: true, invitation: data.invitation };
}

// ── register-agency (71.4) ───────────────────────────────────────────────────

export interface RegisterAgencyInput {
  name: string;
  slug: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  /** Opcional — omitido del payload cuando es null. */
  logo_url: string | null;
}

export interface RegisteredAgency {
  agency_id: string;
  name: string;
  slug: string;
  status: string;
  logo_url: string | null;
}

export interface RegisterAgencyOk {
  ok: true;
  agency: RegisteredAgency;
}

export async function register_agency(
  input: RegisterAgencyInput,
): Promise<RegisterAgencyOk | ApiError> {
  const body: Record<string, string> = {
    name: input.name,
    slug: input.slug,
    contact_name: input.contact_name,
    contact_phone: input.contact_phone,
    contact_email: input.contact_email,
  };
  if (input.logo_url !== null) {
    body['logo_url'] = input.logo_url;
  }

  const { data, error } = await supabase.functions.invoke('register-agency', { body });

  if (error !== null) {
    return { ok: false, code: await extract_error_code(error) };
  }
  return { ok: true, agency: data as RegisteredAgency };
}

// ── manage-agency-member (71.6) ──────────────────────────────────────────────

export type MemberAction = 'suspend' | 'reactivate' | 'remove';

export interface ManagedMember {
  id: string;
  agency_id: string;
  user_id: string;
  member_role: string;
  status: string;
}

export interface ManageMemberOk {
  ok: true;
  member: ManagedMember;
}

export async function manage_agency_member(
  member_id: string,
  action: MemberAction,
): Promise<ManageMemberOk | ApiError> {
  const { data, error } = await supabase.functions.invoke('manage-agency-member', {
    body: { member_id, action },
  });

  if (error !== null) {
    return { ok: false, code: await extract_error_code(error) };
  }
  return { ok: true, member: data.member as ManagedMember };
}

// ── Rol propio + listado de miembros (71.6) ──────────────────────────────────

export interface OwnMembership {
  agency_id: string;
  member_role: string;
}

/** Membresía activa del usuario dado, o null si no pertenece a ninguna agencia. */
export async function fetch_own_membership(user_id: string): Promise<OwnMembership | null> {
  const { data, error } = await supabase
    .from('agency_members')
    .select('agency_id, member_role')
    .eq('user_id', user_id)
    .eq('status', 'active')
    .maybeSingle();

  if (error !== null || data === null) return null;
  return { agency_id: data.agency_id, member_role: data.member_role };
}

export interface AgencyMemberRow {
  id: string;
  user_id: string;
  member_role: string;
  status: string;
  full_name: string | null;
  profile_photo_url: string | null;
}

type RawUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

type RawMemberRow = {
  id: string;
  user_id: string;
  member_role: string;
  status: string;
  users: RawUser | null;
};

/**
 * Miembros de UNA agencia — la del caller, resuelta por fetch_own_membership /
 * useAgencyRole. El `.eq('agency_id', …)` es obligatorio: RLS `members_select`
 * NO acota por agencia a un admin de plataforma (#253, ver header). null solo
 * ante un error real de red/query.
 */
export async function fetch_agency_members(
  agency_id: string,
): Promise<AgencyMemberRow[] | null> {
  const { data, error } = await supabase
    .from('agency_members')
    .select('id, user_id, member_role, status, users(id, first_name, last_name, avatar_url)')
    .eq('agency_id', agency_id);

  if (error !== null) return null;

  const raw = (data as unknown as RawMemberRow[] | null) ?? [];
  return raw.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    member_role: row.member_role,
    status: row.status,
    full_name: build_full_name(row.users?.first_name ?? null, row.users?.last_name ?? null),
    profile_photo_url: row.users?.avatar_url ?? null,
  }));
}
