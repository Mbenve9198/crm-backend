import { describe, expect, it } from 'vitest';
import {
  isSyntheticEmailAddress,
  legacyPhoneLookupPattern,
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

  it('non finge che una cifra qualsiasi sia un numero italiano', () => {
    // Sei cifre non sono un recapito: con il vecchio controllo di sola forma
    // diventavano «+39123456» e si portavano dietro un contatto fantasma.
    expect(normalizePhoneToE164('123456')).toBeNull();
    // Un cellulare italiano ha dieci cifre: né nove né undici.
    expect(normalizePhoneToE164('340111223')).toBeNull();
    expect(normalizePhoneToE164('34011122334')).toBeNull();
    // Un cellulare spagnolo senza prefisso non è un numero italiano.
    expect(normalizePhoneToE164('34600111222')).toBeNull();
  });

  it('non ricompone le cifre sparse fra le lettere', () => {
    // Buttando via «ext» resterebbe +393401112233**7**: un numero diverso,
    // non lo stesso numero scritto male.
    expect(normalizePhoneToE164('+39 340 111 2233 ext 7')).toBeNull();
    expect(normalizePhoneToE164('340 111 2233 (casa)')).toBeNull();
  });

  it('legge il 39 iniziale come prefisso solo se quel che resta è un numero', () => {
    // «391 234 5678» è un cellulare italiano vero, non 39 + «12345678».
    expect(normalizePhoneToE164('3912345678')?.e164).toBe('+393912345678');
    expect(normalizePhoneToE164('393401112233')?.e164).toBe('+393401112233');
  });
});

describe('legacyPhoneLookupPattern', () => {
  const pattern = legacyPhoneLookupPattern('+393401112233');

  it('ritrova il numero salvato prima che lo normalizzassimo', () => {
    for (const stored of [
      '+393401112233',
      '+39 340 111 2233',
      '3401112233',
      '340-111-2233',
      '340 111 2233',
      '0039 340 111 2233',
      '(340) 111 2233'
    ]) {
      expect(pattern.test(stored)).toBe(true);
    }
  });

  it('non prende un numero diverso', () => {
    for (const stored of [
      '+393401112234',
      '340111223',
      '13401112233',
      '+34600111222',
      ''
    ]) {
      expect(pattern.test(stored)).toBe(false);
    }
  });

  it('non restituisce un pattern se non c\'è un numero', () => {
    expect(legacyPhoneLookupPattern('')).toBeNull();
    expect(legacyPhoneLookupPattern(null)).toBeNull();
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
