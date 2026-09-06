import { describe, expect, it } from 'vitest';
import {
  isSyntheticEmailAddress,
  normalizePhoneToE164,
  syntheticGraderEmail
} from '../../services/phoneIdentityService.js';

describe('normalizePhoneToE164', () => {
  it('riduce alla stessa forma le varianti dello stesso numero italiano', () => {
    const variants = [
      '+39 340 111 2233',
      '+393401112233',
      '3401112233',
      '340 111 2233',
      '340-111-2233',
      '0039 340 111 2233',
      '393401112233',
      'whatsapp:+393401112233'
    ];

    const normalized = new Set(variants.map((raw) => normalizePhoneToE164(raw)?.e164));

    expect([...normalized]).toEqual(['+393401112233']);
  });

  it('tiene i numeri fissi italiani e i prefissi esteri', () => {
    expect(normalizePhoneToE164('051 123456')?.e164).toBe('+39051123456');
    expect(normalizePhoneToE164('+34 600 111 222')?.e164).toBe('+34600111222');
  });

  it('scarta quello che non è un numero utilizzabile', () => {
    expect(normalizePhoneToE164('   ')).toBeNull();
    expect(normalizePhoneToE164('')).toBeNull();
    expect(normalizePhoneToE164(null)).toBeNull();
    expect(normalizePhoneToE164(undefined)).toBeNull();
    expect(normalizePhoneToE164('non un numero')).toBeNull();
    expect(normalizePhoneToE164('12345')).toBeNull();
    expect(normalizePhoneToE164('+391234567890123456')).toBeNull();
  });
});

describe('syntheticGraderEmail', () => {
  it('deriva un indirizzo stabile dal numero canonico', () => {
    expect(syntheticGraderEmail('+393401112233'))
      .toBe(syntheticGraderEmail(normalizePhoneToE164('340 111 2233').e164));
  });

  it('riconosce gli indirizzi che generiamo noi', () => {
    expect(isSyntheticEmailAddress(syntheticGraderEmail('+393401112233'))).toBe(true);
    expect(isSyntheticEmailAddress('titolare@osteria.it')).toBe(false);
    expect(isSyntheticEmailAddress(null)).toBe(false);
  });
});
