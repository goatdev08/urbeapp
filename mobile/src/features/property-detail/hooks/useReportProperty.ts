/**
 * useReportProperty — STUB fase RED (subtarea 220.5). Firma fijada por el RED
 * en mobile/src/features/property-detail/__tests__/useReportProperty.test.tsx
 * (docblock ahí = contrato completo + los 20 edge cases). Sin lógica: cada
 * rama lanza `not_implemented` para que las aserciones del test fallen por
 * ASERCIÓN, no por import roto.
 */

import { useMemo } from 'react';

export type PropertyReportReason =
  | 'not_exist_fraud'
  | 'misleading'
  | 'false_price'
  | 'wrong_address'
  | 'inappropriate'
  | 'duplicate'
  | 'other';

export interface UseReportPropertyParams {
  property_id: string;
  owner_user_id: string;

  supabase?: any;
}

export interface SubmitReportInput {
  reason: PropertyReportReason;
  reason_text?: string;
}

export type SubmitReportResult = { ok: true } | { ok: false };

export interface UseReportPropertyReturn {
  submit_report(input: SubmitReportInput): Promise<SubmitReportResult>;
  is_submitting: boolean;
  error_message: string | null;
}

export function useReportProperty(
  _params: UseReportPropertyParams,
): UseReportPropertyReturn {
  return useMemo(
    () => ({
      submit_report(): Promise<SubmitReportResult> {
        throw new Error('not_implemented');
      },
      is_submitting: false,
      error_message: null,
    }),
    [],
  );
}
