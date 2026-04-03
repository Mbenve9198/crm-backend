import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import KnowledgeChunk from '../models/knowledgeChunkModel.js';

const KNOWLEDGE_DATA = [
  // ━━━ PRODOTTO: IL FLUSSO COMPLETO ━━━
  {
    content: `Come funziona MenuChat — il flusso completo:
1. Mettiamo un QR code sui tavoli del ristorante
2. Il cliente scannerizza il QR e si apre WhatsApp con un messaggio già pronto (la "parola magica" del ristorante, tipo "MENU")
3. Il cliente invia il messaggio e il nostro bot WhatsApp risponde subito con il link al menu digitale del ristorante
4. Il cliente apre il menu, sfoglia i piatti, ordina — tutto dal telefono, senza scaricare app
5. Dopo il pasto, il nostro sistema aspetta il momento giusto e manda automaticamente un messaggio WhatsApp con la richiesta di lasciare una recensione su Google
6. Il cliente clicca, lascia la recensione — tutto in 30 secondi

Ogni persona che apre il menu riceve la richiesta. Non serve prenotare, non serve registrarsi. Basta aprire il menu.`,
    category: 'product', tags: ['come_funziona', 'flusso', 'qr', 'whatsapp', 'menu', 'recensioni'], source: 'manual'
  },
  {
    content: `Il menu digitale MenuChat non è una paginetta triste. È un menu vero:
- Categorie con icone (Antipasti, Primi, Pizze, Dolci...)
- Foto dei piatti in alta qualità
- Prezzi, descrizioni, ingredienti, allergeni
- Personalizzabile con logo, colori, font del ristorante
- Multilingua (italiano, inglese, tedesco, francese, spagnolo)
- Funziona dal telefono del cliente con i dati mobili — non serve WiFi nel locale

Il menu si apre via WhatsApp: il cliente scannerizza il QR, manda la parola, e il bot gli manda il link. Niente app da scaricare, niente registrazione.`,
    category: 'product', tags: ['menu_digitale', 'design', 'multilingua', 'wifi', 'app'], source: 'manual'
  },
  {
    content: `Smart timing — quando mandare la richiesta di recensione:
Il sistema non manda la richiesta "dopo 2 ore" a tutti. Ha un algoritmo intelligente che capisce a che ora il cliente ha aperto il menu e calcola il momento migliore:
- Colazione: 60 minuti dopo (il pasto è veloce)
- Pranzo: 2 ore dopo
- Cena: 90 minuti dopo
- Aperitivo: 45 minuti dopo
- Se è tarda notte: la mattina dopo alle 10 (non svegliamo nessuno)

Il sistema impara nel tempo quale orario funziona meglio per ogni ristorante e si ottimizza automaticamente. Manda il messaggio solo in orari civili (9-23).`,
    category: 'product', tags: ['timing', 'algoritmo', 'smart', 'orario', 'recensioni'], source: 'manual'
  },
  {
    content: `Filtro recensioni — protezione dalle recensioni negative:
Quando il cliente clicca il link per la recensione, prima di mandarlo su Google gli chiediamo "Com'è andata?":
- Se dà 4 o 5 stelle → lo mandiamo direttamente su Google a lasciare la recensione pubblica
- Se dà 1, 2 o 3 stelle → gli chiediamo un feedback privato che arriva solo al ristoratore

Risultato: le recensioni negative restano private, quelle positive vanno su Google. Il ristoratore sa comunque cosa migliorare, ma la reputazione online è protetta.`,
    category: 'product', tags: ['filtro', 'recensioni_negative', 'protezione', 'rating', 'google'], source: 'manual'
  },
  {
    content: `Raccolta contatti e marketing WhatsApp:
Quando il cliente apre il menu, può scegliere di lasciare il consenso per essere ricontattato dal ristorante (opt-in GDPR). Chi accetta viene salvato come contatto WhatsApp.

In pochi mesi il ristorante accumula centinaia o migliaia di contatti REALI — persone che hanno mangiato lì davvero. Poi può mandare campagne WhatsApp: menu del giorno, eventi, promozioni, auguri di Natale.

È come avere una mailing list, ma su WhatsApp — dove i messaggi si aprono davvero (tasso di apertura 90%+ vs 20% delle email).`,
    category: 'product', tags: ['marketing', 'contatti', 'whatsapp', 'campagne', 'gdpr', 'opt_in'], source: 'manual'
  },
  {
    content: `Setup di MenuChat — lo facciamo noi:
Il ristoratore non deve fare nulla di tecnico. Il setup lo facciamo noi in massimo 10 minuti:
1. Creiamo il menu digitale con i piatti del ristorante
2. Configuriamo il bot WhatsApp con la parola magica
3. Generiamo il QR code da mettere sui tavoli
4. Attiviamo il sistema di richiesta recensioni automatico

Il QR lo mandiamo stampato o il ristoratore lo stampa. Si mette sui tavoli e basta. Da quel momento il sistema lavora da solo — il ristoratore non deve toccare niente.`,
    category: 'product', tags: ['setup', 'tempo', 'facilità', 'qr', 'automatico'], source: 'manual'
  },
  {
    content: `Numeri reali di MenuChat:
- Ogni 100 persone che aprono il menu, circa 10 lasciano la recensione su Google
- Il 65% di chi clicca il link della recensione completa il processo
- Un ristorante con 100 coperti al giorno può aspettarsi circa 250-300 recensioni al mese
- In 2-3 mesi si possono guadagnare 5-10 posizioni su Google Maps
- Il sistema funziona 7 giorni su 7, automaticamente, senza intervento del ristoratore

Questi numeri sono conservativi — molti ristoranti fanno di più perché il messaggio arriva al momento giusto su WhatsApp, dove tutti lo leggono.`,
    category: 'product', tags: ['numeri', 'risultati', 'conversione', 'recensioni', 'posizioni'], source: 'manual'
  },

  // ━━━ PRICING ━━━
  {
    content: `Pricing MenuChat:
- Prova gratuita: 2 settimane, senza impegno, cancelli quando vuoi
- Prezzo a listino: 1.290 euro + IVA all'anno
- MA: "il nostro interesse è lavorare con voi, siamo molto flessibili sul prezzo"
- Non citare mai il prezzo pieno come prima cosa — parti SEMPRE dalla prova gratuita
- Se il lead chiede il prezzo: "il listino è 1.290 euro annuale, ma partiamo dalla prova gratuita e poi vediamo insieme le condizioni migliori per voi"
- Mai dire 39 euro al mese o altri prezzi inventati
- Mai dare sconti senza parlarne prima con Marco`,
    category: 'pricing', tags: ['prezzo', 'costo', 'prova_gratuita', 'annuale', 'flessibile'], source: 'manual'
  },

  // ━━━ FAQ ━━━
  {
    content: `FAQ "Come fate a raggiungere tutti i clienti?" — Risposta:
Ogni cliente che si siede al tavolo vede il QR code. Lo scannerizza per aprire il menu su WhatsApp. Da quel momento il sistema sa che quella persona è nel ristorante. Dopo il pasto, le manda automaticamente la richiesta di recensione — sempre su WhatsApp. Non serve che prenoti, non serve che si registri. Basta che apra il menu. Per questo i numeri sono così alti: il menu lo guardano tutti.`,
    category: 'faq', tags: ['come_raggiungere', 'clienti', 'tutti', 'copertura'], source: 'manual'
  },
  {
    content: `FAQ "Le recensioni sono false?" — Risposta:
Assolutamente no. Zero false, zero bot, zero comprate. Funziona così: una persona mangia nel tuo ristorante, apre il menu dal QR, e dopo il pasto riceve un messaggio WhatsApp che gli chiede se vuole lasciare una recensione. Se vuole la lascia, se non vuole nessun problema. Sono i tuoi clienti veri, che hanno mangiato da te davvero. Google le vede come autentiche perché lo sono.`,
    category: 'faq', tags: ['recensioni_false', 'autenticità', 'google', 'vere'], source: 'manual'
  },
  {
    content: `FAQ "E il GDPR / privacy?" — Risposta:
Il numero di telefono il cliente lo usa lui stesso quando manda il messaggio WhatsApp per aprire il menu. L'invio della richiesta di recensione è trattato come comunicazione di servizio legata all'esperienza nel locale. Per il marketing (campagne WhatsApp), c'è un consenso opt-in esplicito che il cliente dà quando apre il menu — tutto tracciato e conforme al GDPR. Chi non accetta non viene ricontattato per promozioni.`,
    category: 'faq', tags: ['gdpr', 'privacy', 'consenso', 'legale', 'whatsapp'], source: 'manual'
  },
  {
    content: `FAQ "Funziona senza WiFi nel locale?" — Risposta:
Sì. Il QR code apre WhatsApp, che funziona con i dati mobili del telefono del cliente. Il menu digitale è una pagina web leggera che si carica in un secondo. Non serve WiFi nel locale, non serve scaricare nessuna app. Il cliente usa il suo telefono come fa normalmente.`,
    category: 'faq', tags: ['wifi', 'internet', 'app', 'dati_mobili'], source: 'manual'
  },
  {
    content: `FAQ "Quante recensioni posso aspettarmi?" — Risposta:
Dipende da quanta gente entra nel locale. La regola è semplice: ogni 100 persone che aprono il menu, circa 10 lasciano la recensione su Google. Se fai 100 coperti al giorno, sono circa 250-300 recensioni al mese. Se ne fai 50, circa 120-150. Sono numeri enormi — la maggior parte dei ristoranti ne riceve 2-3 a settimana senza sistema.`,
    category: 'faq', tags: ['quante_recensioni', 'stima', 'coperti', 'previsione'], source: 'manual'
  },
  {
    content: `FAQ "Cosa succede se un cliente vuole lasciare una recensione negativa?" — Risposta:
Prima di mandarlo su Google, gli chiediamo come è andata. Se dà 4 o 5 stelle, va su Google. Se dà meno di 4, gli chiediamo un feedback privato che arriva solo a te. Tu sai cosa migliorare, ma la recensione negativa non finisce online. È un filtro intelligente che protegge la tua reputazione.`,
    category: 'faq', tags: ['recensioni_negative', 'filtro', 'protezione', 'feedback'], source: 'manual'
  },

  // ━━━ COMPETITOR ━━━
  {
    content: `Competitor: Pienissimo Pro — sistema di gestione ristorante (CRM, prenotazioni, fidelizzazione). Usato da ristoranti strutturati. MenuChat è complementare: Pienissimo gestisce prenotazioni e sala, MenuChat si concentra su recensioni Google + raccolta contatti WhatsApp. Un ristorante può usare entrambi.`,
    category: 'competitor', tags: ['pienissimo', 'pienissimo_pro', 'complementare'], source: 'manual'
  },
  {
    content: `TripAdvisor vs Google Maps: quando qualcuno cerca "ristorante + città" su Google, il primo risultato è Google Maps con le stelle e le recensioni. TripAdvisor è ancora rilevante ma secondario — il traffico locale passa da Google. Le recensioni Google determinano chi appare per primo quando qualcuno ha fame e cerca dove mangiare.`,
    category: 'competitor', tags: ['tripadvisor', 'google_maps', 'ranking', 'visibilità'], source: 'manual'
  },

  // ━━━ VANTAGGI CHIAVE (per l'agente quando deve convincere) ━━━
  {
    content: `Perché un ristoratore dovrebbe usare MenuChat — i punti chiave:
1. Più recensioni Google = più clienti nuovi che ti trovano su Maps
2. Il sistema lavora da solo 7/7 — non devi fare niente dopo il setup
3. Protegge dalle recensioni negative con il filtro intelligente
4. Ti dà un database di contatti WhatsApp dei tuoi clienti reali per fare marketing
5. Setup in 10 minuti, lo facciamo noi
6. Prova gratuita 2 settimane — se non funziona, cancelli
7. Non è come chiedere le recensioni a voce (imbarazzante e non scalabile) — è automatico e naturale
8. I numeri sono prevedibili: 10 recensioni ogni 100 persone che vedono il menu`,
    category: 'product', tags: ['vantaggi', 'vendita', 'punti_chiave', 'persuasione'], source: 'manual'
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
