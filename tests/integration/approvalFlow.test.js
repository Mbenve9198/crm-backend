import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { contactOutbound, ownerUser } from '../setup/fixtures.js';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      constructor() {
        this.messages = {
          create: vi.fn(async (params) => {
            const system = params.system || '';
            if (system.includes('strategist')) {
              return {
                content: [
                  { type: 'thinking', thinking: 'Lead outbound interessato, costruisco rapport.' },
                  { type: 'text', text: JSON.stringify({
                    approach: 'social_proof',
                    mainAngle: 'Ringrazia e mostra caso studio simile',
                    painPointToUse: null,
                    socialProof: { clientName: 'MOOD', data: '100+ rec/mese', menuUrl: null },
                    cta: 'ask_question',
                    ctaDetails: 'Chiedi quante recensioni raccoglie al mese',
                    tone: 'consultivo',
                    maxWords: 100,
                    doNot: ['Spiegare il meccanismo', 'Citare il prezzo'],
                    channelToUse: 'email'
                  }) }
                ],
                stop_reason: 'end_turn',
                usage: { input_tokens: 2000, output_tokens: 300 }
              };
            }
            if (system.includes('Scrivi messaggi a ristoratori')) {
              return {
                content: [{ type: 'text', text: 'Ciao! Grazie per la risposta. Un locale come MOOD raccoglie 100+ recensioni al mese. Quante ne raccogliete voi? A presto, Marco' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 1000, output_tokens: 100 }
              };
            }
            if (system.includes('quality reviewer')) {
              return {
                content: [{ type: 'text', text: '{"pass":true,"violations":[],"feedback":""}' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 800, output_tokens: 50 }
              };
            }
            return { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 50 } };
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
  default: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) }
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

describe('Flusso Approval-First (multi-agent)', () => {
  it('pipeline genera bozza, conversazione awaiting_human', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactOutbound);

    const result = await handleAgentConversation({
      contact,
      replyText: 'Mi interessa saperne di più',
      category: 'INTERESTED',
      confidence: 0.8,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: { campaignId: 'c1', leadId: 'l1' }
    });

    expect(result.action).toBe('awaiting_human');

    const conv = await Conversation.findOne({ contact: contact._id });
    expect(conv).toBeDefined();
    expect(conv.status).toBe('awaiting_human');

    const agentMsg = conv.messages.find(m => m.role === 'agent');
    expect(agentMsg).toBeDefined();
    expect(agentMsg.content.length).toBeGreaterThan(0);
  });
});
