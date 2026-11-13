import { describe, expect, it } from 'vitest';
import { normalizePhone, tenDigitPhone, whatsappNumber } from './phone';

describe('phone numbers', () => {
  it('normalises common Ghana forms', () => {
    for (const p of ['0241234567', '+233 24 123 4567', '233241234567', '00233241234567', '241234567', '024-123-4567']) expect(normalizePhone(p)).toBe('0241234567');
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('12')).toBeNull();
  });
  it('accepts exactly 10 digits', () => {
    expect(tenDigitPhone('+233241234567')).toBe('0241234567');
    expect(tenDigitPhone('02412345678')).toBeNull();
    expect(tenDigitPhone('12345678901')).toBeNull();
  });
  it('builds WhatsApp numbers', () => {
    expect(whatsappNumber('0241234567')).toBe('233241234567');
    expect(whatsappNumber('+233 24 123 4567')).toBe('233241234567');
    expect(whatsappNumber('241234567')).toBe('233241234567');
  });
});
