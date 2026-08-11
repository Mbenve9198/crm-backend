/**
 * Script cold call strutturato: template + slot dalla visibility card.
 * Nessuna chiamata AI — deterministico e pronto in dialer.
 * Ogni dato scheda noto condiziona opening / hook / discovery / value / obiezioni.
 */

const DEFAULT_LIST = 'Cold Call - Vicini Clienti';

function asCard(contact) {
  const props = contact.properties || {};
  return props.visibilityCard || null;
}

function asNumber(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickNearby(contact, card) {
  const props = contact.properties || {};
  const fromCard = card?.contact?.clienteVicino || card?.nearbyClient?.name;
  const name = fromCard || props.cliente_vicino || null;

  let distM = null;
  if (card?.contact?.distM != null) distM = asNumber(card.contact.distM);
  else if (card?.nearbyClient?.distM != null) distM = asNumber(card.nearbyClient.distM);
  else if (props.dist_m != null) distM = asNumber(props.dist_m);
  else if (props.dist_km != null) {
    const km = asNumber(props.dist_km);
    distM = km != null ? km * 1000 : null;
  }

  return { name, distM };
}

function pickKeyword(card) {
  return card?.ranking?.selectedKeyword || card?.ranking?.keyword || card?.keyword?.keyword || null;
}

function pickRank(card) {
  const r = card?.ranking?.userRank;
  if (typeof r === 'number' && Number.isFinite(r)) return r;
  if (typeof r === 'string' && /^\d+$/.test(r.trim())) return Number(r.trim());
  return null;
}

function pickCompetitor(card) {
  const ahead = card?.ranking?.competitorsAhead;
  if (!Array.isArray(ahead) || ahead.length === 0) return null;
  return ahead[0];
}

function pickVelocity(card) {
  return asNumber(card?.velocity?.avgPerMonthRecent);
}

/** Arrotonda velocity per parlato: 1 decimale sotto 10, intero sopra. */
function roundVelocity(v) {
  if (v == null) return null;
  return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
}

function formatVelocityPerMonth(v) {
  const rounded = roundVelocity(v);
  if (rounded == null) return null;
  const unit = rounded === 1 ? 'recensione/mese' : 'recensioni/mese';
  return `Negli ultimi mesi risultano circa ${rounded} ${unit}.`;
}

function isLowVelocity(v) {
  return v != null && v < 1.5;
}

function formatDist(distM) {
  const n = asNumber(distM);
  if (n == null) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(1)} km`;
  return `${Math.round(n)} metri`;
}

function buildMapsHook(contact, card) {
  const keyword = pickKeyword(card);
  const rank = pickRank(card);
  const competitor = pickCompetitor(card);
  const rating = card?.place?.rating ?? card?.ranking?.user?.rating;
  const reviews = card?.place?.reviews ?? card?.ranking?.user?.reviews;

  if (keyword && rank === 1 && !competitor) {
    return `Su Maps, per «${keyword}» risultate #1${reviews != null ? ` con ${reviews} recensioni` : ''}${rating != null ? ` (⭐ ${rating})` : ''} — ottima posizione; spesso il gap è il volume di recensioni vere al mese.`;
  }

  if (keyword && rank != null && competitor) {
    return `Su Maps, chi cerca «${keyword}» vede prima ${competitor.name} (#${competitor.rank}${competitor.reviews ? `, ${competitor.reviews} rec` : ''}). Voi risultate #${rank}${reviews != null ? ` con ${reviews} recensioni` : ''}${rating != null ? ` (⭐ ${rating})` : ''}.`;
  }

  if (keyword && rank != null) {
    return `Su Maps, per «${keyword}» risultate #${rank}${reviews != null ? ` con ${reviews} recensioni` : ''}${rating != null ? ` (⭐ ${rating})` : ''}.`;
  }

  return null;
}

/**
 * Hook post-permesso: ancora vicino + numeri del lead + domanda discovery.
 */
