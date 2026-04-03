import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import KnowledgeChunk from '../models/knowledgeChunkModel.js';

/**
 * Knowledge Base per l'AI Sales Agent.
 * Solo FATTI INVARIANTI: prodotto, pricing, condizioni, FAQ tecniche.
 * Le risposte alle obiezioni NON sono qui — l'agente ragiona e compone
 * basandosi sui dati reali che recupera con i tool.
 */
const KNOWLEDGE_DATA = [
  // ━━━ PRODOTTO ━━━
  {
    content: `MenuChat è un sistema automatico per raccogliere recensioni Google per ristoranti. Funziona così: il ristorante usa un menu digitale con QR code. Quando il cliente scannerizza il QR per vedere il menu, il sistema raccoglie il suo numero di telefono (con consenso GDPR esplicito). Dopo che il cliente ha mangiato, riceve un messaggio WhatsApp che gli chiede di lasciare una recensione su Google. Recensioni vere, di persone reali che hanno mangiato nel ristorante — zero fake, zero bot, zero comprate.`,
    category: 'product', tags: ['come_funziona', 'overview', 'qr', 'whatsapp', 'recensioni'], source: 'manual'
  },
  {
    content: `Setup di MenuChat: lo facciamo noi in massimo 10 minuti. Creiamo il menu digitale con i piatti del ristorante, generiamo il QR code, e configuriamo il sistema WhatsApp. Il ristoratore non deve fare nulla di tecnico. Il QR va messo sui tavoli — lo mandiamo noi stampato o lo stampa il ristoratore. Non serve app da scaricare, non serve WiFi nel locale (il QR porta a una pagina web che funziona con i dati del telefono del cliente).`,
    category: 'product', tags: ['setup', 'tempo', 'facilità', 'qr', 'wifi'], source: 'manual'
  },
  {
    content: `Risultati tipici con MenuChat: i ristoranti raccolgono più di 100 recensioni Google al mese. Tasso di conversione medio: circa il 3% dei coperti lascia la recensione. Esempio: 100 coperti/giorno × 26 giorni × 3% = circa 78 recensioni/mese. 200 coperti/giorno = circa 156 recensioni/mese. In 3 mesi un ristorante può salire di 5-10 posizioni su Google Maps.`,
    category: 'product', tags: ['risultati', 'numeri', 'conversione', 'recensioni', 'coperti'], source: 'manual'
  },
  {
    content: `Oltre alle recensioni, MenuChat raccoglie i numeri di telefono dei clienti (con consenso GDPR). In pochi mesi il ristorante accumula migliaia di contatti reali a cui fare campagne marketing WhatsApp: promozioni, eventi, menu del giorno, comunicazioni. È un CRM WhatsApp automatico integrato nel menu.`,
    category: 'product', tags: ['crm', 'contatti', 'whatsapp', 'marketing', 'gdpr', 'database'], source: 'manual'
  },

  // ━━━ PRICING (CORRETTO: 1290€+IVA annuale) ━━━
  {
    content: `Pricing MenuChat: prova gratuita di 2 settimane senza impegno. Se non convince, si cancella senza pagare nulla. Prezzo a listino: 1.290€+IVA all'anno. MA: "il nostro interesse è lavorare con voi, siamo molto flessibili" — non citare mai il prezzo pieno come prima cosa. Parti SEMPRE dalla prova gratuita. Se il lead chiede il prezzo, digli che il listino è 1.290€ annuale ma che per iniziare c'è la prova gratuita e poi si discute le condizioni. Mai dire 39€/mese o altri prezzi inventati.`,
    category: 'pricing', tags: ['prezzo', 'costo', 'prova_gratuita', 'annuale', 'flessibile'], source: 'manual'
  },

  // ━━━ FAQ TECNICHE ━━━
  {
    content: `FAQ "Come fate a trovare i clienti che vengono a mangiare?": Usiamo un menu digitale integrato con WhatsApp. Ogni cliente che scannerizza il QR code per vedere il menu ci lascia il suo numero (con consenso). Siccome tutti passano dal menu, riusciamo a inviare la richiesta di recensione a praticamente tutti i coperti.`,
    category: 'faq', tags: ['come_trovare_clienti', 'menu_digitale', 'qr', 'whatsapp'], source: 'manual'
  },
  {
    content: `FAQ "E il GDPR?": Tutto il flusso è GDPR compliant. Il consenso viene raccolto nel momento in cui il cliente usa il menu digitale — c'è un passaggio esplicito di opt-in. I dati sono tracciati e gestiti nel rispetto della normativa europea. Il ristoratore può sempre mostrare da dove arriva ogni consenso.`,
    category: 'faq', tags: ['gdpr', 'privacy', 'consenso', 'legale'], source: 'manual'
  },
  {
    content: `FAQ "Quante recensioni posso aspettarmi?": Dipende dai coperti. Formula: coperti al giorno × 26 giorni lavorativi × 3% tasso di conversione. Esempio: 100 coperti/giorno = circa 78 recensioni/mese. 50 coperti/giorno = circa 39 recensioni/mese. 200 coperti/giorno = circa 156 recensioni/mese.`,
    category: 'faq', tags: ['quante_recensioni', 'stima', 'coperti', 'conversione', 'formula'], source: 'manual'
  },
  {
    content: `FAQ "Le recensioni sono false/comprate?": Assolutamente no. Zero false, zero bot, zero comprate. Sono i clienti reali che hanno mangiato nel ristorante. Il sistema gli manda un messaggio WhatsApp dopo il pasto e gli chiede se vogliono lasciare una recensione. Se vogliono la lasciano, se non vogliono nessun problema. Google le vede come recensioni autentiche perché lo sono.`,
    category: 'faq', tags: ['recensioni_false', 'autenticità', 'google', 'bot', 'fake'], source: 'manual'
  },

  // ━━━ COMPETITOR (solo fatti, niente script di risposta) ━━━
  {
    content: `Competitor noto: Pienissimo Pro — sistema di gestione ristorante (CRM, prenotazioni, fidelizzazione). Usato da ristoranti strutturati. MenuChat è complementare: Pienissimo si concentra su gestione/prenotazioni, MenuChat si concentra specificamente su recensioni Google + raccolta contatti WhatsApp automatica dal menu.`,
    category: 'competitor', tags: ['pienissimo', 'pienissimo_pro', 'crm', 'prenotazioni'], source: 'manual'
  },
  {
    content: `TripAdvisor vs Google Maps: Google Maps è diventato il canale dominante per la scoperta locale. Quando qualcuno cerca "ristorante [città]" su Google, Maps è il primo risultato. Le recensioni Google influenzano direttamente il ranking locale. TripAdvisor è ancora rilevante ma secondario per il traffico locale.`,
    category: 'competitor', tags: ['tripadvisor', 'google_maps', 'ranking', 'scoperta_locale'], source: 'manual'
  }
];

const seedKnowledgeBase = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/menuchatcrm';
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    await KnowledgeChunk.deleteMany({});
    console.log('Knowledge base svuotata');

    const result = await KnowledgeChunk.insertMany(KNOWLEDGE_DATA);
    console.log(`Knowledge base popolata con ${result.length} chunk`);

    const byCat = {};
    for (const chunk of result) {
      byCat[chunk.category] = (byCat[chunk.category] || 0) + 1;
    }
    console.log('Distribuzione:', byCat);

    await mongoose.disconnect();
  } catch (error) {
    console.error('Errore seeding knowledge base:', error);
    process.exit(1);
  }
};

seedKnowledgeBase();
