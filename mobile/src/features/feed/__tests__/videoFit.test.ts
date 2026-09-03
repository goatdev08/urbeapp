/**
 * videoFit.test.ts — RED (#242.2): presentación híbrida del video en el feed.
 *
 * Decisión Abraham 2026-09-03 (AskUserQuestion, opción "Híbrido"): un video
 * vertical se ve a pantalla completa (cover, inmersivo como hoy); uno
 * horizontal o cuadrado se ve completo (contain) sobre su portada desenfocada.
 * La frontera NO es "portrait vs landscape" sino cuánto recortaría cover: si
 * cover pierde más de MAX_CROP_FRACTION (25 %) del cuadro → contain.
 *
 * SUT: src/features/feed/lib/videoFit.ts
 *   - MAX_CROP_FRACTION = 0.25
 *   - fit_for_video(media, screen): 'cover' | 'contain'
 *       media: { width, height } | null | undefined (desconocido → 'cover',
 *       el comportamiento previo a #242; nunca un salto a contain "por si acaso")
 */
import { MAX_CROP_FRACTION, fit_for_video } from '../lib/videoFit';

// iPhone 15 (390×844 → 0.462) y Pixel 7 (412×915 → 0.450).
const IPHONE = { width: 390, height: 844 };
const PIXEL = { width: 412, height: 915 };

describe('videoFit — constantes', () => {
  it('(EC-FIT-1) umbral_es_25_por_ciento', () => {
    expect(MAX_CROP_FRACTION).toBe(0.25);
  });
});

describe('fit_for_video — tamaño desconocido o inválido → cover (comportamiento previo)', () => {
  it('(EC-FIT-2) null_y_undefined → cover', () => {
    expect(fit_for_video(null, IPHONE)).toBe('cover');
    expect(fit_for_video(undefined, IPHONE)).toBe('cover');
  });

  it('(EC-FIT-3) dimension_cero_o_negativa → cover', () => {
    expect(fit_for_video({ width: 0, height: 1920 }, IPHONE)).toBe('cover');
    expect(fit_for_video({ width: 1080, height: 0 }, IPHONE)).toBe('cover');
    expect(fit_for_video({ width: -1080, height: 1920 }, IPHONE)).toBe('cover');
  });

  it('(EC-FIT-4) NaN → cover', () => {
    expect(fit_for_video({ width: NaN, height: 1920 }, IPHONE)).toBe('cover');
  });

  it('(EC-FIT-5) pantalla_invalida → cover (no divide entre cero)', () => {
    expect(fit_for_video({ width: 1080, height: 1920 }, { width: 0, height: 0 })).toBe('cover');
  });
});

describe('fit_for_video — vertical → cover', () => {
  it('(EC-FIT-6) 9:16 (1080×1920) en iPhone → cover (recorta ~18 %)', () => {
    expect(fit_for_video({ width: 1080, height: 1920 }, IPHONE)).toBe('cover');
  });

  it('(EC-FIT-7) 9:16 en Pixel (20:9) → cover (recorta ~20 %)', () => {
    expect(fit_for_video({ width: 1080, height: 1920 }, PIXEL)).toBe('cover');
  });

  it('(EC-FIT-8) misma_relacion_que_la_pantalla → cover (recorte 0)', () => {
    expect(fit_for_video({ width: 390, height: 844 }, IPHONE)).toBe('cover');
    expect(fit_for_video({ width: 780, height: 1688 }, IPHONE)).toBe('cover');
  });

  it('(EC-FIT-9) mas_alto_que_la_pantalla (9:21) → cover (recorta arriba/abajo ~9 %)', () => {
    expect(fit_for_video({ width: 1080, height: 2520 }, IPHONE)).toBe('cover');
  });

  it('(EC-FIT-10) frontera_exacta_25_por_ciento → cover (≤ umbral)', () => {
    // relación pantalla 0.462… × 4/3 = video que cover recorta exactamente 25 %.
    const r = IPHONE.width / IPHONE.height;
    expect(fit_for_video({ width: r * (4 / 3) * 1000, height: 1000 }, IPHONE)).toBe('cover');
  });
});

describe('fit_for_video — horizontal o cuadrado → contain', () => {
  it('(EC-FIT-11) 16:9 (1920×1080) → contain (cover recortaría ~74 %)', () => {
    expect(fit_for_video({ width: 1920, height: 1080 }, IPHONE)).toBe('contain');
  });

  it('(EC-FIT-12) cuadrado 1:1 → contain (~54 %)', () => {
    expect(fit_for_video({ width: 1080, height: 1080 }, IPHONE)).toBe('contain');
  });

  it('(EC-FIT-13) retrato_ancho 4:5 (Instagram) → contain (~42 %)', () => {
    expect(fit_for_video({ width: 1080, height: 1350 }, IPHONE)).toBe('contain');
  });

  it('(EC-FIT-14) retrato 3:4 → contain (~38 %)', () => {
    expect(fit_for_video({ width: 1080, height: 1440 }, IPHONE)).toBe('contain');
  });

  it('(EC-FIT-15) justo_arriba_del_umbral → contain', () => {
    const r = IPHONE.width / IPHONE.height;
    expect(fit_for_video({ width: r * (4 / 3) * 1000 + 1, height: 1000 }, IPHONE)).toBe('contain');
  });

  it('(EC-FIT-16) demasiado_alto (9:32, recorta 42 % arriba/abajo) → contain', () => {
    expect(fit_for_video({ width: 900, height: 3200 }, IPHONE)).toBe('contain');
  });
});
