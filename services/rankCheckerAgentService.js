import Contact from '../models/contactModel.js';
import Conversation from '../models/conversationModel.js';
import { runAgentLoop, resolveIdentity } from './salesAgentService.js';

/**
 * Servizio per outreach proattivo ai lead rank checker.
 * L'agente contatta per primo via email (Resend) + WhatsApp (Twilio) simultaneamente.
 * Poi continua sul canale dove il lead risponde (WhatsApp prioritario).
 */

const OUTREACH_INTERVAL_MS = 30 * 60 * 1000; // 30 minuti
const MIN_AGE_HOURS = 2; // aspetta almeno 2 ore dopo la creazione (SOAP Opera #1 gia partita)

/**
 * Avvia il job scheduler per outreach rank checker
 */
export const startRankCheckerOutreachJob = () => {
  console.log(`🚀 Rank Checker Outreach Job avviato (intervallo: ${OUTREACH_INTERVAL_MS / 60000} min)`);

  processRankCheckerOutreach().catch(err =>
    console.error('❌ Errore primo ciclo outreach:', err.message)
  );

  setInterval(async () => {
    try {
      await processRankCheckerOutreach();
    } catch (error) {
      console.error('❌ Errore ciclo outreach rank checker:', error.message);
    }
  }, OUTREACH_INTERVAL_MS);
};

/**
 * Processa i lead rank checker pronti per outreach.
 * Solo in orari civili (9-20 Europe/Rome) -- i ristoratori non leggono email alle 3 di notte.
 */
const processRankCheckerOutreach = async () => {
  const now = new Date();
  const romeHour = parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }));
  if (romeHour < 9 || romeHour >= 20) {
    return;
  }

  const minCreatedAt = new Date(Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000);
  const maxCreatedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const leads = await Contact.find({
    source: 'inbound_rank_checker',
    status: 'da contattare',
    createdAt: { $lte: minCreatedAt, $gte: maxCreatedAt }
  }).populate('owner', 'email firstName lastName').lean();

  const existingConvContactIds = await Conversation.distinct('contact');
  const existingSet = new Set(existingConvContactIds.map(id => id.toString()));

  const eligibleLeads = leads.filter(l => !existingSet.has(l._id.toString()));

  if (eligibleLeads.length === 0) return;

  console.log(`📞 Rank Checker Outreach: ${eligibleLeads.length} lead da contattare`);

  for (const lead of eligibleLeads.slice(0, 5)) {
    try {
      await initiateRankCheckerOutreach(lead);
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(`❌ Errore outreach per ${lead.email}:`, error.message);
    }
  }
};

/**
 * Avvia il primo contatto con un lead rank checker via email + WhatsApp
 */
const initiateRankCheckerOutreach = async (contact) => {
  const ownerEmail = contact.owner?.email || null;
  const identity = resolveIdentity(ownerEmail);

  const conversation = new Conversation({
    contact: contact._id,
    channel: 'email',
    status: 'active',
    stage: 'initial_reply',
    agentIdentity: identity,
    context: {
      leadCategory: 'RANK_CHECKER_OUTREACH',
      leadSource: 'inbound_rank_checker',
      restaurantData: buildRestaurantContext(contact)
    },
    assignedTo: contact.owner?._id || contact.owner
  });

  await conversation.save();

  const outreachPrompt = buildOutreachPrompt(contact, identity);

  console.log(`🧠 Agent outreach loop per ${contact.name} (${contact.email})`);

  try {
    const agentResult = await runAgentLoop(conversation, outreachPrompt);

    if (agentResult.toolsUsed.length > 0) {
      console.log(`  🔧 Tool usati: ${agentResult.toolsUsed.map(t => t.name).join(', ')}`);
    }

    const hasSent = agentResult.toolsUsed.some(t =>
      t.name === 'send_email_reply' || t.name === 'send_whatsapp'
    );

    if (hasSent) {
      console.log(`✅ Outreach inviato a ${contact.name}`);
      const { sendAgentActivityReport } = await import('./emailNotificationService.js');
      const agentMsg = conversation.messages?.filter(m => m.role === 'agent').pop();
      sendAgentActivityReport({ action: 'outreach_sent', contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone, agentName: identity.name, agentReply: agentMsg?.content, toolsUsed: agentResult.toolsUsed.map(t => t.name), conversationId: conversation._id, source: 'inbound_rank_checker' }).catch(() => {});
    } else {
      console.log(`⚠️ Agente non ha inviato outreach per ${contact.name} — escalation`);
      const { executeTools } = await import('./agentToolsService.js');
      await executeTools('request_human_help', {
        reason: `Outreach fallito per ${contact.name} (${contact.email}): l'agente non ha inviato nessun messaggio. Verificare dati contatto e riprovare manualmente.`,
        urgency: 'medium'
      }, { conversation });
    }
  } catch (error) {
    console.error(`❌ Errore agent loop outreach:`, error.message);
    conversation.status = 'awaiting_human';
    await conversation.save();
    try {
      const { executeTools } = await import('./agentToolsService.js');
      await executeTools('request_human_help', {
        reason: `Errore tecnico outreach per ${contact.name}: ${error.message}`,
        urgency: 'high'
      }, { conversation });
    } catch { /* non bloccante */ }
  }
};

