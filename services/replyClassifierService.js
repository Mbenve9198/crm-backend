import Anthropic from '@anthropic-ai/sdk';

/**
 * Servizio per classificare le risposte email dai lead Smartlead con Claude AI
 * ed estrarre entità strutturate (telefono, nome contatto, disponibilità)
 * 
 * Categorie:
 * - INTERESTED: segnale positivo esplicito (domanda, telefono, richiesta info) → sequenza FERMATA
 * - NEUTRAL: risposta ambigua senza segnale positivo né rifiuto → sequenza FERMATA (no CRM, no notifica)
 * - NOT_INTERESTED: rifiuto esplicito senza richiesta di stop → sequenza FERMATA
 * - DO_NOT_CONTACT: richiesta esplicita di non essere contattati → sequenza FERMATA
 * - OUT_OF_OFFICE: risposte automatiche → sequenza CONTINUA
 */

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ITALIAN_PHONE_REGEX = /(?:(?:\+?39[\s.\-]?)?(?:3[0-9]{2}|0[0-9]{1,4})[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}[\s.\-]?\d{0,4})/g;

const CLASSIFICATION_PROMPT = `Sei un esperto analista di cold email outbound per il settore della ristorazione italiana.

Il tuo compito è CLASSIFICARE la risposta di un ristoratore a una nostra email commerciale e ESTRARRE dati strutturati dalla risposta.

CONTESTO DEL NOSTRO SERVIZIO:
Offriamo un sistema automatico per raccogliere recensioni Google per ristoranti tramite QR code e WhatsApp.
Le nostre email presentano dati sulla posizione Google Maps del ristorante, confronto con competitor locali, e propongono una prova gratuita del nostro sistema.

CATEGORIE DI CLASSIFICAZIONE (scegli UNA):

1. **INTERESTED** — Il lead mostra un SEGNALE POSITIVO ESPLICITO di engagement.
   Classifica come INTERESTED SOLO se:
   - Chiede informazioni, prezzi, come funziona, tempistiche
   - Fornisce numero di telefono NEL CORPO del messaggio (NON nella firma) o chiede di essere chiamato
   - Dice "sì mi interessa", "parliamone", "mandami info", "dimmi di più"
   - Chiede una demo, prova gratuita, o vuole vedere il sistema
   - Fa domande specifiche sul servizio (costi, funzionamento, risultati)
   - Chiede come iniziare o propone un appuntamento/chiamata
   - Propone date/orari per sentirsi ("sentiamoci venerdì", "chiamami dopo le 16")
   - Fornisce contatto di una persona specifica da chiamare ("parla con Paolo", "chiedi di Mattia")

2. **NEUTRAL** — La risposta NON contiene né un segnale positivo esplicito né un rifiuto chiaro.
   Classifica come NEUTRAL se:
   - Risposte brevi senza contenuto: "Ok", "Ricevuto", "Grazie", "Buongiorno", "Ottimo"
   - Reindirizzamento email/contatto: "scrivete a questo indirizzo", "contattate la nuova gestione" (se non è una cessione definitiva)
   - Spiega una situazione TEMPORANEA senza interesse: "siamo stagionali", "apriamo a maggio", "siamo chiusi per ferie", "riapriamo a settembre"
   - Critica i dati della nostra email senza mostrare interesse nel servizio
   - Confusione: "non ho capito", "di cosa si tratta?", "chi sei?"
   - Delega generica: "c'è mia nipote che se ne occupa", "la mail è stata inoltrata al reparto"
   - Risponde solo con un link (es. link Google Maps o sito) senza testo significativo
   - Risposte tipo "ho visto la mail", "grazie per il suo interessamento", "grazie comunque"
   - Risposte vaghe: "forse più avanti", "ci penso", "non adesso", "non è il momento"
   - Feedback sui dati: "il ristorante che citi è lontano da noi", "quella keyword è sbagliata"
   - ATTENZIONE: "abbiamo chiuso" DA SOLO è ambiguo — se è chiusura definitiva/cessata attività → NOT_INTERESTED; se è chiusura stagionale/temporanea → NEUTRAL

3. **NOT_INTERESTED** — Il lead rifiuta ESPLICITAMENTE e CHIARAMENTE, oppure l'attività non è più attiva/raggiungibile.
   Classifica come NOT_INTERESTED se:
   - Dice chiaramente "non ci interessa", "non ci serve", "non siamo interessati", "non sono interessato/a"
   - Dice "no mi interessa", "non mi interessava", "non ci interessava" (anche varianti passato)
   - Dice che l'attività è sospesa/chiusa E non mostra apertura futura
   - Dice che ha già un fornitore e non vuole cambiare ("abbiamo già un sistema")
   - Rifiuto cortese ma definitivo: "non fa per noi", "non è di nostro interesse"
   - "Grazie ma non siamo interessati / non ci serve"
   - "Per il momento non sono interessato/a" (rifiuto temporale con "non")
   - Dice che non ha budget / soldi ("non investo", "non abbiamo fondi")
   - **L'attività è stata VENDUTA o CEDUTA**: "il ristorante è stato venduto", "abbiamo venduto", "ho ceduto l'attività", "è stato ceduto" — il destinatario non è più il proprietario/decisore, quindi è un lead morto
   - **Non è più il proprietario/titolare**: "non sono più il proprietario", "non siamo più i titolari", "ho cambiato attività"
   - **Chiusura DEFINITIVA** (non stagionale): "abbiamo chiuso definitivamente", "il locale è chiuso", "abbiamo cessato l'attività" — senza indicazioni di riapertura

4. **DO_NOT_CONTACT** — Rifiuto netto con richiesta di stop.
   Classifica come DO_NOT_CONTACT se:
   - Chiede di NON essere più contattato: "non contattatemi più", "basta email"
   - Chiede rimozione/cancellazione: "rimuovetemi", "cancellate i miei dati", "unsubscribe"
   - Cita GDPR / privacy con richiesta cancellazione
   - Minaccia o cita vie legali
   - Risposta molto breve e secca: "No", "No grazie" (senza altre aperture)
   - Risposta aggressiva / insulti
   - Rifiuto + disclaimer GDPR nella stessa risposta

5. **OUT_OF_OFFICE** — Risposte automatiche che NON esprimono né interesse né disinteresse.
   Classifica come OUT_OF_OFFICE se:
   - Risposte automatiche: "fuori ufficio", "out of office", vacation reply
   - Autoresponder generici: "grazie per averci contattato, la risponderemo al più presto"
   - Risposte con solo orari apertura / info prenotazioni (risposte bot)
   - Bounce, delivery failure, mailer-daemon
   - Conferme di ricezione automatiche
   - "Siamo chiusi per ferie / riapriremo il..."
   - **Notifiche automatiche di cambio indirizzo email**: "l'indirizzo X verrà disattivato", "potrete contattarci al nuovo indirizzo Y", "saremo lieti di soddisfare ogni vostra richiesta" — sono comunicazioni di servizio inviate in massa, non risposte personali alla nostra email

REGOLE CRITICHE:
- NEL DUBBIO tra INTERESTED e NEUTRAL → scegli NEUTRAL (non INTERESTED)
- NEL DUBBIO tra NEUTRAL e NOT_INTERESTED → scegli NOT_INTERESTED se l'attività è definitivamente chiusa o venduta
- INTERESTED richiede un SEGNALE POSITIVO ESPLICITO (domanda, telefono, richiesta info/call)
- Un numero di telefono nella FIRMA email (dopo "Tel:", "Mobile:", "Fax:") NON conta come segnale positivo
- Un numero di telefono SCRITTO NEL CORPO del messaggio dal lead È un segnale positivo forte
- ABBREVIAZIONI ITALIANE: "nn" = "non", "n" = "non", "x" = "per". "Nn sono interessato" = NOT_INTERESTED
- "no mi interessa" = "non mi interessa" = NOT_INTERESTED (variante colloquiale comune)
- "non mi interessava" (passato) = NOT_INTERESTED
- Risposte che iniziano con rifiuto + disclaimer GDPR = DO_NOT_CONTACT
- Autoresponder generici (anche con numeri di telefono o WhatsApp) = OUT_OF_OFFICE
- ATTIVITÀ VENDUTA/CEDUTA = NOT_INTERESTED: "il ristorante è stato venduto", "abbiamo ceduto", "non sono più il proprietario" → il lead non è più un potenziale cliente, non ha senso contattarlo
- CHIUSURA DEFINITIVA = NOT_INTERESTED: "abbiamo chiuso definitivamente", "cessata attività" — senza apertura futura
- CHIUSURA TEMPORANEA = NEUTRAL: "chiusi per ferie", "riapriamo a settembre", "siamo stagionali" — potrebbero riaprire

ESTRAZIONE ENTITÀ:
Oltre alla classificazione, estrai i seguenti dati dalla risposta (se presenti):
- phone: numero di telefono fornito DAL LEAD nel corpo del messaggio (NON dalla firma). Normalizza con prefisso +39
- contactName: nome della persona da contattare se diverso dal destinatario
- preferredChannel: "phone", "whatsapp", "email", "in_person" — come preferisce essere contattato
- availability: finestre di disponibilità menzionate ("dopo le 16", "venerdì mattina", "la prossima settimana")
- specificRequest: cosa chiede specificamente il lead (max 80 caratteri)

FORMATO RISPOSTA (SOLO JSON valido, nient'altro):
{
  "category": "INTERESTED|NEUTRAL|NOT_INTERESTED|DO_NOT_CONTACT|OUT_OF_OFFICE",
  "confidence": 0.0-1.0,
  "reason": "breve spiegazione in italiano (max 100 caratteri)",
  "extracted": {
    "phone": "+39XXXXXXXXXX o null",
    "contactName": "nome o null",
    "preferredChannel": "phone|whatsapp|email|in_person|null",
    "availability": "descrizione o null",
    "specificRequest": "descrizione o null"
  }
}`;

