import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({ default: class { constructor() { this.messages = { create: vi.fn() }; } } }));
vi.mock('../../config/redis.js', () => ({ default: { isAvailable: () => false, getClient: () => null } }));
vi.mock('../../services/agentToolsService.js', () => ({ AGENT_TOOLS: [], executeTools: vi.fn() }));
vi.mock('../../services/emailNotificationService.js', () => ({ sendAgentActivityReport: vi.fn() }));
vi.mock('../../services/smartleadApiService.js', () => ({
  fetchMessageHistory: vi.fn(async () => []),
  fetchLeadByEmail: vi.fn(async () => null),
  stripHtml: vi.fn(s => s)
}));

let routeLeadReply;

beforeAll(async () => {
  const mod = await import('../../services/salesAgentService.js');
  routeLeadReply = mod.routeLeadReply;
});

describe('routeLeadReply', () => {
  it('DO_NOT_CONTACT -> stop', () => {
    const result = routeLeadReply('DO_NOT_CONTACT', 0.99, {}, 'cancellate tutto');
    expect(result.action).toBe('stop');
    expect(result.reason).toBe('DNC');
  });

  it('OUT_OF_OFFICE -> resume_sequence', () => {
    const result = routeLeadReply('OUT_OF_OFFICE', 0.95, {}, 'Sono fuori ufficio');
    expect(result.action).toBe('resume_sequence');
  });

  it('INTERESTED + alta confidence + telefono -> direct_handoff', () => {
    const result = routeLeadReply('INTERESTED', 0.95, { phone: '+393401234567', preferredChannel: 'phone' }, 'chiamatemi');
    expect(result.action).toBe('direct_handoff');
  });

  it('INTERESTED + alta confidence + "chiamami" nel testo -> direct_handoff', () => {
    const result = routeLeadReply('INTERESTED', 0.92, {}, 'Si mi interessa, chiamatemi pure');
    expect(result.action).toBe('direct_handoff');
  });

  it('INTERESTED + alta confidence senza telefono e senza "chiamami" -> agent', () => {
    const result = routeLeadReply('INTERESTED', 0.95, {}, 'Mi interessa, mandatemi più info');
    expect(result.action).toBe('agent');
  });

  it('INTERESTED + bassa confidence -> agent', () => {
    const result = routeLeadReply('INTERESTED', 0.6, {}, 'ok');
    expect(result.action).toBe('agent');
  });

  it('NEUTRAL -> agent', () => {
    const result = routeLeadReply('NEUTRAL', 0.7, {}, 'Grazie');
    expect(result.action).toBe('agent');
  });

  it('NOT_INTERESTED + confidence < 0.85 -> agent (tentativo recupero)', () => {
    const result = routeLeadReply('NOT_INTERESTED', 0.75, {}, 'Non credo faccia per noi');
    expect(result.action).toBe('agent');
  });

  it('NOT_INTERESTED + confidence >= 0.85 -> track_lost', () => {
    const result = routeLeadReply('NOT_INTERESTED', 0.90, {}, 'Non siamo assolutamente interessati');
    expect(result.action).toBe('track_lost');
  });

  it('Categoria sconosciuta -> agent (fallback sicuro)', () => {
    const result = routeLeadReply('UNKNOWN_CATEGORY', 0.5, {}, 'boh');
    expect(result.action).toBe('agent');
  });
});
