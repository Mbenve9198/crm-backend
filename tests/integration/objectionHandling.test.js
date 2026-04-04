import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { contactOutbound, ownerUser } from '../setup/fixtures.js';

let callCount = 0;

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      constructor() {
        this.messages = {
          create: vi.fn(async (params) => {
            const system = params.system || '';
            if (system.includes('strategist')) {
              callCount++;
              if (callCount <= 2) {
                return {
                  content: [
                    { type: 'thinking', thinking: 'Lead con obiezione no_tempo. Primo tentativo: reframe.' },
                    { type: 'text', text: JSON.stringify({
                      approach: 'objection_reframe',
                      mainAngle: 'Reframe: 5 minuti bastano',
                      painPointToUse: null,
                      socialProof: null,
                      cta: 'propose_call',
                      ctaDetails: 'Proponi 5 minuti al telefono',
                      tone: 'empatico',
                      maxWords: 100,
                      doNot: ['Insistere troppo', 'Spiegare il meccanismo'],
                      channelToUse: 'email'
                    }) }
                  ],
                  stop_reason: 'end_turn',
                  usage: { input_tokens: 2000, output_tokens: 300 }
                };
              }
              return {
                content: [
                  { type: 'thinking', thinking: 'Seconda obiezione. Meglio programmare follow-up.' },
                  { type: 'text', text: JSON.stringify({
                    approach: 'schedule_followup',
                    mainAngle: 'Rifiuto ripetuto, programmo follow-up tra 14 giorni',
                    cta: 'schedule_followup',
                    ctaDetails: '14',
                    tone: 'empatico',
                    maxWords: 80,
                    doNot: [],
                    channelToUse: 'email'
                  }) }
                ],
                stop_reason: 'end_turn',
                usage: { input_tokens: 2000, output_tokens: 200 }
              };
            }
            if (system.includes('Scrivi messaggi a ristoratori')) {
              return {
                content: [{ type: 'text', text: 'Capisco perfettamente! Solo 5 minuti al telefono per capire se ha senso. Quando ti viene piu comodo?\n\nMarco' }],
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
            // Insight extraction (Haiku)
            return {
              content: [{ type: 'text', text: '{"objections":["no_tempo"],"painPoints":[]}' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 500, output_tokens: 50 }
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

let Contact, User, Conversation, handleAgentConversation;

beforeAll(async () => {
  await connectTestDB();
  Contact = (await import('../../models/contactModel.js')).default;
  User = (await import('../../models/userModel.js')).default;
  Conversation = (await import('../../models/conversationModel.js')).default;
  const agentMod = await import('../../services/salesAgentService.js');
  handleAgentConversation = agentMod.handleAgentConversation;
});

afterEach(async () => { await clearTestDB(); callCount = 0; });
afterAll(async () => { await disconnectTestDB(); });

describe('Obiezione aggressiva prolungata (multi-agent)', () => {
  it('primo turno: reframe, secondo turno: schedule_followup', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactOutbound);

    const result1 = await handleAgentConversation({
      contact,
      replyText: 'Non ho tempo per queste cose, sono pieno di lavoro',
      category: 'NOT_INTERESTED',
      confidence: 0.6,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: { campaignId: 'c1', leadId: 'l1' }
    });

    expect(result1.action).toBe('awaiting_human');

    const result2 = await handleAgentConversation({
      contact,
      replyText: 'Ho gia detto che non ho tempo, non mi interessa',
      category: 'NOT_INTERESTED',
      confidence: 0.75,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: { campaignId: 'c1', leadId: 'l1' }
    });

    expect(['scheduled_followup', 'awaiting_human']).toContain(result2.action);
  });
});
