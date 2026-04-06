/**
 * Test: Verifica quali dati del CRM arrivano all'agente durante la riattivazione.
 *
 * Scenario: lead vecchio con storico ricco (chiamate, note, activity)
 * → il task processor crea un task "reactivation"
 * → callAgentProactive() serializza i dati
 * → verifica che dati critici NON vengano persi
 */

import { describe, test, expect, beforeAll } from 'vitest';

let counter = 0;
const oid = () => `64f${(++counter).toString(16).padStart(21, '0')}`;

const OWNER_ID = oid();
const CONTACT_ID = oid();
const CONVERSATION_ID = oid();

const richContact = {
  _id: CONTACT_ID,
  name: 'Ristorante Il Vecchio Mulino',
  email: 'info@vecchiomulino.it',
  phone: '+393481234567',
  lists: ['Smartlead Outbound Email'],
  status: 'ghosted/bad timing',
  source: 'smartlead_outbound',
  owner: OWNER_ID,
  createdBy: OWNER_ID,
  properties: {
    city: 'Firenze',
    location: 'Firenze',
    rating: '4.3',
    reviews_count: '127',
    google_maps_link: 'https://maps.google.com/?cid=456',
    site: 'https://vecchiomulino.it',
    category: 'Ristorante',
    contact_person: 'Giovanni Rossi',
    notes: 'Proprietario molto gentile, ha 2 locali. Interessato ma voleva aspettare dopo la stagione estiva.',
    callbackAt: '2026-03-15T10:00:00.000Z',
    callbackNote: 'Richiamare dopo Pasqua, dice che è troppo impegnato adesso',
    callRequested: true,
    callPreference: 'Mattina presto, prima delle 11',
    company: 'Vecchio Mulino S.r.l.',
    smartlead_campaign_id: 'campaign_202',
    smartlead_campaign_name: 'Q4 Ristoranti Toscana',
    smartlead_lead_id: 'sl_lead_789',
  },
  rankCheckerData: {
    placeId: 'ChIJ_vecchiomulino_123',
    keyword: 'ristorante firenze centro',
    dailyCovers: 120,
    hasDigitalMenu: false,
    estimatedMonthlyReviews: 22,
    restaurantData: {
      name: 'Ristorante Il Vecchio Mulino',
      rating: 4.3,
      reviewCount: 127,
      address: 'Via dei Neri 35, Firenze, FI',
      coordinates: { lat: 43.7696, lng: 11.2558 }
    },
    ranking: {
      mainRank: 12,
      competitorsAhead: 11,
      estimatedLostCustomers: 28,
      fullResults: {
        mainResult: { rank: 12, coordinates: { lat: 43.7696, lng: 11.2558 } },
        competitors: [
          { name: 'Trattoria Mario', rank: 1, rating: 4.5, reviews: 3200, place_id: 'comp1' },
          { name: 'Osteria dell\'Enoteca', rank: 2, rating: 4.4, reviews: 1800, place_id: 'comp2' },
          { name: 'Il Latini', rank: 3, rating: 4.2, reviews: 5600, place_id: 'comp3' },
        ]
      }
    },
    qualificationResult: {
      qualified: true,
      score: 82,
      qualifiedAt: '2025-10-15T14:30:00.000Z'
    }
  },
  createdAt: new Date('2025-09-01T10:00:00.000Z'),
  updatedAt: new Date('2025-11-20T16:00:00.000Z'),
};

