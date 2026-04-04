import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { contactOutbound, ownerUser } from '../setup/fixtures.js';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      constructor() {
        this.messages = {
          create: vi.fn(async () => ({
            content: [{ type: 'tool_use', id: 'tc1', name: 'send_email_reply', input: {
              message: 'Ciao! Grazie per la risposta. Ti chiamo 5 minuti per spiegarti la prova gratuita?\n\nMarco'
            } }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5000, output_tokens: 200 }
          }))
        };
      }
    }
  };
});

vi.mock('../../config/redis.js', () => ({ default: { isAvailable: () => false, getClient: () => null } }));

const mockSendReview = vi.fn(async () => ({ success: true }));
const mockSendReport = vi.fn(async () => {});
vi.mock('../../services/emailNotificationService.js', () => ({
  sendAgentActivityReport: mockSendReport,
  sendAgentHumanReviewEmail: mockSendReview
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
  generateSignedActionUrl: vi.fn((id, action) => `http://localhost:3099/api/agent/email-action?id=${id}&action=${action}&exp=999&token=test`),
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
  process.env.AGENT_APPROVAL_MODE = 'true';
  await connectTestDB();
  Contact = (await import('../../models/contactModel.js')).default;
  User = (await import('../../models/userModel.js')).default;
  Conversation = (await import('../../models/conversationModel.js')).default;
  const agentMod = await import('../../services/salesAgentService.js');
  handleAgentConversation = agentMod.handleAgentConversation;
});

afterEach(async () => { await clearTestDB(); });
afterAll(async () => {
  process.env.AGENT_APPROVAL_MODE = 'false';
  await disconnectTestDB();
});

describe('Flusso Approval-First', () => {
  it('APPROVAL_MODE=true -> bozza salvata, non inviata, conversazione awaiting_human', async () => {
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
    expect(agentMsg.metadata.wasAutoSent).toBe(false);
  });
});
