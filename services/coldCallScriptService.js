/**
 * Script cold call strutturato: template + slot dalla visibility card.
 * Nessuna chiamata AI — deterministico e pronto in dialer.
 * Ogni dato scheda noto condiziona opening / hook / discovery / value / obiezioni.
 */

const DEFAULT_LIST = 'Cold Call - Vicini Clienti';

/** True solo se la scheda ha un place risolto (non stub fallito). */
function isUsableCard(card) {
  if (!card || typeof card !== 'object') return false;
  const place = card.place;
  if (!place || place.error) return false;
  if (!place.placeId && !place.name) return false;
  if (card.ranking?.error === 'no place' || card.velocity?.error === 'no place') return false;
  return true;
}

function asCard(contact) {
  const props = contact.properties || {};
  const card = props.visibilityCard || null;
  return isUsableCard(card) ? card : null;
}

function asNumber(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatDist(distM) {
  const n = asNumber(distM);
  if (n == null) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(1)} km`;
  return `${Math.round(n)} metri`;
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

/**
 * Estrae una sola volta tutti gli slot usati da opening/hook/discovery/value/obiezioni.
 */
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

  const ahead = card?.ranking?.competitorsAhead;
  const competitor = Array.isArray(ahead) && ahead.length > 0 ? ahead[0] : null;

  const rating = asNumber(
    card?.place?.rating ?? card?.ranking?.user?.rating ?? props.rating
  );
  const reviews = asNumber(
    card?.place?.reviews ?? card?.ranking?.user?.reviews ?? props.reviews_count
  );
  const velocity = asNumber(card?.velocity?.avgPerMonthRecent);

  return {
    locale: card?.place?.name || contact.name,
    nearby: { name: nearbyName, distM },
    keyword,
    rank,
    competitor,
    rating,
    reviews,
    velocity,
    velocityRounded: roundVelocity(velocity),
    lowVelocity: isLowVelocity(velocity),
    address: card?.place?.address || props.address || null,
    city: card?.contact?.city || props.city || null,
    category: card?.contact?.category || props.category || null,
    placeId: card?.place?.placeId || props.place_id || null,
    generatedAt: props.visibilityCardGeneratedAt || card?.generatedAt || null,
  };
}

/** rank1 | trailing | ranked | none — una sola decisione di posizione Maps. */
function positionKind(slots) {
  const { keyword, rank, competitor } = slots;
  if (keyword && rank === 1) return 'rank1';
  if (keyword && rank != null && competitor) return 'trailing';
  if (keyword && rank != null) return 'ranked';
  return 'none';
}

function ratingReviewsSuffix(slots) {
  const { reviews, rating } = slots;
  return `${reviews != null ? ` con ${reviews} recensioni` : ''}${rating != null ? ` (⭐ ${rating})` : ''}`;
}

/** Una sola generatrice del pezzo Maps (usata da hook e da render markdown test). */
export function buildMapsHookLine(slots) {
  const { keyword, rank, competitor } = slots;
  const kind = positionKind(slots);
  const suffix = ratingReviewsSuffix(slots);

  if (kind === 'rank1') {
    return `Su Maps, per «${keyword}» risultate #1${suffix} — ottima posizione; spesso il gap è il volume di recensioni vere al mese.`;
  }
  if (kind === 'trailing') {
    return `Su Maps, chi cerca «${keyword}» vede prima ${competitor.name} (#${competitor.rank}${competitor.reviews ? `, ${competitor.reviews} rec` : ''}). Voi risultate #${rank}${suffix}.`;
  }
  if (kind === 'ranked') {
    return `Su Maps, per «${keyword}» risultate #${rank}${suffix}.`;
  }
  return null;
}

function buildOpening(slots) {
  const lines = [`Buongiorno, ${slots.locale}? Sono Alessandro di Menu Chat.`];

  if (slots.nearby.name) {
    const distLabel = formatDist(slots.nearby.distM);
    lines.push(
      `Lavoriamo con ${slots.nearby.name}${distLabel ? `, qui a ${distLabel}` : ' qui vicino'}, sulle recensioni Google vere.`
    );
  } else {
    lines.push(`Lavoriamo con locali della vostra zona sulle recensioni Google vere.`);
  }

  const leadBits = [];
  if (slots.reviews != null) leadBits.push(`circa ${slots.reviews} recensioni`);
  if (slots.rating != null) leadBits.push(`media ${slots.rating}`);
  if (slots.keyword && slots.rank != null) leadBits.push(`#${slots.rank} su «${slots.keyword}»`);
  if (leadBits.length) {
    lines.push(`Voi su Maps siete a ${leadBits.join(', ')}.`);
  }

  const velocityLine = formatVelocityPerMonth(slots.velocity);
  if (velocityLine) lines.push(velocityLine);

  lines.push(
    `Vi chiamo per lo stesso motivo — capire in trenta secondi se anche a voi può servire. Due domande al volo, va bene?`
  );
  return lines.join(' ');
}