const richConversation = {
  _id: CONVERSATION_ID,
  contact: CONTACT_ID,
  channel: 'email',
  status: 'paused',
  stage: 'objection_handling',
  agentIdentity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
  messages: [
    { role: 'agent', content: 'Buongiorno Giovanni, ho visto i risultati del Rank Checker...', channel: 'email', createdAt: new Date('2025-10-16T09:00:00Z') },
    { role: 'lead', content: 'Grazie Marco, interessante ma al momento siamo nel pieno della stagione. Ricontattami dopo Natale.', channel: 'email', createdAt: new Date('2025-10-17T14:00:00Z') },
    { role: 'agent', content: 'Capisco perfettamente Giovanni! Ti ricontatto dopo le feste...', channel: 'email', createdAt: new Date('2025-10-17T15:00:00Z') },
    { role: 'lead', content: 'Perfetto, a dopo le feste.', channel: 'email', createdAt: new Date('2025-10-18T10:00:00Z') },
  ],
  context: {
    leadCategory: 'INTERESTED',
    leadSource: 'smartlead_outbound',
    smartleadData: { campaignId: 'campaign_202', leadId: 'sl_lead_789' },
    restaurantData: { name: 'Ristorante Il Vecchio Mulino', city: 'Firenze' },
    objections: ['bad_timing'],
    painPoints: ['poche_recensioni', 'competitor_visibili'],
    conversationSummary: 'Giovanni del Vecchio Mulino a Firenze è interessato ma ha chiesto di risentirci dopo le feste. Ha 2 locali, è consapevole del problema recensioni (127 vs 3200 del competitor principale). Obiezione: bad timing per la stagione.',
    humanNotes: [
      { note: 'Chiamato Giovanni il 20/10. Molto cordiale, conferma interesse. Ha 2 locali, quello di Firenze centro e uno a Fiesole. Vuole iniziare col primo. Budget non è un problema, è il tempo. Richiamare dopo Natale.', at: new Date('2025-10-20T11:00:00Z') },
      { note: 'Giovanni ha risposto a una mail di Natale generica. Ha scritto "buone feste anche a voi". Buon segno.', at: new Date('2025-12-23T09:00:00Z') },
    ]
  },
  metrics: { messagesCount: 4, agentMessagesCount: 2, humanInterventions: 0 },
  outcome: null,
  assignedTo: OWNER_ID,
  updatedAt: new Date('2025-12-23T09:00:00.000Z'),
};

const callHistory = [
  {
    _id: oid(),
    twilioCallSid: 'CA_test_001',
    contact: CONTACT_ID,
    initiatedBy: OWNER_ID,
    fromNumber: '+393517279170',
    toNumber: '+393481234567',
    status: 'completed',
    direction: 'outbound-api',
    duration: 185,
    startTime: new Date('2025-10-20T10:55:00Z'),
    endTime: new Date('2025-10-20T11:00:05Z'),
    notes: 'Giovanni conferma interesse, ha 2 locali. Vuole partire col locale di Firenze centro. Budget ok (~100€/mese dice che è niente), il problema è che in stagione non ha tempo. Richiamare dopo Natale. Persona molto gentile e razionale.',
    outcome: 'callback',
    rating: 4,
    flag: null,
  },
  {
    _id: oid(),
    twilioCallSid: 'CA_test_002',
    contact: CONTACT_ID,
    initiatedBy: OWNER_ID,
    fromNumber: '+393517279170',
    toNumber: '+393481234567',
    status: 'no-answer',
    direction: 'outbound-api',
    duration: 0,
    startTime: new Date('2026-01-10T10:00:00Z'),
    endTime: new Date('2026-01-10T10:00:30Z'),
    notes: null,
    outcome: 'no-answer',
  },
  {
    _id: oid(),
    twilioCallSid: 'CA_test_003',
    contact: CONTACT_ID,
    initiatedBy: OWNER_ID,
    fromNumber: '+393517279170',
    toNumber: '+393481234567',
    status: 'completed',
    direction: 'outbound-api',
    duration: 45,
    startTime: new Date('2026-01-12T11:00:00Z'),
    endTime: new Date('2026-01-12T11:00:45Z'),
    notes: 'Risponde veloce, dice che è ancora interessato ma deve parlarne col socio. Mi farà sapere entro fine mese.',
    outcome: 'callback',
  },
];

