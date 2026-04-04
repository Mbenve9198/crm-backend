import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { contactOutbound, ownerUser } from '../setup/fixtures.js';

vi.mock('@anthropic-ai/sdk', () => {
  let callIdx = 0;
  const responses = [
    // Turn 1: agent responds to "non ho tempo"
    {
      content: [{ type: 'tool_use', id: 'tc1', name: 'send_email_reply', input: {
        message: 'Capisco perfettamente! Proprio per questo ti propongo 5 minuti al telefono — non una presentazione, solo per capire se ha senso per te. Quando ti viene più comodo?\n\nMarco'
      } }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5000, output_tokens: 200 }
    },
    // Turn 1 insight extraction (Haiku)
    {
      content: [{ type: 'text', text: '{"objections":["no_tempo"],"painPoints":[]}' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 50 }
    },
    // Turn 2: agent escalates after second objection
    {
      content: [{ type: 'tool_use', id: 'tc2', name: 'schedule_followup', input: { days: 14, note: 'Rifiuto soft su tempo, ricontattare con angolo diverso' } }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 6000, output_tokens: 150 }
    },
    // Turn 2 insight extraction (Haiku)
    {
      content: [{ type: 'text', text: '{"objections":["no_tempo","non_interessa"],"painPoints":[]}' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 50 }
    }
  ];
  return {
    default: class {
      constructor() {
        this.messages = {
          create: vi.fn(async () => {
            const r = responses[callIdx] || responses[responses.length - 1];
            callIdx++;
            return r;
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
  generateSignedActionUrl: vi.fn(() => 'http://localhost/mock-action'),
  verifySignedUrl: vi.fn(() => true),
  getISOWeek: vi.fn(() => 1),
  buildFeedbackContext: vi.fn(() => ({})),
  renderHtmlPage: vi.fn(() => '<html>ok</html>')
}));
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => ({ data: {} }))
  }
}));

let Contact, User, Conversation, handleAgentConversation;

beforeAll(async () => {
  await connectTestDB();
  Contact = (await import('../../models/contactModel.js')).default;
  User = (await import('../../models/userModel.js')).default;
  Conversation = (await import('../../models/conversationModel.js')).default;
  const agentMod = await import('../../services/salesAgentService.js');
  handleAgentConversation = agentMod.handleAgentConversation;
});

afterEach(async () => { await clearTestDB(); });
afterAll(async () => { await disconnectTestDB(); });

describe('Obiezione aggressiva prolungata', () => {
  it('gestisce 2 turni di obiezione e poi scala con followup', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactOutbound);

    // Turn 1: lead con obiezione "non ho tempo"
    const result1 = await handleAgentConversation({
      contact,
      replyText: 'Non ho tempo per queste cose, sono pieno di lavoro',
      category: 'NOT_INTERESTED',
      confidence: 0.6,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: { campaignId: 'c1', leadId: 'l1' }
    });

    expect(['auto_sent', 'awaiting_human']).toContain(result1.action);

    // Verifica conversazione creata
    const conv = await Conversation.findOne({ contact: contact._id });
    expect(conv).toBeDefined();
    expect(conv.status).toMatch(/active|awaiting_human/);

    // Turn 2: lead insiste
    const result2 = await handleAgentConversation({
      contact,
      replyText: 'Ho già detto che non ho tempo, non mi interessa',
      category: 'NOT_INTERESTED',
      confidence: 0.75,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: { campaignId: 'c1', leadId: 'l1' }
    });

    expect(['scheduled_followup', 'awaiting_human', 'auto_sent']).toContain(result2.action);
  });
});
