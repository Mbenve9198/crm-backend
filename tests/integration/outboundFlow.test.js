import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { contactInbound, ownerUser } from '../setup/fixtures.js';

vi.mock('@anthropic-ai/sdk', () => {
  let callIdx = 0;
  const responses = [
    // Round 1: agent calls search_similar_clients
    {
      content: [{ type: 'tool_use', id: 'tc1', name: 'search_similar_clients', input: { cuisine_type: 'trattoria', city: 'Napoli' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 5000, output_tokens: 200 }
    },
    // Round 2: agent composes message and calls send_email_reply
    {
      content: [{ type: 'tool_use', id: 'tc2', name: 'send_email_reply', input: {
        message: 'Ciao! Grazie per aver provato il Rank Checker.\n\nHo visto che per "trattoria napoli centro" sei in 15° posizione — chi cerca su Maps vede prima Nennella e Da Michele, che hanno migliaia di recensioni in più.\n\nCon i tuoi 80 coperti al giorno, in sole 2 settimane di test potremmo raccogliere circa 67 nuove recensioni. Un locale simile, Pizzeria Simile a Roma, ha raccolto 170 recensioni in 6 mesi con noi.\n\nIl tuo numero è +393339876543 — posso chiamarti 5 minuti per spiegarti come funziona la prova gratuita?\n\nMarco'
      } }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 7000, output_tokens: 400 }
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
    get: vi.fn(async (url) => {
      if (url.includes('/api/restaurants/similar')) {
        return { data: { restaurants: [{ name: 'Pizzeria Simile', address: { city: 'Roma' }, currentReviewCount: 250, initialReviewCount: 80, reviewsGained: 170, monthsActive: 6, avgReviewsPerMonth: 28, googleRating: { rating: 4.7, reviewCount: 250 }, menuUrl: 'https://menuchat.it/menu/test', menuItemCount: 45, _id: 'sim1' }] } };
      }
      return { data: {} };
    }),
    post: vi.fn(async () => ({ data: {} }))
  }
}));

let Contact, User, Conversation, runAgentLoop;

beforeAll(async () => {
  await connectTestDB();
  Contact = (await import('../../models/contactModel.js')).default;
  User = (await import('../../models/userModel.js')).default;
  Conversation = (await import('../../models/conversationModel.js')).default;
  const agentMod = await import('../../services/salesAgentService.js');
  runAgentLoop = agentMod.runAgentLoop;
});

afterEach(async () => { await clearTestDB(); });
afterAll(async () => { await disconnectTestDB(); });

describe('Outbound Flow con Rank Checker', () => {
  it('crea conversazione, usa tool search_similar_clients, invia email con CTA', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactInbound);

    const conversation = await Conversation.create({
      contact: contact._id,
      channel: 'email',
      status: 'active',
      stage: 'initial_reply',
      agentIdentity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
      context: {
        leadCategory: 'RANK_CHECKER_OUTREACH',
        leadSource: 'inbound_rank_checker',
        restaurantData: { name: contact.name, city: 'Napoli' }
      },
      assignedTo: ownerUser._id
    });

    const result = await runAgentLoop(conversation, '[ISTRUZIONE INTERNA] Primo contatto rank checker');

    expect(result.toolsUsed.length).toBeGreaterThanOrEqual(1);
    const toolNames = result.toolsUsed.map(t => t.name);
    expect(toolNames).toContain('search_similar_clients');
    expect(toolNames).toContain('send_email_reply');

    const sendTool = result.toolsUsed.find(t => t.name === 'send_email_reply');
    expect(sendTool).toBeDefined();
  });
});
