import { vi } from 'vitest';

// -- Anthropic Mock Factory --

export const createAnthropicMock = (responses) => {
  let callIndex = 0;
  return {
    default: class Anthropic {
      constructor() {
        this.messages = {
          create: vi.fn(async () => {
            const r = responses[callIndex] || responses[responses.length - 1];
            callIndex++;
            return r;
          })
        };
      }
    }
  };
};

export const makeTextResponse = (text) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 3000, output_tokens: 200 }
});

export const makeToolUseResponse = (toolName, input, id = 'tool_1') => ({
  content: [{ type: 'tool_use', id, name: toolName, input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 3000, output_tokens: 150 }
});

export const makeToolThenTextResponse = (toolName, input, text) => [
  makeToolUseResponse(toolName, input),
  makeTextResponse(text)
];

// -- SmartLead API Mock --

export const smartleadMocks = {
  fetchMessageHistory: vi.fn(async () => [
    { type: 'SENT', subject: 'Test campagna', email_body: '<p>Ciao, ho visto il tuo ristorante...</p>', stats_id: 'stats_1' },
    { type: 'REPLY', subject: 'Re: Test campagna', email_body: '<p>Mi interessa, dimmi di più</p>', stats_id: 'stats_2' }
  ]),
  replyToEmailThread: vi.fn(async () => ({ success: true, data: {} })),
  fetchLeadByEmail: vi.fn(async () => ({
    id: 12345,
    email: 'test@ristorante.it',
    company_name: 'Pizzeria Test',
    first_name: 'Mario',
    last_name: 'Rossi',
    phone_number: '+393401234567',
    location: 'Roma',
    custom_fields: { rating_prospect: '4.2', reviews_prospect: '85' },
    lead_campaign_data: [{ last_email_sequence_sent: 1 }]
  })),
  updateLeadCategory: vi.fn(async () => ({ success: true })),
  resumeLead: vi.fn(async () => ({ success: true })),
  mapAiCategoryToSmartlead: vi.fn((cat) => {
    const map = { INTERESTED: { smartleadCategory: 'Interested', shouldPause: true }, NOT_INTERESTED: { smartleadCategory: 'Not Interested', shouldPause: true }, DO_NOT_CONTACT: { smartleadCategory: 'Do Not Contact', shouldPause: true }, OUT_OF_OFFICE: { smartleadCategory: 'Out Of Office', shouldPause: false }, NEUTRAL: { smartleadCategory: 'Information Request', shouldPause: true } };
    return map[cat] || { smartleadCategory: null, shouldPause: false };
  }),
  extractLeadId: vi.fn((data) => data.sl_email_lead_id || data.lead_id || null),
  stripHtml: vi.fn((html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
};

// -- Resend Mock --

export const resendSentEmails = [];
export const resendMock = {
  emails: {
    send: vi.fn(async (params) => {
      resendSentEmails.push(params);
      return { data: { id: `resend_${Date.now()}` } };
    })
  }
};

// -- WhatsApp Mock --

export const whatsappSentMessages = [];
export const whatsappMocks = {
  sendWhatsAppTemplate: vi.fn(async (phone, contentSid, vars) => {
    whatsappSentMessages.push({ type: 'template', phone, contentSid, vars });
    return { success: true, messageSid: `wa_${Date.now()}` };
  }),
  sendWhatsAppMessage: vi.fn(async (phone, message) => {
    whatsappSentMessages.push({ type: 'session', phone, message });
    return { success: true, messageSid: `wa_${Date.now()}` };
  })
};

// -- Axios Mock (SerpAPI + MenuChat backend) --

export const createAxiosMock = (overrides = {}) => {
  const defaultGet = async (url, config) => {
    if (url.includes('serpapi.com')) {
      return {
        data: {
          local_results: [
            { title: 'Pizzeria Test', position: 12, rating: 4.2, reviews: 85, place_id: 'place_1', type: 'Pizzeria' },
            { title: 'Competitor Uno', position: 1, rating: 4.8, reviews: 320, place_id: 'place_2', type: 'Pizzeria' },
            { title: 'Competitor Due', position: 2, rating: 4.6, reviews: 210, place_id: 'place_3', type: 'Pizzeria' }
          ]
        }
      };
    }
    if (url.includes('/api/restaurants/similar')) {
      return {
        data: {
          restaurants: [
            { name: 'Pizzeria Simile', address: { city: 'Roma' }, currentReviewCount: 250, initialReviewCount: 80, reviewsGained: 170, monthsActive: 6, avgReviewsPerMonth: 28, googleRating: { rating: 4.7, reviewCount: 250 }, menuUrl: 'https://menuchat.it/menu/test123', menuItemCount: 45, _id: 'sim_1' }
          ]
        }
      };
    }
    return { data: {} };
  };

  return {
    default: {
      get: vi.fn(overrides.get || defaultGet),
      post: vi.fn(overrides.post || (async () => ({ data: {} }))),
      create: vi.fn(() => ({ get: vi.fn(defaultGet), post: vi.fn(async () => ({ data: {} })) }))
    }
  };
};

// -- Redis Mock --

export const redisMock = {
  default: {
    isAvailable: vi.fn(() => false),
    getClient: vi.fn(() => null),
    initialize: vi.fn(async () => null),
    disconnect: vi.fn(async () => {})
  }
};

// -- Email Notification Mock --

export const notificationsSent = [];
export const emailNotificationMocks = {
  sendSmartleadInterestedNotification: vi.fn(async (data) => { notificationsSent.push({ type: 'interested', ...data }); return { success: true }; }),
  sendAgentHumanReviewEmail: vi.fn(async (data) => { notificationsSent.push({ type: 'review', ...data }); return { success: true }; }),
  sendAgentActivityReport: vi.fn(async (data) => { notificationsSent.push({ type: 'report', ...data }); })
};

// -- Agent Logger Mock --

export const logEntries = [];
export const agentLoggerMock = {
  default: {
    info: vi.fn((event, data) => logEntries.push({ level: 'info', event, ...data })),
    warn: vi.fn((event, data) => logEntries.push({ level: 'warn', event, ...data })),
    error: vi.fn((event, data) => logEntries.push({ level: 'error', event, ...data }))
  }
};

// -- Reset all mocks --

export const resetAllMocks = () => {
  resendSentEmails.length = 0;
  whatsappSentMessages.length = 0;
  notificationsSent.length = 0;
  logEntries.length = 0;
  vi.clearAllMocks();
};
