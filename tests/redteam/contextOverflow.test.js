import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { ownerUser, OWNER_ID } from '../setup/fixtures.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = {
        create: vi.fn(async () => ({
          content: [{ type: 'text', text: 'Grazie per il messaggio. Posso chiamarti?\n\nMarco' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5000, output_tokens: 100 }
        }))
      };
    }
  }
}));

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

let Conversation, Contact, User;

beforeAll(async () => {
  await connectTestDB();
  Conversation = (await import('../../models/conversationModel.js')).default;
  Contact = (await import('../../models/contactModel.js')).default;
  User = (await import('../../models/userModel.js')).default;
});

afterEach(async () => { await clearTestDB(); });
afterAll(async () => { await disconnectTestDB(); });

describe('Context Overflow', () => {
  it('getConversationThread(15) tronca messaggi a 15', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create({
      name: 'Test Overflow', email: 'overflow@test.it', source: 'manual', owner: OWNER_ID, createdBy: OWNER_ID,
      password: '$2a$10$dummy'
    });

    const conv = new Conversation({
      contact: contact._id, channel: 'email', status: 'active', stage: 'initial_reply',
      context: { leadSource: 'smartlead_outbound' }, assignedTo: OWNER_ID
    });

    for (let i = 0; i < 30; i++) {
      conv.addMessage(i % 2 === 0 ? 'lead' : 'agent', `Messaggio numero ${i}`, 'email');
    }
    await conv.save();

    const thread = conv.getConversationThread(15);
    expect(thread).toHaveLength(15);
    expect(thread[0].content).toContain('Messaggio numero 15');
  });

  it('messaggio lungo viene troncato dallo schema (maxLength 4000)', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create({
      name: 'Test Long', email: 'long@test.it', source: 'manual', owner: OWNER_ID, createdBy: OWNER_ID,
      password: '$2a$10$dummy'
    });

    const conv = new Conversation({
      contact: contact._id, channel: 'email', status: 'active', stage: 'initial_reply',
      context: { leadSource: 'smartlead_outbound' }, assignedTo: OWNER_ID
    });

    const longText = 'A'.repeat(50000);
    conv.addMessage('lead', longText.substring(0, 4000), 'email');
    await conv.save();

    const saved = await Conversation.findById(conv._id);
    expect(saved.messages[0].content.length).toBeLessThanOrEqual(4000);
  });

  it('conversazione con 30 messaggi non causa errori nel getConversationThread', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create({
      name: 'Test Many', email: 'many@test.it', source: 'manual', owner: OWNER_ID, createdBy: OWNER_ID,
      password: '$2a$10$dummy'
    });

    const conv = new Conversation({
      contact: contact._id, channel: 'email', status: 'active', stage: 'initial_reply',
      context: { leadSource: 'smartlead_outbound' }, assignedTo: OWNER_ID
    });

    for (let i = 0; i < 30; i++) {
      conv.addMessage(i % 2 === 0 ? 'lead' : 'agent', `Msg ${i}: ${'X'.repeat(200)}`, 'email');
    }
    await conv.save();

    const thread = conv.getConversationThread(15);
    expect(thread).toHaveLength(15);

    const roles = thread.map(m => m.role);
    expect(roles.every(r => r === 'user' || r === 'assistant')).toBe(true);
  });
});
