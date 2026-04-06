import axios from 'axios';
import { Resend } from 'resend';
import { replyToEmailThread } from './smartleadApiService.js';
import { sendWhatsAppTemplate, sendWhatsAppMessage } from './whatsappAgentService.js';
import Conversation from '../models/conversationModel.js';
import Contact from '../models/contactModel.js';
import agentLogger from './agentLogger.js';
import OutboundMessageJob from '../models/outboundMessageJobModel.js';

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
  },
  {
    name: 'book_callback',
    description: 'Fissa una chiamata con il lead. Usa SEMPRE questo tool quando il lead accetta di essere contattato telefonicamente. Il tool salva il numero, la fascia oraria, aggiorna lo stato nel CRM a "da richiamare", e invia un messaggio di conferma al lead sullo stesso canale della conversazione. PRIMA di chiamare questo tool, assicurati di avere il numero di telefono e almeno un\'indicazione di fascia oraria.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Numero di telefono confermato del lead (con prefisso +39)' },
        time_preference: { type: 'string', description: 'Fascia oraria preferita dal lead (es. "mattina", "pomeriggio dopo le 15", "domani alle 11", "qualsiasi orario")' },
        confirmation_message: { type: 'string', description: 'Messaggio di conferma da inviare al lead. Esempio: "Perfetto! Ti chiamo domani pomeriggio al [numero]. A presto! Marco"' },
        notes: { type: 'string', description: 'Note per l\'operatore che farà la chiamata (pain points, contesto, cosa interessa al lead)' }
      },
      required: ['phone', 'time_preference', 'confirmation_message']
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
    case 'book_callback':
      return await toolBookCallback(toolInput, conversationContext);
    case 'update_smartlead_email':
      return await toolUpdateSmartleadEmail(toolInput, conversationContext);
    case 'update_contact':
      return await toolUpdateContact(toolInput, conversationContext);
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
          currentReviews: r.currentReviewCount || r.googleRating?.reviewCount,
          initialReviews: r.initialReviewCount || 0,
          reviewsGained: r.reviewsGained,
          monthsActive: r.monthsActive,
          avgReviewsPerMonth: r.avgReviewsPerMonth,
          rating: r.googleRating?.rating,
          menuUrl: r.menuUrl || `https://menuchat.it/menu/${r._id}`,
          menuItemCount: r.menuItemCount || 0
        })),
        note: 'Questi sono clienti REALI MenuChat. Usa i dati "reviewsGained" e "monthsActive" per dire cose come: "[nome] ha raccolto [reviewsGained] recensioni in [monthsActive] mesi con MenuChat — erano a [initialReviews], ora sono a [currentReviews]". Puoi anche condividere il link al menu (menuUrl). NON inventare numeri — usa SOLO quelli che vedi qui.'
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

    if (data.place_results) {
      const p = data.place_results;
      return {
        name: p.title,
        rating: p.rating,
        reviews: p.reviews,
        address: p.address,
        phone: p.phone,
        website: p.website,
        type: Array.isArray(p.type) ? p.type.join(', ') : (p.type || ''),
        hours: p.hours,
        price_range: p.price,
        description: p.description,
        place_id: p.place_id,
        reviews_breakdown: p.reviews_per_score || {},
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

  // Guardrail canale: non inviare su email se il canale corrente è WhatsApp
  const currentChannel = conversation.channelState?.currentChannel || conversation.channel || 'email';
  if (currentChannel !== 'email') {
    agentLogger.warn('channel_guardrail_block', {
      conversationId: conversation._id,
      data: { attempted: 'email', currentChannel }
    });
    return { sent: false, skipped: true, reason: `Channel guardrail: current_channel=${currentChannel}` };
  }

  const contact = await Contact.findById(conversation.contact).lean();
  if (!contact) return { error: 'Contatto non trovato' };

  if (process.env.AGENT_APPROVAL_MODE === 'true') {
    conversation.addMessage('agent', message, 'email', {
      wasAutoSent: false,
      isDraft: true,
      draftSubject: subject
    });
    conversation.status = 'awaiting_human';
    conversation.markModified('context');
    await conversation.save();
    return {
      sent: false,
      draft: true,
      channel: 'email',
      note: 'Messaggio salvato come bozza. In attesa di approvazione umana.'
    };
  }

  const htmlBody = message.split('\n').map(line => line.trim() ? `<p>${line}</p>` : '<br>').join('');

  const isSmartlead = conversation.context?.leadSource === 'smartlead_outbound' &&
    conversation.context?.smartleadData?.campaignId;

  let result;

  if (isSmartlead) {
    const { campaignId, leadId } = conversation.context.smartleadData;
    result = await replyToEmailThread(campaignId, leadId, htmlBody);
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

  // Guardrail canale: non inviare su WhatsApp se il canale corrente è email
  if (conversation) {
    const currentChannel = conversation.channelState?.currentChannel || conversation.channel || 'email';
    if (currentChannel !== 'whatsapp') {
      agentLogger.warn('channel_guardrail_block', {
        conversationId: conversation._id,
        data: { attempted: 'whatsapp', currentChannel }
      });
      return { sent: false, skipped: true, reason: `Channel guardrail: current_channel=${currentChannel}` };
    }
  }

  if (process.env.AGENT_APPROVAL_MODE === 'true' && conversation) {
    conversation.addMessage('agent', message, 'whatsapp', {
      wasAutoSent: false,
      isDraft: true,
      draftPhone: phone
    });
    conversation.status = 'awaiting_human';
    conversation.markModified('context');
    await conversation.save();
    return {
      sent: false,
      draft: true,
      channel: 'whatsapp',
      note: 'Messaggio WhatsApp salvato come bozza. In attesa di approvazione umana.'
    };
  }

  const windowUntil = conversation?.channelState?.whatsappWindowOpenUntil
    ? new Date(conversation.channelState.whatsappWindowOpenUntil).getTime()
    : null;
  const hasActiveSession = windowUntil ? Date.now() <= windowUntil : conversation?.messages?.some(m =>
    m.channel === 'whatsapp' && m.role === 'lead' &&
    m.createdAt && (Date.now() - new Date(m.createdAt).getTime()) < 24 * 60 * 60 * 1000
  );

  if (!hasActiveSession) {
    // Primo contatto o session scaduta: serve template.
    // Se esiste un template "statico" configurato, usalo. Altrimenti crea un job dinamico (Content API + approval).
    const contentSid = process.env.TWILIO_AGENT_TEMPLATE_SID;

    if (contentSid && !contentSid.startsWith('(')) {
      const result = await sendWhatsAppTemplate(phone, contentSid, { '1': message.substring(0, 500) });
      if (result.success && conversation) {
        conversation.addMessage('agent', message, 'whatsapp', { twilioMessageSid: result.messageSid });
        await conversation.save();
      }
      return { sent: result.success, channel: 'whatsapp_template', messageSid: result.messageSid };
    }

    if (!conversation) {
      return { sent: false, error: 'Nessuna conversazione — impossibile enqueue job WhatsApp' };
    }

    const job = await OutboundMessageJob.create({
      contact: conversation.contact,
      conversation: conversation._id,
      attemptType: is_first_contact ? 'first_touch' : 'other',
      messageText: message,
      sendMode: 'template',
      sendStatus: 'queued',
      approvalStatus: 'not_requested',
      cancelIfInboundAfter: new Date(), // se il lead risponde su qualunque canale, skip
      nextRetryAt: new Date()
    });

    agentLogger.info('whatsapp_job_enqueued', { conversationId: conversation._id, data: { jobId: job._id.toString() } });

    return {
      sent: false,
      queued: true,
      jobId: job._id.toString(),
      channel: 'whatsapp_dynamic_template',
      note: 'WhatsApp fuori finestra: creato job dinamico (template + approvazione). Verrà inviato appena approvato, se il lead non risponde prima.'
    };
  }

  // Session window attiva: messaggio libero
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

  const { generateSignedActionUrl } = await import('./signedUrlService.js');
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
    approveLink: generateSignedActionUrl(conversation._id, 'approve'),
    modifyLink: `${frontendUrl}/agent/review?id=${conversation._id}`,
    discardLink: generateSignedActionUrl(conversation._id, 'discard')
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

async function toolBookCallback({ phone, time_preference, confirmation_message, notes }, ctx) {
  const conversation = ctx?.conversation;
  if (!conversation) return { error: 'Nessuna conversazione attiva' };

  const contact = ctx?.contact || await Contact.findById(conversation.contact);
  if (!contact) return { error: 'Contatto non trovato' };

  // Aggiorna telefono nel contatto se diverso o mancante
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  if (!contact.phone || contact.phone !== cleanPhone) {
    await Contact.findByIdAndUpdate(contact._id, { phone: cleanPhone });
  }

  // Aggiorna status contatto a "da richiamare"
  await Contact.findByIdAndUpdate(contact._id, {
    status: 'da richiamare',
    'properties.preferred_availability': time_preference,
    'properties.callback_notes': notes || '',
    'properties.callbackAt': new Date().toISOString()
  });

  // Aggiorna conversazione
  conversation.stage = 'handoff';
  conversation.context.qualificationData = {
    ...(conversation.context.qualificationData || {}),
    callbackPhone: cleanPhone,
    callbackTimePreference: time_preference,
    callbackNotes: notes,
    callbackBookedAt: new Date().toISOString()
  };
  conversation.markModified('context');

  // Invia messaggio di conferma al lead sullo stesso canale
  const lastLeadChannel = [...(conversation.messages || [])].reverse().find(m => m.role === 'lead')?.channel || 'email';

  let sendResult = { sent: false };
  if (lastLeadChannel === 'whatsapp') {
    sendResult = await toolSendWhatsApp({ message: confirmation_message, phone: cleanPhone }, ctx);
  } else {
    sendResult = await toolSendEmail({ message: confirmation_message }, ctx);
  }

  if (!sendResult.sent) {
    const altChannel = lastLeadChannel === 'whatsapp' ? 'email' : 'whatsapp';
    if (altChannel === 'email') {
      sendResult = await toolSendEmail({ message: confirmation_message }, ctx);
    } else if (contact.phone) {
      sendResult = await toolSendWhatsApp({ message: confirmation_message, phone: cleanPhone }, ctx);
    }
  }

  await conversation.save();

  agentLogger.info('callback_booked', {
    conversationId: conversation._id,
    data: { phone: cleanPhone, timePreference: time_preference, confirmSent: sendResult.sent }
  });

  // Notifica il team
  const { sendAgentActivityReport } = await import('./emailNotificationService.js');
  sendAgentActivityReport({
    action: 'callback_booked',
    contactName: contact.name,
    contactEmail: contact.email,
    contactPhone: cleanPhone,
    agentName: conversation.agentIdentity?.name || 'Marco',
    agentReply: confirmation_message,
    toolsUsed: ['book_callback'],
    conversationId: conversation._id,
    source: contact.source,
    extra: `Fascia oraria: ${time_preference}. Note: ${notes || 'N/A'}`
  }).catch(() => {});

  return {
    booked: true,
    phone: cleanPhone,
    time_preference,
    confirmation_sent: sendResult.sent,
    contact_status: 'da richiamare',
    note: `Callback fissata. Contatto aggiornato a "da richiamare". ${sendResult.sent ? 'Conferma inviata al lead.' : 'ATTENZIONE: conferma NON inviata — verificare manualmente.'}`
  };
}

async function toolUpdateSmartleadEmail({ new_email }, ctx) {
  const conversation = ctx?.conversation;
  if (!conversation) return { error: 'Nessuna conversazione attiva' };

  const slData = conversation.context?.smartleadData;
  if (!slData?.campaignId || !slData?.leadId) {
    return { error: 'Dati Smartlead mancanti (campaignId/leadId)' };
  }

  try {
    const SMARTLEAD_API_KEY = process.env.SMARTLEAD_API_KEY;
    if (!SMARTLEAD_API_KEY) return { error: 'SMARTLEAD_API_KEY non configurata' };

    await axios.post(
      `https://server.smartlead.ai/api/v1/campaigns/${slData.campaignId}/leads/${slData.leadId}`,
      { email: new_email },
      { params: { api_key: SMARTLEAD_API_KEY }, timeout: 10000 }
    );

    const contact = ctx?.contact || await Contact.findById(conversation.contact);
    if (contact) {
      contact.email = new_email;
      await contact.save();
    }

    agentLogger.info('smartlead_email_updated', {
      conversationId: conversation._id,
      data: { newEmail: new_email }
    });

    return { success: true, new_email, note: 'Email aggiornata su Smartlead e nel CRM.' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolUpdateContact(updates, ctx) {
  const conversation = ctx?.conversation;
  const contact = ctx?.contact || (conversation ? await Contact.findById(conversation.contact) : null);
  if (!contact) return { error: 'Contatto non trovato' };

  try {
    const allowed = ['phone', 'status', 'properties'];
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'properties' && typeof value === 'object') {
        for (const [pk, pv] of Object.entries(value)) {
          contact.properties = contact.properties || {};
          contact.properties[pk] = pv;
        }
        contact.markModified('properties');
      } else if (allowed.includes(key)) {
        contact[key] = value;
      }
    }
    await contact.save();
    return { success: true, updated: Object.keys(updates) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export { toolSearchSimilarClients, toolResearchBusiness, toolGetRanking, toolSendEmail, toolSendWhatsApp, toolBookCallback, toolScheduleFollowup, toolRequestHumanHelp, toolUpdateSmartleadEmail, toolUpdateContact };
export default { AGENT_TOOLS, executeTools };
