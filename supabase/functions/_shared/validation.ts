// _shared/validation.ts

import type { RegisterInput } from "../register/types.ts";

export interface CreateAgencyInput {
  name: string;
  slug: string;
  contact_email?: string | undefined;
  contact_name?: string | undefined;
  contact_phone?: string | undefined;
}

export interface RedeemInvitationInput {
  invitationCode: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

// Regex RFC 5322 simplificado — cubre los casos de tests sin dependencias externas
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida y parsea el payload de redeem-invitation.
 * Reglas canónicas (§7.1 lineamientos):
 *   - invitationCode: string, min 6 caracteres
 *   - email: string, formato email válido
 *   - password: string, min 8 caracteres
 *   - firstName: string, min 1 carácter (no vacío)
 *   - lastName: string, min 1 carácter (no vacío)
 * Campos extra son ignorados silenciosamente.
 */
export function parse_redeem_invitation_input(
  raw: unknown,
): ParseResult<RedeemInvitationInput> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "El payload debe ser un objeto JSON",
      },
    };
  }

  const obj = raw as Record<string, unknown>;

  // invitationCode
  if (obj.invitationCode === undefined || obj.invitationCode === null) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "invitationCode es requerido" },
    };
  }
  if (
    typeof obj.invitationCode !== "string" || obj.invitationCode.length === 0
  ) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "invitationCode no puede ser vacío",
      },
    };
  }
  if (obj.invitationCode.length < 6) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "invitationCode debe tener al menos 6 caracteres",
      },
    };
  }

  // email
  if (obj.email === undefined || obj.email === null) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "email es requerido" },
    };
  }
  if (typeof obj.email !== "string" || obj.email.length === 0) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "email no puede ser vacío" },
    };
  }
  if (!EMAIL_REGEX.test(obj.email)) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "email no tiene un formato válido",
      },
    };
  }

  // password
  if (obj.password === undefined || obj.password === null) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "password es requerido" },
    };
  }
  if (typeof obj.password !== "string" || obj.password.length === 0) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "password no puede ser vacío" },
    };
  }
  if (obj.password.length < 8) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "password debe tener al menos 8 caracteres",
      },
    };
  }

  // firstName
  if (obj.firstName === undefined || obj.firstName === null) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "firstName es requerido" },
    };
  }
  if (typeof obj.firstName !== "string" || obj.firstName.trim().length === 0) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "firstName no puede ser vacío" },
    };
  }

  // lastName
  if (obj.lastName === undefined || obj.lastName === null) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "lastName es requerido" },
    };
  }
  if (typeof obj.lastName !== "string" || obj.lastName.trim().length === 0) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "lastName no puede ser vacío" },
    };
  }

  return {
    success: true,
    data: {
      invitationCode: obj.invitationCode,
      email: obj.email,
      password: obj.password,
      firstName: obj.firstName,
      lastName: obj.lastName,
    },
  };
}

// Slug: solo letras minúsculas, dígitos y guiones (sin mayúsculas, espacios, _, ni !)
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Valida y parsea el payload de admin-create-agency.
 * Reglas canónicas (§7.4):
 *   - name: string, min 2 caracteres
 *   - slug: string, formato /^[a-z0-9]+(?:-[a-z0-9]+)*$/ (lowercase, guiones, sin espacios)
 *   - contact_email: opcional; si está presente, debe ser email válido
 *   - contact_name: opcional, cualquier string
 *   - contact_phone: opcional, cualquier string
 * Campos extra son ignorados silenciosamente.
 */
export function parse_create_agency_input(
  raw: unknown,
): ParseResult<CreateAgencyInput> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "El payload debe ser un objeto JSON",
      },
    };
  }

  const obj = raw as Record<string, unknown>;

  // name: requerido, mínimo 2 caracteres
  if (obj.name === undefined || obj.name === null) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "name es requerido" },
    };
  }
  if (typeof obj.name !== "string" || obj.name.length < 2) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "name debe tener al menos 2 caracteres",
      },
    };
  }

  // slug: requerido, formato /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  if (obj.slug === undefined || obj.slug === null) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "slug es requerido" },
    };
  }
  if (typeof obj.slug !== "string") {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "slug debe ser un string" },
    };
  }
  if (!SLUG_REGEX.test(obj.slug)) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message:
          "slug debe contener solo letras minúsculas, dígitos y guiones (ej: mi-agencia)",
      },
    };
  }

  // contact_email: opcional; si presente, debe ser email válido
  if (obj.contact_email !== undefined && obj.contact_email !== null) {
    if (
      typeof obj.contact_email !== "string" ||
      !EMAIL_REGEX.test(obj.contact_email)
    ) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "contact_email no tiene un formato válido",
        },
      };
    }
  }

  return {
    success: true,
    data: {
      name: obj.name,
      slug: obj.slug,
      contact_email: typeof obj.contact_email === "string"
        ? obj.contact_email
        : undefined,
      contact_name: typeof obj.contact_name === "string"
        ? obj.contact_name
        : undefined,
      contact_phone: typeof obj.contact_phone === "string"
        ? obj.contact_phone
        : undefined,
    },
  };
}

