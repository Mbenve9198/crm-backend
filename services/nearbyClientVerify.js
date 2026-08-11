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

function nameLooseMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = na.split(' ').filter((t) => t.length > 3);
  const tb = new Set(nb.split(' ').filter((t) => t.length > 3));
  if (ta.length === 0 || tb.size === 0) return false;
  const hit = ta.filter((t) => tb.has(t)).length;
  return hit >= Math.min(2, ta.length);
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
    const q = [rawName, city].filter(Boolean).join(' ');
    try {
      const data = await serp({ engine: 'google_maps', type: 'search', q });
      const results = data.local_results || [];
      const hit =
        results.find((r) => nameLooseMatch(r.title, rawName)) || results[0] || null;
      if (!hit?.gps_coordinates) {
        index.set(key, { name: rawName, lat: null, lng: null, placeId: null, source: 'unresolved' });
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
