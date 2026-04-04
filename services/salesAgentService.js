import Anthropic from '@anthropic-ai/sdk';
import Conversation from '../models/conversationModel.js';
import Contact from '../models/contactModel.js';
import AgentMetric from '../models/agentMetricModel.js';
import KnowledgeChunk from '../models/knowledgeChunkModel.js';
import agentLogger from './agentLogger.js';
import { AGENT_TOOLS, executeTools } from './agentToolsService.js';
import { sendAgentActivityReport } from './emailNotificationService.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_MODEL = 'claude-opus-4-20250514';
const AGENT_TEMPERATURE = 0.35;
const MAX_TOOL_ROUNDS = 5;

const OPUS_INPUT_RATE = 5 / 1_000_000;
const OPUS_OUTPUT_RATE = 25 / 1_000_000;

// Lock per-conversation per evitare esecuzioni parallele sullo stesso contatto
const conversationLocks = new Map();
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

const acquireLock = (contactId) => {
  const key = contactId.toString();
  const now = Date.now();
  const existing = conversationLocks.get(key);
  if (existing && now - existing < LOCK_TIMEOUT_MS) {
    return false;
  }
  conversationLocks.set(key, now);
  return true;
};

const releaseLock = (contactId) => {
  conversationLocks.delete(contactId.toString());
};

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

STRATEGIA PER TIPO DI LEAD:

SE IL LEAD È OUTBOUND (fonte: smartlead_outbound):
- Ha ricevuto una nostra email fredda e ha risposto. NON ti conosce, probabilmente è diffidente
- Priorità: costruire rapport e credibilità. Ringrazia per la risposta, riconosci il suo tempo
- Non bombardare di informazioni — fai UNA domanda mirata sulla sua situazione attuale
- Tono: più morbido e consultivo. Mostra che capisci il suo mondo, non stai vendendo
- NON proporre la chiamata al primo messaggio — prima crea valore. La chiamata arriva dopo che il lead ha mostrato apertura
- Se risponde in modo neutro o con domande, è un BUON segnale — vuol dire che non ha ignorato l'email
- Usa "search_similar_clients" per trovare un ristorante simile al suo — la social proof è la leva più forte su un lead freddo

SE IL LEAD È INBOUND (fonte: inbound_rank_checker):
- Ha usato il nostro Rank Checker volontariamente — ha già un interesse attivo
- Priorità: capitalizzare l'interesse rapidamente. Il lead è "caldo", non farlo raffreddare
- Vai dritto al punto: hai visto i suoi dati, sai la sua posizione, conosci i suoi competitor
- Proponi subito la chiamata — "Ti chiamo 5 minuti per spiegarti come funziona la prova?"
- Personalizza con i dati del rank checker: posizione, competitor, coperti, stima recensioni
- Se hai già il numero di telefono nei dati, conferma e proponi di chiamare direttamente

GESTIONE OBIEZIONI:
Quando il lead solleva un'obiezione, NON arrenderti e NON chiedere aiuto subito. Hai queste strategie:

"Non ho tempo" / "Sono impegnato":
→ "Capisco perfettamente, proprio per questo ti propongo 5 minuti al telefono — non una presentazione, solo per capire se ha senso per te. Se non fa al caso tuo, ci salutiamo in 5 minuti. Quando ti viene più comodo?"

"Mandami una mail" / "Mandami le informazioni":
→ "Certo, però un paio di cose cambiano da locale a locale — tipo la stima delle recensioni dipende dai tuoi coperti. 5 minuti al telefono e ti do numeri concreti per il tuo ristorante. Preferisci mattina o pomeriggio?"

"Quanto costa?" / "Qual è il prezzo?":
→ "Il listino è 1.290€ all'anno, ma la cosa bella è che partiamo con 2 settimane di prova gratuita — zero impegno. Nella chiamata ti spiego come funziona e vediamo se è adatto al tuo locale. Ti chiamo?"

"Ho già un sistema" / "Abbiamo già un fornitore":
→ "Ottimo, vuol dire che credi nel valore delle recensioni! Curiosità: quante ne raccogliete al mese? Il nostro sistema è complementare — molti lo usano insieme ad altri strumenti. Se vuoi, ti spiego i numeri in 5 minuti."

"Non mi interessa" (tono soft / esitante):
→ Non forzare. Rispondi con gentilezza: "Nessun problema! Se cambi idea, sai dove trovarmi. In ogni caso, il rank checker è gratuito — puoi usarlo quando vuoi per monitorare la tua posizione su Maps. In bocca al lupo!"
→ Poi usa schedule_followup per 14 giorni con nota "Rifiuto soft, ricontattare con angolo diverso"

"Non è il momento" / "Forse più avanti" / "Ci penso":
→ "Capisco, nessun problema. Ti riscrivo tra un paio di settimane? Così non ti perdi niente e decidi con calma."
→ Usa schedule_followup con i giorni appropriati

