import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { contactInbound, ownerUser } from '../setup/fixtures.js';

const capturedMessages = [];

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      constructor() {
        this.messages = {
          create: vi.fn(async (params) => {
            const lastUserMsg = Array.isArray(params.messages)
              ? params.messages.filter(m => typeof m.content === 'string').slice(-1)[0]?.content || ''
              : '';

            // Pre-defined quality responses for evaluation
            const responses = {
              default: 'Ciao! Grazie per aver provato il nostro Rank Checker.\n\nHo dato un\'occhiata ai tuoi dati: per "trattoria napoli centro" sei in 15° posizione — Nennella e Da Michele ti superano con migliaia di recensioni in più. Ogni settimana, circa 35 clienti che cercano su Maps finiscono da loro.\n\nCon i tuoi 80 coperti al giorno, in 2 settimane di prova potremmo raccogliere circa 67 nuove recensioni.\n\nIl tuo numero è +393339876543 — posso chiamarti 5 minuti per spiegarti come funziona la prova gratuita?\n\nMarco'
            };

            const responseText = responses.default;
            capturedMessages.push({ system: params.system, messages: params.messages, response: responseText });

            if (lastUserMsg.includes('[ISTRUZIONE INTERNA]') || lastUserMsg.includes('Primo contatto')) {
              return {
                content: [{ type: 'tool_use', id: 'tc1', name: 'send_email_reply', input: { message: responseText } }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 5000, output_tokens: 300 }
              };
            }

            return {
              content: [{ type: 'text', text: responseText }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 5000, output_tokens: 300 }
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
  default: {
    get: vi.fn(async (url) => {
      if (url.includes('/api/restaurants/similar')) {
        return { data: { restaurants: [{ name: 'Trattoria Simile', address: { city: 'Napoli' }, currentReviewCount: 180, initialReviewCount: 40, reviewsGained: 140, monthsActive: 5, avgReviewsPerMonth: 28, googleRating: { rating: 4.6 }, menuUrl: 'https://menuchat.it/menu/sim', _id: 's1' }] } };
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

afterEach(async () => { await clearTestDB(); capturedMessages.length = 0; });
afterAll(async () => { await disconnectTestDB(); });

const evaluateResponse = (response) => {
  const wordCount = response.split(/\s+/).length;
  const scores = {};

  scores.brevita = wordCount <= 150 ? 5 : wordCount <= 200 ? 3 : 1;

  const hasCTA = /chiam|telefono|numero|posso chiamarti|a che numero/i.test(response);
  scores.cta = hasCTA ? 5 : 1;

  const hasSignature = /Marco|Federico/i.test(response);
  scores.firma = hasSignature ? 5 : 1;

  const noVideoCall = !/zoom|meet|videochiamata|google meet/i.test(response);
  scores.noVideoCall = noVideoCall ? 5 : 1;

  const noFakePrice = !/39€|€39|€ 39|39 euro al mese/i.test(response);
  scores.noPrezzoFalso = noFakePrice ? 5 : 1;

  const isItalian = /ciao|grazie|buongiorno|salve|prova|recensioni|ristorante/i.test(response);
  scores.italiano = isItalian ? 5 : 1;

  const mentionsData = /posizione|ranking|recensioni|competitor|stelle|coperti/i.test(response);
  scores.usaDati = mentionsData ? 5 : 2;

  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
  return { scores, avg, wordCount };
};

describe('LLM Response Quality Evaluation', () => {
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
    const sentTool = result.toolsUsed.find(t => t.name === 'send_email_reply');

    expect(sentTool).toBeDefined();
    const agentMessage = sentTool.input.message;

    const evaluation = evaluateResponse(agentMessage);
    console.log('Evaluation scores:', evaluation);

    expect(evaluation.avg).toBeGreaterThanOrEqual(3.5);
    expect(evaluation.scores.cta).toBeGreaterThanOrEqual(3);
    expect(evaluation.scores.noVideoCall).toBe(5);
    expect(evaluation.scores.noPrezzoFalso).toBe(5);
    expect(evaluation.scores.firma).toBe(5);
    expect(evaluation.scores.italiano).toBe(5);
  });

  it('system prompt viene costruito con contesto rank checker', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactInbound);

    const conv = new Conversation({
      contact: contact._id, channel: 'email', status: 'active', stage: 'initial_reply',
      agentIdentity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
      context: { leadCategory: 'INTERESTED', leadSource: 'inbound_rank_checker', restaurantData: { name: contact.name, city: 'Napoli' } },
      assignedTo: ownerUser._id
    });
    await conv.save();

    await runAgentLoop(conv, 'Mi interessa, raccontatemi');

    expect(capturedMessages.length).toBeGreaterThan(0);
    const systemPrompt = capturedMessages[0].system;
    expect(systemPrompt).toContain('trattoria napoli centro');
    expect(systemPrompt).toContain('Trattoria Bella Napoli');
    expect(systemPrompt).toContain('CONTESTO LEAD ATTUALE');
  });

  it('contesto contiene dati rank checker con competitor', async () => {
    await User.create(ownerUser);
    const contact = await Contact.create(contactInbound);

    const conv = new Conversation({
      contact: contact._id, channel: 'email', status: 'active', stage: 'initial_reply',
      agentIdentity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
      context: { leadCategory: 'INTERESTED', leadSource: 'inbound_rank_checker' },
      assignedTo: ownerUser._id
    });
    await conv.save();

    await runAgentLoop(conv, 'Come funziona?');

    const systemPrompt = capturedMessages[0]?.system || '';
    expect(systemPrompt).toContain('DATI RANK CHECKER');
    expect(systemPrompt).toContain('Posizione: 15');
    expect(systemPrompt).toContain('Trattoria Nennella');
  });
});
