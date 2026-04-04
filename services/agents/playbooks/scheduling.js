export default {
  stage: 'scheduling',
  objective: 'Raccogliere numero di telefono e fascia oraria per fissare la chiamata',
  context: 'Il lead e\' aperto alla chiamata. Devi raccogliere/confermare numero e disponibilita.',
  approach: 'Sii diretto. Conferma il numero, proponi una fascia oraria, chiudi.',
  doNot: [
    'Allungare la conversazione inutilmente — il lead ha gia detto si',
    'Tornare a spiegare il prodotto',
    'Inventare disponibilita che il lead non ha espresso'
  ],
  steps: [
    'Se hai il numero: conferma e proponi fascia oraria',
    'Se non hai il numero: chiedilo direttamente',
    'Dopo conferma: usa book_callback per finalizzare'
  ],
  maxWords: 60
};
