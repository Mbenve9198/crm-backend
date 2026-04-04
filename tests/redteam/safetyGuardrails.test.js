import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('Safety Guardrails Multi-Agent', () => {
  it('writer prompt impone limite parole massimo', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/writer.js', import.meta.url), 'utf-8');
    expect(source).toContain('maxWords');
    expect(source).toContain('Conta le parole');
  });

  it('reviewer prompt controlla limite parole', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/reviewer.js', import.meta.url), 'utf-8');
    expect(source).toContain('superare');
    expect(source).toContain('parole');
    expect(source).toContain('Conta attentamente');
  });

  it('playbook rank checker ha max 80 parole', async () => {
    const playbook = (await import('../../services/agents/playbooks/inbound_rankchecker.js')).default;
    expect(playbook.maxWords).toBe(80);
  });

  it('playbook outbound ha max 100 parole', async () => {
    const playbook = (await import('../../services/agents/playbooks/outbound_initial.js')).default;
    expect(playbook.maxWords).toBe(100);
  });

  it('playbook objection ha strategie per ogni obiezione', async () => {
    const playbook = (await import('../../services/agents/playbooks/objection_handling.js')).default;
    expect(playbook.objectionStrategies.no_tempo).toBeDefined();
    expect(playbook.objectionStrategies.mandami_mail).toBeDefined();
    expect(playbook.objectionStrategies.prezzo).toBeDefined();
    expect(playbook.objectionStrategies.ha_gia_fornitore).toBeDefined();
    expect(playbook.objectionStrategies.non_interessa).toBeDefined();
    expect(playbook.objectionStrategies.bad_timing).toBeDefined();
    expect(playbook.objectionStrategies.troppo_caro).toBeDefined();
  });

  it('playbook objection non permette piu di 2 insistenze', async () => {
    const playbook = (await import('../../services/agents/playbooks/objection_handling.js')).default;
    const doNotJoined = playbook.doNot.join(' ').toLowerCase();
    expect(doNotJoined).toContain('2');
  });

  it('outreach prompt PAS nel playbook rank checker', async () => {
    const playbook = (await import('../../services/agents/playbooks/inbound_rankchecker.js')).default;
    expect(playbook.strategies.pain_point_leverage).toBeDefined();
    expect(playbook.strategies.social_proof).toBeDefined();
    expect(playbook.strategies.direct_cta).toBeDefined();
  });

  it('reviewer controlla CTA e firma obbligatorie', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/reviewer.js', import.meta.url), 'utf-8');
    expect(source).toContain('CTA chiara');
    expect(source).toContain('firmato col nome');
  });

  it('researcher esporta summarizeDataForReviewer', async () => {
    const mod = await import('../../services/agents/researcher.js');
    expect(typeof mod.summarizeDataForReviewer).toBe('function');
  });
});
