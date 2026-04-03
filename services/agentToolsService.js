import axios from 'axios';
import { Resend } from 'resend';
import { replyToEmailThread } from './smartleadApiService.js';
import { sendWhatsAppTemplate, sendWhatsAppMessage } from './whatsappAgentService.js';
import Conversation from '../models/conversationModel.js';
import Contact from '../models/contactModel.js';
import agentLogger from './agentLogger.js';

const SERPAPI_KEY = process.env.SERPAPI_KEY || process.env.SERPER_API_KEY;
const MENUCHAT_BACKEND_URL = process.env.CRM_API_URL || process.env.MENUCHAT_BACKEND_URL;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOOL DEFINITIONS (schema per Claude tool_use)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const AGENT_TOOLS = [
  {
    name: 'search_similar_clients',
    description: 'Cerca ristoranti clienti MenuChat simili al lead per tipo di cucina e zona geografica. Restituisce nome, città, recensioni Google raccolte, e link al menu digitale pubblico. Usa questo tool quando vuoi mostrare al lead un esempio concreto di ristorante simile che usa MenuChat, o quando vuoi citare dati reali di risultati ottenuti.',
    input_schema: {
      type: 'object',
      properties: {
        cuisine_type: { type: 'string', description: 'Tipo di cucina o ristorante (es. "pizzeria", "ristorante", "trattoria", "pub", "sushi")' },
        city: { type: 'string', description: 'Città o provincia del lead' },
        region: { type: 'string', description: 'Regione italiana (es. "Campania", "Toscana")' }
      },
      required: ['cuisine_type']
    }
  },
  {
    name: 'research_business_serpapi',
    description: 'Ricerca dettagli del ristorante/attività del lead su Google Maps via SerpAPI. Restituisce rating, numero recensioni, indirizzo, telefono, sito web, orari, tipo attività, e le ultime recensioni. Usa questo tool quando hai il place_id o il nome+città del lead e vuoi dati aggiornati per personalizzare la risposta.',
    input_schema: {
      type: 'object',
      properties: {
        place_id: { type: 'string', description: 'Google Place ID del ristorante' },
        business_name: { type: 'string', description: 'Nome del ristorante (alternativa a place_id)' },
        city: { type: 'string', description: 'Città (necessario se usi business_name senza place_id)' }
      },
      required: []
    }
  },
  {
    name: 'get_ranking_for_keyword',
    description: 'Controlla la posizione attuale del ristorante su Google Maps per una keyword specifica. Restituisce rank, competitor in zona, e dati comparativi. Usa questo tool quando vuoi dare al lead dati aggiornati sulla sua visibilità.',
    input_schema: {
      type: 'object',
      properties: {
        restaurant_name: { type: 'string', description: 'Nome del ristorante' },
        place_id: { type: 'string', description: 'Google Place ID' },
        keyword: { type: 'string', description: 'Keyword di ricerca (es. "pizzeria napoli", "ristorante roma")' },
        latitude: { type: 'number', description: 'Latitudine del ristorante' },
        longitude: { type: 'number', description: 'Longitudine del ristorante' }
      },
      required: ['keyword']
    }
  },
  {
    name: 'send_email_reply',
    description: 'Invia la tua risposta al lead via email. Per lead Smartlead usa reply-in-thread (mantiene la conversazione). Per lead rank checker usa Resend. Chiama SEMPRE questo tool quando hai composto la risposta finale e sei pronto a inviarla.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Il testo della risposta email da inviare al lead. Scrivi in modo umano, breve (max 150 parole), e firma col tuo nome.' },
        subject: { type: 'string', description: 'Oggetto email (solo per Resend/rank checker, ignorato per Smartlead reply-in-thread)' }
      },
      required: ['message']
    }
  },
  {
    name: 'send_whatsapp',
    description: 'Invia un messaggio WhatsApp al lead via Twilio. Se è il primo contatto, usa un template approvato. Se il lead ha già risposto su WhatsApp (session window 24h attiva), puoi mandare un messaggio libero. Usa questo tool quando il lead ha fornito un numero di telefono o preferisce WhatsApp.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Testo del messaggio WhatsApp. Breve e diretto.' },
        phone: { type: 'string', description: 'Numero di telefono del lead (con prefisso +39)' },
        is_first_contact: { type: 'boolean', description: 'true se è il primo messaggio WhatsApp (serve template), false se la session window è attiva' }
      },
      required: ['message', 'phone']
    }
  },
  {
    name: 'request_human_help',
    description: 'Chiedi aiuto a Marco quando non sai come gestire una situazione, quando l\'obiezione è nuova o complessa, o quando la conversazione richiede un tocco umano. Fornisci il contesto e spiega cosa ti mette in difficoltà. Marco vedrà la richiesta nel CRM e ti darà indicazioni.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Perché hai bisogno di aiuto. Spiega la situazione specifica.' },
        draft_reply: { type: 'string', description: 'La tua bozza di risposta (se ne hai una). Marco può approvarla o modificarla.' },
        urgency: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Urgenza della richiesta' }
      },
      required: ['reason']
    }
  },
  {
    name: 'schedule_followup',
    description: 'Programma un follow-up per ricontattare il lead tra N giorni. Usa questo tool quando il lead dice "risentirci tra una settimana", "non adesso ma più avanti", o quando vuoi fare un follow-up dopo aver mandato info.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Tra quanti giorni ricontattare (1-90)' },
        note: { type: 'string', description: 'Nota su cosa fare al follow-up' }
      },
      required: ['days', 'note']
    }
  }
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOOL IMPLEMENTATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const executeTools = async (toolName, toolInput, conversationContext) => {
  agentLogger.info('tool_call', {
    conversationId: conversationContext?.conversation?._id,
    data: { tool: toolName, input: JSON.stringify(toolInput).substring(0, 200) }
  });

  switch (toolName) {
    case 'search_similar_clients':
      return await toolSearchSimilarClients(toolInput);
    case 'research_business_serpapi':
      return await toolResearchBusiness(toolInput);
    case 'get_ranking_for_keyword':
      return await toolGetRanking(toolInput);
    case 'send_email_reply':
      return await toolSendEmail(toolInput, conversationContext);
    case 'send_whatsapp':
      return await toolSendWhatsApp(toolInput, conversationContext);
    case 'request_human_help':
      return await toolRequestHumanHelp(toolInput, conversationContext);
    case 'schedule_followup':
      return await toolScheduleFollowup(toolInput, conversationContext);
    default:
      return { error: `Tool sconosciuto: ${toolName}` };
  }
};