function buildHook(contact, card) {
  const nearby = pickNearby(contact, card);
  const rating = card?.place?.rating ?? card?.ranking?.user?.rating ?? contact.properties?.rating;
  const reviews = card?.place?.reviews ?? card?.ranking?.user?.reviews ?? contact.properties?.reviews_count;
  const velocity = pickVelocity(card);
  const mapsHook = buildMapsHook(contact, card);

  const parts = [];

  if (nearby.name) {
    const distLabel = formatDist(nearby.distM);
    parts.push(
      `Perfetto. Vi chiamo perché siete vicini a ${nearby.name}${distLabel ? ` (${distLabel})` : ''}, con cui lavoriamo sulle recensioni Google vere.`
    );
  } else {
    parts.push(`Perfetto. Lavoriamo con locali della vostra zona sulle recensioni Google vere.`);
  }

  if (reviews != null || rating != null) {
    parts.push(
      `Voi su Maps siete a circa ${reviews != null ? `${reviews} recensioni` : 'poche recensioni'}${rating != null ? `, media ${rating}` : ''}.`
    );
  }

  const velocityLine = formatVelocityPerMonth(velocity);
  if (velocityLine) {
    parts.push(velocityLine);
  }

  if (mapsHook) {
    parts.push(mapsHook);
  }

  if (isLowVelocity(velocity)) {
    parts.push(`Dai dati recenti sembra che le recensioni arrivino più «al naturale» — poche al mese.`);
  }

  parts.push(`State già facendo qualcosa di concreto per le recensioni, o lasciate al naturale?`);
  return parts.join(' ');
}

/**
 * Apertura: vicino + numeri lead + motivo call + permesso.
 * (I numeri dell'ancora "in X mesi +Z" servono dati ancora non in CRM → usiamo lead + nome vicino.)
 */
function buildOpening(contact, card) {
  const locale = card?.place?.name || contact.name;
  const nearby = pickNearby(contact, card);
  const rating = card?.place?.rating ?? card?.ranking?.user?.rating ?? contact.properties?.rating;
  const reviews = card?.place?.reviews ?? card?.ranking?.user?.reviews ?? contact.properties?.reviews_count;
  const keyword = pickKeyword(card);
  const rank = pickRank(card);

  const lines = [`Buongiorno, ${locale}? Sono Alessandro di Menu Chat.`];

  if (nearby.name) {
    const distLabel = formatDist(nearby.distM);
    lines.push(
      `Lavoriamo con ${nearby.name}${distLabel ? `, qui a ${distLabel}` : ' qui vicino'}, sulle recensioni Google vere.`
    );
  } else {
    lines.push(`Lavoriamo con locali della vostra zona sulle recensioni Google vere.`);
  }

  const velocity = pickVelocity(card);
  const leadBits = [];
  if (reviews != null) leadBits.push(`circa ${reviews} recensioni`);
  if (rating != null) leadBits.push(`media ${rating}`);
  if (keyword && rank != null) leadBits.push(`#${rank} su «${keyword}»`);
  if (leadBits.length) {
    lines.push(`Voi su Maps siete a ${leadBits.join(', ')}.`);
  }

  const velocityLine = formatVelocityPerMonth(velocity);
  if (velocityLine) {
    lines.push(velocityLine);
  }

  lines.push(
    `Vi chiamo per lo stesso motivo — capire in trenta secondi se anche a voi può servire. Due domande al volo, va bene?`
  );

  return lines.join(' ');
}

