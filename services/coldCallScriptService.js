/**
 * Script cold call strutturato: template + slot dalla visibility card.
 * Nessuna chiamata AI — deterministico e pronto in dialer.
 */

const DEFAULT_LIST = 'Cold Call - Vicini Clienti';

function asCard(contact) {
  const props = contact.properties || {};
  return props.visibilityCard || null;
}

function pickNearby(contact, card) {
  const props = contact.properties || {};
  const fromCard = card?.contact?.clienteVicino || card?.nearbyClient?.name;
  const name = fromCard || props.cliente_vicino || null;

  let distM = null;
  if (card?.contact?.distM != null) distM = Number(card.contact.distM);
  else if (card?.nearbyClient?.distM != null) distM = Number(card.nearbyClient.distM);
  else if (props.dist_m != null) distM = Number(props.dist_m);
  else if (props.dist_km != null) distM = Number(props.dist_km) * 1000;

  return { name, distM: distM != null && !Number.isNaN(distM) ? distM : null };
}

function pickKeyword(card) {
  return card?.ranking?.selectedKeyword || card?.ranking?.keyword || card?.keyword?.keyword || null;
}

function pickRank(card) {
  const r = card?.ranking?.userRank;
  return typeof r === 'number' ? r : null;
}

function pickCompetitor(card) {
  const ahead = card?.ranking?.competitorsAhead;
  if (!Array.isArray(ahead) || ahead.length === 0) return null;
  return ahead[0];
}

function formatDist(distM) {
  if (distM == null || Number.isNaN(Number(distM))) return null;
  const n = Number(distM);
  if (n >= 1000) return `${(n / 1000).toFixed(1)} km`;
  return `${Math.round(n)} metri`;
}

function buildMapsHook(contact, card) {
  const keyword = pickKeyword(card);
  const rank = pickRank(card);
  const competitor = pickCompetitor(card);
  const rating = card?.place?.rating ?? card?.ranking?.user?.rating;
  const reviews = card?.place?.reviews ?? card?.ranking?.user?.reviews;

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

  if (mapsHook) {
    parts.push(mapsHook);
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

  const leadBits = [];
  if (reviews != null) leadBits.push(`circa ${reviews} recensioni`);
  if (rating != null) leadBits.push(`media ${rating}`);
  if (keyword && rank != null) leadBits.push(`#${rank} su «${keyword}»`);
  if (leadBits.length) {
    lines.push(`Voi su Maps siete a ${leadBits.join(', ')}.`);
  }

  lines.push(
    `Vi chiamo per lo stesso motivo — capire in trenta secondi se anche a voi può servire. Due domande al volo, va bene?`
  );

  return lines.join(' ');
}

function buildDiscovery(contact, card) {
  const rating = card?.place?.rating ?? card?.ranking?.user?.rating ?? contact.properties?.rating;
  const questions = [
    {
      id: 'q1',
      label: 'Recensioni oggi',
      line: 'State già facendo qualcosa per le recensioni?',
    },
    {
      id: 'q2',
      label: 'Volume / stack',
      line: 'Quante ne entrano più o meno al mese, a occhio? (Se hanno già QR/agenzia: vi sta portando quante al mese?)',
    },
    {
      id: 'q3',
      label: 'Capacità',
      line: 'Più o meno quanti coperti fate a settimana in questo periodo?',
    },
    {
      id: 'name_role',
      label: 'Nome / ruolo',
      line: 'Scusa, stiamo parlando da un minuto: come ti chiami? … Sei titolare, socio, o gestisci tu queste cose?',
    },
  ];

  if (rating != null && Number(rating) < 4.3) {
    questions.push({
      id: 'rating_focus',
      label: 'Focus voto',
      line: `Vedo media ${rating} — vi interessa più alzare il voto, il volume, o entrambi?`,
    });
  }

  return questions;
}

function buildCardSummary(contact, card) {
  const nearby = pickNearby(contact, card);
  const competitor = pickCompetitor(card);
  return {
    name: card?.place?.name || contact.name,
    keyword: pickKeyword(card),
    rank: pickRank(card),
    rating: card?.place?.rating ?? card?.ranking?.user?.rating ?? contact.properties?.rating ?? null,
    reviews: card?.place?.reviews ?? card?.ranking?.user?.reviews ?? contact.properties?.reviews_count ?? null,
    velocityPerMonth: card?.velocity?.avgPerMonthRecent ?? null,
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
    value:
      `In pratica facciamo una cosa sola: più recensioni vere su Google Maps. ` +
      `Menù digitale / QR a tavola → WhatsApp → richiesta recensione al momento giusto. ` +
      `Non compriamo recensioni: massimizziamo quelle dei clienti che avete già. ` +
      `Nei locali simili vediamo ordine di grandezza 50–100 recensioni vere al mese, in base alle scansioni.`,
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
    objections: [
      {
        trigger: 'Abbiamo già il menù digitale / QR',
        line: 'Perfetto — allora non vi vendo il menù. Il pezzo che manca di solito è far arrivare recensioni vere in automatico da chi usa il QR. Vi mostro solo quello in prova.',
      },
      {
        trigger: 'Non mi interessa / non ora',
        line: 'Ok, non insisto. Se cambia qualcosa sulle recensioni Maps, mi trovate. Buona giornata.',
      },
      {
        trigger: 'Quanto costa?',
        line: 'Prima vediamo se vi serve: in prova il setup QR è 25€ + IVA, senza impegno sul piano annuale. Se funziona vi spiego i numeri dopo.',
      },
      {
        trigger: 'Mandami una mail / materiale',
        line: 'Certo — meglio WhatsApp, lo aprite subito. Mi date il numero giusto e vi scrivo io tra un minuto, poi ci risentiamo.',
      },
      {
        trigger: 'Non conosco il locale vicino',
        line: 'Ci sta, zona piena di locali. A prescindere dal nome: voi sulle recensioni Maps state già facendo qualcosa, o al naturale?',
      },
    ],
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
