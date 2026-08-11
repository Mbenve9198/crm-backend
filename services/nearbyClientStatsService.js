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

export function nameLooseMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 6 && longer.includes(shorter)) return true;
  const ta = significantTokens(a);
  const tb = new Set(significantTokens(b));
  if (ta.length === 0 || tb.size === 0) return false;
  const hit = ta.filter((t) => tb.has(t)).length;
  // 2 token = match forte; 1 token lungo (≥5) basta (es. «Tegolo»)
  if (hit >= 2) return true;
  if (hit === 1) {
    const shared = ta.find((t) => tb.has(t));
    return !!shared && shared.length >= 5;
  }
  return false;
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

/** Lookup approfondito per nome (senza filtro menu≥10). */
async function fetchLookup({ name, city, includeInactive = true, limit = 15 } = {}) {
  const base = backendUrl();
  const key = apiKey();
  if (!base || !key) {
    throw new Error('CRM_API_URL / CRM_API_KEY mancanti per stats clienti-ancora');
  }
  const { data } = await axios.get(`${base}/api/restaurants/lookup`, {
    params: {
      name,
      city: city || undefined,
      limit,
      includeInactive: includeInactive ? '1' : undefined,
    },
    headers: { 'x-api-key': key },
    timeout: 45000,
  });
  return data?.restaurants || [];
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
  const hits = (restaurants || []).filter((r) => nameLooseMatch(name, r.name));
  hits.sort((a, b) => {
    const ca = normalizeName(a.address?.city || '');
    const cb = normalizeName(b.address?.city || '');
    const want = normalizeName(city || '');
    const sa = want && ca && (ca.includes(want) || want.includes(ca)) ? 1 : 0;
    const sb = want && cb && (cb.includes(want) || want.includes(cb)) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const addrA = normalizeName(a.address?.formattedAddress || '');
    const addrB = normalizeName(b.address?.formattedAddress || '');
    const inNameA = want && normalizeName(a.name).includes(want) ? 1 : 0;
    const inNameB = want && normalizeName(b.name).includes(want) ? 1 : 0;
    if (inNameA !== inNameB) return inNameB - inNameA;
    const addrHitA = want && addrA.includes(want) ? 1 : 0;
    const addrHitB = want && addrB.includes(want) ? 1 : 0;
    if (addrHitA !== addrHitB) return addrHitB - addrHitA;
    return (b.reviewsGained || 0) - (a.reviewsGained || 0);
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
          // retry senza city
          if (city) {
            const deep2 = await fetchLookup({ name: q, city: null, includeInactive: true, limit: 20 });
            best = pickBestHit(name, city, deep2) || pickBestHit(q, city, deep2);
            if (best) break;
          }
        } catch (err) {
          console.warn(`lookup fail «${q}»:`, err.message || err);
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