function buildDiscovery(contact, card) {
  const rating = asNumber(card?.place?.rating ?? card?.ranking?.user?.rating ?? contact.properties?.rating);
  const velocity = pickVelocity(card);
  const velocityRounded = roundVelocity(velocity);
  const lowVelocity = isLowVelocity(velocity);
  const competitor = pickCompetitor(card);
  const keyword = pickKeyword(card);
  const rank = pickRank(card);

  const q1Line = lowVelocity
    ? 'Dai dati Maps sembra che le recensioni arrivino più al naturale — state facendo qualcosa per incentivarle?'
    : 'State già facendo qualcosa per le recensioni?';

  const q2 =
    velocityRounded != null
      ? {
          id: 'q2',
          label: 'Volume / stack',
          mode: 'confirm',
          line:
            velocityRounded === 1
              ? 'Dai dati Maps risulta circa 1 recensione al mese di recente — vi torna, o state facendo di più/meno?'
              : `Dai dati Maps risultano circa ${velocityRounded} recensioni al mese di recente — vi torna, o state facendo di più/meno?`,
          knownFact: `~${velocityRounded} rec/mese Maps`,
        }
      : {
          id: 'q2',
          label: 'Volume / stack',
          mode: 'ask',
          line: 'Quante ne entrano più o meno al mese, a occhio? (Se hanno già QR/agenzia: vi sta portando quante al mese?)',
        };

  const questions = [
    {
      id: 'q1',
      label: 'Recensioni oggi',
      mode: 'ask',
      line: q1Line,
      ...(lowVelocity ? { knownFact: 'velocity bassa — al naturale' } : {}),
    },
    q2,
  ];

  if (competitor?.name && keyword && rank != null && rank > 1) {
    questions.push({
      id: 'q_competitor',
      label: 'Gap Maps',
      mode: 'confirm',
      line: `Su «${keyword}» Maps mostra prima ${competitor.name}${competitor.reviews != null ? ` (${competitor.reviews} rec)` : ''} e voi #${rank} — lo sapevate, o vi interessa chiudere quel gap?`,
      knownFact: `${competitor.name} #${competitor.rank ?? 1} · voi #${rank}`,
    });
  } else if (rank === 1 && keyword) {
    questions.push({
      id: 'q_rank1',
      label: 'Difesa #1',
      mode: 'confirm',
      line: `Su «${keyword}» risultate #1 — ottimo. Vi interessa difendere/accelerare il volume di recensioni vere al mese?`,
      knownFact: `#1 su «${keyword}»`,
    });
  }

  questions.push(
    {
      id: 'q3',
      label: 'Capacità',
      mode: 'ask',
      line: 'Più o meno quanti coperti fate a settimana in questo periodo?',
    },
    {
      id: 'name_role',
      label: 'Nome / ruolo',
      mode: 'ask',
      line: 'Scusa, stiamo parlando da un minuto: come ti chiami? … Sei titolare, socio, o gestisci tu queste cose?',
    }
  );

  if (rating != null && rating < 4.3) {
    questions.push({
      id: 'rating_focus',
      label: 'Focus voto',
      mode: 'ask',
      line: `Vedo media ${rating} — vi interessa più alzare il voto, il volume, o entrambi?`,
      knownFact: `media ${rating}`,
    });
  }

  return questions;
}

function buildValue(contact, card) {
  const velocity = pickVelocity(card);
  const velocityRounded = roundVelocity(velocity);
  const competitor = pickCompetitor(card);
  const keyword = pickKeyword(card);
  const rank = pickRank(card);
  const lowVelocity = isLowVelocity(velocity);

  const parts = [
    `In pratica facciamo una cosa sola: più recensioni vere su Google Maps.`,
    `Menù digitale / QR a tavola → WhatsApp → richiesta recensione al momento giusto.`,
    `Non compriamo recensioni: massimizziamo quelle dei clienti che avete già.`,
  ];

  if (competitor?.name && rank != null && rank > 1 && keyword) {
    parts.push(
      `L’obiettivo concreto su «${keyword}» è avvicinarvi a ${competitor.name} (oggi davanti a voi) con volume vero, non con trucchi.`
    );
  } else if (rank === 1 && keyword) {
    parts.push(
      `Siete già #1 su «${keyword}»: il pezzo utile è tenere/accelerare il ritmo di recensioni vere, così non vi superano.`
    );
  }

  if (lowVelocity && velocityRounded != null) {
    parts.push(
      `Oggi il ritmo recente è ~${velocityRounded}/mese: nei locali simili vediamo ordine di grandezza 50–100 recensioni vere al mese, in base alle scansioni.`
    );
  } else {
    parts.push(
      `Nei locali simili vediamo ordine di grandezza 50–100 recensioni vere al mese, in base alle scansioni.`
    );
  }

  return parts.join(' ');
}

