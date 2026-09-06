/**
 * crm_narrative.test.ts — RED (subtarea 267.3).
 *
 * Contrato: copy narrativo del header del CRM y de cada fila. Fuente de los
 * literales: enunciado de la subtarea (exploración 045 §7.3/§7.4, decisiones
 * de Abraham 2026-09-06). Copy aprobado — no promete notificaciones push.
 */

import type { CrmBand, CrmLeadSignals } from '../../types';
import { crm_header_narrative, crm_row_narrative } from '../crm_narrative';

function counts(partial: Partial<Record<CrmBand, number>>): Record<CrmBand, number> {
  return { hot: 0, cooling: 0, warming: 0, silent: 0, ...partial };
}

function signals(partial: Partial<CrmLeadSignals>): CrmLeadSignals {
  return { video_completed: 0, video_views: 0, likes: 0, saves: 0, ...partial };
}

describe('crm_header_narrative', () => {
  it('hot=2: headline en plural, highlight "2 personas"', () => {
    const result = crm_header_narrative(counts({ hot: 2 }));
    expect(result.headline).toBe('2 personas están listas para que les hables.');
    expect(result.highlight).toBe('2 personas');
  });

  it('hot=1: headline en singular, highlight "1 persona"', () => {
    const result = crm_header_narrative(counts({ hot: 1 }));
    expect(result.headline).toBe('1 persona está lista para que le hables.');
    expect(result.highlight).toBe('1 persona');
  });

  it('cooling=2 con top_cooling: subline nombra a la persona y su delta', () => {
    const result = crm_header_narrative(
      counts({ hot: 1, cooling: 2 }),
      { first_name: 'Fernando', delta: -5 },
    );
    expect(result.subline).toBe(
      'Y 2 se están enfriando — Fernando bajó 5° en 3 días desde su última señal.',
    );
    // El caso mixto NO degrada el headline: sigue habiendo un lead caliente.
    expect(result.headline).toBe('1 persona está lista para que le hables.');
    expect(result.highlight).toBe('1 persona');
  });

  it('cooling=1 con top_cooling: subline en singular ("se está enfriando")', () => {
    const result = crm_header_narrative(
      counts({ hot: 1, cooling: 1 }),
      { first_name: 'Fernando', delta: -5 },
    );
    expect(result.subline).toBe(
      'Y 1 se está enfriando — Fernando bajó 5° en 3 días desde su última señal.',
    );
    expect(result.headline).toBe('1 persona está lista para que le hables.');
    expect(result.highlight).toBe('1 persona');
  });

  it('cooling=2 SIN top_cooling: subline corto, sin nombre', () => {
    const result = crm_header_narrative(counts({ hot: 1, cooling: 2 }), null);
    expect(result.subline).toBe('Y 2 se están enfriando.');
  });

  it('cooling=0: subline null (no hay nada que enfriar)', () => {
    const result = crm_header_narrative(counts({ hot: 3, cooling: 0 }));
    expect(result.subline).toBeNull();
  });

  it('hot=0 y cooling=0 pero warming+silent>0: headline "Nadie pendiente por hoy" sin prometer notificaciones', () => {
    const result = crm_header_narrative(counts({ warming: 4, silent: 2 }));
    expect(result.headline).toBe('Nadie pendiente por hoy.');
    expect(result.subline).toBe(
      'Vuelve a revisar más tarde — el radar se actualiza solo con actividad nueva.',
    );
    expect(result.highlight).toBeNull();
    const full_text = `${result.headline} ${result.subline ?? ''}`.toLowerCase();
    expect(full_text).not.toMatch(/avisamos|notific/);
  });

  it('todo en cero: headline de radar apagado, distinto del caso "nadie pendiente"', () => {
    const result = crm_header_narrative(counts({}));
    expect(result.headline).toBe('Aún no hay señal que leer');
    expect(result.subline).toBe(
      'El radar se enciende cuando alguien ve, guarda o repite tus propiedades.',
    );
    expect(result.highlight).toBeNull();
  });

  it('determinismo: no depende de la fecha del sistema (misma entrada, 2 fechas distintas → mismo resultado)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = crm_header_narrative(counts({ hot: 2, cooling: 1 }), { first_name: 'Ana', delta: -3 });
    jest.setSystemTime(new Date('2027-06-15T12:30:00Z'));
    const second = crm_header_narrative(counts({ hot: 2, cooling: 1 }), { first_name: 'Ana', delta: -3 });
    expect(second).toEqual(first);
    jest.useRealTimers();
  });
});

describe('crm_row_narrative', () => {
  it('views + save + whatsapp sin escribir + origen: frase completa', () => {
    const result = crm_row_narrative(signals({ video_views: 4, saves: 1 }), 'Bugambilias', true);
    expect(result).toBe(
      'Vio 4 veces tu casa de Bugambilias, la guardó y abrió tu WhatsApp sin escribirte.',
    );
  });

  it('1 vista: singular "Vio 1 vez"', () => {
    const result = crm_row_narrative(signals({ video_views: 1, saves: 1 }), 'Bugambilias', true);
    expect(result).toBe(
      'Vio 1 vez tu casa de Bugambilias, la guardó y abrió tu WhatsApp sin escribirte.',
    );
  });

  it('saves=0: sin la cláusula "la guardó" (las 2 cláusulas restantes se unen con "y")', () => {
    const result = crm_row_narrative(signals({ video_views: 4, saves: 0 }), 'Bugambilias', true);
    expect(result).toBe('Vio 4 veces tu casa de Bugambilias y abrió tu WhatsApp sin escribirte.');
    expect(result).not.toMatch(/guard/);
  });

  it('whatsapp=false: sin la cláusula del WhatsApp', () => {
    const result = crm_row_narrative(signals({ video_views: 4, saves: 1 }), 'Bugambilias', false);
    expect(result).toBe('Vio 4 veces tu casa de Bugambilias, la guardó.');
    expect(result).not.toMatch(/whatsapp/i);
  });

  it('origin_address null: sin dirección, gramática correcta (sin " y" colgante, sin doble espacio)', () => {
    const result = crm_row_narrative(signals({ video_views: 4, saves: 1 }), null, false);
    expect(result).toBe('Vio 4 veces tu propiedad, la guardó.');
    expect(result).not.toMatch(/ {2}/);
    expect(result.trim().endsWith(' y')).toBe(false);
  });

  it('video_completed>0 y views=0: "Terminó tu video de X."', () => {
    const result = crm_row_narrative(signals({ video_completed: 1 }), 'Bugambilias', false);
    expect(result).toBe('Terminó tu video de Bugambilias.');
  });

  it('todo cero y sin origen: "Sin actividad reciente."', () => {
    const result = crm_row_narrative(signals({}), null, false);
    expect(result).toBe('Sin actividad reciente.');
  });

  it('invariante de privacidad: nunca incluye "$" ni dígitos ajenos al conteo de vistas', () => {
    const result = crm_row_narrative(signals({ video_views: 7, saves: 1 }), 'Bugambilias', true);
    expect(result).not.toContain('$');
    // El único número permitido en el texto es el conteo de vistas (7).
    const digits_found = result.match(/\d+/g) ?? [];
    expect(digits_found).toEqual(['7']);
  });
});
