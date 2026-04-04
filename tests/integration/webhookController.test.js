import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { ownerUser, webhookEmailReply, webhookDNC, webhookOOO } from '../setup/fixtures.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = {
        create: vi.fn(async (params) => {
          const content = params.messages?.[0]?.content || '';
          if (content.includes('CLASSIFICARE')) {
            return {
              content: [{ type: 'text', text: '{"category":"INTERESTED","confidence":0.85,"reason":"Lead chiede info","extracted":{"phone":null}}' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1000, output_tokens: 100 }
            };
          }
          return {
            content: [{ type: 'text', text: 'Ciao, grazie per la risposta!' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 3000, output_tokens: 150 }
          };
        })
      };
    }
  }
}));

vi.mock('../../config/redis.js', () => ({ default: { isAvailable: () => false, getClient: () => null } }));
vi.mock('../../services/emailNotificationService.js', () => ({
  sendSmartleadInterestedNotification: vi.fn(async () => ({ success: true })),
  sendAgentActivityReport: vi.fn(async () => {}),
  sendAgentHumanReviewEmail: vi.fn(async () => ({ success: true }))
}));

const mockUpdateCategory = vi.fn(async () => ({ success: true }));
const mockResumeLead = vi.fn(async () => ({ success: true }));
const mockFetchLeadByEmail = vi.fn(async () => ({
  id: 555, email: 'mario@pizzeriadamario.it', company_name: 'Pizzeria Da Mario',
  first_name: 'Mario', last_name: 'Rossi', phone_number: '+393401234567',
  location: 'Roma', custom_fields: { rating_prospect: '4.2' }
}));

vi.mock('../../services/smartleadApiService.js', () => ({
  fetchMessageHistory: vi.fn(async () => []),
  fetchLeadByEmail: mockFetchLeadByEmail,
  replyToEmailThread: vi.fn(async () => ({ success: true })),
  updateLeadCategory: mockUpdateCategory,
  resumeLead: mockResumeLead,
  mapAiCategoryToSmartlead: vi.fn((cat) => {
    const map = { INTERESTED: { smartleadCategory: 'Interested', shouldPause: true }, DO_NOT_CONTACT: { smartleadCategory: 'Do Not Contact', shouldPause: true }, OUT_OF_OFFICE: { smartleadCategory: 'Out Of Office', shouldPause: false } };
    return map[cat] || { smartleadCategory: null, shouldPause: false };
  }),
  extractLeadId: vi.fn((d) => d.sl_email_lead_id || null),
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

let User, Contact, handleSmartleadWebhook;

beforeAll(async () => {
  await connectTestDB();
  User = (await import('../../models/userModel.js')).default;
  Contact = (await import('../../models/contactModel.js')).default;
  const ctrl = await import('../../controllers/smartleadWebhookController.js');
  handleSmartleadWebhook = ctrl.handleSmartleadWebhook;
});

afterEach(async () => { await clearTestDB(); });
afterAll(async () => { await disconnectTestDB(); });

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.send = (data) => { res.body = data; return res; };
  return res;
};

describe('Webhook Controller', () => {
  it('webhook con secret valido -> 200', async () => {
    process.env.SMARTLEAD_WEBHOOK_SECRET = 'test-secret';
    await User.create(ownerUser);
    const req = { body: webhookEmailReply, headers: { 'x-webhook-secret': 'test-secret' }, query: {} };
    const res = mockRes();
    await handleSmartleadWebhook(req, res);
    expect(res.statusCode).toBe(200);
    process.env.SMARTLEAD_WEBHOOK_SECRET = '';
  });

  it('webhook con secret invalido -> 403', async () => {
    process.env.SMARTLEAD_WEBHOOK_SECRET = 'correct-secret';
    const req = { body: webhookEmailReply, headers: { 'x-webhook-secret': 'wrong' }, query: {} };
    const res = mockRes();
    await handleSmartleadWebhook(req, res);
    expect(res.statusCode).toBe(403);
    process.env.SMARTLEAD_WEBHOOK_SECRET = '';
  });

  it('webhook senza secret configurato -> 200 (nessun check)', async () => {
    process.env.SMARTLEAD_WEBHOOK_SECRET = '';
    await User.create(ownerUser);
    const req = { body: { ...webhookEmailReply, event_timestamp: Date.now().toString() }, headers: {}, query: {} };
    const res = mockRes();
    await handleSmartleadWebhook(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('webhook duplicato -> skip', async () => {
    process.env.SMARTLEAD_WEBHOOK_SECRET = '';
    await User.create(ownerUser);
    const ts = Date.now().toString();
    const payload = { ...webhookEmailReply, event_timestamp: ts + '_dup_test' };

    const req1 = { body: payload, headers: {}, query: {} };
    const res1 = mockRes();
    await handleSmartleadWebhook(req1, res1);
    expect(res1.statusCode).toBe(200);

    const req2 = { body: payload, headers: {}, query: {} };
    const res2 = mockRes();
    await handleSmartleadWebhook(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.message).toBe('duplicate_skipped');
  });

  it('EMAIL_REPLY interessato -> crea contatto nel CRM', async () => {
    process.env.SMARTLEAD_WEBHOOK_SECRET = '';
    await User.create(ownerUser);
    const payload = { ...webhookEmailReply, event_timestamp: 'interested_test_' + Date.now() };
    const req = { body: payload, headers: {}, query: {} };
    const res = mockRes();
    await handleSmartleadWebhook(req, res);
    expect(res.statusCode).toBe(200);

    const contact = await Contact.findOne({ email: webhookEmailReply.to_email });
    expect(contact).toBeDefined();
    expect(contact.source).toBe('smartlead_outbound');
  });
});
