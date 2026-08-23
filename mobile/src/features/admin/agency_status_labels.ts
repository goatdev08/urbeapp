// Presentación compartida del enum agency_status (tarea #211, obs. 2 del
// guardian de 211.2): la lista (/admin) y el detalle (/admin/agencies/[id])
// mostraban el MISMO estado con etiqueta y color distintos ("Pendiente" ámbar
// vs "Pendiente de aprobación" ocre). Una sola fuente de verdad para ambos.
import type { Database } from '@/types/database';

export type AgencyStatus = Database['public']['Enums']['agency_status'];

export const AGENCY_STATUS_LABELS: Record<AgencyStatus, string> = {
  active: 'Activa',
  suspended: 'Suspendida',
  pending_approval: 'Pendiente',
  rejected: 'Rechazada',
  // ponytail: 'approved' es un valor legacy del enum, sin flujo que lo
  // produzca hoy (D1/D2 de 20260805000007 solo usan pending_approval->{active,rejected}).
  approved: 'Aprobada',
};

export function format_agency_status(status: AgencyStatus): string {
  return AGENCY_STATUS_LABELS[status] ?? status;
}

/** Color del badge de estado (paleta ya usada por /admin desde #153). */
export function agency_status_color(status: AgencyStatus): string {
  switch (status) {
    case 'active':
      return '#1A5E44'; // salvia
    case 'approved':
      return '#4A90D9'; // azul
    case 'pending_approval':
      return '#E5A020'; // ámbar
    case 'suspended':
    case 'rejected':
      return '#D94A4A'; // rojo
    default:
      return '#9CA3AF'; // gris
  }
}
