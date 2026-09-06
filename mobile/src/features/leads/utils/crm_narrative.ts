/**
 * crm_narrative.ts — copy narrativo del header del CRM y de cada fila.
 *
 * STUB mínimo — subtarea 267.3 (RED). La fase GREEN implementa el copy
 * real (exploración 045 §7.3/§7.4, decisiones de Abraham 2026-09-06).
 */

import type { CrmBand, CrmLeadSignals } from '../types';
import { CRM_TREND_WINDOW_DAYS } from './crm_temperature_format';

export interface CrmHeaderNarrative {
  headline: string;
  highlight: string | null;
  subline: string | null;
}

/** "Y 2 se están enfriando — Fernando bajó 5° en 3 días..." / null si cooling=0. */
function cooling_subline(
  cooling: number,
  top_cooling?: { first_name: string; delta: number } | null,
): string | null {
  if (cooling === 0) return null;
  const verb = cooling === 1 ? 'se está enfriando' : 'se están enfriando';
  if (!top_cooling) return `Y ${cooling} ${verb}.`;
  const abs_delta = Math.abs(Math.round(top_cooling.delta));
  return `Y ${cooling} ${verb} — ${top_cooling.first_name} bajó ${abs_delta}° en ${CRM_TREND_WINDOW_DAYS} días desde su última señal.`;
}

/**
 * Headline/highlight/subline del header del CRM (exploración 045 §7.3,
 * decisiones de Abraham 2026-09-06). Pura: sin Date, mismo resultado sin
 * importar cuándo se llame. Prioridad: hot > cooling > (warming|silent) > 0.
 * Copy aprobado — nunca promete notificaciones push.
 */
export function crm_header_narrative(
  counts: Record<CrmBand, number>,
  top_cooling?: { first_name: string; delta: number } | null,
): CrmHeaderNarrative {
  const { hot, cooling, warming, silent } = counts;

  if (hot > 0) {
    const persona = hot === 1 ? 'persona' : 'personas';
    return {
      headline:
        hot === 1
          ? '1 persona está lista para que le hables.'
          : `${hot} personas están listas para que les hables.`,
      highlight: `${hot} ${persona}`,
      subline: cooling_subline(cooling, top_cooling),
    };
  }

  if (cooling > 0) {
    return {
      headline: 'Nadie pendiente por hoy.',
      highlight: null,
      subline: cooling_subline(cooling, top_cooling),
    };
  }

  if (warming > 0 || silent > 0) {
    return {
      headline: 'Nadie pendiente por hoy.',
      highlight: null,
      subline: 'Vuelve a revisar más tarde — el radar se actualiza solo con actividad nueva.',
    };
  }

  return {
    headline: 'Aún no hay señal que leer',
    highlight: null,
    subline: 'El radar se enciende cuando alguien ve, guarda o repite tus propiedades.',
  };
}

/**
 * Frase de actividad de una fila (exploración 045 §7.3, decisiones de
 * Abraham 2026-09-06). Prioridad: vistas > video completado (sin vistas
 * nuevas) > nada. `saves`/whatsapp son cláusulas opcionales que se agregan
 * al final — la única cifra permitida en el texto es el conteo de vistas
 * (invariante de privacidad: nunca precio ni otros números).
 */
export function crm_row_narrative(
  signals: CrmLeadSignals,
  origin_address: string | null,
  opened_whatsapp_without_writing: boolean,
): string {
  const place = origin_address ? `tu casa de ${origin_address}` : 'tu propiedad';

  let primary: string | null = null;
  if (signals.video_views > 0) {
    const vez = signals.video_views === 1 ? 'vez' : 'veces';
    primary = `Vio ${signals.video_views} ${vez} ${place}`;
  } else if (signals.video_completed > 0) {
    primary = origin_address ? `Terminó tu video de ${origin_address}` : 'Terminó tu video';
  }

  if (primary === null && signals.saves === 0 && !opened_whatsapp_without_writing) {
    return 'Sin actividad reciente.';
  }

  let text = primary ?? '';
  if (signals.saves > 0) {
    text += `${text ? ', ' : ''}la guardó`;
  }
  if (opened_whatsapp_without_writing) {
    text += `${text ? ' y ' : ''}abrió tu WhatsApp sin escribirte`;
  }
  return `${text}.`;
}
