export default {
  stage: 'objection_handling',
  objective: 'Gestire l\'obiezione e riportare il focus su: basso rischio (prova gratuita) + basso impegno (chiamata 5 minuti)',
  context: 'Il lead ha sollevato un\'obiezione. NON arrenderti subito, ma NON forzare. Max 2 tentativi sulla stessa obiezione.',
  approach: 'Ogni obiezione e\' un\'opportunita. Il lead sta parlando con te — non e\' completamente disinteressato.',
  doNot: [
    'Insistere piu di 2 volte sulla stessa obiezione',
    'Ignorare l\'obiezione e cambiare argomento',
    'Essere aggressivo o push',
    'Inventare dati per controbattere'
  ],
  objectionStrategies: {
    no_tempo: {
      reframe: 'Proprio per questo propongo 5 minuti al telefono — non una presentazione, solo per capire se ha senso. Se non fa al caso tuo, ci salutiamo in 5 minuti.',
      cta: 'Quando ti viene piu comodo?'
    },
    mandami_mail: {
      reframe: 'Un paio di cose cambiano da locale a locale — tipo la stima recensioni dipende dai coperti. 5 minuti al telefono e ti do numeri concreti per il tuo ristorante.',
      cta: 'Preferisci mattina o pomeriggio?'
    },
    prezzo: {
      reframe: 'Il listino e\' 1.290 euro annuale, ma partiamo con 2 settimane di prova gratuita — zero impegno.',
      cta: 'Nella chiamata ti spiego come funziona e vediamo se e\' adatto. Ti chiamo?'
    },
    ha_gia_fornitore: {
      reframe: 'Ottimo, vuol dire che credi nel valore delle recensioni! Curiosita: quante ne raccogliete al mese? Il nostro sistema e\' complementare.',
      cta: 'Ti spiego i numeri in 5 minuti?'
    },
    non_interessa: {
      reframe: 'Nessun problema! Il rank checker e\' gratuito — puoi usarlo quando vuoi. In bocca al lupo!',
      fallback: 'schedule_followup 14 giorni con angolo diverso'
    },
    bad_timing: {
      reframe: 'Capisco. Ti riscrivo tra un paio di settimane? Cosi decidi con calma.',
      fallback: 'schedule_followup con giorni appropriati'
    },
    troppo_caro: {
      reframe: 'Partiamo con 2 settimane gratis — parliamo del prezzo solo se funziona. Siamo molto flessibili sulle condizioni.',
      cta: 'Ti chiamo 5 minuti?'
    }
  },
  maxWords: 100
};