const activityHistory = [
  {
    _id: oid(),
    contact: CONTACT_ID,
    type: 'email',
    title: 'Prima email outbound',
    description: 'Email Smartlead campagna Q4 Toscana',
    data: { kind: 'outbound', origin: 'smartlead', campaignId: 'campaign_202' },
    createdBy: OWNER_ID,
    status: 'completed',
    createdAt: new Date('2025-10-16T09:00:00Z'),
  },
  {
    _id: oid(),
    contact: CONTACT_ID,
    type: 'call',
    title: 'Chiamata - Callback',
    data: { callOutcome: 'callback', callDuration: 185 },
    createdBy: OWNER_ID,
    status: 'completed',
    createdAt: new Date('2025-10-20T11:00:00Z'),
  },
  {
    _id: oid(),
    contact: CONTACT_ID,
    type: 'note',
    title: 'Nota interna',
    description: 'Giovanni ha 2 locali, budget non è un problema. Richiamare dopo le feste.',
    data: {},
    createdBy: OWNER_ID,
    status: 'completed',
    createdAt: new Date('2025-10-20T11:05:00Z'),
  },
  {
    _id: oid(),
    contact: CONTACT_ID,
    type: 'status_change',
    title: 'Stato: contattato → ghosted/bad timing',
    data: { statusChange: { oldStatus: 'contattato', newStatus: 'ghosted/bad timing' } },
    createdBy: OWNER_ID,
    status: 'completed',
    createdAt: new Date('2025-11-20T16:00:00Z'),
  },
  {
    _id: oid(),
    contact: CONTACT_ID,
    type: 'call',
    title: 'Chiamata - Nessuna risposta',
    data: { callOutcome: 'no-answer', callDuration: 0 },
    createdBy: OWNER_ID,
    status: 'completed',
    createdAt: new Date('2026-01-10T10:00:00Z'),
  },
  {
    _id: oid(),
    contact: CONTACT_ID,
    type: 'call',
    title: 'Chiamata - Callback',
    description: 'Ancora interessato, deve parlare col socio',
    data: { callOutcome: 'callback', callDuration: 45 },
    createdBy: OWNER_ID,
    status: 'completed',
    createdAt: new Date('2026-01-12T11:00:00Z'),
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Inline replica of serializeContact + serializeMessages from
// agentServiceClient.js (so we can test without importing the module)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function _extractCityFromAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const parts = address.split(',');
  if (parts.length >= 2) {
    const cityPart = parts[parts.length - 2].trim();
    const tokens = cityPart.split(' ').filter(t => t.length > 2 && !/^\d+$/.test(t));
    return tokens.join(' ') || null;
  }
  return null;
}

function serializeContact(contact) {
  const p = contact.properties || {};
  const rc = contact.rankCheckerData || {};
  const rcRestaurant = rc.restaurantData || {};

  return {
    name: contact.name,
    email: contact.email,
    phone: contact.phone || null,
    city: p.city || p['Città'] || p.location || _extractCityFromAddress(rcRestaurant.address) || null,
    address: p.full_address || p['Indirizzo'] || rcRestaurant.address || null,
    rating: p.rating || p.Rating || rcRestaurant.rating || null,
    reviews: p.reviews_count || p.Recensioni || rcRestaurant.reviewCount || null,
    source: contact.source,
    category: p.category || p.business_type || null,
    website: p.site || p.Website || null,
    google_maps_link: p.google_maps_link || p.googleMapsUrl || null,
    contact_person: p.contact_person || p.contactName || null,
    place_id: rc.placeId || null,
    coordinates: rcRestaurant.coordinates || null,
    call_requested: p.callRequested || false,
    call_preference: p.callPreference || null,
  };
}

function serializeMessages(messages) {
  return (messages || []).map(m => ({
    role: m.role,
    content: m.content,
    channel: m.channel || 'email',
    created_at: m.createdAt?.toISOString?.() || null
  }));
}

function buildProactivePayload(task, contact, conversation) {
  const identity = conversation?.agentIdentity || { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' };

  return {
    task_type: task.type,
    contact: serializeContact(contact),
    conversation_id: conversation?._id?.toString() || null,
    messages: serializeMessages(conversation?.messages || []),
    lead_source: contact.source || 'smartlead_outbound',
    rank_checker_data: contact.rankCheckerData ? {
      keyword: contact.rankCheckerData.keyword,
      dailyCovers: contact.rankCheckerData.dailyCovers,
      hasDigitalMenu: contact.rankCheckerData.hasDigitalMenu,
      estimatedMonthlyReviews: contact.rankCheckerData.estimatedMonthlyReviews,
      placeId: contact.rankCheckerData.placeId,
      ranking: contact.rankCheckerData.ranking,
      restaurantData: contact.rankCheckerData.restaurantData,
    } : null,
    smartlead_data: conversation?.context?.smartleadData ? {
      campaign_id: String(conversation.context.smartleadData.campaignId || ''),
      lead_id: String(conversation.context.smartleadData.leadId || '')
    } : null,
    agent_identity: { name: identity.name, surname: identity.surname, role: identity.role },
    task_context: task.context || {},
    previous_insights: conversation?.context ? {
      objections: conversation.context.objections || [],
      pain_points: conversation.context.painPoints || []
    } : null,
    days_since_last_contact: conversation?.updatedAt
      ? Math.floor((Date.now() - new Date(conversation.updatedAt).getTime()) / (24 * 60 * 60 * 1000))
      : null,
    last_outcome: conversation?.outcome || null
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Reactivation Data Flow — Payload per agente', () => {
  const reactivationTask = {
    type: 'reactivation',
    contact: richContact,
    conversation: richConversation,
    context: { reason: 'Dormant 30+ days' },
  };

  let payload;

  beforeAll(() => {
    payload = buildProactivePayload(reactivationTask, richContact, richConversation);
  });

  test('payload contiene i dati base del contatto', () => {
    expect(payload.contact.name).toBe('Ristorante Il Vecchio Mulino');
    expect(payload.contact.email).toBe('info@vecchiomulino.it');
    expect(payload.contact.phone).toBe('+393481234567');
    expect(payload.contact.city).toBe('Firenze');
    expect(payload.contact.category).toBe('Ristorante');
    expect(payload.contact.contact_person).toBe('Giovanni Rossi');
  });

  test('payload contiene i dati rank checker', () => {
    expect(payload.rank_checker_data).not.toBeNull();
    expect(payload.rank_checker_data.keyword).toBe('ristorante firenze centro');
    expect(payload.rank_checker_data.ranking.mainRank).toBe(12);
  });

  test('payload contiene i messaggi della conversazione', () => {
    expect(payload.messages).toHaveLength(4);
    expect(payload.messages[1].content).toContain('stagione');
  });

  test('payload contiene obiezioni e pain points precedenti', () => {
    expect(payload.previous_insights.objections).toContain('bad_timing');
    expect(payload.previous_insights.pain_points).toContain('poche_recensioni');
  });

  test('payload calcola days_since_last_contact', () => {
    expect(payload.days_since_last_contact).toBeGreaterThan(90);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GAP CRITICI — dati nel CRM che NON arrivano all'agente
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  test('❌ GAP: note umane sulla conversazione NON vengono passate', () => {
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toContain('Chiamato Giovanni il 20/10');
    expect(payloadStr).not.toContain('2 locali');
    expect(payloadStr).not.toContain('buone feste anche a voi');
  });

  test('❌ GAP: conversation summary NON viene passato', () => {
    expect(payload).not.toHaveProperty('conversation_summary');
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toContain('deve parlarne col socio');
    expect(payloadStr).not.toContain('Budget non è un problema');
  });

  test('❌ GAP: storico chiamate (Call model) NON viene passato', () => {
    const payloadStr = JSON.stringify(payload);
    // Le note della chiamata con info critiche sono perse
    expect(payloadStr).not.toContain('conferma interesse');
    expect(payloadStr).not.toContain('Budget ok');
    expect(payloadStr).not.toContain('parlare col socio');
    // Nessun campo nel payload trasporta dati sulle chiamate
    expect(payload).not.toHaveProperty('call_history');
    expect(payload).not.toHaveProperty('calls');
  });

  test('❌ GAP: activity timeline NON viene passata', () => {
    expect(payload).not.toHaveProperty('activities');
    expect(payload).not.toHaveProperty('activity_history');
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toContain('Nota interna');
  });

  test('❌ GAP: note libere nelle properties del contatto NON vengono passate', () => {
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toContain('Proprietario molto gentile');
    expect(payloadStr).not.toContain('aspettare dopo la stagione estiva');
  });

  test('❌ GAP: callback info NON viene passata', () => {
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toContain('Richiamare dopo Pasqua');
    expect(payloadStr).not.toContain('callbackAt');
  });

  test('❌ GAP: stato del contatto nel CRM (ghosted/bad timing) NON viene passato', () => {
    expect(payload.contact).not.toHaveProperty('status');
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toContain('ghosted');
  });

  test('call_requested viene passato ma come campo extra non nel modello Pydantic dell\'agente', () => {
    expect(payload.contact.call_requested).toBe(true);
    expect(payload.contact.call_preference).toBe('Mattina presto, prima delle 11');
  });
});

describe('Reactivation senza conversazione precedente', () => {
  test('rank_checker_outreach per lead senza conversazione', () => {
    const task = {
      type: 'rank_checker_outreach',
      contact: richContact,
      conversation: null,
      context: { source: 'rank_checker' },
    };
    const payload = buildProactivePayload(task, richContact, null);

    expect(payload.task_type).toBe('rank_checker_outreach');
    expect(payload.messages).toHaveLength(0);
    expect(payload.conversation_id).toBeNull();
    expect(payload.previous_insights).toBeNull();
    expect(payload.days_since_last_contact).toBeNull();
    expect(payload.contact.name).toBe('Ristorante Il Vecchio Mulino');
    expect(payload.rank_checker_data).not.toBeNull();
  });
});

describe('Riepilogo dati persi per scenario tipo', () => {
  test('stampa il payload completo e il delta dei dati mancanti', () => {
    const task = {
      type: 'reactivation',
      contact: richContact,
      conversation: richConversation,
      context: { reason: 'Dormant 30+ days' },
    };
    const payload = buildProactivePayload(task, richContact, richConversation);

    const dataAvailableInCRM = {
      'Contact.properties.notes': richContact.properties.notes,
      'Contact.properties.callbackNote': richContact.properties.callbackNote,
      'Contact.properties.callbackAt': richContact.properties.callbackAt,
      'Contact.status': richContact.status,
      'Conversation.context.humanNotes': richConversation.context.humanNotes,
      'Conversation.context.conversationSummary': richConversation.context.conversationSummary,
      'Calls': callHistory.map(c => ({ outcome: c.outcome, duration: c.duration, notes: c.notes, date: c.startTime })),
      'Activities': activityHistory.map(a => ({ type: a.type, title: a.title, description: a.description, date: a.createdAt })),
    };

    const dataSentToAgent = {
      contact: payload.contact,
      task_type: payload.task_type,
      task_context: payload.task_context,
      messages_count: payload.messages.length,
      previous_insights: payload.previous_insights,
      days_since_last_contact: payload.days_since_last_contact,
      last_outcome: payload.last_outcome,
    };

    console.log('\n═══════════════════════════════════════════════');
    console.log('  DATI NEL CRM MA NON INVIATI ALL\'AGENTE');
    console.log('═══════════════════════════════════════════════\n');
    console.log(JSON.stringify(dataAvailableInCRM, null, 2));
    console.log('\n═══════════════════════════════════════════════');
    console.log('  DATI EFFETTIVAMENTE INVIATI ALL\'AGENTE');
    console.log('═══════════════════════════════════════════════\n');
    console.log(JSON.stringify(dataSentToAgent, null, 2));

    expect(true).toBe(true);
  });
});
