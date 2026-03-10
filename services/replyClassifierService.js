import Anthropic from '@anthropic-ai/sdk';

/**
 * Servizio per classificare le risposte email dai lead Smartlead con Claude AI
 * 
 * Categorie:
 * - INTERESTED: qualsiasi risposta non chiaramente negativa → sequenza FERMATA
 * - NOT_INTERESTED: solo rifiuti espliciti → sequenza FERMATA
 * - OUT_OF_OFFICE: risposte automatiche → sequenza CONTINUA
 */

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CLASSIFICATION_PROMPT = `Sei un esperto analista di cold email outbound per il settore della ristorazione italiana.

Il tuo compito è classificare la RISPOSTA di un ristoratore a una nostra email commerciale.

CONTESTO DEL NOSTRO SERVIZIO:
Offriamo un sistema automatico per raccogliere recensioni Google per ristoranti tramite QR code e WhatsApp.
Le nostre email presentano dati sulla posizione Google Maps del ristorante, confronto con competitor locali, e propongono una prova gratuita del nostro sistema.

CATEGORIE DI CLASSIFICAZIONE (scegli UNA):

1. **INTERESTED** — Il lead mostra QUALSIASI segnale di engagement o non rifiuta chiaramente.
   Classifica come INTERESTED se:
   - Chiede informazioni, prezzi, come funziona, tempistiche
   - Fornisce numero di telefono o chiede di essere chiamato/ricontattato
   - Dice "sì mi interessa", "parliamone", "mandami info", "dimmi di più"
   - Chiede una demo, prova gratuita, o vuole vedere il sistema
   - Fa domande sul servizio (anche con dubbi o perplessità — è engagement positivo)
   - Chiede come iniziare, quanto costa, che risultati dà
   - Fa riferimento a voler migliorare recensioni o visibilità
   - Risponde in modo vago ma senza rifiutare ("magari ne parliamo", "ci penso", "forse più avanti")
   - Risponde con semplice curiosità ("che servizio è?", "come funziona?")
   - Qualsiasi risposta che NON è un rifiuto chiaro ed esplicito
   - NEL DUBBIO TRA INTERESTED E NOT_INTERESTED → scegli INTERESTED

2. **NOT_INTERESTED** — Il lead rifiuta ESPLICITAMENTE e CHIARAMENTE, ma senza chiedere esplicitamente di non essere più contattato in futuro.
   Classifica come NOT_INTERESTED se:
   - Dice chiaramente "non ci interessa", "non ci serve", "non siamo interessati", "non sono interessato", "non abbiamo bisogno"
   - Dice che l’attività è sospesa/chiusa ("attività momentaneamente sospesa", "ristorante chiuso", "non facciamo più questo servizio")
   - Dice che ha già un fornitore o un sistema e non vuole cambiarlo ora
   - Rifiuto cortese ma DEFINITIVO ("non è proprio il nostro ambito", "non fa per noi", "non è di nostro interesse")
   - Risposte tipo "grazie ma non siamo interessati / non ci serve"
   - Risposte come "ci aggiorniamo la prossima settimana" SENZA chiara apertura positiva e senza richiesta di maggiori info → considerale NOT_INTERESTED (non OUT_OF_OFFICE)

3. **DO_NOT_CONTACT** — Il lead NON vuole più essere contattato, oppure il rifiuto è talmente netto che è prudente non scrivergli mai più.
   Classifica come DO_NOT_CONTACT se:
   - Chiede esplicitamente di NON essere più contattato: "non contattatemi più", "non scrivetemi più", "basta email", "non voglio più ricevere vostre comunicazioni"
   - Chiede rimozione/cancellazione: "rimuovetemi/rimuoveteci dalla mailing list", "cancellate i miei dati", "cancellazione immediata/definitiva", "unsubscribe"
   - Cita GDPR / privacy con richiesta di cancellazione o diffida: "ai sensi del GDPR", "violazione della privacy", "diffidiamo dal contattarci ulteriormente"
   - Minaccia o cita vie legali / autorità: "procederemo per vie legali", "segnaleremo alle autorità", "spam"
   - Risposta molto breve e secca come solo "No", "No grazie", "No non mi interessa" (senza altre aperture positive)

4. **OUT_OF_OFFICE** — Risposte automatiche che NON esprimono né interesse né disinteresse.
   Classifica come OUT_OF_OFFICE se:
   - Risposte automatiche: "fuori ufficio", "out of office", "sono in ferie fino a..."
   - Auto-reply di sistema, vacation reply
   - Aperture ticket automatiche ("il tuo ticket #123 è stato aperto")
   - Risposte automatiche con link di prenotazione ("per prenotare clicca qui")
   - "Siamo chiusi per ferie" / "riapriremo il..." SENZA espressione di disinteresse
   - Bounce, delivery failure, mailer-daemon
   - Bot/chatbot risposte automatiche
   - Conferme di ricezione automatiche

REGOLE CRITICHE:
- Se hai QUALSIASI dubbio tra INTERESTED e NOT_INTERESTED → scegli INTERESTED
- "Ci penso" / "ne parliamo" / "forse" / "non adesso" / "magari dopo le ferie" = INTERESTED
- "Non abbiamo tempo in questo periodo" = INTERESTED
- Risposte brevi tipo "Ok", "Ricevuto", "Grazie" senza contesto = INTERESTED
- Risposte in altre lingue = classifica normalmente in base al contenuto
- ABBREVIAZIONI ITALIANE: "nn" = "non", "x" = "per", "cmq" = "comunque". "Nn sono interessato" = "Non sono interessato" = NOT_INTERESTED
- Se la risposta contiene disclaimer GDPR/privacy con richiesta cancellazione dati = DO_NOT_CONTACT (il lead non vuole essere contattato in futuro)
- Se la risposta inizia con un rifiuto chiaro + richiesta di non essere più contattato ("non sono interessato, cancellatemi", "no grazie, rimuovetemi") anche se seguito da testo legale/GDPR = DO_NOT_CONTACT

FORMATO RISPOSTA (SOLO JSON valido, nient'altro):
{
  "category": "INTERESTED|NOT_INTERESTED|DO_NOT_CONTACT|OUT_OF_OFFICE",
  "confidence": 0.0-1.0,
  "reason": "breve spiegazione in italiano (max 100 caratteri)"
}`;

