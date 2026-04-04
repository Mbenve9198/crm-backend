import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { contactOutbound, ownerUser } from '../setup/fixtures.js';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      constructor() {
        this.messages = {
          create: vi.fn(async () => {
            throw new Error('429 rate_limit_error: Too many requests');
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
  replyToEmailThread: vi.fn(async () => ({ success: false, error: 'SmartLead timeout' })),
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
    get: vi.fn(async () => { throw new Error('SerpAPI timeout'); }),
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

describe('Resilienza errori API', () => {
  it('Anthropic 429 -> conversazione awaiting_human, lock rilasciato', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactOutbound);

    const result = await handleAgentConversation({
      contact,
      replyText: 'Mi interessa, raccontatemi di più',
      category: 'INTERESTED',
      confidence: 0.8,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: { campaignId: 'c1', leadId: 'l1' }
    });

    expect(result.action).toBe('error');
    expect(result.error).toContain('429');

    const conv = await Conversation.findOne({ contact: contact._id });
    expect(conv).toBeDefined();
    expect(conv.status).toBe('awaiting_human');
  });

  it('il lock viene rilasciato anche dopo errore (no deadlock)', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactOutbound);

    // Prima chiamata: errore
    await handleAgentConversation({
      contact,
      replyText: 'Test 1',
      category: 'NEUTRAL',
      confidence: 0.5,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: {}
    });

    // Seconda chiamata: NON deve essere bloccata dal lock
    const result2 = await handleAgentConversation({
      contact,
      replyText: 'Test 2',
      category: 'NEUTRAL',
      confidence: 0.5,
      extracted: {},
      fromEmail: 'marco@menuchat.it',
      webhookBasic: {}
    });

    expect(result2.action).not.toBe('locked');
  });
});