function buildObjections(contact, card) {
  const nearby = pickNearby(contact, card);
  const ancora = nearby.name || 'il locale vicino con cui lavoriamo';
  const competitor = pickCompetitor(card);
  const keyword = pickKeyword(card);
  const rank = pickRank(card);
  const velocityRounded = roundVelocity(pickVelocity(card));

  const objections = [
    {
      id: 'menu_qr',
      short: 'Menù / QR',
      trigger: 'Abbiamo già il menù digitale / QR',
      line: 'Perfetto — allora non vi vendo il menù. Il pezzo che manca di solito è far arrivare recensioni vere in automatico da chi usa il QR. Vi mostro solo quello in prova.',
    },
    {
      id: 'not_now',
      short: 'Non ora',
      trigger: 'Non mi interessa / non ora',
      line: 'Ok, non insisto. Se cambia qualcosa sulle recensioni Maps, mi trovate. Buona giornata.',
    },
    {
      id: 'price',
      short: 'Prezzo',
      trigger: 'Quanto costa?',
      line: 'Prima vediamo se vi serve: in prova il setup QR è 25€ + IVA, senza impegno sul piano annuale. Se funziona vi spiego i numeri dopo.',
    },
    {
      id: 'send_info',
      short: 'Mail / WA',
      trigger: 'Mandami una mail / materiale',
      line: 'Certo — meglio WhatsApp, lo aprite subito. Mi date il numero giusto e vi scrivo io tra un minuto, poi ci risentiamo.',
    },
    {
      id: 'unknown_nearby',
      short: 'Non conosco',
      trigger: 'Non conosco il locale vicino',
      line: nearby.name
        ? `Ci sta, zona piena di locali — ${nearby.name} è solo il riferimento. A prescindere dal nome: voi sulle recensioni Maps state già facendo qualcosa, o al naturale?`
        : 'Ci sta, zona piena di locali. A prescindere dal nome: voi sulle recensioni Maps state già facendo qualcosa, o al naturale?',
    },
  ];

  if (rank === 1 && keyword) {
    objections.push({
      id: 'already_first',
      short: 'Siamo #1',
      trigger: 'Siamo già i primi / stiamo bene così',
      line: `Esatto, su «${keyword}» risultate #1 — bravi. Il rischio tipico è che il volume mensile resti basso e qualcuno vi passi. La prova serve solo ad accelerare le recensioni vere, non a “sistemare” il ranking.`,
    });
  }

  if (competitor?.name && rank != null && rank > 1) {
    const compShort =
      competitor.name.replace(/^Ristorante\s+/i, '').trim().split(/\s+/).slice(0, 2).join(' ') ||
      'Competitor';
    objections.push({
      id: 'competitor_ok',
      short: compShort,
      trigger: `Conosco ${competitor.name} / non ci interessa il confronto`,
      line: `Non è una gara personale con ${competitor.name}: è cosa vede chi cerca «${keyword || 'in zona'}» su Maps. Se il volume vero sale, la posizione tende a seguirlo — partiamo dalla prova e guardiamo i numeri.`,
    });
  }

  if (velocityRounded != null) {
    objections.push({
      id: 'velocity_wrong',
      short: 'Numeri sbagliati',
      trigger: 'I vostri numeri sulle recensioni non tornano',
      line: `Ok, Maps a noi dà circa ${velocityRounded}/mese di recente — se da voi è diverso dimmi pure il ritmo vero e ragioniamo su quello. L’importante è se volete accelerare in modo automatico.`,
    });
  }

  // ancora usata solo come contesto (gate/busy la usano a parte)
  void ancora;
  return objections;
}