const buildRestaurantContext = (contact) => {
  const rc = contact.rankCheckerData || {};
  const ranking = rc.ranking || {};
  const restaurantData = rc.restaurantData || {};

  const competitors = [];
  if (ranking.fullResults?.competitors) {
    for (const comp of ranking.fullResults.competitors.slice(0, 3)) {
      competitors.push({ name: comp.name, reviews: comp.reviews, rank: comp.rank });
    }
  }

  return {
    name: contact.name,
    city: contact.properties?.location || extractCity(contact),
    rank: ranking.mainRank || ranking.fullResults?.mainResult?.rank,
    keyword: rc.keyword,
    rating: restaurantData.rating,
    reviewsCount: restaurantData.reviewCount,
    competitors,
    estimatedLostCustomers: ranking.estimatedLostCustomers,
    googleMapsLink: contact.properties?.googleMapsUrl,
    hasDigitalMenu: rc.hasDigitalMenu,
    dailyCovers: rc.dailyCovers,
    estimatedMonthlyReviews: rc.estimatedMonthlyReviews
  };
};

/**
 * Genera il "messaggio di sistema" che innesca l'agente per outreach.
 * Non e' un messaggio del lead -- e' un'istruzione interna per l'agente.
 */
const buildOutreachPrompt = (contact, identity) => {
  const rc = contact.rankCheckerData || {};
  const ranking = rc.ranking || {};
  const covers = rc.dailyCovers || 0;
  const estimatedIn2Weeks = covers > 0 ? Math.round(covers * 14 * 0.06) : null;
  const city = extractCity(contact);
  const restaurantData = rc.restaurantData || {};

  let menuNote = '';
  if (rc.hasDigitalMenu === true) {
    menuNote = `Ha GIA un menu digitale — è a un passo dal sistema completo.`;
  } else if (rc.hasDigitalMenu === false) {
    menuNote = `NON ha menu digitale ma ha detto che lo metterebbe.`;
  }

  let competitorInfo = '';
  if (ranking.fullResults?.competitors?.length > 0) {
    const comps = ranking.fullResults.competitors.slice(0, 2);
    competitorInfo = comps.map(c => `${c.name}: pos ${c.rank}, ${c.reviews || '?'} rec`).join(' | ');
  }

  return `[ISTRUZIONE INTERNA]
PRIMO CONTATTO. Scrivi come una persona vera. NON come un AI. NON come un venditore.

STRUTTURA DEL MESSAGGIO (segui questo ordine):

1. APERTURA: Ringrazia per aver usato il Rank Checker. Personalizza con il nome del ristorante.

2. PROBLEMA (usa i dati sotto):
   - La sua posizione su Google Maps per "${rc.keyword || '?'}": ${ranking.mainRank || '?'}°
   - Competitor che lo superano: ${competitorInfo || 'N/A'}
   - Se la posizione è bassa: "chi cerca '${rc.keyword}' su Maps vede prima [competitor] — ogni settimana sono circa ${ranking.estimatedLostCustomers || '?'} clienti che finiscono da loro invece che da te"
   - Se il rating è sotto 4.5: "con ${restaurantData.rating || '?'} stelle, i clienti tendono a scegliere chi ha rating più alto"

3. DREAM OUTCOME (stima concreta basata sui dati):
   - "Con ${covers || '?'} coperti al giorno, in 2 settimane di test potremmo raccogliere circa ${estimatedIn2Weeks || '?'} nuove recensioni — abbastanza per salire nel ranking"
   - Se search_similar_clients ha trovato un risultato: "Un locale simile al tuo, [nome], è passato da [initialReviews] a [currentReviews] recensioni in [monthsActive] mesi"
   - NON dire come funziona il sistema. Il "come" lo spieghi nella chiamata

4. CTA (chiudi SEMPRE così):
   - ${contact.phone ? `"Il tuo numero è ${contact.phone} — posso chiamarti 5 minuti per spiegarti come funziona la prova gratuita?"` : `"A che numero posso chiamarti? Bastano 5 minuti per spiegarti come funziona la prova gratuita."`}

DATI:
- ${contact.name} | ${city} | ${contact.email} | Tel: ${contact.phone || 'N/A'}
- Keyword "${rc.keyword || '?'}" -> posizione ${ranking.mainRank || '?'}
- Rating ${restaurantData.rating || '?'}/5 con ${restaurantData.reviewCount || '?'} recensioni
- ${covers} coperti/giorno -> stima 2 settimane prova: ${estimatedIn2Weeks || '?'} recensioni
- Menu digitale: ${menuNote || 'info non disponibile'}
- Competitor: ${competitorInfo || 'N/A'}

REGOLE TASSATIVE:
- MAI citare il prezzo
- MAI spiegare il meccanismo (QR, WhatsApp, filtro, bot) — si spiega nella chiamata
- MAI dire "ti faccio vedere" o "ti mostro" — di' "ti spiego come funziona la prova"
- Max 80 parole
- Firma solo col nome

COSA FARE:
1. Usa "search_similar_clients" per trovare un cliente MenuChat simile
2. Componi il messaggio seguendo la struttura sopra
3. Invia via email (send_email_reply)
4. NON mandare WhatsApp al primo contatto`;
};

const extractCity = (contact) => {
  if (contact.properties?.location) return contact.properties.location;
  if (contact.rankCheckerData?.restaurantData?.address) {
    const parts = contact.rankCheckerData.restaurantData.address.split(',');
    return parts.length >= 2 ? parts[parts.length - 2].trim() : '';
  }
  return '';
};

export default { startRankCheckerOutreachJob, processRankCheckerOutreach };
