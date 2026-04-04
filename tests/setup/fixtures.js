import mongoose from 'mongoose';

const oid = () => new mongoose.Types.ObjectId();

export const OWNER_ID = oid();
export const CONTACT_OUTBOUND_ID = oid();
export const CONTACT_INBOUND_ID = oid();
export const CONVERSATION_ID = oid();

export const ownerUser = {
  _id: OWNER_ID,
  email: 'marco@menuchat.com',
  firstName: 'Marco',
  lastName: 'Benvenuti',
  role: 'admin',
  isActive: true,
  password: '$2a$10$dummyhashedpasswordfortesting1234567890abcde'
};

export const contactOutbound = {
  _id: CONTACT_OUTBOUND_ID,
  name: 'Pizzeria Da Mario',
  email: 'mario@pizzeriadamario.it',
  phone: '+393401234567',
  lists: ['Smartlead Outbound Email'],
  status: 'da contattare',
  source: 'smartlead_outbound',
  owner: OWNER_ID,
  createdBy: OWNER_ID,
  properties: {
    city: 'Roma',
    location: 'Roma',
    rating: '4.2',
    reviews_count: '85',
    google_maps_link: 'https://maps.google.com/?cid=123',
    site: 'https://pizzeriadamario.it',
    category: 'Pizzeria',
    smartlead_campaign_id: 'campaign_101',
    smartlead_campaign_name: 'Q1 Ristoranti Roma',
    smartlead_lead_id: 'sl_lead_555'
  }
};

export const contactInbound = {
  _id: CONTACT_INBOUND_ID,
  name: 'Trattoria Bella Napoli',
  email: 'info@bellanapoli.it',
  phone: '+393339876543',
  lists: ['Inbound - Rank Checker'],
  status: 'da contattare',
  source: 'inbound_rank_checker',
  owner: OWNER_ID,
  createdBy: OWNER_ID,
  properties: {
    location: 'Napoli',
    city: 'Napoli'
  },
  rankCheckerData: {
    keyword: 'trattoria napoli centro',
    dailyCovers: 80,
    hasDigitalMenu: false,
    estimatedMonthlyReviews: 15,
    restaurantData: {
      name: 'Trattoria Bella Napoli',
      rating: 4.1,
      reviewCount: 62,
      address: 'Via Toledo 45, Napoli, NA'
    },
    ranking: {
      mainRank: 15,
      competitorsAhead: 14,
      estimatedLostCustomers: 35,
      fullResults: {
        mainResult: { rank: 15 },
        competitors: [
          { name: 'Trattoria Nennella', rank: 1, reviews: 4200 },
          { name: 'Da Michele', rank: 2, reviews: 12000 },
          { name: 'Sorbillo', rank: 3, reviews: 8500 }
        ]
      }
    }
  }
};

export const webhookEmailReply = {
  event_type: 'EMAIL_REPLY',
  to_email: 'mario@pizzeriadamario.it',
  to_name: 'Pizzeria Da Mario',
  from_email: 'marco@menuchat.it',
  campaign_id: 'campaign_101',
  campaign_name: 'Q1 Ristoranti Roma',
  sl_email_lead_id: 'sl_lead_555',
  subject: 'Re: Pizzeria Da Mario — posizione su Google Maps',
  reply_message: {
    text: 'Buongiorno, mi interessa saperne di più. Come funziona?',
    html: '<p>Buongiorno, mi interessa saperne di più. Come funziona?</p>'
  },
  event_timestamp: new Date().toISOString()
};

export const webhookDNC = {
  event_type: 'EMAIL_REPLY',
  to_email: 'angry@ristorante.it',
  to_name: 'Ristorante Angry',
  from_email: 'marco@menuchat.it',
  campaign_id: 'campaign_101',
  campaign_name: 'Q1 Ristoranti Roma',
  sl_email_lead_id: 'sl_lead_999',
  subject: 'Re: test',
  reply_message: { text: 'Non contattatemi più, cancellate i miei dati' },
  event_timestamp: new Date().toISOString()
};

export const webhookOOO = {
  event_type: 'EMAIL_REPLY',
  to_email: 'vacanza@ristorante.it',
  to_name: 'Ristorante Vacanza',
  from_email: 'marco@menuchat.it',
  campaign_id: 'campaign_101',
  campaign_name: 'Q1 Ristoranti Roma',
  sl_email_lead_id: 'sl_lead_888',
  subject: 'Re: test',
  reply_message: { text: 'Sono fuori ufficio fino al 15 gennaio. Risponderò al mio ritorno.' },
  event_timestamp: new Date().toISOString()
};

export const conversationActive = {
  _id: CONVERSATION_ID,
  contact: CONTACT_OUTBOUND_ID,
  channel: 'email',
  status: 'active',
  stage: 'initial_reply',
  agentIdentity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
  messages: [
    { role: 'lead', content: 'Mi interessa saperne di più', channel: 'email', createdAt: new Date() }
  ],
  context: {
    leadCategory: 'INTERESTED',
    leadSource: 'smartlead_outbound',
    smartleadData: { campaignId: 'campaign_101', leadId: 'sl_lead_555' },
    restaurantData: { name: 'Pizzeria Da Mario', city: 'Roma' },
    objections: [],
    painPoints: []
  },
  metrics: { messagesCount: 1, agentMessagesCount: 0 },
  assignedTo: OWNER_ID
};

export const conversationAwaitingHuman = {
  ...conversationActive,
  _id: oid(),
  status: 'awaiting_human',
  messages: [
    { role: 'lead', content: 'Quanto costa il servizio?', channel: 'email', createdAt: new Date(Date.now() - 60000) },
    { role: 'agent', content: 'Il listino è 1.290€ annuale, ma partiamo con 2 settimane di prova gratuita...', channel: 'email', metadata: { wasAutoSent: false, isDraft: true }, createdAt: new Date() }
  ],
  metrics: { messagesCount: 2, agentMessagesCount: 1 }
};
