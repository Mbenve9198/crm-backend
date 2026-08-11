/**
 * Stats crescita recensioni dei clienti-ancora via API backend prodotto.
 * Usato per condizionare opening/hook cold call: "+X rec in Y mesi".
 *
 * Evita di leggere Mongo prodotto direttamente (DB separato): usa
 * GET /api/restaurants/similar + GET /api/restaurants/lookup (deep name search).
 */

import axios from 'axios';

const NAME_STOP = new Set([
  'ristorante', 'pizzeria', 'restaurant', 'pizza', 'bar', 'cafe', 'caffe',
  'trattoria', 'osteria', 'hostaria', 'hotel', 'steakhouse', 'pub', 'grill',
  'cucina', 'food', 'the', 'and', 'del', 'della', 'delle', 'dei', 'di', 'da', 'al',
  'la', 'il', 'lo', 'le', 'gli', 'con', 'per', 'san', 'santa',
]);

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(name) {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t.length > 2 && !NAME_STOP.has(t));
}

/** Token troppo generici per un match a 1 parola */
const WEAK_NAME_TOKENS = new Set([
  'giardino', 'porto', 'mare', 'garden', 'lounge', 'grill', 'taverna',
  'locale', 'cafe', 'house', 'food', 'kitchen', 'pizza', 'sushi', 'roma',
  'firenze', 'milano', 'napoli', 'torino', 'livorno', 'latina',
]);

export function nameLooseMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 8 && longer.includes(shorter)) {
    const st = significantTokens(shorter);
    if (st.length >= 2) return true;
    if (st.length === 1 && st[0].length >= 6 && !WEAK_NAME_TOKENS.has(st[0])) return true;
  }
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const tbSet = new Set(tb);
  const hit = ta.filter((t) => tbSet.has(t)).length;
  // ≥2 token significativi in comune
  if (hit >= 2) return true;
  // 1 token solo se distintivo e presente come unico segnale forte sul lato corto
  if (hit === 1) {
    const shared = ta.find((t) => tbSet.has(t));
    if (!shared || shared.length < 6 || WEAK_NAME_TOKENS.has(shared)) return false;
    const shorterToks = ta.length <= tb.length ? ta : tb;
    return shorterToks.length === 1 && shorterToks[0] === shared;
  }
  return false;
}

function cityCompatible(wantCity, restaurant) {
  const want = normalizeName(wantCity || '');
  if (!want) return true;
  const city = normalizeName(restaurant?.address?.city || restaurant?.city || '');
  const addr = normalizeName(restaurant?.address?.formattedAddress || '');
  const name = normalizeName(restaurant?.name || '');
  return (
    (city && (city.includes(want) || want.includes(city))) ||
    (addr && addr.includes(want)) ||
    (name && name.includes(want))
  );
}

/** Pulisce prefissi/virgolette tipici degli ancora import. */
export function cleanAnchorName(name) {
  return String(name || '')
    .replace(/[“”«»]/g, '"')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/^ristorante\s+/i, '')
    .replace(/^pizzeria\s+/i, '')
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function backendUrl() {
  return (process.env.CRM_API_URL || '').replace(/\/$/, '');
}

function apiKey() {
  return process.env.CRM_API_KEY || '';
}

async function fetchSimilar({ city, type, limit = 100 } = {}) {
  const base = backendUrl();
  const key = apiKey();
  if (!base || !key) {
    throw new Error('CRM_API_URL / CRM_API_KEY mancanti per stats clienti-ancora');
  }
  const { data } = await axios.get(`${base}/api/restaurants/similar`, {
    params: { city, type, limit },
    headers: { 'x-api-key': key },
    timeout: 45000,
  });
  return data?.restaurants || [];
}

