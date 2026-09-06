/**
 * crm_next_status.test.ts — RED (subtarea 267.3).
 *
 * Contrato: crm_next_action(projected) devuelve la acción sugerida del botón
 * primario de una fila del CRM. Exploración 045 §7.3/§7.4, decisiones de
 * Abraham 2026-09-06.
 */

import { AGENDAR_STATUS, crm_next_action } from '../crm_next_status';
import { ALL_LEAD_STATUSES } from '../../lead_status_meta';

describe('crm_next_action', () => {
  it('nuevo → set contacted, label Contactado', () => {
    expect(crm_next_action('nuevo')).toEqual({
      kind: 'set',
      status: 'contacted',
      label: 'Contactado',
    });
  });

  it('contactado → set visit_scheduled, label Visita', () => {
    expect(crm_next_action('contactado')).toEqual({
      kind: 'set',
      status: 'visit_scheduled',
      label: 'Visita',
    });
  });

  it('visita → open_picker, label Cerrar… (nunca set — cerrar exige elegir renta/venta/perdido)', () => {
    const action = crm_next_action('visita');
    expect(action).toEqual({ kind: 'open_picker', label: 'Cerrar…' });
    expect(action.kind).not.toBe('set');
  });

  it('cerrado → open_picker, label Reabrir', () => {
    expect(crm_next_action('cerrado')).toEqual({ kind: 'open_picker', label: 'Reabrir' });
  });

  it('exhaustividad: ningún proyectado vigente devuelve undefined', () => {
    const proyectados: Array<'nuevo' | 'contactado' | 'visita' | 'cerrado'> = [
      'nuevo',
      'contactado',
      'visita',
      'cerrado',
    ];
    for (const p of proyectados) {
      expect(crm_next_action(p)).not.toBeUndefined();
    }
  });

  it('fallback seguro: un valor fuera del dominio cae en open_picker, nunca set (no adivina un status)', () => {
    const action = crm_next_action('desconocido' as 'nuevo');
    expect(action.kind).toBe('open_picker');
  });
});

describe('AGENDAR_STATUS', () => {
  it('es visit_scheduled — el botón Agendar marca exactamente ese status', () => {
    expect(AGENDAR_STATUS).toBe('visit_scheduled');
  });

  it('es un status vigente (aparece en ALL_LEAD_STATUSES, no un legacy)', () => {
    expect(ALL_LEAD_STATUSES).toContain(AGENDAR_STATUS);
  });
});
