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

function buildHook(contact, card) {
  const name = card?.place?.name || contact.name;
  const keyword = pickKeyword(card);
  const rank = pickRank(card);
  const competitor = pickCompetitor(card);
  const nearby = pickNearby(contact, card);
  const rating = card?.place?.rating ?? card?.ranking?.user?.rating;
  const reviews = card?.place?.reviews ?? card?.ranking?.user?.reviews;

  if (keyword && rank != null && competitor) {
    return `Su Maps, chi cerca «${keyword}» vede prima ${competitor.name} (#${competitor.rank}${competitor.reviews ? `, ${competitor.reviews} rec` : ''}). Voi risultate #${rank}${reviews ? ` con ${reviews} recensioni` : ''}${rating != null ? ` (⭐ ${rating})` : ''}.`;
  }

  if (keyword && rank != null) {
    return `Su Maps, per «${keyword}» risultate #${rank}${reviews ? ` con ${reviews} recensioni` : ''}${rating != null ? ` (⭐ ${rating})` : ''}.`;
  }

  if (nearby.name) {
    const distBit = nearby.distM != null ? ` (a circa ${Math.round(nearby.distM)} metri)` : '';
    return `Lavoriamo già con ${nearby.name}${distBit} nella vostra zona sulle recensioni Google.`;
  }

  return `Lavoriamo con locali della vostra zona sulle recensioni Google vere via menù digitale.`;
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
  const locale = card?.place?.name || contact.name;
  const summary = buildCardSummary(contact, card);

  return {
    opening:
      `Buongiorno, ${locale}? Sono Alessandro di Menu Chat. ` +
      `Vi chiamo da Google Maps perché lavoriamo con locali della vostra zona sulle recensioni Google. ` +
      `Due domande al volo, trenta secondi — va bene?`,
    hook: summary.hook,
    busy:
      `Capito, non vi rubo tempo. Quando posso richiamarvi cinque minuti — oggi pomeriggio o domani mattina?`,
    gate:
      `Ok, e il titolare / chi gestisce le recensioni c’è in fascia? Mi lascia nome e un orario, così richiamo io senza farvi perdere tempo.`,
    trial:
      `Se siete voi a decidere: vi lascio una prova gratuita del menù digitale con raccolta recensioni. Vi mando il link su WhatsApp e vi richiamo io tra un paio di giorni per vedere com’è andata — va bene?`,
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
        line: 'Prima vediamo se vi serve: in prova non pagate. Se funziona vi spiego i numeri dopo, senza impegno adesso.',
      },
      {
        trigger: 'Mandami una mail / materiale',
        line: 'Certo — meglio WhatsApp, lo aprite subito. Mi date il numero giusto e vi scrivo io tra un minuto, poi ci risentiamo.',
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