/** Lookup approfondito per nome / placeId (senza filtro menu≥10). */
async function fetchLookup({
  name,
  city,
  placeId,
  includeInactive = true,
  limit = 15,
} = {}) {
  const base = backendUrl();
  const key = apiKey();
  if (!base || !key) {
    throw new Error('CRM_API_URL / CRM_API_KEY mancanti per stats clienti-ancora');
  }
  const { data } = await axios.get(`${base}/api/restaurants/lookup`, {
    params: {
      name: name || undefined,
      placeId: placeId || undefined,
      city: city || undefined,
      limit,
      includeInactive: includeInactive ? '1' : undefined,
    },
    headers: { 'x-api-key': key },
    timeout: 45000,
  });
  return data?.restaurants || [];
}

/** Risolve place Google dell’ancora (spesso in place_results, non local_results). */
async function resolveAnchorPlace(name, city) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;
  const cleaned = cleanAnchorName(name);
  const q = [cleaned || name, city].filter(Boolean).join(' ');
  try {
    const { data } = await axios.get('https://serpapi.com/search.json', {
      params: {
        api_key: key,
        engine: 'google_maps',
        type: 'search',
        q,
        hl: 'it',
      },
      timeout: 45000,
    });
    const place = data.place_results;
    if (place?.place_id || place?.title) {
      return {
        title: place.title || name,
        placeId: place.place_id || null,
        reviews: place.reviews ?? null,
        rating: place.rating ?? null,
        address: place.address || null,
      };
    }
    const hit = (data.local_results || []).find(
      (r) => nameLooseMatch(r.title, name) || nameLooseMatch(r.title, cleaned)
    );
    if (!hit) return null;
    return {
      title: hit.title,
      placeId: hit.place_id || null,
      reviews: hit.reviews ?? null,
      rating: hit.rating ?? null,
      address: hit.address || null,
    };
  } catch {
    return null;
  }
}

function toStats(restaurant) {
  if (!restaurant) return null;
  const initial =
    restaurant.initialReviewCount ?? restaurant.googleRating?.initialReviewCount ?? null;
  const current =
    restaurant.currentReviewCount ?? restaurant.googleRating?.reviewCount ?? null;
  const gained =
    restaurant.reviewsGained != null
      ? restaurant.reviewsGained
      : initial != null && current != null && initial > 0
        ? Math.max(0, current - initial)
        : null;
  const startedAt = restaurant.createdAt ? new Date(restaurant.createdAt).toISOString() : null;
  let monthsActive = restaurant.monthsActive ?? null;
  if (monthsActive == null && startedAt) {
    const days = Math.round((Date.now() - new Date(startedAt).getTime()) / 86400000);
    monthsActive = Math.max(1, Math.round(days / 30));
  }
  const avgPerMonth =
    restaurant.avgReviewsPerMonth ??
    (gained != null && monthsActive > 0 ? Math.round(gained / monthsActive) : null);

  return {
    restaurantId: restaurant._id || restaurant.id || null,
    name: restaurant.name,
    city:
      restaurant.address?.city ||
      restaurant.city ||
      null,
    address: restaurant.address?.formattedAddress || null,
    initialReviewCount: initial,
    currentReviewCount: current,
    reviewsGained: gained,
    monthsActive,
    avgReviewsPerMonth: avgPerMonth,
    rating: restaurant.googleRating?.rating ?? restaurant.rating ?? null,
    startedAt,
    syncedAt: new Date().toISOString(),
  };
}

function pickBestHit(name, city, restaurants) {
  let hits = (restaurants || []).filter((r) => nameLooseMatch(name, r.name));
  // Se abbiamo la città del lead, scarta match fuori zona (es. Giardino Firenze vs Taormina)
  if (city) {
    const local = hits.filter((r) => cityCompatible(city, r));
    if (local.length) hits = local;
    else return null;
  }
  hits.sort((a, b) => {
    const ta = significantTokens(name);
    const score = (r) => {
      const tr = new Set(significantTokens(r.name));
      const hit = ta.filter((t) => tr.has(t)).length;
      const exact = normalizeName(r.name) === normalizeName(name) ? 10 : 0;
      const cityBonus = cityCompatible(city, r) ? 3 : 0;
      return exact * 100 + hit * 10 + cityBonus + (r.reviewsGained || 0) / 10000;
    };
    return score(b) - score(a);
  });
  return hits[0] || null;
}

