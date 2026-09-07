/**
 * Tests fase RED — format_response_time (subtarea 269.5, CRM vista de
 * agencia, exploración 045 fase E).
 * Archivo SUT: mobile/src/features/leads/utils/format_response_time.ts
 * (STUB que lanza 'not_implemented' — la implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del util —
 *   format_response_time(hours: number | null): string
 * — consume `response_hours` de public.crm_agency_overview (migración
 * 20260906400001) para la columna "responde en" de la fila de agente.
 *
 * Ubicación: mobile/src/features/leads/utils/ (NO mobile/src/utils/, que no
 * existe en el repo) — mismo directorio que crm_temperature_format.ts /
 * relative_time.ts, confirmado en wiki/codebase/mapa-codebase.md ("Lógica
 * pura en utils/: crm_next_status.ts, crm_temperature_format.ts, …"). El
 * plan de la subtarea decía mobile/src/utils/; se corrige aquí para no
 * fragmentar la convención del feature (Paso 0 del protocolo test-author).
 *
 * FÓRMULA (derivada del contrato de la subtarea, D-FMT de este archivo):
 *   hours === null            → '—'
 *   hours < 1                 → `${Math.round(hours * 60)} min`
 *   1 <= hours < 48            → `${Math.round(hours)} h`
 *   hours >= 48                → `${Math.round(hours / 24)} d`
 * Los bordes se fijan por construcción de la fórmula (no se redondea dos
 * veces ni se re-deriva en el test — son los valores que la propia
 * definición produce, verificados a mano abajo):
 *   0.5  → 0.5*60=30            → '30 min'
 *   0.99 → round(0.99*60)=59    → '59 min' (sigue en la rama <1h)
 *   1    → round(1)=1            → '1 h' (primer valor en la rama h)
 *   23.5 → round(23.5)=24        → '24 h' (Math.round redondea .5 hacia arriba)
 *   47.9 → round(47.9)=48        → '48 h' (sigue en la rama h: 47.9 < 48)
 *   48   → round(48/24)=2        → '2 d' (cruza a la rama d: 48 >= 48)
 *   72   → round(72/24)=3        → '3 d'
 *
 * SIN reloj fijo / SIN 4 TZ (memoria tests_bomba_de_fecha_y_estado_inicial):
 * la función es aritmética pura sobre un `number` ya calculado por la RPC
 * (mediana en horas) — no llama a `Date.now()`, `new Date()` ni ningún API
 * sensible a huso horario o reloj del sistema. La "bomba de fecha" aplica a
 * funciones que DERIVAN un delta de tiempo desde AHORA (relative_time.ts);
 * aquí `hours` ya viene resuelto por el caller, así que no hay reloj que
 * congelar ni TZ que variar.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) null_da_guion_largo
 * - (EC-2) minutos_45_min_redondeados
 * - (EC-3) horas_2_h_redondeadas
 * - (EC-4) dias_3_d_redondeados_72h
 *
 * ### Bordes exactos de la fórmula (D-FMT)
 * - (EC-5) borde_0_5_h_30_min
 * - (EC-6) borde_0_99_h_59_min_sigue_en_rama_minutos
 * - (EC-7) borde_1_h_primer_valor_en_rama_horas
 * - (EC-8) borde_23_5_h_redondea_hacia_arriba_24_h
 * - (EC-9) borde_47_9_h_48_h_sigue_en_rama_horas
 * - (EC-10) borde_48_h_cruza_a_rama_dias_2_d
 *
 * ### Boundary / error
 * - (EC-11) cero_horas_0_min_no_null_no_guion
 * - (EC-12) nunca_devuelve_el_valor_crudo_ni_decimales_sin_formatear
 */

import { format_response_time } from '../format_response_time';

describe('format_response_time', () => {
  it('(EC-1) null_da_guion_largo: hours=null → "—"', () => {
    expect(format_response_time(null)).toBe('—');
  });

  it('(EC-2) minutos_45_min_redondeados: 0.75 h → "45 min"', () => {
    expect(format_response_time(0.75)).toBe('45 min');
  });

  it('(EC-3) horas_2_h_redondeadas: 2 h → "2 h"', () => {
    expect(format_response_time(2)).toBe('2 h');
  });

  it('(EC-4) dias_3_d_redondeados_72h: 72 h → "3 d"', () => {
    expect(format_response_time(72)).toBe('3 d');
  });

  it('(EC-5) borde_0_5_h_30_min: 0.5 h → "30 min"', () => {
    expect(format_response_time(0.5)).toBe('30 min');
  });

  it('(EC-6) borde_0_99_h_59_min_sigue_en_rama_minutos: 0.99 h → "59 min", NO "1 h"', () => {
    const result = format_response_time(0.99);
    expect(result).toBe('59 min');
    expect(result).not.toBe('1 h');
  });

  it('(EC-7) borde_1_h_primer_valor_en_rama_horas: 1 h → "1 h", NO "60 min"', () => {
    const result = format_response_time(1);
    expect(result).toBe('1 h');
    expect(result).not.toBe('60 min');
  });

  it('(EC-8) borde_23_5_h_redondea_hacia_arriba_24_h: 23.5 h → "24 h"', () => {
    expect(format_response_time(23.5)).toBe('24 h');
  });

  it('(EC-9) borde_47_9_h_48_h_sigue_en_rama_horas: 47.9 h → "48 h", NO "2 d"', () => {
    const result = format_response_time(47.9);
    expect(result).toBe('48 h');
    expect(result).not.toBe('2 d');
  });

  it('(EC-10) borde_48_h_cruza_a_rama_dias_2_d: 48 h → "2 d", NO "48 h"', () => {
    const result = format_response_time(48);
    expect(result).toBe('2 d');
    expect(result).not.toBe('48 h');
  });

  it('(EC-11) cero_horas_0_min_no_null_no_guion: 0 h → "0 min" (respuesta instantánea, no es lo mismo que "sin dato")', () => {
    const result = format_response_time(0);
    expect(result).toBe('0 min');
    expect(result).not.toBe('—');
  });

  it('(EC-12) nunca_devuelve_el_valor_crudo_ni_decimales_sin_formatear: 18.5 h → "19 h" (Math.round redondea .5 hacia arriba), NUNCA "18.5" ni "18.5 h"', () => {
    const result = format_response_time(18.5);
    expect(result).toBe('19 h');
    expect(result).not.toBe('18.5');
    expect(result).not.toBe('18.5 h');
  });
});
