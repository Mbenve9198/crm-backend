/**
 * Script cold call v3: apertura ancora+proof, hook Maps, qualificazione,
 * value/trial condizionati dai coperti (calcolo 10% lato FE/BE helper).
 */

import { isUsableVisibilityCard } from './visibilityCardUtils.js';

const DEFAULT_LIST = 'Cold Call - Vicini Clienti';

function asCard(contact) {
  const props = contact.properties || {};
  const card = props.visibilityCard || null;
  return isUsableVisibilityCard(card) ? card : null;
}

function asNumber(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatDist(distM) {
  const n = asNumber(distM);
  if (n == null) return null;
  if (n >= 1000) {
    const km = n / 1000;
    const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
    return `${rounded} km`;
  }
  return `${Math.round(n)} metri`;
}

/**
 * Proiezioni da coperti/settimana.
 * mensili ≈ settimanali × 4; potenziale rec/mese = 10% coperti mensili.
 */
export function computeCoverProjections(coversPerWeek, currentReviews) {
  const weekly = asNumber(coversPerWeek);
  if (weekly == null || weekly <= 0) return null;
  const coversMonthly = Math.round(weekly * 4);
  const potentialMonthly = Math.max(1, Math.round(coversMonthly * 0.1));
  const reviewsNow = asNumber(currentReviews) || 0;
  const yearReviews = reviewsNow + potentialMonthly * 12;
  const twoWeekPotential = Math.max(1, Math.round(potentialMonthly / 2));
  return {
    coversPerWeek: weekly,
    coversMonthly,
    potentialMonthly,
    yearReviews,
    twoWeekPotential,
    reviewsNow,
  };
}

/** Nuovo rating medio dopo una recensione a 1 stella. */
export function ratingAfterOneStar(rating, reviews) {
  const r = asNumber(rating);
  const n = asNumber(reviews);
  if (r == null || n == null || n <= 0) return null;
  return Math.round(((r * n + 1) / (n + 1)) * 100) / 100;
}

function extractSlots(contact, card) {
  const props = contact.properties || {};
  const fromCard = card?.contact?.clienteVicino || card?.nearbyClient?.name;
  const nearbyName = fromCard || props.cliente_vicino || null;

  let distM = null;
  if (card?.contact?.distM != null) distM = asNumber(card.contact.distM);
  else if (card?.nearbyClient?.distM != null) distM = asNumber(card.nearbyClient.distM);
  else if (props.dist_m != null) distM = asNumber(props.dist_m);
  else if (props.dist_km != null) {
    const km = asNumber(props.dist_km);
    distM = km != null ? km * 1000 : null;
  }

  const keyword =
    card?.ranking?.selectedKeyword || card?.ranking?.keyword || card?.keyword?.keyword || null;

  const rawRank = card?.ranking?.userRank;
  let rank = null;
  if (typeof rawRank === 'number' && Number.isFinite(rawRank)) rank = rawRank;
  else if (typeof rawRank === 'string' && /^\d+$/.test(rawRank.trim())) rank = Number(rawRank.trim());

  const ahead = Array.isArray(card?.ranking?.competitorsAhead)
    ? card.ranking.competitorsAhead
    : [];

  const rating = asNumber(
    card?.place?.rating ?? card?.ranking?.user?.rating ?? props.rating
  );
  const reviews = asNumber(
    card?.place?.reviews ?? card?.ranking?.user?.reviews ?? props.reviews_count
  );

  const nearbyClientStats =
    props.nearbyClientStats || card?.nearbyClientStats || null;

  const foundFlag = card?.ranking?.found;
  const rawRankStr = typeof rawRank === 'string' ? rawRank.toLowerCase() : '';
  const looksOutOfTop =
    foundFlag === false ||
    /fuori|nessun|non\s*trov|top\s*20|top risultati/.test(rawRankStr);

  /** rank1 | ranked | out_of_top | unknown */
  let rankKind = 'unknown';
  if (rank === 1) rankKind = 'rank1';
  else if (rank != null && rank > 1) rankKind = 'ranked';
  else if (looksOutOfTop || (keyword && rank == null && ahead.length > 0)) {
    rankKind = 'out_of_top';
  }

  return {
    locale: card?.place?.name || contact.name,
    nearby: { name: nearbyName, distM },
    nearbyClientStats,
    keyword,
    rank,
    rankKind,
    rankingFound: foundFlag === true ? true : foundFlag === false ? false : null,
    competitors: ahead.slice(0, 2),
    competitor: ahead[0] || null,
    rating,
    reviews,
    address: card?.place?.address || props.address || null,
    city: card?.contact?.city || props.city || null,
    category: card?.contact?.category || props.category || null,
    placeId: card?.place?.placeId || props.place_id || null,
    generatedAt: props.visibilityCardGeneratedAt || card?.generatedAt || null,
    agentName: null,
  };
}

function nearbyProofLine(slots) {
  const s = slots.nearbyClientStats;
  if (!s || s.reviewsGained == null || s.reviewsGained <= 0) return null;
  const months = asNumber(s.monthsActive);
  const monthsLabel =
    months == null || months <= 0
      ? null
      : months === 1
        ? '1 mese'
        : `${Math.round(months)} mesi`;
  if (s.initialReviewCount != null && s.currentReviewCount != null && monthsLabel) {
    return `lo abbiamo aiutato a passare da ${s.initialReviewCount} a ${s.currentReviewCount} recensioni in ${monthsLabel}`;
  }
  if (monthsLabel) {
    return `gli abbiamo portato +${s.reviewsGained} recensioni Google in ${monthsLabel}`;
  }
  return `gli abbiamo portato +${s.reviewsGained} recensioni Google vere`;
}

function buildOpening(slots) {
  const agent = slots.agentName || '{{agentName}}';
  const lines = [`Buongiorno, ${slots.locale}? Sono ${agent} di Menu Chat.`];

  if (slots.nearby.name) {
    const distLabel = formatDist(slots.nearby.distM);
    const proof = nearbyProofLine(slots);
    let line = `Vi chiamo perché lavoriamo con ${slots.nearby.name}${
      distLabel ? `, qui a ${distLabel} da voi` : ' qui vicino'
    }`;
    if (proof) line += `: ${proof}`;
    else line += ', sulle recensioni Google vere';
    lines.push(`${line}.`);
  } else {
    lines.push(`Vi chiamo perché lavoriamo con locali della vostra zona sulle recensioni Google vere.`);
  }

  if (slots.reviews != null) {
    lines.push(`Voi su Maps siete a circa ${slots.reviews} recensioni.`);
  }

  lines.push(
    `Posso farvi due domande al volo per capire se possiamo aiutarvi allo stesso modo?`
  );
  return lines.join(' ');
}

/** Posizione relativa vs competitor — solo con rank numerico noto (>1). */
function competitorsPhrase(slots) {
  if (slots.rank == null || slots.rank <= 1) return null;
  const comps = slots.competitors || [];
  if (comps.length >= 2) {
    return `sotto ${comps[0].name} e ${comps[1].name}`;
  }
  if (comps.length === 1) {
    return `sotto ${comps[0].name}`;
  }
  return 'dietro ad altri locali della zona';
}

function reviewsPossessivePhrase(slots) {
  if (slots.reviews != null) return `le vostre ${slots.reviews} recensioni`;
  return 'le vostre recensioni';
}

function topCompetitorsPhrase(slots) {
  const comps = slots.competitors || [];
  if (comps.length >= 2) return `${comps[0].name} e ${comps[1].name}`;
  if (comps.length === 1) return comps[0].name;
  return 'altri locali della zona';
}

function buildHook(slots) {
  const keyword = slots.keyword || 'la vostra categoria in zona';
  const q1 = `come avete raccolto ${reviewsPossessivePhrase(slots)}?`;

  if (slots.rankKind === 'rank1') {
    return (
      `Perfetto. Ho simulato una ricerca su Google Maps, scrivendo «${keyword}», e siete apparsi #1 — bravi. ` +
      `Il punto non è arrivarci, è restarci: chi è dietro sale in fretta se raccoglie più recensioni di voi. ` +
      `Per capire se ha senso aiutarvi a difendere la posizione: ${q1}`
    );
  }

  if (slots.rankKind === 'out_of_top') {
    return (
      `Perfetto. Ho simulato una ricerca su Google Maps, scrivendo «${keyword}»: voi non uscite nei primi risultati — per quella ricerca praticamente non vi trovano. ` +
      `Chi appare per primo sono ${topCompetitorsPhrase(slots)}. ` +
      `Il modo migliore per rientrare in mappa è avere più recensioni vere: ${q1}`
    );
  }

  const under = competitorsPhrase(slots);
  const rankTxt = slots.rank != null ? `#${slots.rank}` : 'fuori dai primi risultati';
  const positionBit = under ? `${rankTxt}, ${under}` : rankTxt;
  return (
    `Perfetto. Ho simulato una ricerca su Google Maps, scrivendo «${keyword}», e siete apparsi ${positionBit}. ` +
    `Il modo migliore per salire nei primi risultati è avere più recensioni: ${q1}`
  );
}

function buildDiscovery(slots) {
  return [
    {
      id: 'q1',
      label: 'Recensioni oggi',
      mode: 'ask',
      line: `Come avete raccolto ${reviewsPossessivePhrase(slots)}?`,
      ...(slots.reviews != null ? { knownFact: `${slots.reviews} rec Maps` } : {}),
    },
    {
      id: 'q2_covers',
      label: 'Coperti / settimana',
      mode: 'ask',
      inputType: 'number',
      line: 'Più o meno quanti coperti fate a settimana in questo periodo?',
      placeholder: 'es. 200',
      drivesProjections: true,
    },
    {
      id: 'q3_menu',
      label: 'Menu cartaceo o digitale',
      mode: 'ask',
      line: 'Avete menu cartaceo o digitale?',
      choiceOptions: [
        { id: 'cartaceo', label: 'Cartaceo' },
        { id: 'digitale', label: 'Digitale' },
      ],
      followUpIfPaper:
        'Sareste disposti a mettere il menu digitale se vi permettesse di raccogliere circa {{potentialMonthly}} recensioni al mese?',
      followUpChoices: [
        { id: 'si', label: 'Sì' },
        { id: 'no', label: 'No', opensObjection: 'no_digital' },
      ],
    },
  ];
}

function buildValueTemplate(slots) {
  const keyword = slots.keyword || 'in zona';
  const ancora = slots.nearby.name || 'il locale vicino con cui lavoriamo';
  const reviews = slots.reviews != null ? String(slots.reviews) : 'quelle che avete';
  const rank = slots.rank != null ? String(slots.rank) : '…';

  let line1 =
    `Con i QR e WhatsApp potete arrivare a circa {{potentialMonthly}} recensioni al mese: da ${reviews} a circa {{yearReviews}} entro un anno.`;
  if (slots.rankKind === 'rank1') {
    line1 =
      `Con i QR e WhatsApp potete arrivare a circa {{potentialMonthly}} recensioni al mese: da ${reviews} a circa {{yearReviews}} entro un anno, e restare saldamente primi su «${keyword}».`;
  } else if (slots.rankKind === 'ranked') {
    line1 =
      `Con i QR e WhatsApp potete arrivare a circa {{potentialMonthly}} recensioni al mese: da ${reviews} a circa {{yearReviews}} entro un anno, e stringere su chi è davanti su «${keyword}» — oggi siete intorno al ${rank}° posto.`;
  } else if (slots.rankKind === 'out_of_top') {
    line1 =
      `Con i QR e WhatsApp potete arrivare a circa {{potentialMonthly}} recensioni al mese: da ${reviews} a circa {{yearReviews}} entro un anno, e tornare visibili su Maps quando uno cerca «${keyword}».`;
  } else if (slots.keyword) {
    // unknown ma con keyword: obiettivo generico di primato, senza fingere il rank
    line1 =
      `Con i QR e WhatsApp potete arrivare a circa {{potentialMonthly}} recensioni al mese: da ${reviews} a circa {{yearReviews}} entro un anno, ed essere più forti su Maps quando uno cerca «${keyword}».`;
  }

  const line2 =
    'Nella prova di due settimane, se i QR stanno sui tavoli, di solito vediamo intorno a {{twoWeekPotential}} recensioni nuove.';
  const cta =
    `Come abbiamo fatto per ${ancora}: ti andrebbe di provare gratis lo stesso sistema per due settimane, senza impegno?`;

  return {
    needsCovers: true,
    lines: [line1, line2, cta],
  };
}

function buildTrialSteps(slots) {
  void slots;
  return {
    needsCovers: true,
    steps: [
      {
        id: 'explain',
        title: 'Come funziona',
        line:
          'Bene, ti spiego come funziona: mettiamo dei QR code sui tavoli e quando il cliente scannerizza per vedere il menu digitale si apre una chat WhatsApp che invia in automatico il menu. Dopo che ha finito di mangiare, quando l’esperienza è ancora calda, riceve un messaggio WhatsApp con la richiesta di recensione e link diretto a Google. Puoi aspettarti che ogni 100 persone che vedono il menu, circa 10 mettano la recensione. Ti è chiaro fin qui?',
      },
      {
        id: 'start_timing',
        title: 'Partenza prova',
        line:
          'Perfetto. Allora apriamo la prova: ti spedisco i QR e le due settimane partono quando li metti sui tavoli. Me la confermi per questa settimana?',
        choiceOptions: [
          { id: 'this_week', label: 'Questa settimana' },
          { id: 'next_week', label: 'La prossima' },
          { id: 'other_date', label: 'Altra data' },
        ],
        fields: [
          {
            id: 'trial_start_date_note',
            label: 'Se altra data / nota',
            placeholder: 'es. dopo Pasqua, dal 20…',
          },
        ],
      },
      {
        id: 'ship_qr',
        title: 'Spedizione QR',
        line:
          'Per iniziare la prova ti inviamo 50 QR code direttamente all’indirizzo che preferisci: ti costano giusto 25€ + IVA per la stampa e la spedizione. Tu dovrai solo mettere i QR sui tavoli e togliere il cartaceo (davvero importante). A che indirizzo posso inviarteli?',
        fields: [
          {
            id: 'trial_ship_address',
            label: 'Indirizzo spedizione QR',
            placeholder: 'Via, CAP, città (e eventuale riferimento)',
          },
        ],
      },
      {
        id: 'invoice',
        title: 'Fattura setup',
        line:
          'Ok, li metto in spedizione oggi: di solito arrivano in circa due giorni lavorativi. Intanto ti mando la fattura dei 25€ + IVA: basta la paghi entro un paio di giorni. Mi servirebbe P.IVA, ragione sociale, sede legale e codice univoco.',
        fields: [
          {
            id: 'trial_ragione_sociale',
            label: 'Ragione sociale',
            placeholder: 'es. Ristorante Rossi Srl',
          },
          {
            id: 'trial_piva',
            label: 'P.IVA',
            placeholder: '11 cifre',
          },
          {
            id: 'trial_sede_legale',
            label: 'Sede legale',
            placeholder: 'Via, CAP, città',
          },
          {
            id: 'trial_codice_univoco',
            label: 'Codice univoco / SDI',
            placeholder: '7 caratteri o PEC',
          },
        ],
      },
      {
        id: 'menu_assets',
        title: 'Menu (digitale o cartaceo)',
        line:
          'Se ha già menu digitale: mi manderesti il link al tuo menu digitale o una foto del QR che hai sui tavoli? Se non ce l’ha: mi manderesti PDF oppure foto del tuo menu cartaceo? Così ti preparo il tuo menu digitale.',
        fields: [
          {
            id: 'trial_menu_asset',
            label: 'Link menu / nota asset',
            placeholder: 'URL, «foto via WA», «PDF in arrivo»…',
          },
        ],
      },
      {
        id: 'wa_number',
        title: 'WhatsApp',
        line: 'Perfetto, il tuo numero WhatsApp dove posso inviarti il menu digitale?',
        fields: [
          {
            id: 'trial_whatsapp',
            label: 'Numero WhatsApp',
            placeholder: '333…',
            inputType: 'tel',
          },
        ],
      },
      {
        id: 'go_live',
        title: 'Messa live + check',
        line:
          'Dalla spedizione i QR arrivano in genere in circa due giorni lavorativi: appena li ricevi li metti sui tavoli e da lì partono le due settimane. Che giorno li mettiamo live dopo l’arrivo? Fissiamo anche un check veloce il giorno dopo che sono arrivati.',
        fields: [
          {
            id: 'trial_qr_live',
            label: 'Data messa QR sui tavoli (post-arrivo)',
            placeholder: 'es. giovedì dopo pranzo',
          },
          {
            id: 'trial_check_call',
            label: 'Check post-arrivo',
            placeholder: 'es. venerdì 11:30',
          },
          {
            id: 'trial_ops_owner',
            label: 'Referente sala (chi mette i QR)',
            placeholder: 'Nome / ruolo — eventuale cell',
          },
        ],
      },
      {
        id: 'remind_paper',
        title: 'Reminder cartaceo',
        line:
          'Ok, allora grazie. Ricordati: quando ti arrivano i QR, dovrai metterli sui tavoli e non dare assolutamente il menu cartaceo a meno di casi eccezionali. Se dai entrambi, le persone useranno il cartaceo, il servizio non funzionerà e avremo perso soldi entrambi.',
      },
      {
        id: 'close',
        title: 'Chiusura',
        line: 'Bene. Allora grazie ancora e buona serata.',
      },
    ],
  };
}

function buildEarlyObjections(slots) {
  const agent = slots.agentName || '{{agentName}}';
  const nearbyBit = slots.nearby.name
    ? `, come facciamo già con ${slots.nearby.name}`
    : '';
  return [
    {
      id: 'busy',
      short: 'Occupato',
      trigger: 'Siamo in servizio / non posso parlare ora',
      placement: 'early',
      line:
        `Capito, non vi rubo tempo. Sono ${agent} di Menu Chat. Vi richiamo quando siete più tranquilli: preferite oggi dopo servizio o domani mattina prima delle 11? Intanto lasci pure solo il nome: ${agent}, recensioni Google${nearbyBit}.`,
    },
    {
      id: 'gate',
      short: 'Non è lui',
      trigger: 'Non sono io che decido / chi parla?',
      placement: 'early',
      line:
        `Capito. Sono ${agent} di Menu Chat${
          slots.nearby.name
            ? `: lavoriamo già con ${slots.nearby.name} qui vicino`
            : ''
        }. Chi decide di solito su menu e recensioni? Preferisce che lo richiami io domani mattina o nel pomeriggio? Se ha un cellulare lo segno e non disturbo più la sala.`,
    },
  ];
}

function buildObjections(slots) {
  const reviews = slots.reviews;
  const rating = slots.rating;
  const after = ratingAfterOneStar(rating, reviews);
  const ratingBit =
    rating != null && reviews != null && after != null
      ? `ora se ti arriva una recensione a una stella, considerando che hai ${reviews} recensioni con rating ${rating}, scenderesti subito a circa ${after}; ma dopo mesi con noi avrai così tante recensioni che il rating non si abbasserà più allo stesso modo`
      : `ora una stella ti fa male subito; con molte più recensioni vere il rating diventa molto più stabile`;

  return [
    {
      id: 'negatives',
      short: 'Recensioni negative?',
      trigger: 'Recensioni negative?',
      line:
        `Chi vuole lasciarti una negativa lo fa già oggi: ti cerca su Google e la scrive, a prescindere. Il problema vero è che chi si trova bene non fa niente. Con noi le positive che prima non arrivavano ora arrivano ogni giorno — e se prima una negativa ti rimaneva in cima per settimane, ora dopo un giorno sarà già sommersa da altre positive. Inoltre ${ratingBit}.`,
    },
    {
      id: 'fake',
      short: 'Recensioni false?',
      trigger: 'Recensioni false?',
      line:
        'No. Niente recensioni comprate, niente bot: solo i tuoi clienti veri, quelli che hanno mangiato da te e scansionato il QR. Chiediamo a chi si è trovato bene di scrivere quello che già pensa. È esattamente il tipo di recensione che Google vuole.',
    },
    {
      id: 'price',
      short: 'Quanto costa?',
      trigger: 'Quanto costa?',
      line:
        'Le prime due settimane niente: nessuna carta, si disdice con un messaggio. Poi poco più di cento euro al mese — ma ne parliamo a prova finita, coi tuoi numeri davanti.',
    },
    {
      id: 'partner',
      short: 'Devo parlarne col socio',
      trigger: 'Devo parlarne col socio',
      line:
        'Certo, ci mancherebbe. Ti dico solo una cosa così non gli porti una roba più grande di quella che è. Qui non c’è niente da decidere adesso: sono due settimane di prova, non paghi niente e non firmi niente. Se in due settimane non vi arrivano recensioni in più, ci salutiamo. La decisione vera la prendete tra due settimane guardando i vostri numeri, non fidandovi di quello che vi dico io al telefono. Detto questo: al di là del socio, tu la proveresti?',
      branches: [
        {
          id: 'partner_yes',
          label: 'Se dice sì',
          line:
            'Perfetto. Allora quando gliene parli digli che la prova è gratis e in due settimane già potrete raccogliere circa {{twoWeekPotential}} recensioni in più. Quando lo senti, stasera? Ti richiamo domani alle 15.',
          needsCovers: true,
        },
        {
          id: 'partner_hesitate',
          label: 'Se tentenna',
          line:
            'Posso essere sincero? Ho la sensazione che più che il socio ci sia qualcosa che non ti convince. Dimmelo tranquillamente, non mi offendo: è meglio un no adesso che due settimane di messaggi. Cos’è che non ti torna?',
        },
      ],
    },
    {
      id: 'no_digital',
      short: 'No menu digitale',
      trigger: 'No menu digitale',
      line:
        'Certo, lo capisco. Il QR per il menu è l’unico modo per far ottenere recensioni in automatico così. E mi dica: sarebbe disposto a mettere su digitale almeno la carta dei vini o dei dolci? Oppure il menu del giorno se ce l’ha?',
      branches: [
        {
          id: 'partial_yes',
          label: 'Se sì → procedi trial',
          line:
            'Perfetto, partiamo da quello — stesso flusso WhatsApp, stesso obiettivo recensioni.',
        },
        {
          id: 'partial_no',
          label: 'Se no → chiudi',
          line:
            'Ok, allora non è il momento. Se cambia idea sulle recensioni Maps, mi trovi. Buona giornata.',
        },
      ],
    },
  ];
}

function buildCardSummary(slots, hook) {
  return {
    name: slots.locale,
    keyword: slots.keyword,
    rank: slots.rank,
    rankKind: slots.rankKind,
    rating: slots.rating,
    reviews: slots.reviews,
    competitorAhead: slots.competitor
      ? {
          name: slots.competitor.name,
          rank: slots.competitor.rank,
          rating: slots.competitor.rating,
          reviews: slots.competitor.reviews,
        }
      : null,
    competitorsAhead: (slots.competitors || []).map((c) => ({
      name: c.name,
      rank: c.rank,
      rating: c.rating,
      reviews: c.reviews,
    })),
    nearbyClient: slots.nearby.name
      ? { name: slots.nearby.name, distM: slots.nearby.distM }
      : null,
    nearbyClientStats: slots.nearbyClientStats || null,
    nearbyProof: nearbyProofLine(slots),
    address: slots.address,
    city: slots.city,
    category: slots.category,
    placeId: slots.placeId,
    hook,
    generatedAt: slots.generatedAt,
  };
}

/** Riempie {{token}} in una stringa. */
export function fillScriptTemplate(template, vars = {}) {
  if (!template) return template;
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : `{{${key}}}`
  );
}

