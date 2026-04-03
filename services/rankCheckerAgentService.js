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

  const existingConvContactIds = await Conversation.distinct('contact', {
    status: { $nin: ['dead'] }
  });
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

  let prompt = `[ISTRUZIONE INTERNA - NON MOSTRARE AL LEAD]
Devi contattare per PRIMO questo ristoratore. Ha usato il nostro Rank Checker e ha visto i suoi dati di ranking su Google Maps. Ha lasciato email e telefono.

CONTATTO:
- Nome: ${contact.name}
- Email: ${contact.email}
- Telefono: ${contact.phone || 'non disponibile'}`;

  if (rc.keyword) prompt += `\n- Keyword analizzata: "${rc.keyword}"`;
  if (ranking.mainRank) prompt += `\n- Posizione trovata: ${ranking.mainRank}`;
  if (ranking.estimatedLostCustomers) prompt += `\n- Clienti persi stimati: ~${ranking.estimatedLostCustomers}/settimana`;
  if (rc.dailyCovers) prompt += `\n- Coperti/giorno: ${rc.dailyCovers}`;
  if (rc.hasDigitalMenu !== undefined) prompt += `\n- Ha menu digitale: ${rc.hasDigitalMenu ? 'sì' : 'no'}`;

  if (ranking.fullResults?.competitors?.length > 0) {
    prompt += `\n- Competitor principali:`;
    for (const c of ranking.fullResults.competitors.slice(0, 3)) {
      prompt += `\n  - ${c.name}: posizione ${c.rank}, ${c.reviews || '?'} recensioni`;
    }
  }

  prompt += `\n\nCOSA DEVI FARE:
1. Usa "search_similar_clients" per trovare un ristorante simile nella sua zona che usa MenuChat — ti serve come esempio concreto
2. Componi un messaggio email PERSONALIZZATO usando i dati di ranking che hai qui sopra
3. Il messaggio deve:
   - Aprire citando un dato specifico del SUO ristorante (posizione, competitor, recensioni)
   - Spiegare in 2 frasi come MenuChat risolve il problema (QR -> WhatsApp -> recensioni automatiche)
   - Se hai trovato un cliente simile, citalo con i numeri reali
   - Proporre una CHIAMATA AL CELLULARE veloce (5-10 minuti) per spiegargli come funziona
   - Menzionare la prova gratuita 2 settimane
   - Max 150 parole, tono da amico imprenditore
4. Invia via email (send_email_reply) — per ora solo email, WhatsApp verrà dopo
5. NON proporre MAI videochiamate o Google Meet — noi facciamo chiamate al cellulare

OBIETTIVO FINALE: portare il lead a una chiamata veloce al telefono → poi prova gratuita 2 settimane di MenuChat.

Il messaggio NON deve sembrare una cold email generica. Deve sembrare che hai PERSONALMENTE guardato i suoi dati e ti stai facendo vivo perché hai visto qualcosa di interessante.`;

  return prompt;
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
