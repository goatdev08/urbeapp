/**
 * useCreateInvitation — genera un código de invitación para la agencia del
 * owner autenticado, vía la EF create-invitation (features/agency/api.ts).
 *
 * Contrato:
 *   - create(input): dispara la EF; limpia invitation/error_code previos.
 *   - invitation: resultado exitoso (contiene plain_token — se muestra UNA vez).
 *   - error_code: code del backend (NOT_AGENCY_OWNER, AGENCY_INACTIVE, …) o
 *     'UNKNOWN' si el fallo no trajo code (red). null cuando no hay error.
 *   - reset(): vuelve al estado inicial (para generar otro código).
 *
 * Patrón useState simple (sin useEffect: la acción es imperativa, como
 * usePropertyActions).
 */
import { useState } from 'react';

import { create_invitation } from '../api';
import type { CreatedInvitation, CreateInvitationInput } from '../api';

export interface UseCreateInvitationState {
  create: (input: CreateInvitationInput) => Promise<void>;
  invitation: CreatedInvitation | null;
  loading: boolean;
  error_code: string | null;
  reset: () => void;
}

export function useCreateInvitation(): UseCreateInvitationState {
  const [invitation, set_invitation] = useState<CreatedInvitation | null>(null);
  const [loading, set_loading] = useState(false);
  const [error_code, set_error_code] = useState<string | null>(null);

  const create = async (input: CreateInvitationInput): Promise<void> => {
    set_loading(true);
    set_invitation(null);
    set_error_code(null);

    const result = await create_invitation(input);

    if (result.ok) {
      set_invitation(result.invitation);
    } else {
      set_error_code(result.code ?? 'UNKNOWN');
    }
    set_loading(false);
  };

  const reset = (): void => {
    set_invitation(null);
    set_error_code(null);
    set_loading(false);
  };

  return { create, invitation, loading, error_code, reset };
}
