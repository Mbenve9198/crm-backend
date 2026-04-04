import Anthropic from '@anthropic-ai/sdk';
import Conversation from '../models/conversationModel.js';
import Contact from '../models/contactModel.js';
import AgentMetric from '../models/agentMetricModel.js';
import agentLogger from './agentLogger.js';
import { AGENT_TOOLS, executeTools } from './agentToolsService.js';
import { sendAgentActivityReport } from './emailNotificationService.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_MODEL = 'claude-opus-4-20250514';
const AGENT_TEMPERATURE = 0.35;
const MAX_TOOL_ROUNDS = 5;

const OPUS_INPUT_RATE = 5 / 1_000_000;
const OPUS_OUTPUT_RATE = 25 / 1_000_000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IDENTITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const IDENTITIES = {
  marco: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
  federico: { name: 'Federico', surname: 'Desantis', role: 'partner' }
};

export const resolveIdentity = (fromEmail) => {
  if (!fromEmail) return IDENTITIES.marco;
  return fromEmail.toLowerCase().includes('federico') ? IDENTITIES.federico : IDENTITIES.marco;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SYSTEM PROMPT: persona, non template
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const buildSystemPrompt = (identity, context) => {
  return `Sei ${identity.name} ${identity.surname}, ${identity.role} di MenuChat.

CHI SEI:
Sei una persona vera, non un bot. Sei un imprenditore italiano che ha fondato MenuChat — un sistema che aiuta i ristoratori a raccogliere recensioni Google in modo automatico. Parli come parleresti a un collega ristoratore: diretto, amichevole, zero formalità inutili. Firmi sempre come ${identity.name}.

COSA FA MENUCHAT (descrivi così al ristoratore, con parole semplici):
Mettiamo un QR code sui tuoi tavoli. Il cliente lo scannerizza e si apre WhatsApp con un messaggio già pronto — tipo "MENU". Lo manda, e il nostro bot risponde subito con il link al tuo menu digitale: piatti, foto, prezzi, allergeni, tutto bello e personalizzato col tuo brand.

Dopo che il cliente ha mangiato, il sistema aspetta il momento giusto (un'ora, due ore — dipende se è pranzo, cena, aperitivo) e gli manda un messaggio WhatsApp: "Com'è andata? Lasceresti una recensione?" con il link diretto a Google.

Il bello è che TUTTE le persone che aprono il menu ricevono la richiesta — non serve che prenotino o si registrino. E c'è un filtro intelligente: chi dà 4-5 stelle va su Google, chi dà meno di 4 scrive un feedback privato che arriva solo a te. Le recensioni negative restano private, quelle positive vanno online.

I numeri: come riferimento generico, circa 100 recensioni al mese. Se conosci i coperti del ristorante, calcola con il 5-7% di conversione. I nostri migliori clienti arrivano a 150 al mese. NON dire MAI "250-300 al mese" — è un numero irrealistico. Il sistema funziona da solo, 7 giorni su 7.

Bonus: chi accetta durante la visione del menu può essere ricontattato per promozioni via WhatsApp — menu del giorno, eventi, offerte. È come avere una mailing list, ma su WhatsApp dove tutti leggono.

PRICING:
- Prova gratuita: 2 settimane, senza impegno, cancelli quando vuoi
- Prezzo pieno: 1.290€+IVA annuale
- MA: "il nostro interesse è lavorare con voi, siamo molto flessibili" — non citare mai il prezzo pieno come prima cosa. Parti dalla prova gratuita. Se il lead chiede il prezzo, digli che il listino è 1.290€ annuale ma che per iniziare c'è la prova gratuita e poi si discute
- NON dire MAI 39€/mese o altri prezzi inventati
- Se il contesto dice "RANK_CHECKER_OUTREACH" → è un PRIMO CONTATTO. NON citare MAI il prezzo in nessuna forma. Il prezzo si discute solo dopo la prima chiamata

COME RAGIONI:
Hai a disposizione dei tool per ottenere informazioni in tempo reale. USALI. Non improvvisare, non inventare dati. Prima di rispondere:
1. Se non conosci il ristorante del lead, usa "research_business_serpapi" per avere dati aggiornati
2. Se vuoi mostrare un esempio concreto, usa "search_similar_clients" per trovare un cliente MenuChat simile nella loro zona
3. Se vuoi verificare la posizione su Google Maps, usa "get_ranking_for_keyword"
4. NON inventare MAI nomi di ristoranti clienti, numeri di recensioni, o statistiche che non hai verificato con un tool
5. Se "search_similar_clients" torna un cliente con menuUrl e hasCompletedMenu=true, CONDIVIDI il link al menu digitale! È una prova concreta potentissima — il lead può vedere con i propri occhi come appare un menu digitale di un ristorante simile al suo. Esempio: "Guarda come funziona il menu di [nome]: [menuUrl]"

COME SCRIVI:
- Max 150 parole per email, max 100 per WhatsApp
- Tono: come un messaggio tra amici che lavorano. Mai "Gentilissimo", mai "Cordiali saluti"
- Chiudi con "A presto" o direttamente col nome
- Se il lead è informale, sii informale. Se è formale, un po' più composto ma mai freddo
- SEMPRE una call to action alla fine (domanda, proposta di sentirsi, ecc.)
- NON proporre MAI videochiamate, Google Meet, Zoom o simili. Noi facciamo CHIAMATE AL CELLULARE, veloci, 5-10 minuti
- NON dire MAI "ti faccio vedere come funziona dal vivo" o "ti mostro il sistema". Noi lo facciamo PROVARE gratis
- Quando proponi di sentirvi: "Ti chiamo per spiegarti come funziona la prova gratuita" oppure "A che numero posso chiamarti?"
- L'obiettivo finale è sempre: fissare una CHIAMATA veloce al telefono → spiegare la prova gratuita 2 settimane

QUANDO CHIEDERE AIUTO A MARCO:
Usa "request_human_help" quando:
- L'obiezione è nuova e non sai come gestirla con i dati che hai
- Il lead menziona un competitor specifico che non conosci
- La situazione richiede una decisione commerciale (sconti, condizioni speciali)
- Dopo 2 tentativi il lead non si sblocca e non vuoi forzare

QUANDO MANDARE EMAIL VS WHATSAPP:
- Se il lead ha risposto via email → rispondi via email (send_email_reply)
- Se il lead ha fornito WhatsApp o ha risposto su WhatsApp → usa quello (send_whatsapp)
- Se devi contattare per primo un rank checker lead → manda entrambi (email + WhatsApp)
- WhatsApp ha priorità se il lead risponde su entrambi i canali

${context || ''}`;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROUTING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const routeLeadReply = (category, confidence, extracted, replyText) => {
  if (category === 'DO_NOT_CONTACT') return { action: 'stop', reason: 'DNC' };
  if (category === 'OUT_OF_OFFICE') return { action: 'resume_sequence', reason: 'OOO' };

  const hasPhoneInBody = extracted?.phone && extracted?.preferredChannel !== 'email';
  const wantsCall = /chiama|call|sentir|telefon|videochiamata/i.test(replyText || '');

  if (category === 'INTERESTED' && confidence >= 0.9 && (hasPhoneInBody || wantsCall)) {
    return { action: 'direct_handoff', reason: 'Lead caldo con telefono/richiesta chiamata' };
  }

  if (category === 'INTERESTED') return { action: 'agent' };
  if (category === 'NEUTRAL') return { action: 'agent' };
  if (category === 'NOT_INTERESTED' && confidence < 0.85) return { action: 'agent' };
  if (category === 'NOT_INTERESTED') return { action: 'track_lost', reason: 'Rifiuto esplicito' };

  return { action: 'agent' };
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AGENTIC LOOP: pensa → tool → pensa → tool → risposta
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const runAgentLoop = async (conversation, leadMessage) => {
  const identity = conversation.agentIdentity || IDENTITIES.marco;
  const contact = await Contact.findById(conversation.contact).lean();

  let contextBlock = '\nCONTESTO LEAD ATTUALE:';
  if (contact) {
    const p = contact.properties || {};
    contextBlock += `\n- Nome ristorante: ${contact.name}`;
    contextBlock += `\n- Email: ${contact.email}`;
    if (contact.phone) contextBlock += `\n- Telefono: ${contact.phone}`;
    const city = p.city || p['Città'] || p.location || '';
    if (city) contextBlock += `\n- Città/Zona: ${city}`;
    const address = p.full_address || p['Indirizzo'] || '';
    if (address) contextBlock += `\n- Indirizzo: ${address}`;
    const rating = p.rating || p.Rating;
    if (rating) contextBlock += `\n- Rating Google: ${rating}/5`;
    const reviews = p.reviews_count || p.Recensioni;
    if (reviews) contextBlock += `\n- Recensioni Google: ${reviews}`;
    if (p.google_maps_link) contextBlock += `\n- Google Maps: ${p.google_maps_link}`;
    if (p.site || p.Website) contextBlock += `\n- Sito web: ${p.site || p.Website}`;
    if (p.category || p.business_type) contextBlock += `\n- Tipo locale: ${p.category || p.business_type}`;
    if (p.current_rank) contextBlock += `\n- Posizione Google Maps: ${p.current_rank}° per "${p.keyword || 'N/A'}"`;
    if (p.estimated_lost_customers) contextBlock += `\n- Clienti persi stimati/settimana: ~${p.estimated_lost_customers}`;
    if (p.competitor_1_name) {
      contextBlock += `\n- Competitor principali:`;
      contextBlock += `\n  - ${p.competitor_1_name}: posizione ${p.competitor_1_rank || '?'}, ${p.competitor_1_reviews || '?'} recensioni, rating ${p.competitor_1_rating || '?'}`;
      if (p.competitor_2_name) contextBlock += `\n  - ${p.competitor_2_name}: posizione ${p.competitor_2_rank || '?'}, ${p.competitor_2_reviews || '?'} recensioni`;
      if (p.competitor_3_name) contextBlock += `\n  - ${p.competitor_3_name}`;
    }
    if (p.contact_person) contextBlock += `\n- Persona da contattare: ${p.contact_person}`;
    if (p.preferred_availability) contextBlock += `\n- Disponibilità preferita: ${p.preferred_availability}`;
    if (contact.source) contextBlock += `\n- Fonte lead: ${contact.source}`;
  }

  const rc = contact?.rankCheckerData;
  if (rc) {
    const ranking = rc.ranking || {};
    contextBlock += `\n\nDATI RANK CHECKER:`;
    contextBlock += `\n- Keyword: "${rc.keyword}"`;
    if (ranking.mainRank) contextBlock += `\n- Posizione: ${ranking.mainRank}`;
    if (ranking.competitorsAhead != null) contextBlock += `\n- Competitor davanti: ${ranking.competitorsAhead}`;
    if (ranking.estimatedLostCustomers) contextBlock += `\n- Clienti persi stimati/settimana: ~${ranking.estimatedLostCustomers}`;
    if (rc.dailyCovers) contextBlock += `\n- Coperti/giorno dichiarati: ${rc.dailyCovers}`;
    if (rc.hasDigitalMenu != null) contextBlock += `\n- Ha menu digitale: ${rc.hasDigitalMenu ? 'sì' : 'no'}`;
    if (ranking.fullResults?.competitors?.length > 0) {
      contextBlock += `\n- Competitor principali:`;
      for (const c of ranking.fullResults.competitors.slice(0, 3)) {
        contextBlock += `\n  - ${c.name}: posizione ${c.rank}, ${c.reviews || '?'} recensioni`;
      }
    }
  }

  if (conversation.context?.objections?.length > 0) {
    contextBlock += `\n\nOBIEZIONI GIÀ EMERSE: ${conversation.context.objections.join(', ')}`;
  }

  const systemPrompt = buildSystemPrompt(identity, contextBlock);

  const messages = conversation.getConversationThread(15);
  messages.push({ role: 'user', content: leadMessage });

  const toolContext = { conversation, contact };
  let currentMessages = messages;
  let finalTextResponse = null;
  let toolsUsed = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const llmStart = Date.now();
    const response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 2048,
      temperature: AGENT_TEMPERATURE,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages: currentMessages
    });
    const llmDuration = Date.now() - llmStart;

    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    AgentMetric.create({
      conversation: conversation._id,
      event: 'llm_call',
      data: {
        model: AGENT_MODEL,
        inputTokens,
        outputTokens,
        costUsd: (inputTokens * OPUS_INPUT_RATE) + (outputTokens * OPUS_OUTPUT_RATE),
        durationMs: llmDuration
      }
    }).catch(() => {});

    const textBlocks = response.content.filter(b => b.type === 'text');
    const toolBlocks = response.content.filter(b => b.type === 'tool_use');

    if (toolBlocks.length === 0) {
      finalTextResponse = textBlocks.map(b => b.text).join('\n').trim();
      break;
    }

    const toolResults = [];
    for (const toolBlock of toolBlocks) {
      const toolStart = Date.now();
      const result = await executeTools(toolBlock.name, toolBlock.input, toolContext);
      const toolDuration = Date.now() - toolStart;
      toolsUsed.push({ name: toolBlock.name, input: toolBlock.input, result });

      AgentMetric.create({
        conversation: conversation._id,
        event: 'tool_call',
        data: {
          toolName: toolBlock.name,
          toolSuccess: !result?.error && result?.sent !== false,
          durationMs: toolDuration
        }
      }).catch(() => {});

      const isSendTool = toolBlock.name === 'send_email_reply' || toolBlock.name === 'send_whatsapp';
      const sendFailed = isSendTool && result && !result.sent;

      let toolResultContent = JSON.stringify(result);
      if (sendFailed) {
        const failReason = result.details?.error || result.note || result.error || 'motivo sconosciuto';
        toolResultContent = JSON.stringify({
          ...result,
          _system_note: `INVIO FALLITO: ${failReason}. Prova il canale alternativo (email se WhatsApp ha fallito, o viceversa). Se anche il canale alternativo fallisce, usa request_human_help.`
        });
        agentLogger.warn('tool_send_failed', { conversationId: conversation._id, data: { tool: toolBlock.name, reason: failReason } });
      } else {
        agentLogger.info('tool_completed', { conversationId: conversation._id, data: toolBlock.name });
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: toolResultContent
      });
    }

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults }
    ];

    if (response.stop_reason === 'end_turn' && textBlocks.length > 0) {
      finalTextResponse = textBlocks.map(b => b.text).join('\n').trim();
      break;
    }
  }

  if (!finalTextResponse && toolsUsed.length >= MAX_TOOL_ROUNDS) {
    agentLogger.warn('max_rounds_reached', { conversationId: conversation._id, data: { rounds: MAX_TOOL_ROUNDS, toolsUsed: toolsUsed.map(t => t.name) } });
    await executeTools('request_human_help', {
      reason: `L'agente ha raggiunto il massimo di ${MAX_TOOL_ROUNDS} round senza produrre una risposta. Serve intervento umano.`,
      urgency: 'high'
    }, toolContext);
  }

  return {
    response: finalTextResponse,
    toolsUsed,
    identity,
    rounds: toolsUsed.length > 0 ? toolsUsed.length : 0
  };
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ORCHESTRATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const handleAgentConversation = async ({
  contact,
  replyText,
  category,
  confidence,
  extracted,
  fromEmail,
  webhookBasic
}) => {
  const identity = resolveIdentity(fromEmail);

  let conversation = await Conversation.findActiveByContact(contact._id);

  if (!conversation) {
    conversation = new Conversation({
      contact: contact._id,
      channel: 'email',
      status: 'active',
      stage: 'initial_reply',
      agentIdentity: identity,
      context: {
        leadCategory: category,
        leadSource: contact.source || 'smartlead_outbound',
        smartleadData: {
          campaignId: webhookBasic?.campaignId,
          leadId: webhookBasic?.leadId
        },
        restaurantData: {
          name: contact.name,
          city: contact.properties?.city || contact.properties?.['Città'] || contact.properties?.location,
          googleMapsLink: contact.properties?.google_maps_link
        },
        smartleadLeadId: webhookBasic?.leadId
      },
      assignedTo: contact.owner
    });
  }

  conversation.addMessage('lead', replyText, 'email', { extractedEntities: extracted });

  const routing = routeLeadReply(category, confidence, extracted, replyText);

  if (routing.action === 'direct_handoff') {
    conversation.status = 'escalated';
    conversation.outcome = 'sql';
    conversation.stage = 'handoff';
    await conversation.save();
    agentLogger.info('direct_handoff', { conversationId: conversation._id, contactEmail: contact.email, data: 'Lead caldo → team vendite' });
    sendAgentActivityReport({ action: 'direct_handoff', contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone || extracted?.phone, agentName: identity.name, leadMessage: replyText, category, confidence, conversationId: conversation._id, source: contact.source }).catch(() => {});
    return { action: 'direct_handoff', conversation };
  }

  if (routing.action === 'stop' || routing.action === 'track_lost') {
    conversation.status = 'dead';
    conversation.outcome = routing.action === 'stop' ? 'dnc' : 'lost';
    await conversation.save();
    return { action: routing.action, conversation };
  }

  if (routing.action === 'resume_sequence') {
    await conversation.save();
    return { action: 'resume_sequence', conversation };
  }

  await conversation.save();

  try {
    agentLogger.info('agent_loop_start', { conversationId: conversation._id, contactEmail: contact.email, data: { name: contact.name } });
    const agentResult = await runAgentLoop(conversation, replyText);

    if (agentResult.toolsUsed.length > 0) {
      agentLogger.info('tools_used', { conversationId: conversation._id, contactEmail: contact.email, data: agentResult.toolsUsed.map(t => t.name) });
    }

    const hasSentMessage = agentResult.toolsUsed.some(t =>
      t.name === 'send_email_reply' || t.name === 'send_whatsapp'
    );
    const hasRequestedHelp = agentResult.toolsUsed.some(t => t.name === 'request_human_help');
    const hasScheduledFollowup = agentResult.toolsUsed.some(t => t.name === 'schedule_followup');

    if (hasRequestedHelp) {
      const agentMsg = conversation.messages.filter(m => m.role === 'agent').pop();
      sendAgentActivityReport({ action: 'awaiting_human', contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone, agentName: identity.name, leadMessage: replyText, agentReply: agentMsg?.content, toolsUsed: agentResult.toolsUsed.map(t => t.name), category, confidence, conversationId: conversation._id, source: contact.source }).catch(() => {});
      return { action: 'awaiting_human', conversation };
    }

    if (hasSentMessage) {
      agentLogger.info('auto_sent', { conversationId: conversation._id, contactEmail: contact.email });
      const agentMsg = conversation.messages.filter(m => m.role === 'agent').pop();
      sendAgentActivityReport({ action: 'auto_sent', contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone, agentName: identity.name, leadMessage: replyText, agentReply: agentMsg?.content, toolsUsed: agentResult.toolsUsed.map(t => t.name), category, confidence, conversationId: conversation._id, source: contact.source }).catch(() => {});
      return { action: 'auto_sent', conversation };
    }

    if (hasScheduledFollowup) {
      sendAgentActivityReport({ action: 'scheduled_followup', contactName: contact.name, contactEmail: contact.email, agentName: identity.name, leadMessage: replyText, agentReply: `Follow-up programmato: ${conversation.context?.nextAction || ''}`, toolsUsed: agentResult.toolsUsed.map(t => t.name), conversationId: conversation._id, source: contact.source }).catch(() => {});
      return { action: 'scheduled_followup', conversation };
    }

    if (agentResult.response && !hasSentMessage) {
      conversation.status = 'awaiting_human';
      conversation.addMessage('agent', agentResult.response, 'email', {
        aiConfidence: 0.5,
        wasAutoSent: false
      });
      await conversation.save();

      const { executeTools: exec } = await import('./agentToolsService.js');
      await exec('request_human_help', {
        reason: 'L\'agente ha generato una risposta ma non l\'ha inviata autonomamente. Verifica e approva.',
        draft_reply: agentResult.response,
        urgency: 'medium'
      }, { conversation });

      return { action: 'awaiting_human', conversation, draftReply: agentResult.response };
    }

    return { action: 'no_action', conversation };
  } catch (error) {
    agentLogger.error('agent_loop_error', { conversationId: conversation._id, contactEmail: contact?.email, data: error.message });
    conversation.status = 'awaiting_human';
    await conversation.save();

    const { executeTools: exec } = await import('./agentToolsService.js');
    await exec('request_human_help', {
      reason: `Errore tecnico nell'agente: ${error.message}`,
      urgency: 'high'
    }, { conversation });

    return { action: 'error', conversation, error: error.message };
  }
};

/**
 * Approva e invia una risposta in attesa di review
 */
export const approveAndSend = async (conversationId, modifiedContent = null) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || conversation.status !== 'awaiting_human') {
    return { success: false, reason: 'Conversazione non in attesa di review' };
  }

  const content = modifiedContent || conversation.messages.filter(m => m.role === 'agent').pop()?.content;
  if (!content) return { success: false, reason: 'Nessun contenuto da inviare' };

  const contact = await Contact.findById(conversation.contact).lean();
  if (!contact) return { success: false, reason: 'Contatto non trovato' };

  const { executeTools: exec } = await import('./agentToolsService.js');
  const sendResult = await exec('send_email_reply', { message: content }, { conversation, contact });

  if (modifiedContent) {
    conversation.addMessage('human', modifiedContent, 'email', { humanEdited: true });
  }
  conversation.status = 'active';
  await conversation.save();

  return { success: true, sendResult };
};

export const discardReply = async (conversationId) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return { success: false, reason: 'Conversazione non trovata' };
  conversation.status = 'paused';
  await conversation.save();
  return { success: true };
};

export default { resolveIdentity, routeLeadReply, runAgentLoop, handleAgentConversation, approveAndSend, discardReply };