/**
 * @param {object} contact - mongoose contact (lean ok)
 * @param {{ agentName?: string }} [opts]
 * @returns {object} structured script
 */
export function buildColdCallScript(contact, opts = {}) {
  const card = asCard(contact);
  const slots = extractSlots(contact, card);
  const agentName =
    (typeof opts.agentName === 'string' && opts.agentName.trim()) ||
    null;
  slots.agentName = agentName;

  const hook = buildHook(slots);
  const summary = buildCardSummary(slots, hook);
  const value = buildValueTemplate(slots);
  const trial = buildTrialSteps(slots);
  const earlyObjections = buildEarlyObjections(slots);
  const objections = buildObjections(slots);

  // Stringhe “piene” senza coperti (placeholder leggibili) per fallback / note
  const fallbackVars = {
    potentialMonthly: '…',
    yearReviews: '…',
    twoWeekPotential: '…',
    agentName: agentName || '…',
  };

  return {
    opening: buildOpening(slots),
    hook,
    discovery: buildDiscovery(slots),
    value: value.lines.map((l) => fillScriptTemplate(l, fallbackVars)).join(' '),
    valueBlock: value,
    trial: trial.steps.map((s) => s.line).join(' '),
    trialBlock: trial,
    earlyObjections,
    busy: earlyObjections.find((o) => o.id === 'busy')?.line || '',
    gate: earlyObjections.find((o) => o.id === 'gate')?.line || '',
    objections,
    cardSummary: summary,
    hasVisibilityCard: !!card,
    listHint: DEFAULT_LIST,
    agentName: agentName || null,
    projectionHints: {
      reviews: slots.reviews,
      rating: slots.rating,
      keyword: slots.keyword,
      nearbyName: slots.nearby.name,
      rankKind: slots.rankKind,
    },
  };
}