async function toolSearchSimilarClients({ cuisine_type, city, region }) {
  try {
    if (!MENUCHAT_BACKEND_URL) {
      return { clients: [], note: 'Backend MenuChat non configurato. Usa i case study generici: MOOD (Gibellina), La Capannina (Napoli), Il Porto (Livorno), Arnold\'s (Firenze).' };
    }

    const response = await axios.get(`${MENUCHAT_BACKEND_URL}/api/restaurants/similar`, {
      params: { type: cuisine_type, city, region, limit: 3 },
      timeout: 10000,
      headers: { 'x-api-key': process.env.CRM_API_KEY || '' }
    }).catch(() => null);

    if (response?.data?.restaurants?.length > 0) {
      return {
        clients: response.data.restaurants.map(r => ({
          name: r.name,
          city: r.address?.city || r.address?.formattedAddress?.split(',').slice(-2, -1)[0]?.trim(),
          googleReviews: r.googleRating?.reviewCount,
          rating: r.googleRating?.rating,
          menuUrl: `https://menuchat.it/menu/${r._id}`,
          reviewsCollectedLastMonth: r.reviewsCollectedLastMonth || null
        })),
        note: 'Questi sono clienti reali MenuChat attivi. Puoi citare i loro dati e condividere il link al menu.'
      };
    }

    return {
      clients: [],
      fallback_case_studies: [
        { name: 'MOOD', city: 'Gibellina (TP)', result: 'più di 100 recensioni/mese' },
        { name: 'La Capannina', city: 'Volla (NA)', result: 'più di 100 recensioni/mese' },
        { name: 'Il Porto', city: 'Livorno', result: 'più di 100 recensioni/mese' },
        { name: "Arnold's", city: 'Firenze', result: 'più di 100 recensioni/mese' }
      ],
      note: 'Nessun cliente trovato nella zona/tipo specifico. Usa i case study generici.'
    };
  } catch (error) {
    return { error: error.message, clients: [] };
  }
}

