import { describe, it, expect } from 'vitest';

const OBJECTION_PATTERNS = [
  { pattern: /non (ho|abbiamo) tempo|sono impegnat|impegnatissim/i, label: 'no_tempo' },
  { pattern: /manda(mi|temi|teci)? (una )?(mail|email|info|informazioni)/i, label: 'mandami_mail' },
  { pattern: /quanto costa|qual è il prezzo|che prezzo|costi|listino/i, label: 'prezzo' },
  { pattern: /già (un|il) (sistema|fornitore|servizio)|abbiamo già/i, label: 'ha_gia_fornitore' },
  { pattern: /non (mi |ci )?(interessa|serve|fa per)/i, label: 'non_interessa' },
  { pattern: /non è il momento|forse più avanti|ci penso|più avanti/i, label: 'bad_timing' },
  { pattern: /troppo caro|non (ho|abbiamo) budget|costoso/i, label: 'troppo_caro' },
  { pattern: /non (ho|abbiamo) bisogno/i, label: 'no_bisogno' }
];

const PAIN_PATTERNS = [
  { pattern: /poche recensioni|recensioni basse|pochi feedback/i, label: 'poche_recensioni' },
  { pattern: /competitor|concorren|ci superano|ci hanno sorpassato/i, label: 'competitor_visibili' },
  { pattern: /menu cartaceo|non (abbiamo|ho) menu digitale|menu fisico/i, label: 'no_menu_digitale' },
  { pattern: /non ci trovano|visibilità bassa|non siamo visibil/i, label: 'bassa_visibilita' },
  { pattern: /recensioni negative|stelle basse|rating basso/i, label: 'recensioni_negative' },
  { pattern: /clienti persi|meno clienti|calo clienti/i, label: 'calo_clienti' }
];

const extractInsightsFromMessage = (text) => {
  const objections = [];
  const painPoints = [];
  for (const { pattern, label } of OBJECTION_PATTERNS) {
    if (pattern.test(text)) objections.push(label);
  }
  for (const { pattern, label } of PAIN_PATTERNS) {
    if (pattern.test(text)) painPoints.push(label);
  }
  return { objections, painPoints };
};

describe('extractInsightsFromMessage', () => {
  it('rileva obiezione "non ho tempo"', () => {
    const { objections } = extractInsightsFromMessage('Non ho tempo per queste cose, sono impegnatissimo');
    expect(objections).toContain('no_tempo');
  });

  it('rileva obiezione "mandami una mail"', () => {
    const { objections } = extractInsightsFromMessage('Mandami una mail con le informazioni');
    expect(objections).toContain('mandami_mail');
  });

  it('rileva obiezione prezzo', () => {
    const { objections } = extractInsightsFromMessage('Quanto costa il servizio?');
    expect(objections).toContain('prezzo');
  });

  it('rileva "ha gia fornitore"', () => {
    const { objections } = extractInsightsFromMessage('Abbiamo già un sistema per le recensioni');
    expect(objections).toContain('ha_gia_fornitore');
  });

  it('rileva "non interessa"', () => {
    const { objections } = extractInsightsFromMessage('Non ci interessa al momento');
    expect(objections).toContain('non_interessa');
  });

  it('rileva bad timing', () => {
    const { objections } = extractInsightsFromMessage('Ci penso e vi faccio sapere');
    expect(objections).toContain('bad_timing');
  });

  it('rileva obiezione prezzo troppo caro', () => {
    const { objections } = extractInsightsFromMessage('È troppo caro per noi, non abbiamo budget');
    expect(objections).toContain('troppo_caro');
  });

  it('rileva pain point poche recensioni', () => {
    const { painPoints } = extractInsightsFromMessage('Il problema è che abbiamo poche recensioni su Google');
    expect(painPoints).toContain('poche_recensioni');
  });

  it('rileva pain point competitor', () => {
    const { painPoints } = extractInsightsFromMessage('I nostri competitor ci superano su Maps');
    expect(painPoints).toContain('competitor_visibili');
  });

  it('rileva multipli pain points', () => {
    const { painPoints } = extractInsightsFromMessage('Abbiamo poche recensioni e i concorrenti ci hanno sorpassato');
    expect(painPoints).toContain('poche_recensioni');
    expect(painPoints).toContain('competitor_visibili');
  });

  it('rileva menu cartaceo', () => {
    const { painPoints } = extractInsightsFromMessage('Abbiamo ancora il menu cartaceo, non ho menu digitale');
    expect(painPoints).toContain('no_menu_digitale');
  });

  it('ritorna arrays vuoti per messaggi neutri', () => {
    const result = extractInsightsFromMessage('Buongiorno, grazie per avermi scritto');
    expect(result.objections).toHaveLength(0);
    expect(result.painPoints).toHaveLength(0);
  });

  it('NON rileva abbreviazioni (bug noto documentato)', () => {
    const { objections } = extractInsightsFromMessage('nn ho tempo');
    expect(objections).not.toContain('no_tempo');
  });

  it('rileva obiezione + pain point nello stesso messaggio', () => {
    const result = extractInsightsFromMessage('Non ho tempo, e comunque abbiamo poche recensioni, ci penso');
    expect(result.objections).toContain('no_tempo');
    expect(result.objections).toContain('bad_timing');
    expect(result.painPoints).toContain('poche_recensioni');
  });
});
