// _shared/validation.ts

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
