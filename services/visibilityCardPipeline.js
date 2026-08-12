/**
 * Pipeline scheda visibilità cold call (Claude keyword → Maps place/rank/velocity).
 * Provider: Serper (preferito) o SerpAPI. Usata da CLI/batch enrich — non dal dialer runtime.
 */

import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { isUsableVisibilityCard } from './visibilityCardUtils.js';
import { mapsSearch, mapsProviderName } from './mapsSearchProvider.js';

export { isUsableVisibilityCard };

const TOURIST_CITIES = new Set([
  'roma', 'rome', 'milano', 'milan', 'firenze', 'florence', 'venezia', 'venice',
  'napoli', 'naples', 'torino', 'turin', 'bologna', 'verona', 'genova', 'genoa',
  'palermo', 'catania', 'pisa', 'siena', 'amalfi', 'capri', 'como', 'rimini',
  'livorno', 'la spezia', 'cinque terre',
]);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} mancante`);
  return v;
}

async function serp(params) {
  return mapsSearch(params);
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(' ').filter((t) => t.length > 2));
  const tb = nb.split(' ').filter((t) => t.length > 2);
  // Serve almeno 2 token in comune (o tutti se ne ha ≥2); zero token → no match
  if (tb.length < 2 || ta.size === 0) return false;
  const hit = tb.filter((t) => ta.has(t)).length;
  return hit >= 2;
}

function guessNeighborhood(address = '', city = '') {
  const known = [
    'Trastevere', 'San Lorenzo', 'Testaccio', 'Prati', 'Ostiense', 'Centocelle',
    'Pigneto', 'Monti', 'Esquilino', 'Flaminio', 'Parioli', 'Eur', 'Navigli',
    'Brera', 'Isola', 'Porta Venezia', 'San Salvario', 'Centro',
  ];
  const blob = `${address || ''} ${city || ''}`;
  return known.find((k) => new RegExp(k, 'i').test(blob)) || null;
}

function isTouristCity(city = '') {
  const c = normalize(city);
  return TOURIST_CITIES.has(c) || [...TOURIST_CITIES].some((t) => c.includes(t));
}

export function contactBaseFromDoc(contact) {
  const props = contact.properties || {};
  return {
    id: String(contact._id),
    name: contact.name,
    status: contact.status,
    city: props.city,
    category: props.category,
    address: props.address,
    clienteVicino: props.cliente_vicino,
    distM: props.dist_m,
    placeIdImport: props.place_id,
    ratingImport: props.rating,
    reviewsImport: props.reviews_count,
  };
}

export async function pickKeyword({ name, category, city, address }) {
  const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  const neighborhood = guessNeighborhood(`${name} ${address}`, city);
  const tourist = isTouristCity(city);
  const prompt = `Devi scegliere query Google Maps REALI: cosa digita qualcuno col telefono quando ha fame e vuole un posto come questo.

Locale: ${name}
Categoria Google: ${category || 'n/d'}
Città: ${city || 'n/d'}
Quartiere (se noto): ${neighborhood || 'n/d'}
Indirizzo: ${address || 'n/d'}
Contesto domanda: ${tourist
    ? 'CITTÀ TURISTICA — mix di ITALIANI + TURISTI (spesso cercano in inglese). Devi coprire entrambi i pubblici.'
    : 'Città poco/medio turistica — priorità a come cercano gli ITALIANI; inglese solo se naturale (es. sushi, tacos, steakhouse).'}

Come cercano le persone (non etichette SEO/categorie Google):
- Italiani: "pizzeria San Lorenzo", "sushi Prati", "tacos Roma", "ristorante di carne Latina", "peruviano Livorno"
- Turisti (EN): "pizza Trastevere", "tacos Rome", "steakhouse Rome", "peruvian restaurant Livorno", "mexican food San Lorenzo"
- Male: "tex-mex", "bisteccheria Latina", "american restaurant", jargon da scheda Maps, categorie Google letterali

Regole:
- "keyword" = la query PRINCIPALE più utile per una cold call (quella con più intent locale reale)
- In città turistiche: se il traffico turistico conta, la keyword principale può essere EN; metti comunque IT nelle alt
- In città non turistiche: keyword principale in IT (parole EN ok solo se le usano anche gli italiani: sushi, tacos, steakhouse, burger)
- Grandi città: settore + QUARTIERE quando possibile; medie: settore + città
- Se categoria Tex-Mex/Messicano → "tacos" / "mexican" / "messicano", MAI "tex-mex"
- Carne/bisteccheria → "steakhouse" o "ristorante di carne", non "bisteccheria" se suona falso
- NON usare il nome del locale
- 2-5 parole max

