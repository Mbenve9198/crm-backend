export default {
  stage: 'initial_reply',
  source: 'smartlead_outbound',
  objective: 'Rispondere al lead, creare valore, e proporre una chiamata di 5 minuti. Raccogliere nome e numero se non li abbiamo.',
  context: 'Il lead ha ricevuto una nostra email fredda e HA RISPOSTO — e\' un lead caldo. Chi risponde a una cold email merita attenzione immediata e una proposta concreta.',
  approach: `RISPONDI SEMPRE alle domande del lead. Se chiede come funziona, dai una descrizione generica. Se chiede il prezzo, menziona la prova gratuita.

Poi PROPONI SEMPRE la chiamata. L'obiettivo e' SEMPRE fissare una chiamata di 5 minuti. Non aspettare messaggi successivi.

STRUTTURA:
1. Ringrazia brevemente per la risposta
2. Se ha fatto domande: rispondi in modo sintetico (descrizione generica del sistema, prova gratuita)
3. Cita un cliente simile con dati concreti (reviewsGained, monthsActive)
4. Proponi la chiamata: "Posso chiamarti 5 minuti per spiegarti come funziona la prova?"
5. Se non hai il nome della persona: chiedi "Con chi parlo?"
6. Se non hai il numero: chiedi "A che numero posso chiamarti?"`,
  doNot: [
    'Spiegare il meccanismo tecnico (QR, WhatsApp, filtro, bot) — si spiega nella chiamata',
    'Citare il prezzo pieno (1.290 euro) — menziona solo la prova gratuita di 2 settimane',
    'Proporre videochiamate, Zoom, Google Meet',
    'Inventare dati non presenti nel contesto',
    'Ignorare domande dirette del lead'
  ],
  strategies: {
    answer_and_propose: 'Rispondi alla domanda + caso studio concreto + proponi chiamata 5 minuti',
    social_proof: 'Cita un ristorante simile con dati reali (reviewsGained, monthsActive)',
    collect_info: 'Se manca il nome o il numero: chiedili in modo naturale alla fine del messaggio'
  },
  maxWords: 100
};