"È troppo caro" / "Non ho budget":
→ "Guarda, partiamo con 2 settimane gratis — e poi parliamo del prezzo solo se funziona. Il nostro interesse è lavorare insieme, siamo molto flessibili sulle condizioni. Ti chiamo 5 minuti?"

REGOLA D'ORO OBIEZIONI: ogni obiezione è un'opportunità. Il lead sta parlando con te — vuol dire che non è completamente disinteressato. Il tuo obiettivo è sempre riportare il focus su: basso rischio (prova gratuita) + basso impegno (chiamata 5 minuti).

FASE DELLA CONVERSAZIONE:
Adatta il tuo comportamento alla fase in cui ti trovi:
- "initial_reply": primo scambio. Conosci il lead, personalizza, crea connessione. Per OUTBOUND non proporre ancora la chiamata.
- "objection_handling": il lead ha obiezioni. Usa le strategie sopra. Massimo 2 tentativi sulla stessa obiezione — se non si sblocca, schedule_followup o request_human_help.
- "qualification": stai raccogliendo info. Chiedi i coperti, se ha menu digitale, quante recensioni fa ora.
- "scheduling": il lead è aperto. Usa "book_callback" per raccogliere numero e disponibilità e confermare la chiamata.

QUANDO IL LEAD DICE SÌ ALLA CHIAMATA:
Quando il lead accetta di essere contattato telefonicamente:
1. Usa il tool "book_callback" per raccogliere/confermare il numero e le fasce orarie
2. Il tool invierà automaticamente un messaggio di conferma al lead
3. NON chiudere la conversazione senza conferma esplicita del numero e della fascia oraria

ESTRAZIONE INSIGHT:
Dopo ogni risposta del lead, valuta mentalmente:
- Quali obiezioni sono emerse? (prezzo, tempo, competitor, non interessa, bad timing)
- Quali pain point ha espresso? (poche recensioni, competitor più visibili, menu cartaceo, nessun sistema digitale)
- Il lead ha fornito info utili? (coperti, tipo locale, numero telefono, persona da contattare)
Questi insight saranno salvati automaticamente per personalizzare i messaggi futuri.