/**
 * Classifica una risposta email con AI
 */
export const classifyReply = async (replyText, context = {}) => {
  try {
    if (!replyText || replyText.trim().length === 0) {
      return { category: 'OUT_OF_OFFICE', confidence: 1.0, reason: 'Risposta vuota', shouldStopSequence: false };
    }

    const cleanedReply = cleanReplyText(replyText);

    const quickResult = quickClassify(cleanedReply);
    if (quickResult) {
      console.log(`⚡ Classificazione rapida: ${quickResult.category} (${quickResult.reason})`);
      return quickResult;
    }

    let userMessage = `RISPOSTA EMAIL DA CLASSIFICARE:\n\n"${cleanedReply}"`;
    if (context.restaurantName) userMessage += `\n\nCONTESTO:\n- Ristorante: ${context.restaurantName}`;
    if (context.campaignName) userMessage += `\n- Campagna: ${context.campaignName}`;
    if (context.subject) userMessage += `\n- Oggetto email originale: ${context.subject}`;

    console.log(`🤖 Classificazione AI della risposta (${cleanedReply.length} caratteri)...`);

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: `${CLASSIFICATION_PROMPT}\n\n${userMessage}` }]
    });

    const result = parseClassificationResponse(message.content[0].text.trim());
    console.log(`✅ Classificazione AI: ${result.category} (confidence: ${result.confidence}) - ${result.reason}`);
    return result;

  } catch (error) {
    console.error('❌ Errore classificazione AI:', error);
    return { category: 'INTERESTED', confidence: 0.0, reason: `Errore AI — default INTERESTED`, shouldStopSequence: true };
  }
};