function positionKind(slots) {
  const { keyword, rank, competitor, rankKind } = slots;
  if (rankKind === 'out_of_top' || (keyword && rankKind === 'out_of_top')) {
    return 'out_of_top';
  }
  if (keyword && rank === 1) return 'rank1';
  if (keyword && rank != null && competitor) return 'trailing';
  if (keyword && rank != null) return 'ranked';
  if (keyword && rankKind === 'out_of_top') return 'out_of_top';
  return 'none';
}

function ratingReviewsSuffix(slots) {
  const { reviews, rating } = slots;
  return `${reviews != null ? ` con ${reviews} recensioni` : ''}${
    rating != null ? ` (⭐ ${rating})` : ''
  }`;
}

/** Pezzo Maps monolinea (CLI test + compat). Null se keyword/rank mancanti. */
export function buildMapsHookLine(slots) {
  if (!slots) return null;
  const { keyword, rank, competitor } = slots;
  const kind = positionKind(slots);
  const suffix = ratingReviewsSuffix(slots);

  if (kind === 'rank1') {
    return `Su Maps, per «${keyword}» risultate #1${suffix} — ottima posizione; il rischio è farsi raggiungere sul volume di recensioni.`;
  }
  if (kind === 'out_of_top') {
    return `Su Maps, per «${keyword}» non uscite nei primi risultati (fuori top 20): per quella ricerca praticamente non vi trovano${suffix}.`;
  }
  if (kind === 'trailing') {
    return `Su Maps, chi cerca «${keyword}» vede prima ${competitor.name} (#${competitor.rank}${
      competitor.reviews ? `, ${competitor.reviews} rec` : ''
    }). Voi risultate #${rank}${suffix}.`;
  }
  if (kind === 'ranked') {
    return `Su Maps, per «${keyword}» risultate #${rank}${suffix}.`;
  }
  return null;
}

