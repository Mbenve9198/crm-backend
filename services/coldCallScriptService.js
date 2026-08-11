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

  return {
    locale: card?.place?.name || contact.name,
    nearby: { name: nearbyName, distM },
    nearbyClientStats,
    keyword,
    rank,
    competitors: ahead.slice(0, 2),
    competitor: ahead[0] || null,
    rating,
    reviews,
    address: card?.place?.address || props.address || null,
    city: card?.contact?.city || props.city || null,
    category: card?.contact?.category || props.category || null,
    placeId: card?.place?.placeId || props.place_id || null,
    generatedAt: props.visibilityCardGeneratedAt || card?.generatedAt || null,
  };
}

function nearbyProofLine(slots) {
  const s = slots.nearbyClientStats;
  if (!s || s.reviewsGained == null || s.reviewsGained <= 0) return null;
  const months = s.monthsActive;
  const monthsLabel =
    months == null ? null : months === 1 ? '1 mese' : `${months} mesi`;
  if (s.initialReviewCount != null && s.currentReviewCount != null && monthsLabel) {
    return `lo abbiamo aiutato a passare da ${s.initialReviewCount} a ${s.currentReviewCount} recensioni in ${monthsLabel}`;
  }
  if (monthsLabel) {
    return `gli abbiamo portato +${s.reviewsGained} recensioni Google in ${monthsLabel}`;
  }
  return `gli abbiamo portato +${s.reviewsGained} recensioni Google vere`;
}

function buildOpening(slots) {
  const lines = [
    'Stop. Ascolta.',
    `Buongiorno, ${slots.locale}? Sono Alessandro di Menu Chat.`,
  ];

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

/** Posizione relativa vs competitor — null se #1 o senza competitor noti. */
function competitorsPhrase(slots) {
  if (slots.rank === 1) return null;
  const comps = slots.competitors || [];
  if (comps.length >= 2) {
    return `sotto ${comps[0].name} e ${comps[1].name}`;
  }
  if (comps.length === 1) {
    return `sotto ${comps[0].name}`;
  }
  if (slots.rank != null && slots.rank > 1) {
    return 'dietro ad altri locali della zona';
  }
  return null;
}

function reviewsPossessivePhrase(slots) {
  if (slots.reviews != null) return `le vostre ${slots.reviews} recensioni`;
  return 'le vostre recensioni';
}

function buildHook(slots) {
  const keyword = slots.keyword || 'la vostra categoria in zona';
  const rankTxt = slots.rank != null ? `#${slots.rank}` : 'fuori dai primi risultati';
  const under = competitorsPhrase(slots);
  const positionBit = under ? `${rankTxt}, ${under}` : rankTxt;
  return (
    `Perfetto. Ho simulato una ricerca su Google Maps, scrivendo «${keyword}», e siete apparsi ${positionBit}. ` +
    `Il modo migliore per apparire nei primi risultati è avere più recensioni: come avete raccolto ${reviewsPossessivePhrase(slots)}?`
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
      followUpIfPaper:
        'Se cartaceo — sareste disposti a mettere il menu digitale se vi permettesse di raccogliere circa {{potentialMonthly}} recensioni al mese?',
    },
    {
      id: 'name_role',
      label: 'Nome / ruolo',
      mode: 'ask',
      line: 'Scusa, stiamo parlando da un minuto: come ti chiami? … Sei titolare, socio, o gestisci tu queste cose?',
    },
  ];
}