/**
 * Classifica una risposta email con AI ed estrae entità strutturate
 */
export const classifyReply = async (replyText, context = {}) => {
  try {
    if (!replyText || replyText.trim().length === 0) {
      return { category: 'OUT_OF_OFFICE', confidence: 1.0, reason: 'Risposta vuota', shouldStopSequence: false, extracted: {} };
    }

    const cleanedReply = cleanReplyText(replyText);

    const quickResult = quickClassify(cleanedReply);
    if (quickResult) {
      console.log(`⚡ Classificazione rapida: ${quickResult.category} (${quickResult.reason})`);
      return quickResult;
    }

    const detectedPhones = detectPhonesInBody(cleanedReply);

    let userMessage = `RISPOSTA EMAIL DA CLASSIFICARE:\n\n"${cleanedReply}"`;
    if (detectedPhones.length > 0) {
      userMessage += `\n\nNUMERI TELEFONO RILEVATI NEL TESTO (da validare — potrebbero essere in firma): ${detectedPhones.join(', ')}`;
    }
    if (context.restaurantName) userMessage += `\n\nCONTESTO:\n- Ristorante: ${context.restaurantName}`;
    if (context.campaignName) userMessage += `\n- Campagna: ${context.campaignName}`;
    if (context.subject) userMessage += `\n- Oggetto email originale: ${context.subject}`;

    console.log(`🤖 Classificazione AI della risposta (${cleanedReply.length} caratteri)...`);

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: `${CLASSIFICATION_PROMPT}\n\n${userMessage}` }]
    });

    const result = parseClassificationResponse(message.content[0].text.trim());
    console.log(`✅ Classificazione AI: ${result.category} (confidence: ${result.confidence}) - ${result.reason}`);
    if (result.extracted?.phone) console.log(`📱 Telefono estratto: ${result.extracted.phone}`);
    if (result.extracted?.contactName) console.log(`👤 Contatto: ${result.extracted.contactName}`);
    return result;

  } catch (error) {
    console.error('❌ Errore classificazione AI:', error);
    return { category: 'NEUTRAL', confidence: 0.0, reason: 'Errore AI — default NEUTRAL', shouldStopSequence: true, extracted: {} };
  }
};