async function toolResearchBusiness({ place_id, business_name, city }) {
  try {
    if (!SERPAPI_KEY) return { error: 'SERPAPI_KEY non configurata' };

    const params = {
      engine: 'google_maps',
      api_key: SERPAPI_KEY,
      hl: 'it'
    };

    if (place_id) {
      params.place_id = place_id;
    } else if (business_name) {
      params.type = 'search';
      params.q = city ? `${business_name} ${city}` : business_name;
    } else {
      return { error: 'Serve place_id oppure business_name' };
    }

    const response = await axios.get('https://serpapi.com/search.json', { params, timeout: 15000 });
    const data = response.data;

    if (place_id && data.place_results) {
      const p = data.place_results;
      return {
        name: p.title,
        rating: p.rating,
        reviews: p.reviews,
        address: p.address,
        phone: p.phone,
        website: p.website,
        type: p.type || p.types?.join(', '),
        hours: p.hours,
        price_range: p.price,
        description: p.description,
        recent_reviews: (p.reviews_per_score ? Object.entries(p.reviews_per_score).map(([stars, count]) => `${stars} stelle: ${count}`) : []),
        note: 'Dati aggiornati da Google Maps. Usali per personalizzare la risposta.'
      };
    }

    if (data.local_results?.length > 0) {
      const first = data.local_results[0];
      return {
        name: first.title,
        rating: first.rating,
        reviews: first.reviews,
        address: first.address,
        phone: first.phone,
        type: first.type,
        place_id: first.place_id,
        position: first.position,
        note: 'Risultato dalla ricerca Maps. Primo risultato per la query.'
      };
    }

    return { error: 'Nessun risultato trovato', query: params.q || place_id };
  } catch (error) {
    return { error: error.message };
  }
}

