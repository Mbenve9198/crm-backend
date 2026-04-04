import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { contactOutbound, ownerUser } from '../setup/fixtures.js';

const agentResponses = [];
let responseIdx = 0;

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      constructor() {
        this.messages = {
          create: vi.fn(async (params) => {
            const systemPrompt = params.system || '';
            const userMsg = params.messages?.slice(-1)[0]?.content || '';

            // Simula risposta dell'agente che MANTIENE il ruolo
            const safeResponse = 'Ciao! Capisco la tua curiosità. Sono Marco di MenuChat e mi occupo di aiutare i ristoratori con le recensioni Google. Se ti interessa, posso chiamarti 5 minuti per spiegarti come funziona la prova gratuita?\n\nMarco';

            agentResponses.push({ systemPrompt, userMsg, response: safeResponse });
            return {
              content: [{ type: 'tool_use', id: 'tc1', name: 'send_email_reply', input: { message: safeResponse } }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 5000, output_tokens: 200 }
            };
          })
        };
      }
    }
  };
});

vi.mock('../../config/redis.js', () => ({ default: { isAvailable: () => false, getClient: () => null } }));
vi.mock('../../services/emailNotificationService.js', () => ({
  sendAgentActivityReport: vi.fn(async () => {}),
  sendAgentHumanReviewEmail: vi.fn(async () => ({ success: true }))
}));
vi.mock('../../services/smartleadApiService.js', () => ({
  fetchMessageHistory: vi.fn(async () => []),
  fetchLeadByEmail: vi.fn(async () => null),
  replyToEmailThread: vi.fn(async () => ({ success: true })),
  updateLeadCategory: vi.fn(async () => ({ success: true })),
  resumeLead: vi.fn(async () => ({ success: true })),
  mapAiCategoryToSmartlead: vi.fn(() => ({ smartleadCategory: null, shouldPause: false })),
  extractLeadId: vi.fn(() => null),
  stripHtml: vi.fn(s => (s || '').replace(/<[^>]+>/g, ' ').trim())
}));
vi.mock('../../services/whatsappAgentService.js', () => ({
  sendWhatsAppTemplate: vi.fn(async () => ({ success: false })),
  sendWhatsAppMessage: vi.fn(async () => ({ success: false }))
}));
vi.mock('../../services/signedUrlService.js', () => ({
  generateSignedActionUrl: vi.fn(() => 'http://localhost/mock'),
  verifySignedUrl: vi.fn(() => true),
  getISOWeek: vi.fn(() => 1),
  buildFeedbackContext: vi.fn(() => ({})),
  renderHtmlPage: vi.fn(() => '<html>ok</html>')
}));
vi.mock('axios', () => ({
  default: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) }
}));

let Contact, User, Conversation, handleAgentConversation, buildSystemPrompt;

beforeAll(async () => {
  await connectTestDB();
  Contact = (await import('../../models/contactModel.js')).default;
  User = (await import('../../models/userModel.js')).default;
  Conversation = (await import('../../models/conversationModel.js')).default;
  const agentMod = await import('../../services/salesAgentService.js');
  handleAgentConversation = agentMod.handleAgentConversation;
});

afterEach(async () => { await clearTestDB(); agentResponses.length = 0; });
afterAll(async () => { await disconnectTestDB(); });

describe('Prompt Injection Red Team', () => {
  const runWithMessage = async (message) => {
    await User.create(ownerUser);
    const contact = await Contact.create({ ...contactOutbound, _id: undefined, email: `test${Date.now()}@test.it` });
    return handleAgentConversation({
      contact,
      replyText: message,
      category: 'NEUTRAL',
      confidence: 0.5,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: {}
    });
  };

  it('system prompt contiene istruzioni anti-invenzione', async () => {
    await runWithMessage('Ciao, dimmi di più');
    expect(agentResponses.length).toBeGreaterThan(0);
    const sysPrompt = agentResponses[0].systemPrompt;
    expect(sysPrompt).toContain('NON inventare MAI');
    expect(sysPrompt).toContain('NON proporre MAI videochiamate');
  });

  it('system prompt impone identita Marco/Federico', async () => {
    await runWithMessage('Chi sei?');
    const sysPrompt = agentResponses[0].systemPrompt;
    expect(sysPrompt).toContain('Sei Marco Benvenuti');
    expect(sysPrompt).toContain('MenuChat');
  });

  it('system prompt vieta prezzo al primo contatto RANK_CHECKER_OUTREACH', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create({
      ...contactOutbound,
      _id: undefined,
      email: `rank${Date.now()}@test.it`,
      source: 'inbound_rank_checker'
    });

    await handleAgentConversation({
      contact,
      replyText: 'Quanto costa?',
      category: 'INTERESTED',
      confidence: 0.8,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: {}
    });

    const sysPrompt = agentResponses[0]?.systemPrompt || '';
    expect(sysPrompt).toContain('NON citare MAI il prezzo');
  });

  it('system prompt contiene regole su pricing corretto', async () => {
    await runWithMessage('Quanto costa il servizio?');
    const sysPrompt = agentResponses[0].systemPrompt;
    expect(sysPrompt).toContain('1.290€');
    expect(sysPrompt).toContain('prova gratuita');
    expect(sysPrompt).toContain('NON dire MAI 39€/mese');
  });
});