${context || ''}`;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KNOWLEDGE BASE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const KEYWORD_MAP = {
  objection: ['prezzo', 'costo', 'costa', 'budget', 'caro', 'tempo', 'impegnato', 'interessa', 'sistema', 'fornitore', 'già', 'gia'],
  product: ['come funziona', 'funziona', 'qr', 'whatsapp', 'menu', 'recensioni', 'digitale', 'filtro'],
  faq: ['false', 'finte', 'gdpr', 'privacy', 'wifi', 'quante', 'negative', 'stima'],
  pricing: ['prezzo', 'costo', 'costa', 'quanto', 'prova', 'gratis', 'gratuita', 'annuale'],
  competitor: ['pienissimo', 'tripadvisor', 'thefork', 'competitor', 'concorrente']
};

const fetchRelevantKnowledge = async (leadMessage) => {
  try {
    const lower = (leadMessage || '').toLowerCase();
    const matchedKeywords = [];
    let bestCategory = null;

    for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          matchedKeywords.push(kw);
          if (!bestCategory) bestCategory = category;
        }
      }
    }

    if (matchedKeywords.length === 0) return null;

    const chunks = await KnowledgeChunk.searchByKeywords(matchedKeywords, bestCategory, 2);
    if (!chunks || chunks.length === 0) return null;

    return chunks.map(c => c.content).join('\n\n---\n\n');
  } catch {
    return null;
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST-LOOP: estrazione insight e progressione stage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const OBJECTION_PATTERNS = [
  { pattern: /non (ho|abbiamo) tempo|sono impegnat|impegnatissim/i, label: 'no_tempo' },
  { pattern: /manda(mi|temi|teci)? (una )?(mail|email|info|informazioni)/i, label: 'mandami_mail' },
  { pattern: /quanto costa|qual è il prezzo|che prezzo|costi|listino/i, label: 'prezzo' },
  { pattern: /già (un|il) (sistema|fornitore|servizio)|abbiamo già/i, label: 'ha_gia_fornitore' },
  { pattern: /non (mi |ci )?(interessa|serve|fa per)/i, label: 'non_interessa' },
  { pattern: /non è il momento|forse più avanti|ci penso|più avanti/i, label: 'bad_timing' },
  { pattern: /troppo caro|non (ho|abbiamo) budget|costoso/i, label: 'troppo_caro' },
  { pattern: /non (ho|abbiamo) bisogno/i, label: 'no_bisogno' }
];

const PAIN_PATTERNS = [
  { pattern: /poche recensioni|recensioni basse|pochi feedback/i, label: 'poche_recensioni' },
  { pattern: /competitor|concorren|ci superano|ci hanno sorpassato/i, label: 'competitor_visibili' },
  { pattern: /menu cartaceo|non (abbiamo|ho) menu digitale|menu fisico/i, label: 'no_menu_digitale' },
  { pattern: /non ci trovano|visibilità bassa|non siamo visibil/i, label: 'bassa_visibilita' },
  { pattern: /recensioni negative|stelle basse|rating basso/i, label: 'recensioni_negative' },
  { pattern: /clienti persi|meno clienti|calo clienti/i, label: 'calo_clienti' }
];

const extractInsightsFromMessage = (text) => {
  const objections = [];
  const painPoints = [];

  for (const { pattern, label } of OBJECTION_PATTERNS) {
    if (pattern.test(text)) objections.push(label);
  }
  for (const { pattern, label } of PAIN_PATTERNS) {
    if (pattern.test(text)) painPoints.push(label);
  }

  return { objections, painPoints };
};

const inferStage = (conversation, toolsUsed) => {
  const hasBookedCallback = toolsUsed.some(t => t.name === 'book_callback');
  if (hasBookedCallback) return 'handoff';

  const hasScheduledFollowup = toolsUsed.some(t => t.name === 'schedule_followup');
  if (hasScheduledFollowup) return conversation.stage;

  const msgCount = conversation.messages?.length || 0;
  const objCount = conversation.context?.objections?.length || 0;

  if (objCount > 0) return 'objection_handling';
  if (msgCount >= 4) return 'qualification';
  return conversation.stage || 'initial_reply';
};

const updateConversationInsights = async (conversation, leadMessage, toolsUsed) => {
  const { objections, painPoints } = extractInsightsFromMessage(leadMessage);

  let changed = false;

  if (objections.length > 0) {
    if (!conversation.context.objections) conversation.context.objections = [];
    for (const obj of objections) {
      if (!conversation.context.objections.includes(obj)) {
        conversation.context.objections.push(obj);
        changed = true;
      }
    }
  }

  if (painPoints.length > 0) {
    if (!conversation.context.painPoints) conversation.context.painPoints = [];
    for (const pp of painPoints) {
      if (!conversation.context.painPoints.includes(pp)) {
        conversation.context.painPoints.push(pp);
        changed = true;
      }
    }
  }

  const newStage = inferStage(conversation, toolsUsed);
  if (newStage !== conversation.stage) {
    conversation.stage = newStage;
    changed = true;
  }

  if (changed) {
    conversation.markModified('context');
    await conversation.save();
  }
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

  contextBlock += `\n\nFASE CONVERSAZIONE: ${conversation.stage || 'initial_reply'}`;
  contextBlock += `\n- Messaggi scambiati: ${conversation.messages?.length || 0}`;

  if (conversation.context?.objections?.length > 0) {
    contextBlock += `\n\nOBIEZIONI GIÀ EMERSE: ${conversation.context.objections.join(', ')}`;
  }
  if (conversation.context?.painPoints?.length > 0) {
    contextBlock += `\nPAIN POINTS RILEVATI: ${conversation.context.painPoints.join(', ')}`;
  }

  // Knowledge base: inietta chunk rilevanti in base al messaggio del lead
  const knowledgeContext = await fetchRelevantKnowledge(leadMessage);
  if (knowledgeContext) {
    contextBlock += `\n\nINFORMAZIONI UTILI DALLA KNOWLEDGE BASE:\n${knowledgeContext}`;
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
  if (!acquireLock(contact._id)) {
    agentLogger.warn('conversation_locked', { contactEmail: contact.email, data: 'Agente già in esecuzione per questo contatto, skip' });
    return { action: 'locked', conversation: null };
  }

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

  try {
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

    agentLogger.info('agent_loop_start', { conversationId: conversation._id, contactEmail: contact.email, data: { name: contact.name } });
    const agentResult = await runAgentLoop(conversation, replyText);

    // Post-loop: estrai insight e aggiorna stage
    await updateConversationInsights(conversation, replyText, agentResult.toolsUsed).catch(() => {});

    if (agentResult.toolsUsed.length > 0) {
      agentLogger.info('tools_used', { conversationId: conversation._id, contactEmail: contact.email, data: agentResult.toolsUsed.map(t => t.name) });
    }

    const hasSentMessage = agentResult.toolsUsed.some(t =>
      t.name === 'send_email_reply' || t.name === 'send_whatsapp'
    );
    const hasRequestedHelp = agentResult.toolsUsed.some(t => t.name === 'request_human_help');
    const hasScheduledFollowup = agentResult.toolsUsed.some(t => t.name === 'schedule_followup');
    const hasBookedCallback = agentResult.toolsUsed.some(t => t.name === 'book_callback');

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

    if (hasBookedCallback) {
      conversation.stage = 'handoff';
      conversation.outcome = 'call_booked';
      await conversation.save();
      agentLogger.info('callback_booked', { conversationId: conversation._id, contactEmail: contact.email });
      const agentMsg = conversation.messages.filter(m => m.role === 'agent').pop();
      sendAgentActivityReport({ action: 'callback_booked', contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone, agentName: identity.name, leadMessage: replyText, agentReply: agentMsg?.content, toolsUsed: agentResult.toolsUsed.map(t => t.name), category, confidence, conversationId: conversation._id, source: contact.source }).catch(() => {});
      return { action: 'callback_booked', conversation };
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
  } finally {
    releaseLock(contact._id);
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