/**
 * Rileva numeri di telefono italiani nel testo (pre-processing per il prompt)
 */
const detectPhonesInBody = (text) => {
  const matches = text.match(ITALIAN_PHONE_REGEX) || [];
  return [...new Set(matches.map(m => m.replace(/[\s.\-]/g, '').trim()).filter(m => m.length >= 6))];
};

const quickClassify = (text) => {
  const lower = text.toLowerCase().trim();

  const normalized = lower
    .replace(/\bnn\b/g, 'non')
    .replace(/\bn\b(?=\s+(sono|siamo|ci|mi|è|ho|abbiamo|voglio|vogliamo))/g, 'non')
    .replace(/\bxchè\b|\bxché\b|\bperchè\b/g, 'perché')
    .replace(/\bx\b/g, 'per')
    .replace(/\bcmq\b/g, 'comunque')
    .replace(/\bqnd\b/g, 'quando')
    .replace(/\btt\b/g, 'tutto')
    .replace(/\bgrz\b/g, 'grazie');

  // --- OUT_OF_OFFICE: autoresponder, fuori ufficio, bounce ---
  const oooPatterns = [
    'fuori ufficio', 'out of office', 'automatisch', 'auto-reply',
    'automatic reply', 'risposta automatica', 'vacation',
    'non sono disponibile fino', 'sarò assente', 'saro assente', 'away from',
    'i am currently out', 'je suis absent', 'abwesend',
    'delivery status notification', 'undeliverable', 'mail delivery failed',
    'mailer-daemon', 'postmaster', 'noreply', 'no-reply', 'donotreply',
    'il tuo ticket', 'your ticket', 'ticket number', 'numero ticket',
    'prenotazione confermata', 'booking confirmed',
    'riapriremo', 'riapriamo', 'chiusi per ferie',
    'chiusura estiva', 'chiusura invernale',
    'autoresponder', 'message automatique',
    'grazie per averci contattato',
    'la risponderemo al più presto', 'la risponderemo al piu presto',
    'un nostro responsabile', 'provvederemo a rispondervi',
    '***messaggio automatico***',
    'per prenotazioni chiediamo gentilmente',
    'per prenotare clicca', 'prenota un tavolo',
    'siamo aperti a cena', 'siamo aperti a pranzo',
    'orari di apertura',
    // Notifiche automatiche di cambio indirizzo email
    'verrà a breve disattivato', 'verra a breve disattivato',
    'verrà disattivato', 'verra disattivato',
    'saremo lieti di soddisfare',
    'nuovo indirizzo email', 'nuovo indirizzo di posta',
    'cambio indirizzo email', 'cambio di indirizzo email',
    'indirizzo email aggiornato', 'indirizzo aggiornato'
  ];
  for (const p of oooPatterns) {
    if (normalized.includes(p)) return { category: 'OUT_OF_OFFICE', confidence: 0.95, reason: 'Risposta automatica / fuori ufficio', shouldStopSequence: false, extracted: {} };
  }

  // --- DO_NOT_CONTACT: "No" secco, richiesta stop, toni legali ---
  if (/^no+\b/.test(normalized) && normalized.length < 50) {
    return { category: 'DO_NOT_CONTACT', confidence: 0.97, reason: 'Rifiuto secco (NO)', shouldStopSequence: true, extracted: {} };
  }

  const dncPatterns = [
    'non contattatemi più', 'non contattatemi piu', 'non contattarmi più', 'non contattarmi piu',
    'non contattateci più', 'non contattateci piu',
    'non scrivetemi più', 'non scrivetemi piu', 'non scriveteci più', 'non scriveteci piu',
    'non voglio più ricevere', 'non voglio piu ricevere',
    'non desidero ulteriori comunicazioni', 'non desideriamo ulteriori comunicazioni',
    'rimuovetemi dalla mailing list', 'rimuoveteci dalla mailing list', 'rimuovere dalla mailing list',
    'cancellate i miei dati', 'cancellate i nostri dati', 'cancellazione immediata', 'cancellazione definitiva',
    'unsubscribe', 'disiscrivi', 'disiscrivimi', 'disiscrivetemi',
    'remove me', 'remove us', 'stop emailing', 'stop sending',
    'vi diffidiamo dal contattare', 'diffidiamo dal contattarvi ulteriormente',
    'procederemo per vie legali', 'per vie legali',
    'segnaleremo alle autorità', 'segnalare alle autorità',
    'violazione della privacy', 'gdpr',
    'basta email', 'basta messaggi', 'è spam', 'e spam', 'spam',
    'no', 'no grazie', 'no, grazie', 'no non mi interessa', 'no, non mi interessa'
  ];
  for (const p of dncPatterns) {
    if (normalized === p || normalized.startsWith(p + ' ') || normalized.startsWith(p + '.') || normalized.startsWith(p + ',')) {
      return { category: 'DO_NOT_CONTACT', confidence: 0.97, reason: 'Richiesta stop contatti / rifiuto secco', shouldStopSequence: true, extracted: {} };
    }
  }

  // Rifiuto + cancellazione combinata
  if (
    (normalized.includes('cancellate') || normalized.includes('cancellazione') || normalized.includes('rimuovetemi') || normalized.includes('rimuoveteci')) &&
    (normalized.includes('non siamo interessati') || normalized.includes('non mi interessa') ||
     normalized.includes('non ci interessa') || normalized.includes('non sono interessat'))
  ) {
    return { category: 'DO_NOT_CONTACT', confidence: 0.96, reason: 'Non interessato + richiesta di cancellazione', shouldStopSequence: true, extracted: {} };
  }

  // --- NOT_INTERESTED: rifiuto esplicito ---
  const negPatterns = [
    'non ci interessa', 'non mi interessa', 'non siamo interessati',
    'non sono interessato', 'non sono interessata',
    'non interessato', 'non interessata', 'non interessati',
    'non mi interessava', 'non ci interessava', 'non interessava',
    'no mi interessa', 'no mi interessava', 'no ci interessa',
    'non abbiamo bisogno', 'al momento non abbiamo bisogno',
    'non ci serve', 'al momento non ci serve',
    'non ne abbiamo bisogno',
    'abbiamo già un fornitore', 'abbiamo gia un fornitore',
    'abbiamo già questo servizio', 'abbiamo gia questo servizio',
    'abbiamo già un sistema', 'abbiamo gia un sistema',
    'non utilizziamo questo tipo di servizio', 'non utilizziamo questo servizio',
    'la nostra attività è sospesa', 'la nostra attivita è sospesa',
    'la nostra attività e sospesa', 'la nostra attivita e sospesa',
    'attività momentaneamente sospesa', 'attivita momentaneamente sospesa',
    'attività chiusa', 'attivita chiusa',
    'non fa per noi', 'non è il nostro ambito', 'non e il nostro ambito',
    'non è di nostro interesse', 'non e di nostro interesse',
    'grazie ma non siamo interessati', 'grazie ma non ci serve',
    'per il momento non sono interessat',
    'per ora non ci interessa', 'per adesso non ci interessa',
    'al momento non investo', 'non investo soldi',
    'non abbiamo fondi', 'non abbiamo budget',
    // Attività venduta / ceduta → lead morto, non è più il decisore
    'è stato venduto', 'e stato venduto',
    'è stata venduta', 'e stata venduta',
    'è stato ceduto', 'e stato ceduto',
    'è stata ceduta', 'e stata ceduta',
    'abbiamo venduto', 'ho venduto',
    'abbiamo ceduto', 'ho ceduto',
    'l\'attività è stata venduta', 'l\'attivita è stata venduta',
    'il locale è stato venduto', 'il locale e stato venduto',
    'il ristorante è stato venduto', 'il ristorante e stato venduto',
    // Non più proprietario / titolare
    'non sono più il proprietario', 'non sono piu il proprietario',
    'non sono più la proprietaria', 'non sono piu la proprietaria',
    'non sono più il titolare', 'non sono piu il titolare',
    'non sono più la titolare', 'non sono piu la titolare',
    'non siamo più i proprietari', 'non siamo piu i proprietari',
    'non siamo più i titolari', 'non siamo piu i titolari',
    'ho cambiato attività', 'ho cambiato attivita',
    'abbiamo cambiato attività', 'abbiamo cambiato attivita',
    // Chiusura definitiva (senza indicazioni di riapertura)
    'abbiamo chiuso definitivamente', 'abbiamo chiuso per sempre',
    'chiuso definitivamente', 'chiuso per sempre',
    'cessata attività', 'cessata l\'attività', 'cessata l\'attivita',
    'attività cessata', 'attivita cessata',
    'abbiamo cessato l\'attività', 'abbiamo cessato l\'attivita'
  ];
  for (const p of negPatterns) {
    if (normalized.includes(p)) return { category: 'NOT_INTERESTED', confidence: 0.95, reason: 'Rifiuto esplicito o attività non più attiva', shouldStopSequence: true, extracted: {} };
  }

  // --- INTERESTED: segnale positivo esplicito ---
  const phoneInBodyPatterns = [
    'il mio numero', 'ecco il numero', 'contattatemi al',
    'chiamami', 'chiamatemi', 'chiamateci', 'mi chiami', 'ci chiami',
    'dammi il tuo numero', 'lascio il numero', 'ti lascio il numero',
    'ti lascio il mio numero',
  ];
  for (const p of phoneInBodyPatterns) {
    if (normalized.includes(p)) {
      const phones = detectPhonesInBody(text);
      const phone = phones.length > 0 ? (phones[0].startsWith('+') ? phones[0] : '+39' + phones[0]) : null;
      return { category: 'INTERESTED', confidence: 0.95, reason: 'Lead fornisce numero di telefono', shouldStopSequence: true, extracted: { phone, preferredChannel: 'phone' } };
    }
  }

  const whatsappPatterns = [
    'scrivimi su wa', 'scrivimi su whatsapp', 'mandami un whatsapp',
    'scrivi su whatsapp', 'contattami su whatsapp',
  ];
  for (const p of whatsappPatterns) {
    if (normalized.includes(p)) {
      const phones = detectPhonesInBody(text);
      const phone = phones.length > 0 ? (phones[0].startsWith('+') ? phones[0] : '+39' + phones[0]) : null;
      return { category: 'INTERESTED', confidence: 0.95, reason: 'Lead chiede WhatsApp', shouldStopSequence: true, extracted: { phone, preferredChannel: 'whatsapp' } };
    }
  }

  const posPatterns = [
    'quanto costa', 'qual è il prezzo', 'che prezzo', 'quali sono i costi',
    'come funziona il vostro', 'vorrei sapere di più', 'mi interessa',
    'sono interessato', 'sono interessata', 'siamo interessati',
    'ci interessa', 'potrebbe interessare',
    'possiamo parlarne', 'parliamone', 'facciamo una call',
    'prendiamo un appuntamento', 'fissiamo una chiamata',
    'sentiamoci', 'quando possiamo sentirci',
    'puoi contattarmi', 'può contattarmi', 'può chiamarmi', 'puoi chiamarmi',
    'mandami info', 'mandatemi info', 'dimmi di più',
    'vorrei sapere', 'vorrei capire',
    'mi spieghi', 'mi spiegate', 'se mi spiega',
    'fammi sapere come', 'fatemi sapere come',
    'che tipo di proposta', 'maggiori informazioni',
    'illustrarci la proposta',
    'contatta il nostro responsabile'
  ];
  for (const p of posPatterns) {
    if (normalized.includes(p)) return { category: 'INTERESTED', confidence: 0.95, reason: 'Interesse esplicito / richiesta contatto', shouldStopSequence: true, extracted: {} };
  }

  // --- NEUTRAL: nessun pattern matched, ma testo troppo corto per essere significativo ---
  if (normalized.length < 30) {
    return { category: 'NEUTRAL', confidence: 0.80, reason: 'Risposta troppo breve per determinare interesse', shouldStopSequence: true, extracted: {} };
  }

  return null;
};