// ── register (subtarea 93.2, PRD §5.1) ──────────────────────────────────────

// E.164 México: '+52' + 10 dígitos. Mismo criterio que el CHECK users_phone_e164_mx
// (migración 20260727000002).
const PHONE_MX_REGEX = /^\+52[0-9]{10}$/;
// YYYY-MM-DD estricto (rechaza DD/MM/YYYY y strings no-fecha antes de Date.parse).
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
// Catálogo INEGI mx_states: id de 2 dígitos.
const STATE_ID_REGEX = /^\d{2}$/;
// Catálogo INEGI mx_municipalities: cvegeo de 5 dígitos.
const MUNICIPALITY_ID_REGEX = /^\d{5}$/;

function invalid_input(
  message: string,
): { success: false; error: { code: string; message: string } } {
  return { success: false, error: { code: "INVALID_INPUT", message } };
}

/**
 * Valida que `YYYY-MM-DD` (ya validado por DATE_REGEX) sea una fecha REAL del
 * calendario, no solo un string con la forma correcta. `Date.parse`/`new Date`
 * de V8 "rola" al mes siguiente en vez de devolver NaN para días imposibles
 * (`new Date("2010-02-31T00:00:00Z")` → 2010-03-03) — isNaN() no lo cacha. El
 * round-trip de los componentes UTC contra el string original sí delata el
 * rolling. 2008-02-29 (bisiesto real) hace round-trip limpio y pasa.
 */
function is_real_calendar_date(iso_date: string): boolean {
  const date = new Date(`${iso_date}T00:00:00Z`);
  if (isNaN(date.getTime())) return false;
  const [year, month, day] = iso_date.split("-").map(Number);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day;
}

/**
 * Valida y parsea el payload público de registro (§5.1 — TODOS los campos
 * obligatorios). Mismo criterio que los CHECK de la migración
 * 20260727000002_registro_constraints.sql: phone E.164 MX,
 * date_of_birth<=hoy-18años (verificado después, en register_user_atomic vía
 * el CHECK users_mayoria_de_edad — aquí solo se valida FORMATO de fecha),
 * y municipality_id cuyo prefijo coincide con state_id (CHECK
 * users_municipio_del_estado). Campos extra son ignorados silenciosamente.
 */
export function parse_register_input(raw: unknown): ParseResult<RegisterInput> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid_input("El payload debe ser un objeto JSON");
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.email !== "string" || obj.email.length === 0) {
    return invalid_input("email es requerido");
  }
  if (!EMAIL_REGEX.test(obj.email)) {
    return invalid_input("email no tiene un formato válido");
  }

  if (typeof obj.password !== "string" || obj.password.length === 0) {
    return invalid_input("password es requerido");
  }
  if (obj.password.length < 8) {
    return invalid_input("password debe tener al menos 8 caracteres");
  }

  if (
    typeof obj.first_name !== "string" || obj.first_name.trim().length === 0
  ) {
    return invalid_input("first_name es requerido");
  }
  if (
    typeof obj.last_name !== "string" || obj.last_name.trim().length === 0
  ) {
    return invalid_input("last_name es requerido");
  }

  if (typeof obj.phone !== "string" || !PHONE_MX_REGEX.test(obj.phone)) {
    return invalid_input(
      "phone debe tener el formato +52 seguido de 10 dígitos",
    );
  }

  if (
    typeof obj.date_of_birth !== "string" ||
    !DATE_REGEX.test(obj.date_of_birth)
  ) {
    return invalid_input("date_of_birth debe tener formato YYYY-MM-DD");
  }
  if (!is_real_calendar_date(obj.date_of_birth)) {
    return invalid_input("date_of_birth no es una fecha válida");
  }

  if (
    typeof obj.state_id !== "string" || !STATE_ID_REGEX.test(obj.state_id)
  ) {
    return invalid_input("state_id debe ser un código de 2 dígitos");
  }

  if (
    typeof obj.municipality_id !== "string" ||
    !MUNICIPALITY_ID_REGEX.test(obj.municipality_id)
  ) {
    return invalid_input("municipality_id debe ser un código de 5 dígitos");
  }
  if (obj.municipality_id.slice(0, 2) !== obj.state_id) {
    return invalid_input(
      "municipality_id no corresponde al state_id (coherencia cvegeo)",
    );
  }

  return {
    success: true,
    data: {
      email: obj.email,
      password: obj.password,
      first_name: obj.first_name,
      last_name: obj.last_name,
      phone: obj.phone,
      date_of_birth: obj.date_of_birth,
      state_id: obj.state_id,
      municipality_id: obj.municipality_id,
    },
  };
}