function buildValueTemplate(slots) {
  const keyword = slots.keyword || 'in zona';
  const ancora = slots.nearby.name || 'il locale vicino con cui lavoriamo';
  const reviews = slots.reviews != null ? String(slots.reviews) : 'quelle che avete';
  return {
    needsCovers: true,
    lines: [
      `In base a quello che mi hai detto, con il nostro sistema potreste raccogliere circa {{potentialMonthly}} recensioni al mese, e quindi fra un anno avreste circa {{yearReviews}} recensioni (oggi ${reviews} + {{potentialMonthly}}×12) ed essere primi nei risultati su Google Maps quando uno cerca «${keyword}».`,
      `Come abbiamo fatto per ${ancora}: ti andrebbe di provare gratis lo stesso sistema per due settimane senza impegno?`,
    ],
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
        id: 'ship_qr',
        title: 'Spedizione QR',
        line:
          'Per iniziare la prova ti inviamo 50 QR code direttamente all’indirizzo che preferisci: ti costano giusto 25€ + IVA per la stampa e la spedizione. Tu dovrai solo mettere i QR sui tavoli e togliere il cartaceo (davvero importante). A che indirizzo posso inviarteli?',
      },
      {
        id: 'invoice',
        title: 'Fattura setup',
        line:
          'Ok, te li spediamo in giornata. Intanto ti mando la fattura dei 25€ + IVA: basta la paghi entro un paio di giorni. Mi servirebbe P.IVA, ragione sociale, sede legale e codice univoco.',
      },
      {
        id: 'menu_assets',
        title: 'Menu (digitale o cartaceo)',
        line:
          'Se ha già menu digitale: mi manderesti il link al tuo menu digitale o una foto del QR che hai sui tavoli? Se non ce l’ha: mi manderesti PDF oppure foto del tuo menu cartaceo? Così ti preparo il tuo menu digitale.',
      },
      {
        id: 'wa_number',
        title: 'WhatsApp',
        line: 'Perfetto, il tuo numero WhatsApp dove posso inviarti il menu digitale?',
      },
      {
        id: 'remind_paper',
        title: 'Reminder cartaceo',
        line:
          'Ok, allora grazie {{nome}}. Ricordati: quando ti arrivano i QR, dovrai metterli sui tavoli e non dare assolutamente il menu cartaceo a meno di casi eccezionali. Se dai entrambi, le persone useranno il cartaceo, il servizio non funzionerà e avremo perso soldi entrambi.',
      },
      {
        id: 'close',
        title: 'Chiusura',
        line: 'Bene. Allora grazie ancora e buona serata.',
      },
    ],
  };
}