export const cleanReplyText = (text) => {
  if (!text) return '';
  let c = text;
  c = c.replace(/<style[^>]*>.*<\/style>/gmi, '');
  c = c.replace(/<script[^>]*>.*<\/script>/gmi, '');
  c = c.replace(/<[^>]+>/gm, ' ');
  c = c.replace(/^[>|].*$/gm, '');
  c = c.replace(/On .+ wrote:[\s\S]*$/i, '');
  c = c.replace(/Il .+ ha scritto:[\s\S]*$/i, '');
  c = c.replace(/------+ ?Original Message ?------+[\s\S]*$/i, '');
  c = c.replace(/------+ ?Messaggio originale ?------+[\s\S]*$/i, '');
  c = c.replace(/Da:.*Inviato:.*[\s\S]*$/i, '');
  c = c.replace(/From:.*Sent:.*[\s\S]*$/i, '');
  c = c.replace(/--\s*\n[\s\S]*$/, '');
  c = c.replace(/Cordiali saluti[\s\S]*$/i, '');
  c = c.replace(/Distinti saluti[\s\S]*$/i, '');
  c = c.replace(/Best regards[\s\S]*$/i, '');
  c = c.replace(/Inviato da iPhone[\s\S]*$/i, '');
  c = c.replace(/Inviato dal mio iPhone[\s\S]*$/i, '');
  c = c.replace(/Sent from my iPhone[\s\S]*$/i, '');
  c = c.replace(/Inviato da Outlook[\s\S]*$/i, '');
  c = c.replace(/Inviato da Libero Mail[\s\S]*$/i, '');
  c = c.replace(/Inviato da App Mail[\s\S]*$/i, '');
  c = c.replace(/Ottieni BlueMail[\s\S]*$/i, '');
  c = c.replace(/\s\s+/g, ' ').trim();
  if (c.length > 2000) c = c.substring(0, 2000) + '...';
  return c;
};