const quickClassify = (text) => {
  const lower = text.toLowerCase().trim();

  // Normalizza abbreviazioni italiane comuni prima del pattern matching
  // "nn" → "non", "x" → "per", "xchè/xché" → "perché", "cmq" → "comunque"
  const normalized = lower
    .replace(/\bnn\b/g, 'non')
    .replace(/\bn\b(?=\s+(sono|siamo|ci|mi|è|ho|abbiamo|voglio|vogliamo))/g, 'non')
    .replace(/\bxchè\b|\bxché\b|\bperchè\b/g, 'perché')
    .replace(/\bx\b/g, 'per')
    .replace(/\bcmq\b/g, 'comunque')
    .replace(/\bqnd\b/g, 'quando')
    .replace(/\btt\b/g, 'tutto')
    .replace(/\bgrz\b|\bgrz\b/g, 'grazie');

  const oooPatterns = [
    'fuori ufficio', 'out of office', 'automatisch', 'auto-reply',
    'automatic reply', 'risposta automatica', 'vacation',
    'non sono disponibile fino', 'sarò assente', 'saro assente', 'away from',
    'i am currently out', 'je suis absent', 'abwesend',
    'delivery status notification', 'undeliverable', 'mail delivery failed',
    'mailer-daemon', 'postmaster', 'noreply', 'no-reply', 'donotreply',
    'il tuo ticket', 'your ticket', 'ticket number', 'numero ticket',
    'prenotazione confermata', 'booking confirmed', 'prenota un tavolo',
    'per prenotare', 'riapriremo', 'riapriamo', 'chiusi per ferie',
    'chiusura estiva', 'chiusura invernale',
    'autoresponder', 'message automatique'
  ];
  for (const p of oooPatterns) {
    if (normalized.includes(p)) return { category: 'OUT_OF_OFFICE', confidence: 0.95, reason: 'Risposta automatica / fuori ufficio', shouldStopSequence: false };
  }

  // Pattern forti per DO_NOT_CONTACT (richiesta esplicita di stop / toni legali / "No" secco)
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
    // "No" molto secchi tipici delle tue campagne
    'no', 'no grazie', 'no, grazie', 'no non mi interessa', 'no, non mi interessa'
  ];
  for (const p of dncPatterns) {
    if (normalized === p || normalized.startsWith(p + ' ') || normalized.includes(p + '.')) {
      return { category: 'DO_NOT_CONTACT', confidence: 0.97, reason: 'Richiesta stop contatti / rifiuto secco', shouldStopSequence: true };
    }
  }

  const negPatterns = [
    'non ci interessa', 'non mi interessa', 'non siamo interessati',
    'non sono interessato', 'non sono interessata',
    'non interessato', 'non interessata', 'non interessati',
    'non abbiamo bisogno', 'al momento non abbiamo bisogno',
    'non ci serve', 'al momento non ci serve',
    'abbiamo già un fornitore', 'abbiamo gia un fornitore',
    'abbiamo già questo servizio', 'abbiamo gia questo servizio',
    'abbiamo già un sistema', 'abbiamo gia un sistema',
    'non utilizziamo questo tipo di servizio', 'non utilizziamo questo servizio',
    'la nostra attività è sospesa', 'la nostra attivita è sospesa', 'la nostra attività e sospesa', 'la nostra attivita e sospesa',
    'attività momentaneamente sospesa', 'attivita momentaneamente sospesa',
    'attività chiusa', 'attivita chiusa',
    'non fa per noi', 'non è il nostro ambito', 'non e il nostro ambito',
    'non è di nostro interesse', 'non e di nostro interesse',
    'grazie ma non siamo interessati', 'grazie ma non ci serve'
  ];
  for (const p of negPatterns) {
    if (normalized.includes(p)) return { category: 'NOT_INTERESTED', confidence: 0.95, reason: 'Rifiuto esplicito o richiesta rimozione', shouldStopSequence: true };
  }

  const posPatterns = [
    'chiamami', 'chiamatemi', 'chiamateci', 'mi chiami',
    'il mio numero', 'ecco il numero', 'contattatemi al',
    'quanto costa', 'qual è il prezzo', 'che prezzo',
    'come funziona', 'vorrei sapere', 'mi interessa',
    'sono interessato', 'sono interessata', 'siamo interessati',
    'possiamo parlarne', 'parliamone', 'facciamo una call',
    'prendiamo un appuntamento', 'fissiamo una chiamata'
  ];
  for (const p of posPatterns) {
    if (normalized.includes(p)) return { category: 'INTERESTED', confidence: 0.95, reason: 'Interesse esplicito / richiesta contatto', shouldStopSequence: true };
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
  c = c.replace(/\s\s+/g, ' ').trim();
  if (c.length > 2000) c = c.substring(0, 2000) + '...';
  return c;
};

const parseClassificationResponse = (responseText) => {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const parsed = JSON.parse(jsonMatch[0]);
    const validCategories = ['INTERESTED', 'NOT_INTERESTED', 'DO_NOT_CONTACT', 'OUT_OF_OFFICE'];
    if (!validCategories.includes(parsed.category)) throw new Error(`Invalid category: ${parsed.category}`);
    return {
      category: parsed.category,
      confidence: Math.min(1, Math.max(0, parseFloat(parsed.confidence) || 0.5)),
      reason: parsed.reason || 'N/A',
      shouldStopSequence: parsed.category !== 'OUT_OF_OFFICE'
    };
  } catch (error) {
    console.error('❌ Errore parsing classificazione:', error.message);
    const upper = responseText.toUpperCase();
    if (upper.includes('DO_NOT_CONTACT')) return { category: 'DO_NOT_CONTACT', confidence: 0.5, reason: 'Parsing fallback', shouldStopSequence: true };
    if (upper.includes('NOT_INTERESTED')) return { category: 'NOT_INTERESTED', confidence: 0.5, reason: 'Parsing fallback', shouldStopSequence: true };
    if (upper.includes('OUT_OF_OFFICE')) return { category: 'OUT_OF_OFFICE', confidence: 0.5, reason: 'Parsing fallback', shouldStopSequence: false };
    return { category: 'INTERESTED', confidence: 0.3, reason: 'Default INTERESTED', shouldStopSequence: true };
  }
};

export default { classifyReply, cleanReplyText };
