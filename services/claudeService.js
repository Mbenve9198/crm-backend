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
      const messageStyle = campaignSettings.messageStyle || 'direct';
      const tone = campaignSettings.tone || 'colloquiale e amichevole';
      const maxLength = campaignSettings.maxLength || 350;
      const focusPoint = campaignSettings.focusPoint || 'visibilità su Google';
      const cta = campaignSettings.cta || 'offrire tool gratuito';

      // Scegli il prompt in base allo stile
      let prompt;
      if (messageStyle === 'case-study') {
        prompt = this.buildCaseStudyPrompt({
          restaurantName,
          competitors,
          userReviews,
          userRating,
          city,
          keyword,
          tone,
          maxLength,
          userRank: context.userRank
        });
      } else {
        // Default: direct style
        prompt = this.buildDirectPrompt({
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
          userRank: context.userRank
        });
      }

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
   * Costruisce il prompt DIRECT style (tool gratuito)
   * @private
   */
  buildDirectPrompt({
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

    return `Sei un esperto di marketing digitale per ristoranti. Genera un messaggio WhatsApp colloquiale e diretto.

DATI REALI:
- Ristorante: "${restaurantName}"${city ? ` a ${city}` : ''}
- Posizione Google Maps: ${rankText}  
- Recensioni: ${userReviews}

TOP COMPETITOR:
${competitorList}

STILE DEL MESSAGGIO:
- Tono colloquiale e amichevole (come parlassi ad un amico)
- Inizia con "Ciao ragazzi" o variante simile
- Spiega che hai fatto una ricerca su Google Maps nella loro città
- Menziona la POSIZIONE del loro ristorante
- Nomina 1-2 competitor SPECIFICI con numero recensioni
- Evidenzia che "stanno letteralmente prendendo i clienti che dovrebbero essere vostri" o concetto simile
- Proponi un tool GRATUITO per aiutarli a migliorare la visibilità
- Chiudi con "te lo giro? È gratis" o simile
- Preferibilmente sotto ${maxLength} caratteri (ma non è rigido)
- NO emoji
- NO formattazione markdown
- Linguaggio naturale e spontaneo

ESEMPIO DI OUTPUT (segui questo stile ma adatta ai dati reali):
"Ciao ragazzi, ho fatto una ricerca su google maps a Firenze e il vostro ristorante esce fuori alla posizione 16 con 45 recensioni, mentre i vostri competitor principali tipo La Taverna è secondo con 320 recensioni, Il Vecchio Mulino è terzo con 280 recensioni. Stanno letteralmente prendendo i clienti che dovrebbero essere vostri. Ho creato un tool completamente gratuito dove potete vedere come apparire tra i primi risultati su google maps, te lo giro? È gratis"

IMPORTANTE:
- Usa i DATI REALI forniti (nome ristorante, città, posizione, competitor)
- Sii SPECIFICO con nomi e numeri
- Tono da "consulente amico" non da venditore aggressivo
- Genera SOLO il messaggio, senza spiegazioni

Genera il messaggio:`;
  }

  /**
   * Costruisce il prompt CASE-STUDY style (con esempio Il Porto di Livorno)
   * @private
   */
  buildCaseStudyPrompt({
    restaurantName,
    competitors,
    userReviews,
    userRating,
    city,
    keyword,
    tone,
    maxLength,
    userRank
  }) {
    // Costruisci lista competitor formattata
    const competitorList = competitors
      .map((c, i) => `${i + 1}. ${c.name} - posizione ${c.rank} con ${c.reviews} recensioni (${c.rating}⭐)`)
      .join('\n');

    // Determina posizione del ristorante
    const rankText = typeof userRank === 'number' ? `posizione ${userRank}` : 'fuori dalla top 20';

    return `Sei un esperto di marketing digitale per ristoranti. Genera un messaggio WhatsApp colloquiale che include un case study di successo.

DATI REALI RISTORANTE:
- Nome: "${restaurantName}"${city ? ` a ${city}` : ''}
- Posizione Google Maps: ${rankText}  
- Recensioni attuali: ${userReviews}

TOP COMPETITOR (che escono PRIMA su Google):
${competitorList}

STRUTTURA MESSAGGIO (3 parti):

1. HOOK - Confronto con competitor:
   - Inizia "Ciao ragazzi"
   - Spiega che hai cercato "${keyword}" su Google Maps${city ? ` a ${city}` : ''}
   - Menziona posizione loro ristorante
   - Nomina 1-2 competitor con recensioni specifiche
   - Aggiungi insight: "Vuol dire che una persona che cerca un ristorante su Google ha già scelto dove andare ancora prima di scoprire che esistete" (adatta in base alla posizione)

2. CASE STUDY - Esempio reale di successo:
   - Usa il caso de "Il Porto di Livorno"
   - Dati: passati da 1.108 a 5.389 recensioni in un anno
   - Ora raccolgono oltre 100 recensioni al mese in modo automatico
   - Sii specifico con i numeri

3. CTA - Call to action telefonica:
   - "Vi interessa sapere come abbiamo fatto e se è replicabile per voi?"
   - "Bastano 5 minuti al telefono"

STILE:
- Tono colloquiale e amichevole
- Lunghezza: preferibilmente sotto ${maxLength} caratteri (ma non rigido)
- NO emoji, NO markdown
- Linguaggio naturale e fluido
- Dati REALI e SPECIFICI

ESEMPIO OUTPUT:
"Ciao ragazzi, ho fatto una ricerca su Google Maps a Torino e il vostro Buffa & Pappa esce fuori dalla top 20 con 326 recensioni, mentre i vostri competitor tipo Silos sono primo con 934 recensioni e Piccolo Lord secondo con 622. Vuol dire che una persona che cerca un ristorante su Google ha già scelto dove andare ancora prima di scoprire che esistete.

Abbiamo aiutato un altro ristorante, Il Porto di Livorno, a risolvere esattamente questo problema: sono passati da 1.108 a 5.389 recensioni in un anno, e ora ne raccolgono oltre 100 al mese in modo automatico.

Vi interessa sapere come abbiamo fatto e se è replicabile per voi? Bastano 5 minuti al telefono"

IMPORTANTE:
- Usa i DATI REALI forniti (nome ristorante, città, posizione, competitor)
- Case study de Il Porto è FISSO (usa sempre quei numeri)
- Tono professionale ma amichevole
- Genera SOLO il messaggio

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
          maxLength: 350,
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
   * 📞 Genera uno script di chiamata personalizzato per contatti inbound
   * @param {Object} contact - Contatto con rankCheckerData e properties
   * @returns {Promise<string>} - Script di chiamata formattato
   */
  async generateCallScript(contact) {
    try {
      if (!this.client) {
        throw new Error('ANTHROPIC_API_KEY non configurata');
      }

      // Estrai dati dal contatto
      const { name, rankCheckerData, properties } = contact;
      
      if (!rankCheckerData) {
        throw new Error('Dati Rank Checker mancanti per questo contatto');
      }

      const restaurantData = rankCheckerData.restaurantData || {};
      const ranking = rankCheckerData.ranking || {};
      
      // Costruisci il contesto per il prompt
      const userReviews = restaurantData.reviewCount || 0;
      const userRating = restaurantData.rating || 0;
      const userRank = ranking.mainRank;
      const competitorsAhead = ranking.competitorsAhead || 0;
      const hasDigitalMenu = rankCheckerData.hasDigitalMenu;
      const willingToAdoptMenu = rankCheckerData.willingToAdoptMenu;
      const dailyCovers = rankCheckerData.dailyCovers;
      const keyword = rankCheckerData.keyword || 'ristorante';
      const address = restaurantData.address || '';
      
      // Estrai competitor se disponibili
      // I competitor sono in fullResults.competitors (dal rank checker)
      const fullResults = ranking.fullResults || {};
      const competitors = fullResults.competitors || [];
      const topCompetitors = competitors.slice(0, 3).map((c, i) => ({
        name: c.name || c.title || `Competitor ${i + 1}`,
        reviews: c.reviews || c.reviewCount || 0,
        rating: c.rating || 0,
        rank: c.rank || c.position || i + 1
      }));
      
      console.log(`📊 Competitor trovati per script: ${topCompetitors.length}`, topCompetitors.map(c => c.name));

      // Determina lo scenario per il menu digitale
      let menuScenario = 'A'; // Default: ha già menu
      if (hasDigitalMenu === false) {
        menuScenario = willingToAdoptMenu ? 'B' : 'C';
      }

      const prompt = this.buildCallScriptPrompt({
        restaurantName: name,
        userReviews,
        userRating,
        userRank,
        competitorsAhead,
        topCompetitors,
        keyword,
        address,
        dailyCovers,
        hasDigitalMenu,
        willingToAdoptMenu,
        menuScenario
      });

      console.log(`📞 Generazione script chiamata con Claude per ${name}...`);

      const message = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const generatedScript = message.content[0].text.trim();

      console.log(`✅ Script chiamata generato (${generatedScript.length} caratteri)`);

      return generatedScript;

    } catch (error) {
      console.error('❌ Errore generazione script chiamata:', error);
      throw error;
    }
  }

  /**
   * Costruisce il prompt per lo script di chiamata
   * @private
   */
  buildCallScriptPrompt({
    restaurantName,
    userReviews,
    userRating,
    userRank,
    competitorsAhead,
    topCompetitors,
    keyword,
    address,
    dailyCovers,
    hasDigitalMenu,
    willingToAdoptMenu,
    menuScenario
  }) {
    // Formatta competitor
    const competitorInfo = topCompetitors.length > 0
      ? topCompetitors.map((c, i) => `${i + 1}. ${c.name}: ${c.reviews} recensioni (${c.rating}⭐)`).join('\n')
      : 'Nessun competitor trovato';

    const rankText = typeof userRank === 'number' ? `posizione #${userRank}` : 'fuori dalla top 20';

    // Determina lo scenario menu
    let menuScenarioText = '';
    if (menuScenario === 'A') {
      menuScenarioText = `[SCENARIO A: HA GIÀ UN MENU QR] "...ha già un menu digitale. Ottimo. Possiamo integrare il nostro sistema con i suoi QR code esistenti in 10 minuti. Non deve cambiare assolutamente nulla."`;
    } else if (menuScenario === 'B') {
      menuScenarioText = `[SCENARIO B: NON CE L'HA, È DISPOSTO] "...non ha ancora un menu digitale ma è disposto a metterne uno. Perfetto. Glielo creiamo noi, graficamente e gratuitamente, e le inviamo i QR da stampare. Problema risolto."`;
    } else {
      menuScenarioText = `[SCENARIO C: NON CE L'HA, NON È DISPOSTO] Usa lo script per superare l'obiezione del menu cartaceo.`;
    }

    return `Sei un esperto venditore di MenuChat, un sistema che aiuta i ristoranti a ottenere più recensioni su Google.

Genera uno SCRIPT DI CHIAMATA PERSONALIZZATO basato sui dati reali di questo contatto che ha richiesto un report di analisi.

═══════════════════════════════════════
DATI REALI DEL RISTORANTE
═══════════════════════════════════════
• Nome: ${restaurantName}
• Indirizzo: ${address || 'Non specificato'}
• Rating attuale: ${userRating}⭐
• Recensioni attuali: ${userReviews}
• Posizione Google Maps: ${rankText}
• Competitor davanti: ${competitorsAhead}
• Keyword cercata: "${keyword}"
• Coperti giornalieri: ${dailyCovers || 'Non specificato'}
• Menu digitale: ${hasDigitalMenu ? 'Sì' : 'No'}
• Disposto ad adottarlo: ${willingToAdoptMenu ? 'Sì' : 'No'}

═══════════════════════════════════════
TOP COMPETITOR
═══════════════════════════════════════
${competitorInfo}

═══════════════════════════════════════
SCENARIO MENU DIGITALE
═══════════════════════════════════════
${menuScenarioText}

═══════════════════════════════════════
ISTRUZIONI
═══════════════════════════════════════

Genera uno script di chiamata completo seguendo questa STRUTTURA ESATTA, personalizzando OGNI sezione con i dati reali forniti sopra.

Lo script deve seguire queste 11 fasi:

📞 FASE 1: APERTURA
- Saluto professionale
- Menziona l'analisi gratuita del posizionamento Google che hanno richiesto
- Chiedi se hanno visionato il report

📊 FASE 2: RICAPITOLARE I DATI
- Conferma i dati: ${userReviews} recensioni con rating ${userRating}
- Menziona il competitor principale (${topCompetitors[0]?.name || 'competitor'}) con le sue ${topCompetitors[0]?.reviews || 'XXX'} recensioni
- Chiedi se l'obiettivo è raggiungerli e superarli
- Domanda sull'urgenza: "Perché ha richiesto questo report proprio adesso?"

😤 FASE 3: IL PERCHÉ EMOTIVO
- Chiedi cosa frustra di più:
  a) Clienti soddisfatti che non lasciano recensioni?
  b) Vedere ${topCompetitors[0]?.name || 'competitor'} davanti su Google?

🔍 FASE 4: IDENTIFICARE IL GAP
- Chiedi cosa hanno provato finora (richieste a voce, bigliettini, QR generici)
- Sottolinea che il problema è la mancanza di un SISTEMA, non i clienti
- "L'1% insoddisfatto si ricorda sempre di recensire, la maggioranza silenziosa no"

🎯 FASE 5: RISULTATO IDEALE
- Scenario ideale tra 6 mesi: top 3 Google Maps, rating 4.8+, 300-400 recensioni in più
- Promise realistica: 100-150 nuove recensioni positive nei prossimi 60 giorni

🙋 FASE 6: CHIEDERE PERMESSO
- "Le va se le spiego in 30 secondi come funziona il nostro sistema?"

💡 FASE 7: SPIEGARE MENUCHAT (IL SISTEMA)
Il flusso è semplicissimo:
1. Il cliente scansiona il QR code sul tavolo per vedere il menu
2. Si apre automaticamente una chat WhatsApp che gli invia il menu digitale (in quel momento catturiamo il suo numero, legalmente)
3. Due ore dopo il pasto, il sistema invia automaticamente un messaggio WhatsApp chiedendo "Com'è andata?" e invitando a lasciare una recensione
4. Risultato: il 10% di chi riceve il messaggio lascia effettivamente la recensione

È matematica pura: se hai 100 coperti al giorno e il 70% guarda il menu via QR, sono 70 messaggi. Il 10% di 70 = 7 recensioni AL GIORNO, 200+ al mese. Tutto in automatico, senza chiedere nulla a voce.

📱 FASE 8: GESTIRE OBIEZIONE MENU DIGITALE
${menuScenarioText}
${menuScenario === 'C' ? `
Se è nello SCENARIO C, usa questo script per superare l'obiezione:
"Capisco l'esitazione sul menu cartaceo. Ma guardiamo i fatti: senza questo 'ponte digitale' non possiamo catturare i numeri e automatizzare le richieste. Chiederlo a voce non funziona, adesivi generici nemmeno. Questo QR code è il nostro 'cavallo di Troia': il cliente vuole vedere il menu, noi vogliamo la recensione. Vale la pena sacrificare un'opportunità certa per restare legati al cartaceo?"` : ''}

🤔 FASE 9: NELLE LORO PAROLE
- "Secondo lei, perché un sistema del genere funzionerebbe per ${restaurantName}?"
- Cerca risposte tipo: "È automatico", "Non devo fare nulla", "WhatsApp è diretto"

💰 FASE 10: CHIUSURA E PREZZI
- Piano annuale standard: 149€/mese (1788€/anno)
- Offerta anticipato: 1290€ (107€/mese) - risparmio 500€
- PROVA GRATUITA 14 GIORNI con condizione: QR sui tavoli entro 72 ore
- Opzione stampa QR: 70€+IVA se non vogliono stampare

📉 FASE 11: GESTIONE OBIEZIONI POST-TRIAL (dopo 14 giorni)
- Step-Down 1: Due rate da 645€ (oggi + 60gg)
- Step-Down 2: Acconto 290€ + 10 rate da 100€
- Last Resort: Piano mensile 149€/mese (perde sconto)

═══════════════════════════════════════
FORMATO OUTPUT - IMPORTANTISSIMO
═══════════════════════════════════════

Lo script deve essere DISCORSIVO e NATURALE, come un vero dialogo telefonico.

REGOLE FONDAMENTALI:
1. SCRIVI FRASI COMPLETE E NATURALI, non bullet point o elenchi
2. Deve sembrare una conversazione vera, non uno schema
3. Usa un tono colloquiale ma professionale
4. Includi [PAUSA - ATTENDI RISPOSTA] dove il cliente deve rispondere
5. Personalizza OGNI riferimento con i dati reali del ristorante
6. Usa emoji SOLO per i titoli delle fasi (📞, 📊, 😤, etc.)
7. Dentro ogni fase, scrivi il testo DA LEGGERE direttamente al telefono
8. Puoi usare **grassetto** per evidenziare numeri o concetti chiave

ESEMPIO DI COME SCRIVERE (GIUSTO):
"Perfetto. Allora, sulla base di quello che facciamo con altri ristoranti come il vostro, penso che realisticamente possiamo aggiungere almeno **100-150 nuove recensioni positive** nei prossimi 60 giorni. E l'obiettivo, ovviamente, è mantenere quel flusso costante per sempre. Le sembra un obiettivo interessante?"

ESEMPIO DI COME NON SCRIVERE (SBAGLIATO):
📈 **Scenario ideale:**
- Top 3 su Google Maps
- Rating mantenuto a 4.8+ stelle
- 300-400 nuove recensioni positive

Genera lo script completo in forma DISCORSIVA:`;
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

    // Lunghezza (warning, non error)
    if (message.length > 400) {
      validation.issues.push('Messaggio molto lungo (oltre 400 caratteri)');
      validation.score -= 10;
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

