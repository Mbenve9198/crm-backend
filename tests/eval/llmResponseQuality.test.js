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
                  { type: 'thinking', thinking: 'Lead rank checker con posizione 15. Pain point: bassa visibilita, competitor forti. Social proof: MOOD.' },
                  { type: 'text', text: JSON.stringify({
                    approach: 'pain_point_leverage',
                    mainAngle: 'Posizione 15 su Maps con competitor forti davanti',
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
                content: [{ type: 'text', text: 'Ciao! Ho visto i tuoi dati — per "trattoria napoli centro" sei in 15a posizione, con Nennella e Da Michele davanti che hanno migliaia di recensioni.\n\nUn locale come MOOD raccoglie piu di 100 recensioni al mese.\n\nIl tuo numero e +393339876543 — posso chiamarti 5 minuti per la prova gratuita?\n\nMarco' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 1000, output_tokens: 150 }
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
  generateSignedActionUrl: vi.fn(() => 'http://localhost/mock'),
  verifySignedUrl: vi.fn(() => true),
  getISOWeek: vi.fn(() => 1),
  buildFeedbackContext: vi.fn(() => ({})),
  renderHtmlPage: vi.fn(() => '<html>ok</html>')
}));
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async (url) => {
      if (url.includes('serpapi.com')) return { data: { place_results: { title: 'Trattoria Bella Napoli', rating: 4.1, reviews: 62 } } };
      if (url.includes('/api/restaurants/similar')) return { data: { restaurants: [] } };
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

const evaluateResponse = (response) => {
  const wordCount = response.split(/\s+/).length;
  const scores = {};
  scores.brevita = wordCount <= 120 ? 5 : wordCount <= 150 ? 3 : 1;
  scores.cta = /chiam|telefono|numero|posso chiamarti|prova gratuita/i.test(response) ? 5 : 1;
  scores.firma = /Marco|Federico/i.test(response) ? 5 : 1;
  scores.noVideoCall = !/zoom|meet|videochiamata|google meet/i.test(response) ? 5 : 1;
  scores.noPrezzoFalso = !/39€|€39|€ 39|39 euro al mese/i.test(response) ? 5 : 1;
  scores.noMeccanismo = !/QR code sui.*tavoli|filtro intelligente|WhatsApp.*bot/i.test(response) ? 5 : 1;
  scores.italiano = /ciao|grazie|buongiorno|salve|prova|recensioni|ristorante/i.test(response) ? 5 : 1;
  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
  return { scores, avg, wordCount };
};

describe('LLM Response Quality (multi-agent pipeline)', () => {
  it('risposta outreach rank checker supera soglia qualita', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactInbound);

    const conv = new Conversation({
      contact: contact._id, channel: 'email', status: 'active', stage: 'initial_reply',
      agentIdentity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
      context: { leadCategory: 'RANK_CHECKER_OUTREACH', leadSource: 'inbound_rank_checker', restaurantData: { name: contact.name, city: 'Napoli' } },
      assignedTo: ownerUser._id
    });
    await conv.save();

    const result = await runAgentLoop(conv, '[ISTRUZIONE INTERNA] Primo contatto rank checker');

    expect(result.response).toBeDefined();
    const evaluation = evaluateResponse(result.response);
    console.log('Evaluation scores:', evaluation);

    expect(evaluation.avg).toBeGreaterThanOrEqual(3.5);
    expect(evaluation.scores.cta).toBeGreaterThanOrEqual(3);
    expect(evaluation.scores.noVideoCall).toBe(5);
    expect(evaluation.scores.noPrezzoFalso).toBe(5);
    expect(evaluation.scores.noMeccanismo).toBe(5);
    expect(evaluation.scores.firma).toBe(5);
  });

  it('pipeline produce strategia JSON con campi obbligatori', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactInbound);

    const conv = new Conversation({
      contact: contact._id, channel: 'email', status: 'active', stage: 'initial_reply',
      agentIdentity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
      context: { leadCategory: 'INTERESTED', leadSource: 'inbound_rank_checker' },
      assignedTo: ownerUser._id
    });
    await conv.save();

    const result = await runAgentLoop(conv, 'Come funziona?');
    expect(result.strategy).toBeDefined();
    expect(result.strategy.approach).toBeDefined();
    expect(result.strategy.cta).toBeDefined();
    expect(result.strategy.tone).toBeDefined();
    expect(result.strategy.doNot).toBeDefined();
  });
});