function buildCardSummary(contact, card) {
  const nearby = pickNearby(contact, card);
  const competitor = pickCompetitor(card);
  return {
    name: card?.place?.name || contact.name,
    keyword: pickKeyword(card),
    rank: pickRank(card),
    rating: asNumber(card?.place?.rating ?? card?.ranking?.user?.rating ?? contact.properties?.rating),
    reviews: asNumber(card?.place?.reviews ?? card?.ranking?.user?.reviews ?? contact.properties?.reviews_count),
    velocityPerMonth: pickVelocity(card),
    competitorAhead: competitor
      ? {
          name: competitor.name,
          rank: competitor.rank,
          rating: competitor.rating,
          reviews: competitor.reviews,
        }
      : null,
    nearbyClient: nearby.name
      ? { name: nearby.name, distM: nearby.distM }
      : null,
    address: card?.place?.address || contact.properties?.address || null,
    city: card?.contact?.city || contact.properties?.city || null,
    category: card?.contact?.category || contact.properties?.category || null,
    placeId: card?.place?.placeId || contact.properties?.place_id || null,
    hook: buildHook(contact, card),
    generatedAt: contact.properties?.visibilityCardGeneratedAt || card?.generatedAt || null,
  };
}

/**
 * @param {object} contact - mongoose contact (lean ok)
 * @returns {object} structured script
 */
export function buildColdCallScript(contact) {
  const card = asCard(contact);
  const nearby = pickNearby(contact, card);
  const summary = buildCardSummary(contact, card);
  const ancora = nearby.name || 'il locale vicino con cui lavoriamo';

  return {
    opening: buildOpening(contact, card),
    hook: summary.hook,
    discovery: buildDiscovery(contact, card),
    value: buildValue(contact, card),
    busy:
      `Hai ragione, non ti rubo un secondo. Quando richiamo il titolare — o te? Meglio mattina prima delle 11 o dopo le 15? ` +
      `Lascia solo il nome: Alessandro di Menu Chat, recensioni Google come ${ancora}.`,
    gate:
      `Capito, non sei tu che decidi. Come si chiama chi gestisce queste cose? ` +
      `Meglio che lo richiami domani 10:30 o giovedì 16:00? ` +
      `Puoi dirgli che ha chiamato Alessandro di Menu Chat, per le recensioni Google — stesso tipo di lavoro che facciamo con ${ancora}? ` +
      `C’è un cellulare o un altro modo per trovarlo più facilmente?`,
    trial:
      `Quello che vi consiglio è la prova di due settimane: montiamo i QR, guardiamo i numeri insieme. ` +
      `Per creare e spedirvi circa 50 QR c’è solo il setup 25€ + IVA. ` +
      `Ti mando ora su WhatsApp brochure + esempio. Partiamo da [data] — ti va?`,
    objections: buildObjections(contact, card),
    cardSummary: summary,
    hasVisibilityCard: !!card,
    listHint: DEFAULT_LIST,
  };
}

export function summarizeVisibilityCard(contact) {
  const card = asCard(contact);
  if (!card) {
    const nearby = pickNearby(contact, null);
    return {
      hasVisibilityCard: false,
      keyword: null,
      rank: null,
      nearbyClient: nearby.name ? nearby : null,
      hook: buildHook(contact, null),
    };
  }
  const summary = buildCardSummary(contact, card);
  return {
    hasVisibilityCard: true,
    keyword: summary.keyword,
    rank: summary.rank,
    rating: summary.rating,
    reviews: summary.reviews,
    velocityPerMonth: summary.velocityPerMonth,
    nearbyClient: summary.nearbyClient,
    competitorAhead: summary.competitorAhead,
    hook: summary.hook,
  };
}

export const COLD_CALL_DEFAULT_LIST = DEFAULT_LIST;

export default {
  buildColdCallScript,
  summarizeVisibilityCard,
  COLD_CALL_DEFAULT_LIST,
};
