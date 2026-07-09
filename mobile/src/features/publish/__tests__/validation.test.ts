/**
 * validation.test.ts — validate_video_size (subtarea 49.2, fase RED).
 *
 * El límite MAX_VIDEO_SIZE_BYTES debe coincidir con el límite del bucket de
 * Storage donde se sube el video de la propiedad (500 MB).
 */

import {
  MAX_VIDEO_SIZE_BYTES,
  validate_video_size,
} from '@/features/publish/validation';

const MB = 1024 * 1024;

describe('validate_video_size', () => {
  it('acepta un video bien por debajo de 500 MB', () => {
    const result = validate_video_size(100 * MB);

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('acepta un video de exactamente MAX_VIDEO_SIZE_BYTES (límite inclusivo)', () => {
    const result = validate_video_size(MAX_VIDEO_SIZE_BYTES);

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('rechaza un video de 600 MB con mensaje en español que menciona el tamaño real y el límite', () => {
    const result = validate_video_size(600 * MB);

    expect(result.valid).toBe(false);
    expect(result.error).not.toBeNull();
    expect(result.error).toContain('600 MB');
    expect(result.error).toContain('500 MB');
  });

  it('calcula size_mb redondeado a partir de los bytes', () => {
    const result = validate_video_size(250 * MB);

    expect(result.size_mb).toBe(250);
  });

  it('MAX_VIDEO_SIZE_BYTES coincide con el límite del bucket de Storage (500 MB)', () => {
    expect(MAX_VIDEO_SIZE_BYTES).toBe(524288000);
  });
});
