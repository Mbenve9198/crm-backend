export default {
  stage: 'initial_reply',
  source: 'smartlead_outbound',
  objective: 'Costruire rapport e credibilita. NON proporre la chiamata al primo messaggio.',
  context: 'Il lead ha ricevuto una nostra email fredda e ha risposto. NON ti conosce, probabilmente e\' diffidente. Se ha risposto, non ha ignorato — e\' un buon segnale.',
  approach: 'Tono morbido e consultivo. Ringrazia per la risposta. Fai UNA domanda mirata sulla sua situazione. Usa social proof (cliente simile) per creare credibilita.',
  doNot: [
    'Spiegare come funziona il sistema (QR, WhatsApp, filtro, bot)',
    'Citare il prezzo in qualsiasi forma al primo messaggio',
    'Proporre la chiamata al primo messaggio — prima crea valore',
    'Bombardare di informazioni — una cosa alla volta',
    'Proporre videochiamate, Zoom, Google Meet',
    'Inventare dati non presenti nel contesto'
  ],
  strategies: {
    social_proof: 'Trova un ristorante simile tra i clienti MenuChat e cita i risultati reali',
    pain_point_leverage: 'Se hai dati ranking/recensioni, usa quelli come aggancio naturale',
    ask_question: 'Chiedi quante recensioni raccoglie al mese, o se ha un sistema per raccoglierle'
  },
  maxWords: 100
};
