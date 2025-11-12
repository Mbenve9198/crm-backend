import Anthropic from '@anthropic-ai/sdk';

/**
 * Servizio per interagire con Claude AI (Anthropic)
 * Utilizzato per generare messaggi personalizzati per campagne WhatsApp autopilot
 */

class ClaudeService {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = this.apiKey ? new Anthropic({ apiKey: this.apiKey }) : null;
  }

  /**
   * Genera un messaggio WhatsApp personalizzato basato sui dati del contatto e competitor
   * @param {Object} context - Contesto con dati del ristorante e competitor
   * @param {Object} campaignSettings - Impostazioni della campagna (tone, lunghezza, etc)
   * @returns {Promise<string>} - Messaggio generato
   */
  async generateWhatsAppMessage(context, campaignSettings = {}) {
    try {
      if (!this.client) {
        throw new Error('ANTHROPIC_API_KEY non configurata');
      }

      // Valida context
      if (!context.hasData) {
        throw new Error('Dati contesto insufficienti per generare messaggio');
      }

      const {
        restaurantName,
        competitors,
        userReviews,
        userRating,
        city,
        keyword
      } = context;

      // Default settings
      const tone = campaignSettings.tone || 'professionale e amichevole';
      const maxLength = campaignSettings.maxLength || 300;
      const focusPoint = campaignSettings.focusPoint || 'visibilità su Google';
      const cta = campaignSettings.cta || 'chiedere se sono interessati a migliorare';

      // Costruisci prompt per Claude
      const prompt = this.buildPrompt({
        restaurantName,
        competitors,
        userReviews,
        userRating,
        city,
        keyword,
        tone,
        maxLength,
        focusPoint,
        cta,
        userRank: context.userRank // 🆕 Aggiungi ranking per prompt più specifico
      });

      console.log(`🤖 Generazione messaggio con Claude per ${restaurantName}...`);

      // Chiamata a Claude
      const message = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const generatedMessage = message.content[0].text.trim();

      console.log(`✅ Messaggio generato (${generatedMessage.length} caratteri)`);

      return generatedMessage;

    } catch (error) {
      console.error('❌ Errore generazione messaggio Claude:', error);
      throw error;
    }
  }

  /**
   * Costruisce il prompt per Claude
   * @private
   */
  buildPrompt({
    restaurantName,
    competitors,
    userReviews,
    userRating,
    city,
    keyword,
    tone,
    maxLength,
    focusPoint,
    cta,
    userRank
  }) {
    // Costruisci lista competitor formattata per il prompt
    const competitorList = competitors
      .map((c, i) => `${i + 1}. ${c.name} - posizione ${c.rank} con ${c.reviews} recensioni (${c.rating}⭐)`)
      .join('\n');

    // Determina posizione del ristorante
    const rankText = typeof userRank === 'number' ? `posizione ${userRank}` : 'fuori dalla top 20';

    return `Sei un esperto di marketing digitale per ristoranti. Devi generare un messaggio WhatsApp colloquiale e diretto come se stessi parlando ad un amico ristoratore.

CONTESTO RICERCA GOOGLE MAPS:
- Ho cercato "${keyword}" su Google Maps${city ? ` a ${city}` : ''}
- Il ristorante "${restaurantName}" esce alla ${rankText} con ${userReviews} recensioni

COMPETITOR PRINCIPALI (che escono PRIMA):
${competitorList}

STILE DEL MESSAGGIO:
- Tono colloquiale e amichevole (come parlassi ad un amico)
- Inizia con "Ciao ragazzi" o simile
- Spiega CHE HAI FATTO una ricerca su Google Maps nella loro città
- Menziona la POSIZIONE ESATTA del loro ristorante
- Nomina almeno 1-2 competitor SPECIFICI con posizione e recensioni
- Evidenzia che "stanno letteralmente prendendo i clienti che dovrebbero essere vostri" o concetto simile
- Proponi un tool GRATUITO per aiutarli a migliorare la visibilità
- Chiudi con "te lo giro? È gratis" o simile
- Massimo ${maxLength} caratteri
- NO emoji
- NO formattazione markdown
- Linguaggio naturale e spontaneo

ESEMPIO DI OUTPUT (NON copiare esattamente, ma segui questo stile):
"Ciao ragazzi, ho fatto una ricerca su google maps a Firenze e il vostro ristorante esce fuori alla posizione 16 con 45 recensioni, mentre i vostri competitor principali tipo La Taverna è secondo con 320 recensioni, Il Vecchio Mulino è terzo con 280 recensioni. Stanno letteralmente prendendo i clienti che dovrebbero essere vostri. Ho creato un tool completamente gratuito dove potete vedere come apparire tra i primi risultati su google maps, te lo giro? È gratis"

IMPORTANTE:
- Usa i DATI REALI forniti nel contesto (nome ristorante, città, posizione, competitor)
- Sii SPECIFICO con nomi e numeri
- Mantieni un tono da "consulente amico" non da venditore aggressivo
- Genera SOLO il messaggio, senza spiegazioni

Genera il messaggio:`;
  }

  /**
   * Genera varianti multiple di messaggi per A/B testing
   * @param {Object} context - Contesto con dati del ristorante e competitor
   * @param {number} numVariants - Numero di varianti da generare (default: 3)
   * @returns {Promise<Array<string>>} - Array di messaggi generati
   */
  async generateMessageVariants(context, numVariants = 3) {
    try {
      const variants = [];
      
      // Toni diversi per le varianti
      const tones = [
        'professionale e diretto',
        'amichevole e colloquiale',
        'urgente ma rispettoso'
      ];

      for (let i = 0; i < numVariants; i++) {
        const settings = {
          tone: tones[i % tones.length],
          maxLength: 280,
          focusPoint: i === 0 ? 'visibilità su Google' : (i === 1 ? 'numero di recensioni' : 'competizione locale'),
          cta: 'chiedere se sono interessati a saperne di più'
        };

        const message = await this.generateWhatsAppMessage(context, settings);
        variants.push(message);

        // Pausa tra richieste per evitare rate limiting
        if (i < numVariants - 1) {
          await this.sleep(500);
        }
      }

      return variants;

    } catch (error) {
      console.error('❌ Errore generazione varianti:', error);
      throw error;
    }
  }

  /**
   * Utility sleep
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Valida la qualità del messaggio generato
   * @param {string} message - Messaggio da validare
   * @returns {Object} - Risultato validazione con score e suggerimenti
   */
  validateMessage(message) {
    const validation = {
      isValid: true,
      score: 100,
      issues: []
    };

    // Lunghezza
    if (message.length > 350) {
      validation.issues.push('Messaggio troppo lungo (max 350 caratteri)');
      validation.score -= 20;
    }

    // Presenza di emoji (non dovrebbero esserci)
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    if (emojiRegex.test(message)) {
      validation.issues.push('Contiene emoji (da rimuovere)');
      validation.score -= 10;
    }

    // Presenza di markdown
    if (message.includes('**') || message.includes('*') || message.includes('#')) {
      validation.issues.push('Contiene formattazione markdown');
      validation.score -= 5;
    }

    // Messaggio troppo corto
    if (message.length < 100) {
      validation.issues.push('Messaggio troppo breve (min 100 caratteri)');
      validation.score -= 15;
    }

    validation.isValid = validation.issues.length === 0;

    return validation;
  }
}

// Esporta istanza singleton
const claudeService = new ClaudeService();
export default claudeService;

