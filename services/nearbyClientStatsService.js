/**
 * Stats crescita recensioni dei clienti-ancora via API backend prodotto.
 * Usato per condizionare opening/hook cold call: "+X rec in Y mesi".
 *
 * Evita di leggere Mongo prodotto direttamente (DB separato): usa
 * GET /api/restaurants/similar con CRM_API_KEY.
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
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  const ta = significantTokens(a);
  const tb = new Set(significantTokens(b));
  if (ta.length === 0 || tb.size === 0) return false;
  return ta.filter((t) => tb.has(t)).length >= 2;
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

/**
 * Scarica un pool di clienti cliente ancora (per città ancora) e fa match per nome.
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
  // pool globale
  try {
    for (const r of await fetchSimilar({ limit: 200 })) {
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
    const hits = restaurants.filter((r) => nameLooseMatch(name, r.name));
    hits.sort((a, b) => {
      const ca = normalizeName(a.address?.city || '');
      const cb = normalizeName(b.address?.city || '');
      const want = normalizeName(city || '');
      const sa = want && ca && (ca.includes(want) || want.includes(ca)) ? 1 : 0;
      const sb = want && cb && (cb.includes(want) || want.includes(cb)) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return (b.reviewsGained || 0) - (a.reviewsGained || 0);
    });
    const best = hits[0];
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
  fetchNearbyClientStatsMap,
  formatNearbyClientProof,
};
