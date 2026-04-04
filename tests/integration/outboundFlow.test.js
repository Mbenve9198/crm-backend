import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { contactInbound, ownerUser } from '../setup/fixtures.js';

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
                  { type: 'thinking', thinking: 'Il lead ha posizione 15, competitor forti. Uso pain_point_leverage + social_proof.' },
                  { type: 'text', text: JSON.stringify({
                    approach: 'pain_point_leverage',
                    mainAngle: 'Posizione 15 su Maps, competitor con migliaia di recensioni davanti',
                    painPointToUse: 'bassa_visibilita',
                    socialProof: { clientName: 'MOOD', data: 'piu di 100 recensioni/mese', menuUrl: null },
                    cta: 'confirm_number',
                    ctaDetails: 'Conferma +393339876543',
                    tone: 'consultivo',
                    maxWords: 80,
                    doNot: ['Spiegare come funziona il sistema', 'Citare il prezzo'],
                    channelToUse: 'email'
                  }) }
                ],
                stop_reason: 'end_turn',
                usage: { input_tokens: 2000, output_tokens: 300 }
              };
            }
            if (system.includes('Scrivi messaggi a ristoratori')) {
              return {
                content: [{ type: 'text', text: 'Ciao! Ho visto i tuoi dati dal Rank Checker — per "trattoria napoli centro" sei in 15° posizione, con Nennella e Da Michele davanti.\n\nUn locale come MOOD raccoglie piu di 100 recensioni al mese con il nostro sistema.\n\nIl tuo numero e\' +393339876543 — posso chiamarti 5 minuti per spiegarti come funziona la prova gratuita?\n\nMarco' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 1000, output_tokens: 200 }
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
  default: {
    get: vi.fn(async (url) => {
      if (url.includes('serpapi.com')) {
        return { data: { place_results: { title: 'Trattoria Bella Napoli', rating: 4.1, reviews: 62, address: 'Via Toledo 45, Napoli' } } };
      }
      if (url.includes('/api/restaurants/similar')) {
        return { data: { restaurants: [] } };
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

describe('Outbound Flow con Rank Checker (multi-agent)', () => {
  it('pipeline: researcher -> strategist -> writer -> reviewer -> bozza salvata', async () => {
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

    expect(result.response).toBeDefined();
    expect(result.response.length).toBeGreaterThan(0);

    const conv = await Conversation.findById(conversation._id);
    expect(conv.status).toBe('awaiting_human');

    const agentMsg = conv.messages.find(m => m.role === 'agent');
    expect(agentMsg).toBeDefined();
    expect(agentMsg.content).toContain('Marco');

    expect(result.toolsUsed.some(t => t.name === 'send_email_reply' && t.result?.draft === true)).toBe(true);
  });
});
