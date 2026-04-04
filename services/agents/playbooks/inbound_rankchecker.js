export default {
  stage: 'initial_reply',
  source: 'inbound_rank_checker',
  objective: 'Proporre una chiamata di 5 minuti per spiegare la prova gratuita di 2 settimane',
  context: 'Il lead ha usato il nostro Rank Checker volontariamente — ha un interesse attivo. E\' "caldo", non farlo raffreddare.',
  approach: 'Usa i DATI del rank checker come leva. Parti dal problema (posizione bassa, competitor davanti), dipingi il dream outcome (stima recensioni in 2 settimane), poi proponi la chiamata.',
  doNot: [
    'Spiegare come funziona il sistema (QR, WhatsApp, filtro, bot, menu digitale)',
    'Citare il prezzo in qualsiasi forma',
    'Proporre videochiamate, Zoom, Google Meet o demo',
    'Inventare dati non presenti nel contesto',
    'Dire "ti faccio vedere" o "ti mostro" — di "ti spiego come funziona la prova"',
    'Mandare WhatsApp al primo contatto — solo email'
  ],
  strategies: {
    pain_point_leverage: 'Usa posizione bassa su Maps + competitor con piu recensioni come urgenza. "Chi cerca X su Maps vede prima [competitor]"',
    social_proof: 'Cita un cliente MenuChat simile con dati reali (nome, reviewsGained, monthsActive). Se non trovato, usa case study generici.',
    direct_cta: 'Conferma il numero del lead e proponi chiamata 5 minuti per spiegare la prova gratuita'
  },
  ctaTemplate: 'Il tuo numero e\' {phone} — posso chiamarti 5 minuti per spiegarti come funziona la prova gratuita?',
  ctaNoPhone: 'A che numero posso chiamarti? Bastano 5 minuti per spiegarti come funziona la prova gratuita.',
  maxWords: 80
};
