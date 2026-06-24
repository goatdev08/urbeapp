/**
 * Tests for onboarding/validation.ts — is_valid_full_name (pura, sin UI).
 * Subtarea 6.6.
 */
import { is_valid_full_name } from '../validation';

describe('is_valid_full_name', () => {
  it('returns false for empty string', () => {
    expect(is_valid_full_name('')).toBe(false);
  });

  it('returns false for a single character', () => {
    expect(is_valid_full_name('A')).toBe(false);
  });

  it('returns false for a single character with surrounding spaces', () => {
    expect(is_valid_full_name('  A  ')).toBe(false);
  });

  it('returns false for only spaces (blank name)', () => {
    expect(is_valid_full_name('   ')).toBe(false);
  });

  it('returns true for exactly 2 characters', () => {
    expect(is_valid_full_name('Al')).toBe(true);
  });

  it('returns true for exactly 2 characters with surrounding spaces', () => {
    expect(is_valid_full_name('  Al  ')).toBe(true);
  });

  it('returns true for a full valid name', () => {
    expect(is_valid_full_name('Juan García')).toBe(true);
  });

  it('returns true for a long name', () => {
    expect(is_valid_full_name('María de los Ángeles Rodríguez Pérez')).toBe(true);
  });
});
