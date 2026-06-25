// _shared/validation.ts

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
      contact_email:
        typeof obj.contact_email === "string" ? obj.contact_email : undefined,
      contact_name:
        typeof obj.contact_name === "string" ? obj.contact_name : undefined,
      contact_phone:
        typeof obj.contact_phone === "string" ? obj.contact_phone : undefined,
    },
  };
}
