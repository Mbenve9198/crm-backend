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

2. **NOT_INTERESTED** — Il lead rifiuta ESPLICITAMENTE e CHIARAMENTE.
   Classifica come NOT_INTERESTED SOLO se:
   - Dice chiaramente "non ci interessa", "no grazie", "non vogliamo", "non abbiamo bisogno"
   - Chiede rimozione dalla lista: "rimuoveteci", "cancellatemi", "non contattateci più", "unsubscribe"
   - Risposta arrabbiata o ostile ("è spam", "come avete avuto la mia email", "smettetela")
   - "Abbiamo già un sistema e siamo soddisfatti" (rifiuto definitivo)
   - "Il ristorante è chiuso / in vendita / cambiato gestione"
   - Rifiuto cortese ma DEFINITIVO ("non è proprio il nostro ambito", "non fa per noi")
   - ATTENZIONE: "Non è il momento" o "non abbiamo tempo adesso" NON è NOT_INTERESTED, è INTERESTED (apertura futura)

3. **OUT_OF_OFFICE** — Risposte automatiche che NON esprimono né interesse né disinteresse.
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

FORMATO RISPOSTA (SOLO JSON valido, nient'altro):
{
  "category": "INTERESTED|NOT_INTERESTED|OUT_OF_OFFICE",
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

  const oooPatterns = [
    'fuori ufficio', 'out of office', 'automatisch', 'auto-reply',
    'automatic reply', 'risposta automatica', 'vacation', 'in ferie',
    'non sono disponibile fino', 'sarò assente', 'away from',
    'i am currently out', 'je suis absent', 'abwesend',
    'delivery status notification', 'undeliverable', 'mail delivery failed',
    'mailer-daemon', 'postmaster', 'noreply', 'no-reply', 'donotreply',
    'il tuo ticket', 'your ticket', 'ticket number', 'numero ticket',
    'prenotazione confermata', 'booking confirmed', 'prenota un tavolo',
    'per prenotare', 'riapriremo', 'riapriamo', 'chiusi per ferie',
    'chiusi per riposo', 'chiusura estiva', 'chiusura invernale',
    'autoresponder', 'message automatique'
  ];
  for (const p of oooPatterns) {
    if (lower.includes(p)) return { category: 'OUT_OF_OFFICE', confidence: 0.95, reason: 'Risposta automatica / fuori ufficio', shouldStopSequence: false };
  }

  const negPatterns = [
    'rimuoveteci', 'rimuovetemi', 'cancellatemi', 'cancellate il mio',
    'toglietemi', 'non contattateci', 'non contattatemi', 'unsubscribe',
    'remove me', 'remove us', 'stop emailing', 'stop sending',
    'non scriveteci più', 'non scrivetemi più', 'non inviate più',
    'disiscrivi', 'disiscrivimi', 'disiscrivetemi',
    'non ci interessa', 'non mi interessa', 'non siamo interessati',
    'non sono interessato', 'non sono interessata'
  ];
  for (const p of negPatterns) {
    if (lower.includes(p)) return { category: 'NOT_INTERESTED', confidence: 0.95, reason: 'Rifiuto esplicito o richiesta rimozione', shouldStopSequence: true };
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
    if (lower.includes(p)) return { category: 'INTERESTED', confidence: 0.95, reason: 'Interesse esplicito / richiesta contatto', shouldStopSequence: true };
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
    const validCategories = ['INTERESTED', 'NOT_INTERESTED', 'OUT_OF_OFFICE'];
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
    if (upper.includes('NOT_INTERESTED')) return { category: 'NOT_INTERESTED', confidence: 0.5, reason: 'Parsing fallback', shouldStopSequence: true };
    if (upper.includes('OUT_OF_OFFICE')) return { category: 'OUT_OF_OFFICE', confidence: 0.5, reason: 'Parsing fallback', shouldStopSequence: false };
    return { category: 'INTERESTED', confidence: 0.3, reason: 'Default INTERESTED', shouldStopSequence: true };
  }
};

export default { classifyReply, cleanReplyText };