/**
 * Scarica un pool di clienti-ancora (per città) e fa match per nome.
 * Per i miss: lookup approfondito per nome (anche inactive / senza menu pieno).
 * @returns {Map<string, object>} normalizeName(anchor) → stats
 */
export async function fetchNearbyClientStatsMap(anchors) {
  const list = (anchors || []).filter(Boolean);
  const cityHints = {};
  for (const a of list) {
    if (typeof a === 'string') continue;
    if (a.name && a.city) cityHints[a.name] = a.city;
  }
  const names = list.map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean);

  const cities = [
    ...new Set([
      ...Object.values(cityHints).filter(Boolean),
      ...list.map((a) => (typeof a === 'object' ? a.city : null)).filter(Boolean),
    ]),
  ];

  const byId = new Map();
  try {
    for (const r of await fetchSimilar({ limit: 500 })) {
      byId.set(String(r._id), r);
    }
  } catch {
    /* ignore */
  }
  for (const city of cities) {
    try {
      for (const r of await fetchSimilar({ city, limit: 100 })) {
        byId.set(String(r._id), r);
      }
    } catch {
      /* ignore */
    }
  }

  const restaurants = [...byId.values()];
  const map = new Map();

  for (const name of names) {
    const city = cityHints[name];
    let best = pickBestHit(name, city, restaurants);

    if (!best) {
      const queries = [...new Set([name, cleanAnchorName(name)].filter(Boolean))];
      for (const q of queries) {
        try {
          const deep = await fetchLookup({ name: q, city, includeInactive: true, limit: 20 });
          best = pickBestHit(name, city, deep) || pickBestHit(q, city, deep);
          if (best) break;
          if (city) {
            const deep2 = await fetchLookup({
              name: q,
              city: null,
              includeInactive: true,
              limit: 20,
            });
            best = pickBestHit(name, city, deep2) || pickBestHit(q, city, deep2);
            if (best) break;
          }
        } catch (err) {
          console.warn(`lookup fail «${q}»:`, err.message || err);
        }
      }
    }

    // Ultimo tentativo: SerpAPI → placeId → lookup prodotto
    if (!best) {
      const place = await resolveAnchorPlace(name, city);
      if (place?.placeId) {
        try {
          const byPlace = await fetchLookup({
            placeId: place.placeId,
            includeInactive: true,
            limit: 5,
          });
          best = byPlace[0] || null;
          if (best) {
            console.log(
              `lookup via placeId «${name}» → ${best.name} (${place.placeId})`
            );
          } else {
            console.warn(
              `ancora «${name}» su Maps (${place.title}, ${place.reviews} rec) ma assente nel prodotto`
            );
          }
        } catch (err) {
          console.warn(`lookup placeId fail «${name}»:`, err.message || err);
        }
      }
    }

    if (best) {
      map.set(normalizeName(name), toStats(best));
    }
  }

  return map;
}

/** Riga parlato per opening/hook. */
export function formatNearbyClientProof(stats) {
  if (!stats?.name) return null;
  const gained = stats.reviewsGained;
  const months = stats.monthsActive;
  const initial = stats.initialReviewCount;
  const current = stats.currentReviewCount;
  if (gained == null || gained <= 0 || !months) return null;
  const monthsLabel = months === 1 ? '1 mese' : `${months} mesi`;
  if (initial != null && current != null) {
    return `Con ${stats.name} in ${monthsLabel} siamo passati da ${initial} a ${current} recensioni Google (+${gained}).`;
  }
  return `Con ${stats.name} in ${monthsLabel} abbiamo portato +${gained} recensioni Google vere.`;
}

export default {
  nameLooseMatch,
  cleanAnchorName,
  fetchNearbyClientStatsMap,
  formatNearbyClientProof,
};