async function toolGetRanking({ restaurant_name, place_id, keyword, latitude, longitude }) {
  try {
    if (!SERPAPI_KEY) return { error: 'SERPAPI_KEY non configurata' };

    const params = {
      engine: 'google_maps',
      type: 'search',
      q: keyword,
      api_key: SERPAPI_KEY,
      hl: 'it',
      num: 20
    };

    if (latitude && longitude) {
      params.ll = `@${latitude},${longitude},15z`;
    }

    const response = await axios.get('https://serpapi.com/search.json', { params, timeout: 15000 });
    const results = response.data.local_results || [];

    let userRank = null;
    const competitors = [];

    for (const r of results) {
      if (place_id && r.place_id === place_id) {
        userRank = r.position;
      } else if (restaurant_name && r.title.toLowerCase().includes(restaurant_name.toLowerCase())) {
        userRank = r.position;
      } else {
        competitors.push({
          name: r.title,
          rank: r.position,
          rating: r.rating,
          reviews: r.reviews,
          type: r.type
        });
      }
    }

    return {
      keyword,
      rank: userRank || 'Non trovato nella Top 20',
      total_results: results.length,
      top_competitors: competitors.slice(0, 5),
      note: userRank
        ? `Il ristorante è in posizione ${userRank} per "${keyword}". ${userRank <= 3 ? 'Ottima posizione!' : userRank <= 10 ? 'Buona posizione, ma c\'è margine per salire.' : 'Posizione bassa — i clienti lo trovano difficilmente.'}`
        : `Il ristorante non compare nei primi 20 risultati per "${keyword}". La visibilità è molto bassa.`
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function toolSendEmail({ message, subject }, ctx) {
  const conversation = ctx?.conversation;
  if (!conversation) return { error: 'Nessuna conversazione attiva' };

  const contact = await Contact.findById(conversation.contact).lean();
  if (!contact) return { error: 'Contatto non trovato' };

  const htmlBody = message.split('\n').map(line => line.trim() ? `<p>${line}</p>` : '<br>').join('');

  const isSmartlead = conversation.context?.leadSource === 'smartlead_outbound' &&
    conversation.context?.smartleadData?.campaignId;

  let result;

  if (isSmartlead) {
    const { campaignId, leadId, lastMessageId } = conversation.context.smartleadData;
    result = await replyToEmailThread(campaignId, leadId, htmlBody, lastMessageId);
  } else {
    if (!resend) return { error: 'Resend non configurato' };

    const identity = conversation.agentIdentity || { name: 'Marco', surname: 'Benvenuti' };
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'team@menuchat.it';
    const replyTo = contact._id
      ? `agent+${contact._id}@reply.menuchat.it`
      : fromEmail;

    try {
      const sendResult = await resend.emails.send({
        from: `${identity.name} ${identity.surname} <${fromEmail}>`,
        to: [contact.email],
        replyTo,
        subject: subject || `Re: MenuChat per ${contact.name}`,
        html: htmlBody
      });
      result = { success: true, resendId: sendResult.data?.id };
    } catch (err) {
      result = { success: false, error: err.message };
    }
  }

  if (result?.success) {
    conversation.addMessage('agent', message, 'email', { wasAutoSent: true });
    await conversation.save();
  }

  return { sent: result?.success || false, channel: isSmartlead ? 'smartlead' : 'resend', details: result };
}

async function toolSendWhatsApp({ message, phone, is_first_contact }, ctx) {
  const conversation = ctx?.conversation;

  if (is_first_contact) {
    const contentSid = process.env.TWILIO_AGENT_TEMPLATE_SID;
    if (!contentSid) {
      return { sent: false, note: 'Template WhatsApp per l\'agente non configurato (TWILIO_AGENT_TEMPLATE_SID). Usa email.' };
    }
    const result = await sendWhatsAppTemplate(phone, contentSid, { '1': message.substring(0, 500) });
    if (result.success && conversation) {
      conversation.addMessage('agent', message, 'whatsapp', { twilioMessageSid: result.messageSid });
      await conversation.save();
    }
    return { sent: result.success, channel: 'whatsapp_template', messageSid: result.messageSid };
  }

  const result = await sendWhatsAppMessage(phone, message);
  if (result.success && conversation) {
    conversation.addMessage('agent', message, 'whatsapp', { twilioMessageSid: result.messageSid });
    await conversation.save();
  }
  return { sent: result.success, channel: 'whatsapp_session', messageSid: result.messageSid };
}

async function toolRequestHumanHelp({ reason, draft_reply, urgency }, ctx) {
  const conversation = ctx?.conversation;
  if (!conversation) return { error: 'Nessuna conversazione attiva' };

  conversation.status = 'awaiting_human';
  if (draft_reply) {
    conversation.addMessage('agent', draft_reply, conversation.channel, {
      aiConfidence: 0,
      wasAutoSent: false
    });
  }
  conversation.context.nextAction = `human_review: ${reason}`;
  conversation.markModified('context');
  await conversation.save();

  const contact = await Contact.findById(conversation.contact).lean();
  const frontendUrl = process.env.FRONTEND_URL || 'https://crm-frontend-pied-sigma.vercel.app';

  const { sendAgentHumanReviewEmail } = await import('./emailNotificationService.js');
  await sendAgentHumanReviewEmail({
    restaurantName: conversation.context?.restaurantData?.name || contact?.name,
    city: conversation.context?.restaurantData?.city || '',
    rank: conversation.context?.restaurantData?.rank,
    keyword: conversation.context?.restaurantData?.keyword,
    rating: conversation.context?.restaurantData?.rating,
    reviewsCount: conversation.context?.restaurantData?.reviewsCount,
    leadMessage: conversation.messages.filter(m => m.role === 'lead').pop()?.content || '',
    draftReply: draft_reply,
    reason,
    conversationId: conversation._id,
    contactEmail: contact?.email,
    msgCount: conversation.metrics?.messagesCount || 0,
    objections: conversation.context?.objections || [],
    approveLink: `${frontendUrl}/agent/review?id=${conversation._id}`,
    modifyLink: `${frontendUrl}/agent/review?id=${conversation._id}`,
    discardLink: `${frontendUrl}/agent/review?id=${conversation._id}`
  });

  return { status: 'awaiting_human', reason, note: 'Marco riceverà una notifica e vedrà la richiesta nel CRM.' };
}

async function toolScheduleFollowup({ days, note }, ctx) {
  const conversation = ctx?.conversation;
  if (!conversation) return { error: 'Nessuna conversazione attiva' };

  const followupDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  conversation.context.nextAction = note;
  conversation.context.nextActionAt = followupDate;
  conversation.status = 'paused';
  conversation.markModified('context');
  await conversation.save();

  return {
    scheduled: true,
    followup_date: followupDate.toISOString(),
    days,
    note,
    status: `Follow-up programmato per il ${followupDate.toLocaleDateString('it-IT')}`
  };
}

export default { AGENT_TOOLS, executeTools };