function buildHook(slots) {
  const parts = [];

  if (slots.nearby.name) {
    const distLabel = formatDist(slots.nearby.distM);
    parts.push(
      `Perfetto. Vi chiamo perché siete vicini a ${slots.nearby.name}${distLabel ? ` (${distLabel})` : ''}, con cui lavoriamo sulle recensioni Google vere.`
    );
  } else {
    parts.push(`Perfetto. Lavoriamo con locali della vostra zona sulle recensioni Google vere.`);
  }

  if (slots.reviews != null || slots.rating != null) {
    parts.push(
      `Voi su Maps siete a circa ${slots.reviews != null ? `${slots.reviews} recensioni` : 'poche recensioni'}${slots.rating != null ? `, media ${slots.rating}` : ''}.`
    );
  }

  const velocityLine = formatVelocityPerMonth(slots.velocity);
  if (velocityLine) parts.push(velocityLine);

  const mapsHook = buildMapsHookLine(slots);
  if (mapsHook) parts.push(mapsHook);

  if (slots.lowVelocity) {
    parts.push(`Dai dati recenti sembra che le recensioni arrivino più «al naturale» — poche al mese.`);
  }

  parts.push(`State già facendo qualcosa di concreto per le recensioni, o lasciate al naturale?`);
  return parts.join(' ');
}

function buildDiscovery(slots) {
  const kind = positionKind(slots);
  const { velocityRounded, lowVelocity, competitor, keyword, rank, rating } = slots;

  const questions = [
    {
      id: 'q1',
      label: 'Recensioni oggi',
      mode: 'ask',
      line: lowVelocity
        ? 'Dai dati Maps sembra che le recensioni arrivino più al naturale — state facendo qualcosa per incentivarle?'
        : 'State già facendo qualcosa per le recensioni?',
      ...(lowVelocity ? { knownFact: 'velocity bassa — al naturale' } : {}),
    },
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
        },
  ];

  if (kind === 'trailing') {
    questions.push({
      id: 'q_competitor',
      label: 'Gap Maps',
      mode: 'confirm',
      line: `Su «${keyword}» Maps mostra prima ${competitor.name}${competitor.reviews != null ? ` (${competitor.reviews} rec)` : ''} e voi #${rank} — lo sapevate, o vi interessa chiudere quel gap?`,
      knownFact: `${competitor.name} #${competitor.rank ?? 1} · voi #${rank}`,
    });
  } else if (kind === 'rank1') {
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

function buildValue(slots) {
  const kind = positionKind(slots);
  const parts = [
    `In pratica facciamo una cosa sola: più recensioni vere su Google Maps.`,
    `Menù digitale / QR a tavola → WhatsApp → richiesta recensione al momento giusto.`,
    `Non compriamo recensioni: massimizziamo quelle dei clienti che avete già.`,
  ];

  if (kind === 'trailing') {
    parts.push(
      `L’obiettivo concreto su «${slots.keyword}» è avvicinarvi a ${slots.competitor.name} (oggi davanti a voi) con volume vero, non con trucchi.`
    );
  } else if (kind === 'rank1') {
    parts.push(
      `Siete già #1 su «${slots.keyword}»: il pezzo utile è tenere/accelerare il ritmo di recensioni vere, così non vi superano.`
    );
  }

  if (slots.lowVelocity && slots.velocityRounded != null) {
    parts.push(
      `Oggi il ritmo recente è ~${slots.velocityRounded}/mese: nei locali simili vediamo ordine di grandezza 50–100 recensioni vere al mese, in base alle scansioni.`
    );
  } else {
    parts.push(
      `Nei locali simili vediamo ordine di grandezza 50–100 recensioni vere al mese, in base alle scansioni.`
    );
  }

  return parts.join(' ');
}

function buildObjections(slots) {
  const kind = positionKind(slots);
  const { nearby, keyword, competitor, velocityRounded } = slots;

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

  if (kind === 'rank1') {
    objections.push({
      id: 'already_first',
      short: 'Siamo #1',
      trigger: 'Siamo già i primi / stiamo bene così',
      line: `Esatto, su «${keyword}» risultate #1 — bravi. Il rischio tipico è che il volume mensile resti basso e qualcuno vi passi. La prova serve solo ad accelerare le recensioni vere, non a “sistemare” il ranking.`,
    });
  }

  if (kind === 'trailing') {
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

  return objections;
}

function buildCardSummary(slots, hook) {
  return {
    name: slots.locale,
    keyword: slots.keyword,
    rank: slots.rank,
    rating: slots.rating,
    reviews: slots.reviews,
    velocityPerMonth: slots.velocity,
    competitorAhead: slots.competitor
      ? {
          name: slots.competitor.name,
          rank: slots.competitor.rank,
          rating: slots.competitor.rating,
          reviews: slots.competitor.reviews,
        }
      : null,
    nearbyClient: slots.nearby.name
      ? { name: slots.nearby.name, distM: slots.nearby.distM }
      : null,
    address: slots.address,
    city: slots.city,
    category: slots.category,
    placeId: slots.placeId,
    hook,
    generatedAt: slots.generatedAt,
  };
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
  const ancora = slots.nearby.name || 'il locale vicino con cui lavoriamo';

  return {
    opening: buildOpening(slots),
    hook,
    discovery: buildDiscovery(slots),
    value: buildValue(slots),
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
    objections: buildObjections(slots),
    cardSummary: summary,
    hasVisibilityCard: !!card,
    listHint: DEFAULT_LIST,
  };
}

/** Hook Maps monolinea da card grezza (CLI markdown test). */
export function mapsHookFromCard(card) {
  if (!card) return null;
  const slots = extractSlots({ name: card?.place?.name || card?.contact?.name || '', properties: {} }, card);
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
  mapsHookFromCard,
  buildMapsHookLine,
  COLD_CALL_DEFAULT_LIST,
};