const parseClassificationResponse = (responseText) => {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const parsed = JSON.parse(jsonMatch[0]);
    const validCategories = ['INTERESTED', 'NEUTRAL', 'NOT_INTERESTED', 'DO_NOT_CONTACT', 'OUT_OF_OFFICE'];
    if (!validCategories.includes(parsed.category)) throw new Error(`Invalid category: ${parsed.category}`);

    const extracted = parsed.extracted || {};
    return {
      category: parsed.category,
      confidence: Math.min(1, Math.max(0, parseFloat(parsed.confidence) || 0.5)),
      reason: parsed.reason || 'N/A',
      shouldStopSequence: parsed.category !== 'OUT_OF_OFFICE',
      extracted: {
        phone: extracted.phone && extracted.phone !== 'null' ? extracted.phone : null,
        contactName: extracted.contactName && extracted.contactName !== 'null' ? extracted.contactName : null,
        preferredChannel: extracted.preferredChannel && extracted.preferredChannel !== 'null' ? extracted.preferredChannel : null,
        availability: extracted.availability && extracted.availability !== 'null' ? extracted.availability : null,
        specificRequest: extracted.specificRequest && extracted.specificRequest !== 'null' ? extracted.specificRequest : null
      }
    };
  } catch (error) {
    console.error('❌ Errore parsing classificazione:', error.message);
    const upper = responseText.toUpperCase();
    if (upper.includes('DO_NOT_CONTACT')) return { category: 'DO_NOT_CONTACT', confidence: 0.5, reason: 'Parsing fallback', shouldStopSequence: true, extracted: {} };
    if (upper.includes('NOT_INTERESTED')) return { category: 'NOT_INTERESTED', confidence: 0.5, reason: 'Parsing fallback', shouldStopSequence: true, extracted: {} };
    if (upper.includes('OUT_OF_OFFICE')) return { category: 'OUT_OF_OFFICE', confidence: 0.5, reason: 'Parsing fallback', shouldStopSequence: false, extracted: {} };
    if (upper.includes('INTERESTED')) return { category: 'INTERESTED', confidence: 0.5, reason: 'Parsing fallback', shouldStopSequence: true, extracted: {} };
    return { category: 'NEUTRAL', confidence: 0.3, reason: 'Default NEUTRAL', shouldStopSequence: true, extracted: {} };
  }
};

export default { classifyReply, cleanReplyText };
