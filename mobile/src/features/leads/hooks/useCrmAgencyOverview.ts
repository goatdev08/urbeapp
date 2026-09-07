/**
 * useCrmAgencyOverview — STUB mínimo (fase RED, subtarea 269.5). Lanza a
 * propósito; la implementación real es el GREEN. Contrato completo (SEAMS,
 * decisiones D-XXX, edge cases) en
 * __tests__/useCrmAgencyOverview.test.tsx — no se repite aquí. RPC
 * `crm_agency_overview` (migración 20260906400001).
 */

export interface AgencyAgentRow {
  agent_id: string;
  agent_name: string | null;
  untouched_count: number;
  response_hours: number | null;
  avg_temperature: number | null;
  flag: 'pierde_leads' | 'acumula' | null;
}

export interface UnmanagedLeadRow {
  lead_id: string;
  lead_display_name: string | null;
  temperature: number;
  first_contact_at: string | null;
}

export interface UseCrmAgencyOverviewState {
  agents: AgencyAgentRow[];
  unmanaged: UnmanagedLeadRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCrmAgencyOverview(_agency_id: string | null): UseCrmAgencyOverviewState {
  throw new Error('not_implemented');
}