/** Hook Maps monolinea da card grezza (CLI markdown test). */
export function mapsHookFromCard(card) {
  if (!card) return null;
  const slots = extractSlots(
    { name: card?.place?.name || card?.contact?.name || '', properties: {} },
    card
  );
  return buildMapsHookLine(slots);
}

export function summarizeVisibilityCard(contact) {
  const card = asCard(contact);
  const slots = extractSlots(contact, card);
  const hook = buildHook(slots);
  if (!card) {
    return {
      hasVisibilityCard: false,
      keyword: null,
      rank: null,
      nearbyClient: slots.nearby.name ? slots.nearby : null,
      nearbyClientStats: slots.nearbyClientStats,
      hook,
    };
  }
  const summary = buildCardSummary(slots, hook);
  return {
    hasVisibilityCard: true,
    keyword: summary.keyword,
    rank: summary.rank,
    rating: summary.rating,
    reviews: summary.reviews,
    nearbyClient: summary.nearbyClient,
    nearbyClientStats: summary.nearbyClientStats,
    competitorAhead: summary.competitorAhead,
    hook: summary.hook,
  };
}

export const COLD_CALL_DEFAULT_LIST = DEFAULT_LIST;

export default {
  buildColdCallScript,
  summarizeVisibilityCard,
  mapsHookFromCard,
  buildMapsHookLine,
  computeCoverProjections,
  ratingAfterOneStar,
  fillScriptTemplate,
  COLD_CALL_DEFAULT_LIST,
};
