import { describe, it, expect, vi, beforeAll } from 'vitest';

let buildSystemPrompt;

vi.mock('@anthropic-ai/sdk', () => ({ default: class { constructor() { this.messages = { create: vi.fn() }; } } }));
vi.mock('../../config/redis.js', () => ({ default: { isAvailable: () => false, getClient: () => null } }));
vi.mock('../../services/agentToolsService.js', () => ({ AGENT_TOOLS: [], executeTools: vi.fn() }));
vi.mock('../../services/emailNotificationService.js', () => ({ sendAgentActivityReport: vi.fn() }));
vi.mock('../../services/smartleadApiService.js', () => ({
  fetchMessageHistory: vi.fn(async () => []),
  fetchLeadByEmail: vi.fn(async () => null),
  stripHtml: vi.fn(s => s)
}));

beforeAll(async () => {
  const mod = await import('../../services/salesAgentService.js');
  // buildSystemPrompt is not exported directly, but the system prompt content
  // is embedded in the module. We test the KNOWN rules that MUST be in the prompt
  // by calling resolveIdentity and checking the exported functions behavior.
  buildSystemPrompt = (identity, context) => {
    // Reconstruct from the module's known structure
    return `Sei ${identity.name} ${identity.surname}, ${identity.role} di MenuChat.` + (context || '');
  };
});

describe('Safety Guardrails nel System Prompt', () => {
  it('prompt contiene regola "NON dire MAI 39€/mese"', async () => {
    const mod = await import('../../services/salesAgentService.js');
    // Since buildSystemPrompt is not exported, we verify by reading the source
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../services/salesAgentService.js', import.meta.url), 'utf-8');

    expect(source).toContain('NON dire MAI 39€/mese');
  });

  it('prompt contiene regola anti-videochiamata', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../services/salesAgentService.js', import.meta.url), 'utf-8');

    expect(source).toContain('NON proporre MAI videochiamate');
    expect(source).toContain('Google Meet');
    expect(source).toContain('Zoom');
  });

  it('prompt contiene regola anti-invenzione dati', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../services/salesAgentService.js', import.meta.url), 'utf-8');

    expect(source).toContain('NON inventare MAI nomi di ristoranti');
  });

  it('prompt contiene regola prezzo per RANK_CHECKER_OUTREACH', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../services/salesAgentService.js', import.meta.url), 'utf-8');

    expect(source).toContain('RANK_CHECKER_OUTREACH');
    expect(source).toContain('NON citare MAI il prezzo');
  });

  it('prompt contiene il pricing corretto (1.290€)', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../services/salesAgentService.js', import.meta.url), 'utf-8');

    expect(source).toContain('1.290€');
    expect(source).toContain('2 settimane');
    expect(source).toContain('prova gratuita');
  });

  it('prompt impone max 150 parole per email', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../services/salesAgentService.js', import.meta.url), 'utf-8');

    expect(source).toContain('Max 150 parole per email');
  });

  it('prompt contiene strategia outbound vs inbound', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../services/salesAgentService.js', import.meta.url), 'utf-8');

    expect(source).toContain('SE IL LEAD È OUTBOUND');
    expect(source).toContain('SE IL LEAD È INBOUND');
    expect(source).toContain('smartlead_outbound');
    expect(source).toContain('inbound_rank_checker');
  });

  it('prompt contiene gestione obiezioni strutturata', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../services/salesAgentService.js', import.meta.url), 'utf-8');

    expect(source).toContain('GESTIONE OBIEZIONI');
    expect(source).toContain('Non ho tempo');
    expect(source).toContain('Mandami una mail');
    expect(source).toContain('Quanto costa');
    expect(source).toContain('Ho già un sistema');
  });

  it('outreach prompt PAS NON contiene descrizione prodotto', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../services/rankCheckerAgentService.js', import.meta.url), 'utf-8');

    expect(source).not.toContain('unico menu digitale al mondo');
    expect(source).toContain('PROBLEMA');
    expect(source).toContain('DREAM OUTCOME');
    expect(source).toContain('CTA');
    expect(source).toContain('MAI spiegare il meccanismo');
  });
});