Rispondi SOLO JSON:
{
  "keyword": "query principale",
  "keyword_lang": "it|en",
  "audience": "local|tourist|both",
  "rationale": "max 25 parole",
  "alt_keywords": ["alt IT o EN 1", "alt 2", "alt 3"]
}`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content?.[0]?.text || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`Claude keyword parse fail: ${text}`);
  const parsed = JSON.parse(text.slice(start, end + 1));
  parsed.neighborhood = neighborhood;
  parsed.touristCity = tourist;
  return parsed;
}

function placeFromRow(row, source, placeIdFallback = null) {
  if (!row) return null;
  return {
    source,
    name: row.title,
    placeId: row.place_id || placeIdFallback || null,
    dataId: row.data_id,
    address: row.address,
    rating: row.rating,
    reviews: row.reviews,
    type: Array.isArray(row.type) ? row.type.join(', ') : row.type,
    lat: row.gps_coordinates?.latitude,
    lng: row.gps_coordinates?.longitude,
    thumbnail: row.thumbnail,
    positionInNameSearch: row.position,
  };
}

/** Google Places Details (quando Serper non risolve place_id). */
async function resolvePlaceViaGoogle(placeId) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !placeId) return null;
  try {
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/place/details/json',
      {
        params: {
          place_id: placeId,
          fields: 'name,geometry,rating,user_ratings_total,formatted_address,types,photos',
          language: 'it',
          key,
        },
        timeout: 30000,
      }
    );
    if (data.status !== 'OK' || !data.result) return null;
    const r = data.result;
    const photo = r.photos?.[0]?.photo_reference;
    return {
      source: 'google_places',
      name: r.name,
      placeId,
      dataId: null,
      address: r.formatted_address || null,
      rating: r.rating ?? null,
      reviews: r.user_ratings_total ?? null,
      type: Array.isArray(r.types) ? r.types.slice(0, 3).join(', ') : null,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
      // non persistere URL photo con API key
      thumbnail: null,
    };
  } catch {
    return null;
  }
}

export async function resolvePlace(contact) {
  const placeId = contact.properties?.place_id;
  const address = contact.properties?.address;
  const q = [contact.name, address || contact.properties?.city].filter(Boolean).join(' ');

  // 1) Google Places Details per place_id (affidabile; Serper non ha lookup by id)
  if (placeId) {
    const fromGoogle = await resolvePlaceViaGoogle(placeId);
    if (fromGoogle?.lat != null && fromGoogle?.lng != null) return fromGoogle;
  }

  // 2) Maps search (Serper/SerpAPI): match place_id o nome
  if (placeId || q) {
    const data = await serp({
      engine: 'google_maps',
      type: placeId ? 'place' : 'search',
      place_id: placeId || undefined,
      q: q || placeId,
    });
    if (data.place_results) {
      return placeFromRow(data.place_results, 'place_id', placeId);
    }
    const hit =
      (data.local_results || []).find(
        (r) => (placeId && r.place_id === placeId) || nameMatch(r.title, contact.name)
      ) || null;
    if (hit) return placeFromRow(hit, placeId ? 'place_id+search' : 'search', placeId);
  }

  // 3) Ultimo tentativo: solo nome+città
  const q2 = [contact.name, contact.properties?.city].filter(Boolean).join(' ');
  if (q2 && q2 !== q) {
    const data = await serp({ engine: 'google_maps', type: 'search', q: q2 });
    const hit =
      (data.local_results || []).find((r) => nameMatch(r.title, contact.name)) || null;
    if (hit) return placeFromRow(hit, 'search', placeId);
  }
  return null;
}

function rowMatchesPlace(place, row) {
  // Se abbiamo placeId, match SOLO su place_id (nameMatch è troppo loose su zone tipo "San Lorenzo")
  if (place.placeId) return !!row.place_id && row.place_id === place.placeId;
  return nameMatch(row.title, place.name);
}

async function rankForKeywordOnce(place, keyword) {
  if (!keyword || !String(keyword).trim()) {
    return { error: 'empty keyword', keyword: keyword || '', resultsReturned: 0, found: false };
  }
  if (!place?.lat || !place?.lng) {
    return { error: 'missing coords', keyword, resultsReturned: 0, found: false };
  }
  const data = await serp({
    engine: 'google_maps',
    type: 'search',
    q: keyword,
    ll: `@${place.lat},${place.lng},14z`,
    num: 20,
  });
  const results = data.local_results || [];
  let userRank = null;
  let userRow = null;
  const ahead = [];
  for (const r of results) {
    const match = rowMatchesPlace(place, r);
    if (match && userRank == null) {
      userRank = r.position;
      userRow = r;
    } else if (userRank == null) {
      ahead.push({
        rank: r.position,
        name: r.title,
        rating: r.rating ?? null,
        reviews: r.reviews ?? null,
        type: r.type ?? null,
        placeId: r.place_id,
      });
    }
  }
  return {
    keyword,
    userRank: userRank ?? (results.length ? 'Fuori top risultati restituiti' : 'Nessun risultato'),
    resultsReturned: results.length,
    user: userRow ? { rating: userRow.rating, reviews: userRow.reviews, type: userRow.type } : null,
    competitorsAhead: ahead.slice(0, 5),
    top3: results.slice(0, 3).map((r) => ({
      rank: r.position,
      name: r.title,
      rating: r.rating,
      reviews: r.reviews,
    })),
    found: userRank != null,
  };
}

/** Prova keyword principale + alt finché c'è un rank trovabile o risultati utili. */
export async function rankForKeyword(place, keywordObj) {
  const tried = [];
  const queue = [keywordObj?.keyword, ...(keywordObj?.alt_keywords || [])]
    .map((k) => (typeof k === 'string' ? k.trim() : ''))
    .filter(Boolean);

  if (queue.length === 0) {
    return {
      error: 'empty keyword',
      keyword: null,
      selectedKeyword: null,
      userRank: null,
      resultsReturned: 0,
      competitorsAhead: [],
      top3: [],
      found: false,
      keywordTried: [],
    };
  }

  let best = null;
  for (const kw of queue) {
    const r = await rankForKeywordOnce(place, kw);
    tried.push({ keyword: kw, resultsReturned: r.resultsReturned, userRank: r.userRank });
    if (!best) best = r;
    if (r.found) {
      best = { ...r, keywordTried: tried, selectedKeyword: kw };
      break;
    }
    if ((r.resultsReturned || 0) > (best.resultsReturned || 0)) best = r;
  }
  return {
    ...best,
    keywordTried: tried,
    selectedKeyword: best?.selectedKeyword || best?.keyword || queue[0],
  };
}

function monthKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function reviewVelocity(place, { maxPages = 3 } = {}) {
  if (!place?.placeId && !place?.dataId) return { error: 'no place id' };
  // Serper non supporta google_maps_reviews: salta senza fallire l'enrich.
  if (mapsProviderName() === 'serper' || maxPages <= 0) {
    return {
      error: 'reviews_unsupported',
      provider: mapsProviderName(),
      avgPerMonthRecent: null,
      recentMonths: [],
      sampleSize: 0,
    };
  }
  const all = [];
  let nextPageToken = null;
  for (let page = 0; page < maxPages; page++) {
    const params = {
      engine: 'google_maps_reviews',
      hl: 'it',
      sort_by: 'newest',
    };
    if (place.placeId) params.place_id = place.placeId;
    if (nextPageToken) params.next_page_token = nextPageToken;
    const data = await serp(params);
    const batch = data.reviews || [];
    all.push(...batch);
    nextPageToken = data.serpapi_pagination?.next_page_token;
    if (!nextPageToken || batch.length === 0) break;
  }

  const byMonth = {};
  for (const r of all) {
    const mk = monthKey(r.iso_date || r.iso_date_of_last_edit);
    if (!mk) continue;
    byMonth[mk] = (byMonth[mk] || 0) + 1;
  }
  const monthsSorted = Object.keys(byMonth).sort();
  const recent = monthsSorted.slice(-3);
  const recentCounts = recent.map((m) => ({ month: m, reviews: byMonth[m] }));
  const avgRecent = recentCounts.length
    ? recentCounts.reduce((s, x) => s + x.reviews, 0) / recentCounts.length
    : null;

  return {
    fetched: all.length,
    pages: Math.min(maxPages, all.length ? maxPages : 0),
    placeInfo: null,
    byMonth,
    recentMonths: recentCounts,
    avgPerMonthRecent: avgRecent != null ? Number(avgRecent.toFixed(2)) : null,
    windowNote:
      all.length < 20
        ? 'Campione reviews limitato (pochi risultati newest): velocity indicativa, non censimento completo.'
        : 'Velocity stimata sulle recensioni newest scaricate (paginate).',
    oldestFetched: all[all.length - 1]?.iso_date,
    newestFetched: all[0]?.iso_date,
  };
}

/**
 * Genera la visibility card completa per un contact document.
 * keyword + place in parallelo, poi rank + velocity in parallelo.
 * @param {object} [opts.place] place già risolto (evita doppia SerpAPI dopo nearby-verify)
 * @throws se place non risolvibile — il batch non deve persistere stub.
 */
export async function buildVisibilityCard(contact, opts = {}) {
  const base = contactBaseFromDoc(contact);
  const placePromise = opts.place ? Promise.resolve(opts.place) : resolvePlace(contact);
  const [keyword, place] = await Promise.all([pickKeyword(base), placePromise]);
  if (!place) {
    const err = new Error(`place non risolto per ${base.name || base.id}`);
    err.code = 'NO_PLACE';
    throw err;
  }
  const [ranking, velocity] = await Promise.all([
    rankForKeyword(place, keyword),
    reviewVelocity(place, { maxPages: 3 }),
  ]);
  return {
    contact: base,
    keyword,
    place,
    ranking,
    velocity,
    generatedAt: new Date().toISOString(),
  };
}

export default {
  contactBaseFromDoc,
  pickKeyword,
  resolvePlace,
  rankForKeyword,
  reviewVelocity,
  buildVisibilityCard,
  isUsableVisibilityCard,
};
