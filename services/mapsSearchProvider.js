/**
 * Provider Maps unificato: Serper (preferito) o SerpAPI (fallback).
 * Espone una forma compatibile SerpAPI (local_results / place_results) così
 * visibilityCardPipeline e nearbyClientVerify restano invariati a valle.
 */

import axios from 'axios';

function hasSerper() {
  return !!(process.env.SERPER_API_KEY || process.env.SERPER_KEY);
}

function hasSerpApi() {
  return !!process.env.SERPAPI_KEY;
}

export function mapsProviderName() {
  if (hasSerper()) return 'serper';
  if (hasSerpApi()) return 'serpapi';
  return null;
}

export function requireMapsProvider() {
  const name = mapsProviderName();
  if (!name) {
    throw new Error('SERPER_API_KEY o SERPAPI_KEY mancante');
  }
  return name;
}

function serperKey() {
  return process.env.SERPER_API_KEY || process.env.SERPER_KEY;
}

function normalizePlace(p, idx = 0) {
  if (!p) return null;
  const lat = p.latitude ?? p.lat ?? p.gps_coordinates?.latitude;
  const lng = p.longitude ?? p.lng ?? p.gps_coordinates?.longitude;
  return {
    position: p.position ?? idx + 1,
    title: p.title || p.name,
    place_id: p.placeId || p.place_id || null,
    data_id: p.fid || p.data_id || null,
    address: p.address || null,
    rating: p.rating ?? null,
    reviews: p.ratingCount ?? p.reviews ?? null,
    type: p.type || p.category || (Array.isArray(p.types) ? p.types[0] : null) || null,
    gps_coordinates:
      lat != null && lng != null
        ? { latitude: Number(lat), longitude: Number(lng) }
        : undefined,
    thumbnail: p.thumbnailUrl || p.thumbnail || null,
    cid: p.cid || null,
  };
}

async function serperMaps({ q, ll, num = 20, hl = 'it', gl = 'it' }) {
  const { data } = await axios.post(
    'https://google.serper.dev/maps',
    {
      q,
      ll: ll || undefined,
      num: Math.min(Math.max(num || 10, 1), 20),
      hl,
      gl,
    },
    {
      headers: {
        'X-API-KEY': serperKey(),
        'Content-Type': 'application/json',
      },
      timeout: 45000,
    }
  );
  const places = (data.places || []).map((p, i) => normalizePlace(p, i)).filter(Boolean);
  return {
    local_results: places,
    place_results: places.length === 1 ? places[0] : undefined,
    provider: 'serper',
    credits: data.credits,
  };
}

/**
 * @param {object} params — stile SerpAPI: { engine, type, q, ll, num, place_id, ... }
 */
export async function mapsSearch(params = {}) {
  const provider = requireMapsProvider();
  const hl = params.hl || 'it';

  if (provider === 'serper') {
    const engine = params.engine || 'google_maps';
    if (engine === 'google_maps_reviews') {
      // Serper non espone reviews paginate: il caller gestisce il degrado.
      return {
        reviews: [],
        provider: 'serper',
        unsupported: 'google_maps_reviews',
      };
    }

    // type=place con place_id: Serper non ha endpoint dedicato → search per place_id come q
    // spesso vuoto; il caller resolvePlace preferisce nome+città.
    if (params.type === 'place' && params.place_id) {
      const data = await serperMaps({
        q: params.q || params.place_id,
        ll: params.ll,
        num: 10,
        hl,
      });
      const hit =
        (data.local_results || []).find((r) => r.place_id === params.place_id) ||
        null;
      if (hit) {
        return {
          place_results: {
            title: hit.title,
            place_id: hit.place_id,
            data_id: hit.data_id,
            address: hit.address,
            rating: hit.rating,
            reviews: hit.reviews,
            type: hit.type,
            gps_coordinates: hit.gps_coordinates,
            thumbnail: hit.thumbnail,
          },
          local_results: data.local_results,
          provider: 'serper',
        };
      }
      return { place_results: null, local_results: data.local_results || [], provider: 'serper' };
    }

    return serperMaps({
      q: params.q,
      ll: params.ll,
      num: params.num || 20,
      hl,
      gl: params.gl || 'it',
    });
  }

  // SerpAPI fallback
  const { data } = await axios.get('https://serpapi.com/search.json', {
    params: { api_key: process.env.SERPAPI_KEY, hl, ...params },
    timeout: 45000,
  });
  return { ...data, provider: 'serpapi' };
}

export default {
  mapsSearch,
  mapsProviderName,
  requireMapsProvider,
};
