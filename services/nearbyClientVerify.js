/**
 * Verifica che un lead cold-call sia davvero vicino a un cliente Menu Chat (ancora).
 * Usa coords won CRM se presenti, altrimenti risolve l'ancora via SerpAPI (cache in-process).
 */

import axios from 'axios';

const DEFAULT_MAX_DIST_M = 1000;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} mancante`);
  return v;
}

export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Haversine in metri. */
export function haversineM(lat1, lng1, lat2, lng2) {
  const a1 = Number(lat1);
  const o1 = Number(lng1);
  const a2 = Number(lat2);
  const o2 = Number(lng2);
  if (![a1, o1, a2, o2].every(Number.isFinite)) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const NAME_STOP = new Set([
  'ristorante', 'pizzeria', 'restaurant', 'pizza', 'bar', 'cafe', 'caffè', 'caffe',
  'trattoria', 'osteria', 'hostaria', 'hotel', 'steakhouse', 'pub', 'grill',
  'cucina', 'food', 'the', 'and', 'del', 'della', 'delle', 'dei', 'di', 'da', 'al',
  'la', 'il', 'lo', 'le', 'gli', 'con', 'per', 'san', 'santa',
]);

function significantTokens(name) {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t.length > 2 && !NAME_STOP.has(t));
}

function nameLooseMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // includes solo se il più corto ha abbastanza segnale (evita "bar" ⊆ qualsiasi)
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  const ta = significantTokens(a);
  const tb = new Set(significantTokens(b));
  if (ta.length === 0 || tb.size === 0) return false;
  const hit = ta.filter((t) => tb.has(t)).length;
  // almeno 2 token significativi in comune
  return hit >= 2;
}

async function serp(params) {
  const { data } = await axios.get('https://serpapi.com/search.json', {
    params: { api_key: requireEnv('SERPAPI_KEY'), hl: 'it', ...params },
    timeout: 45000,
  });
  return data;
}

/**
 * Indice ancore: nome cliente_vicino → { name, lat, lng, placeId, source }.
 * Preferisce coords da contatti CRM won/trial; fallback SerpAPI search.
 */
export async function buildAnchorIndex(Contact, { anchors, cityHintByAnchor = {} } = {}) {
  const index = new Map(); // normalizeName → coords

  const won = await Contact.find({
    status: { $in: ['won', 'free trial iniziato', 'qr code inviato'] },
  })
    .select('name status properties')
    .lean();

  for (const w of won) {
    const lat = w.properties?.latitude ?? w.properties?.lat;
    const lng = w.properties?.longitude ?? w.properties?.lng;
    if (lat == null || lng == null) continue;
    const entry = {
      name: w.name,
      lat: Number(lat),
      lng: Number(lng),
      placeId: w.properties?.place_id || null,
      source: 'crm_won',
    };
    index.set(normalizeName(w.name), entry);
  }

  const list = anchors || [];
  for (const rawName of list) {
    const key = normalizeName(rawName);
    if (!key || index.has(key)) continue;

    // fuzzy su won già in index
    let fuzzy = null;
    for (const [k, v] of index.entries()) {
      if (nameLooseMatch(k, key)) {
        fuzzy = v;
        break;
      }
    }
    if (fuzzy) {
      index.set(key, { ...fuzzy, source: `${fuzzy.source}+fuzzy` });
      continue;
    }

    const city = cityHintByAnchor[rawName] || '';
    const cleaned = String(rawName).replace(/[""]/g, '"').replace(/^["']|["']$/g, '');
    const q = [cleaned, city].filter(Boolean).join(' ');
    try {
      const data = await serp({ engine: 'google_maps', type: 'search', q });
      // SerpAPI spesso torna place_results (match unico) invece di local_results
      const results = [...(data.local_results || [])];
      if (data.place_results?.title) {
        results.unshift({
          title: data.place_results.title,
          place_id: data.place_results.place_id,
          gps_coordinates: data.place_results.gps_coordinates,
        });
      }
      // Mai primo risultato cieco: solo match nome (altrimenti Arizona / omonimi)
      let hit = results.find((r) => nameLooseMatch(r.title, rawName) || nameLooseMatch(r.title, cleaned)) || null;
      if (hit?.place_id && !hit.gps_coordinates) {
        const placeData = await serp({
          engine: 'google_maps',
          type: 'place',
          place_id: hit.place_id,
        });
        const p = placeData.place_results;
        if (p?.gps_coordinates) {
          hit = {
            ...hit,
            title: p.title || hit.title,
            gps_coordinates: p.gps_coordinates,
            place_id: p.place_id || hit.place_id,
          };
        }
      }
      if (!hit?.gps_coordinates) {
        index.set(key, {
          name: rawName,
          lat: null,
          lng: null,
          placeId: null,
          source: 'unresolved',
        });
        continue;
      }
      index.set(key, {
        name: hit.title || rawName,
        lat: hit.gps_coordinates.latitude,
        lng: hit.gps_coordinates.longitude,
        placeId: hit.place_id || null,
        source: 'serpapi',
      });
    } catch (err) {
      index.set(key, {
        name: rawName,
        lat: null,
        lng: null,
        placeId: null,
        source: `error:${err.message}`,
      });
    }
  }

  return index;
}

export function lookupAnchor(index, clienteVicino) {
  if (!clienteVicino || !index) return null;
  const key = normalizeName(clienteVicino);
  if (index.has(key)) return index.get(key);
  for (const [k, v] of index.entries()) {
    if (nameLooseMatch(k, key)) return v;
  }
  return null;
}

/**
 * @returns {{ ok: boolean, distM: number|null, reason: string, anchor: object|null }}
 */
export function verifyNearby({ leadLat, leadLng, anchor, maxDistM = DEFAULT_MAX_DIST_M, importDistM = null }) {
  if (importDistM != null && Number.isFinite(Number(importDistM)) && Number(importDistM) > maxDistM) {
    return {
      ok: false,
      distM: Number(importDistM),
      reason: 'import_dist_over_max',
      anchor: anchor || null,
    };
  }
  if (!anchor || anchor.lat == null || anchor.lng == null) {
    return { ok: false, distM: null, reason: 'anchor_unresolved', anchor: anchor || null };
  }
  if (leadLat == null || leadLng == null) {
    return { ok: false, distM: null, reason: 'lead_no_coords', anchor };
  }
  const distM = haversineM(leadLat, leadLng, anchor.lat, anchor.lng);
  if (distM == null) {
    return { ok: false, distM: null, reason: 'haversine_fail', anchor };
  }
  if (distM > maxDistM) {
    return { ok: false, distM: Math.round(distM), reason: 'verified_dist_over_max', anchor };
  }
  return { ok: true, distM: Math.round(distM), reason: 'ok', anchor };
}

export const NEARBY_DEFAULT_MAX_DIST_M = DEFAULT_MAX_DIST_M;

export default {
  normalizeName,
  haversineM,
  buildAnchorIndex,
  lookupAnchor,
  verifyNearby,
  NEARBY_DEFAULT_MAX_DIST_M,
};