function buildObjections(slots) {
  const reviews = slots.reviews;
  const rating = slots.rating;
  const after = ratingAfterOneStar(rating, reviews);
  const ratingBit =
    rating != null && reviews != null && after != null
      ? `ora se ti arriva una recensione a una stella, considerando che hai ${reviews} recensioni con rating ${rating}, scenderesti subito a circa ${after}; ma dopo mesi con noi avrai così tante recensioni che il rating non si abbasserà più allo stesso modo`
      : `ora una stella ti fa male subito; con molte più recensioni vere il rating diventa molto più stabile`;

  const objections = [
    {
      id: 'negatives',
      short: 'Negative',
      trigger: 'E le recensioni negative?',
      line:
        `Chi vuole lasciarti una negativa lo fa già oggi: ti cerca su Google e la scrive, a prescindere. Il problema vero è che chi si trova bene non fa niente. Con noi le positive che prima non arrivavano ora arrivano ogni giorno — e se prima una negativa ti rimaneva in cima per settimane, ora dopo un giorno sarà già sommersa da altre positive. Inoltre ${ratingBit}.`,
    },
    {
      id: 'fake',
      short: 'False?',
      trigger: 'Sono recensioni false?',
      line:
        'No. Niente recensioni comprate, niente bot: solo i tuoi clienti veri, quelli che hanno mangiato da te e scansionato il QR. Chiediamo a chi si è trovato bene di scrivere quello che già pensa. È esattamente il tipo di recensione che Google vuole.',
    },
    {
      id: 'price',
      short: 'Prezzo',
      trigger: 'Quanto costa?',
      line:
        'Le prime due settimane niente: nessuna carta, si disdice con un messaggio. Poi poco più di cento euro al mese — ma ne parliamo a prova finita, coi tuoi numeri davanti.',
    },
    {
      id: 'partner',
      short: 'Socio',
      trigger: 'Ne voglio parlare col socio',
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
      short: 'No digitale',
      trigger: 'Non voglio menu digitale / carta è esperienza / clienti anziani',
      line:
        'Certo, lo capisco. Il QR per il menu è l’unico modo per far ottenere recensioni in automatico così. E mi dica: sarebbe disposto a mettere su digitale almeno la carta dei vini o dei dolci? Oppure il menu del giorno se ce l’ha?',
      branches: [
        { id: 'partial_yes', label: 'Se sì → procedi trial', line: 'Perfetto, partiamo da quello — stesso flusso WhatsApp, stesso obiettivo recensioni.' },
        { id: 'partial_no', label: 'Se no → chiudi', line: 'Ok, allora non è il momento. Se cambia idea sulle recensioni Maps, mi trovi. Buona giornata.' },
      ],
    },
    {
      id: 'busy',
      short: 'Busy',
      trigger: 'Sono occupato / in servizio',
      line:
        `Hai ragione, non ti rubo un secondo. Quando richiamo il titolare — o te? Meglio mattina prima delle 11 o dopo le 15? Lascia solo il nome: Alessandro di Menu Chat, recensioni Google${slots.nearby.name ? ` come ${slots.nearby.name}` : ''}.`,
    },
    {
      id: 'gate',
      short: 'Gate',
      trigger: 'Non sono io che decido',
      line:
        `Capito, non sei tu che decidi. Come si chiama chi gestisce queste cose? Meglio che lo richiami domani 10:30 o giovedì 16:00? Puoi dirgli che ha chiamato Alessandro di Menu Chat, per le recensioni Google${slots.nearby.name ? ` — stesso tipo di lavoro che facciamo con ${slots.nearby.name}` : ''}? C’è un cellulare o un altro modo per trovarlo più facilmente?`,
    },
  ];

  return objections;
}

function buildCardSummary(slots, hook) {
  return {
    name: slots.locale,
    keyword: slots.keyword,
    rank: slots.rank,
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
 * @returns {object} structured script
 */
export function buildColdCallScript(contact) {
  const card = asCard(contact);
  const slots = extractSlots(contact, card);
  const hook = buildHook(slots);
  const summary = buildCardSummary(slots, hook);
  const value = buildValueTemplate(slots);
  const trial = buildTrialSteps(slots);
  const objections = buildObjections(slots);

  // Stringhe “piene” senza coperti (placeholder leggibili) per fallback / note
  const fallbackVars = {
    potentialMonthly: '…',
    yearReviews: '…',
    twoWeekPotential: '…',
    nome: '…',
  };

  return {
    opening: buildOpening(slots),
    hook,
    discovery: buildDiscovery(slots),
    value: value.lines.map((l) => fillScriptTemplate(l, fallbackVars)).join(' '),
    valueBlock: value,
    trial: trial.steps.map((s) => s.line).join(' '),
    trialBlock: trial,
    busy: objections.find((o) => o.id === 'busy')?.line || '',
    gate: objections.find((o) => o.id === 'gate')?.line || '',
    objections: objections.filter((o) => o.id !== 'busy' && o.id !== 'gate'),
    cardSummary: summary,
    hasVisibilityCard: !!card,
    listHint: DEFAULT_LIST,
    projectionHints: {
      reviews: slots.reviews,
      rating: slots.rating,
      keyword: slots.keyword,
      nearbyName: slots.nearby.name,
    },
  };
}

function positionKind(slots) {
  const { keyword, rank, competitor } = slots;
  if (keyword && rank === 1) return 'rank1';
  if (keyword && rank != null && competitor) return 'trailing';
  if (keyword && rank != null) return 'ranked';
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
    return `Su Maps, per «${keyword}» risultate #1${suffix} — ottima posizione; spesso il gap è il volume di recensioni vere al mese.`;
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
