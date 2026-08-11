/**
 * Test: scheda visibilità Google per cold call (Vicini Clienti)
 *
 * Pipeline:
 *  1. Pick N contatti non chiamati dalla lista
 *  2. Claude → keyword di ricerca locale (settore)
 *  3. SerpAPI Maps → place + ranking keyword @ coords
 *  4. SerpAPI Reviews (newest, paginate) → review velocity
 *  5. Output schede markdown
 *
 * Uso:
 *   node scripts/test-visibility-card.js
 *   node scripts/test-visibility-card.js --n=3
 *
 * Note: Serper è senza crediti → usiamo SERPAPI_KEY (già in agentToolsService).
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { MongoClient } from 'mongodb';

const LIST = 'Cold Call - Vicini Clienti';
const OUT_DIR = 'analysis/coldcall-alessandro/visibility-cards-test';
const N = Number((process.argv.find(a => a.startsWith('--n=')) || '--n=3').split('=')[1]) || 3;

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SERPAPI_KEY) throw new Error('SERPAPI_KEY mancante');
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY mancante');

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function serp(params) {
  const { data } = await axios.get('https://serpapi.com/search.json', {
    params: { api_key: SERPAPI_KEY, hl: 'it', ...params },
    timeout: 45000,
  });
  return data;
}

async function pickKeyword({ name, category, city, address }) {
  const prompt = `Sei un esperto di local SEO ristorazione Italia.
Dato questo locale, scegli UNA sola keyword di ricerca Google Maps che un cliente tipico digiterebbe per trovarlo (settore + zona quando utile).

Locale: ${name}
Categoria Maps: ${category || 'n/d'}
Città: ${city || 'n/d'}
Indirizzo: ${address || 'n/d'}

Regole:
- italiano
- specifica del settore (es. "pizzeria Trastevere", "sushi Navigli", "ristorante di pesce Livorno")
- NON usare il nome del locale
- evita keyword troppo generiche tipo solo "ristorante" senza zona/settore
- se la categoria è chiara, usala; altrimenti inferisci dal nome

Rispondi SOLO JSON valido:
{"keyword":"...","rationale":"max 20 parole","alt_keywords":["...","..."]}`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content?.[0]?.text || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`Claude keyword parse fail: ${text}`);
  return JSON.parse(text.slice(start, end + 1));
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
  const ta = new Set(na.split(' ').filter(t => t.length > 2));
  const tb = nb.split(' ').filter(t => t.length > 2);
  const hit = tb.filter(t => ta.has(t)).length;
  return hit >= Math.min(2, tb.length);
}

async function resolvePlace(contact) {
  const placeId = contact.properties?.place_id;
  if (placeId) {
    const data = await serp({ engine: 'google_maps', type: 'place', place_id: placeId });
    if (data.place_results) {
      const p = data.place_results;
      return {
        source: 'place_id',
        name: p.title,
        placeId: p.place_id || placeId,
        dataId: p.data_id,
        address: p.address,
        rating: p.rating,
        reviews: p.reviews,
        type: Array.isArray(p.type) ? p.type.join(', ') : p.type,
        lat: p.gps_coordinates?.latitude,
        lng: p.gps_coordinates?.longitude,
        thumbnail: p.thumbnail,
      };
    }
  }
  const q = [contact.name, contact.properties?.city].filter(Boolean).join(' ');
  const data = await serp({ engine: 'google_maps', type: 'search', q });
  const hit = (data.local_results || []).find(r => nameMatch(r.title, contact.name)) || data.local_results?.[0] || data.place_results;
  if (!hit) return null;
  return {
    source: 'search',
    name: hit.title,
    placeId: hit.place_id,
    dataId: hit.data_id,
    address: hit.address,
    rating: hit.rating,
    reviews: hit.reviews,
    type: hit.type,
    lat: hit.gps_coordinates?.latitude,
    lng: hit.gps_coordinates?.longitude,
    thumbnail: hit.thumbnail,
    positionInNameSearch: hit.position,
  };
}

async function rankForKeyword(place, keyword) {
  if (!place?.lat || !place?.lng) return { error: 'missing coords' };
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
    const match = (place.placeId && r.place_id === place.placeId) || nameMatch(r.title, place.name);
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
    userRank: userRank ?? 'Fuori top risultati restituiti',
    resultsReturned: results.length,
    user: userRow ? { rating: userRow.rating, reviews: userRow.reviews, type: userRow.type } : null,
    competitorsAhead: ahead.slice(0, 5),
    top3: results.slice(0, 3).map(r => ({
      rank: r.position,
      name: r.title,
      rating: r.rating,
      reviews: r.reviews,
    })),
  };
}

function monthKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function reviewVelocity(place, { maxPages = 3 } = {}) {
  if (!place?.placeId && !place?.dataId) return { error: 'no place id' };
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
  // last 3 calendar months with data among fetched newest reviews
  const recent = monthsSorted.slice(-3);
  const recentCounts = recent.map(m => ({ month: m, reviews: byMonth[m] }));
  const avgRecent = recentCounts.length
    ? recentCounts.reduce((s, x) => s + x.reviews, 0) / recentCounts.length
    : null;

  const oldest = all[all.length - 1]?.iso_date;
  const newest = all[0]?.iso_date;

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
    oldestFetched: oldest,
    newestFetched: newest,
  };
}

function renderCard(card) {
  const { contact, keyword, place, ranking, velocity } = card;
  const comps = ranking?.competitorsAhead || [];
  const lines = [
    `# Scheda visibilità — ${contact.name}`,
    ``,
    `- contactId: \`${contact.id}\``,
    `- status CRM: ${contact.status}`,
    `- città: ${contact.city || 'n/d'}`,
    `- categoria import: ${contact.category || 'n/d'}`,
    `- cliente_vicino (import): ${contact.clienteVicino || 'n/d'} @ ${contact.distM ?? '?'}m`,
    ``,
    `## Keyword (Claude)`,
    `- **${keyword.keyword}**`,
    `- rationale: ${keyword.rationale || ''}`,
    `- alt: ${(keyword.alt_keywords || []).join(' · ') || '—'}`,
    ``,
    `## Profilo Google Maps`,
    `- nome Maps: ${place?.name || 'n/d'}`,
    `- place_id: ${place?.placeId || 'n/d'}`,
    `- address: ${place?.address || 'n/d'}`,
    `- type: ${place?.type || 'n/d'}`,
    `- **rating: ${place?.rating ?? 'n/d'}**`,
    `- **volume recensioni: ${place?.reviews ?? 'n/d'}**`,
    `- coords: ${place?.lat ?? '?'}, ${place?.lng ?? '?'}`,
    ``,
    `## Ranking per keyword`,
    `- keyword: **${ranking?.keyword || keyword.keyword}**`,
    `- posizione: **${ranking?.userRank ?? 'n/d'}** (su ${ranking?.resultsReturned ?? 0} risultati)`,
    ``,
    `### Competitor davanti`,
  ];
  if (!comps.length) {
    lines.push('- nessuno davanti nei risultati (o non trovato / #1)');
  } else {
    for (const c of comps) {
      lines.push(`- #${c.rank} **${c.name}** — ⭐ ${c.rating ?? '?'} · ${c.reviews ?? '?'} rec`);
    }
  }
  lines.push('', '### Top 3 assoluti sulla keyword');
  for (const c of ranking?.top3 || []) {
    lines.push(`- #${c.rank} ${c.name} — ⭐ ${c.rating ?? '?'} · ${c.reviews ?? '?'} rec`);
  }
  lines.push('', '## Review velocity');
  if (velocity?.error) {
    lines.push(`- errore: ${velocity.error}`);
  } else {
    lines.push(`- reviews fetched (newest): ${velocity.fetched}`);
    lines.push(`- media/mese (ultimi mesi nel campione): **${velocity.avgPerMonthRecent ?? 'n/d'}**`);
    for (const m of velocity.recentMonths || []) {
      lines.push(`  - ${m.month}: ${m.reviews}`);
    }
    lines.push(`- note: ${velocity.windowNote}`);
  }
  lines.push('', '## Hook cold call (bozza da scheda)');
  const rankTxt = ranking?.userRank;
  const c1 = comps[0];
  if (typeof rankTxt === 'number' && c1) {
    lines.push(
      `> Su Maps, chi cerca “${keyword.keyword}” vede prima **${c1.name}** (#${c1.rank}, ${c1.reviews} rec). Voi risultate #${rankTxt} con ${place?.reviews ?? '?'} recensioni (⭐ ${place?.rating ?? '?'}).`
    );
  } else if (c1) {
    lines.push(
      `> Su Maps per “${keyword.keyword}” i primi sono guidati da **${c1.name}** (${c1.reviews} rec). Voi con ${place?.reviews ?? '?'} recensioni siete fuori dai primi risultati locali.`
    );
  } else {
    lines.push(`> Avete ${place?.reviews ?? '?'} recensioni a ⭐ ${place?.rating ?? '?'}; velocity recente ~${velocity?.avgPerMonthRecent ?? '?'} rec/mese.`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  const cold = await db.collection('contacts').find({ lists: LIST, status: 'da contattare' })
    .project({ name: 1, status: 1, phone: 1, properties: 1, owner: 1 }).toArray();
  const called = new Set(
    (await db.collection('calls').distinct('contact', { contact: { $in: cold.map(c => c._id) } })).map(String)
  );
  const pool = cold.filter(c => !called.has(String(c._id)) && c.properties?.place_id && c.properties?.category);

  // diversifica per città/categoria
  const picked = [];
  const seenCity = new Set();
  const seenCat = new Set();
  for (const c of pool) {
    const city = c.properties.city || '';
    const cat = c.properties.category || '';
    if (seenCity.has(city) && seenCat.has(cat)) continue;
    picked.push(c);
    seenCity.add(city);
    seenCat.add(cat);
    if (picked.length >= N) break;
  }
  while (picked.length < N && pool.length) {
    const c = pool[picked.length];
    if (c && !picked.includes(c)) picked.push(c);
    else break;
  }

  console.log('Picked', picked.map(c => `${c.name} | ${c.properties.city} | ${c.properties.category}`));

  const cards = [];
  for (const c of picked) {
    console.log('\n===', c.name, '===');
    const base = {
      id: String(c._id),
      name: c.name,
      status: c.status,
      city: c.properties.city,
      category: c.properties.category,
      address: c.properties.address,
      clienteVicino: c.properties.cliente_vicino,
      distM: c.properties.dist_m,
      placeIdImport: c.properties.place_id,
      ratingImport: c.properties.rating,
      reviewsImport: c.properties.reviews_count,
    };

    const keyword = await pickKeyword(base);
    console.log('keyword:', keyword.keyword);

    const place = await resolvePlace(c);
    console.log('place:', place?.name, place?.rating, place?.reviews);

    const ranking = place ? await rankForKeyword(place, keyword.keyword) : { error: 'no place' };
    console.log('rank:', ranking.userRank, 'ahead:', ranking.competitorsAhead?.length);

    const velocity = place ? await reviewVelocity(place, { maxPages: 3 }) : { error: 'no place' };
    console.log('velocity avg/mo:', velocity.avgPerMonthRecent, 'fetched', velocity.fetched);

    const card = { contact: base, keyword, place, ranking, velocity, generatedAt: new Date().toISOString() };
    cards.push(card);

    const md = renderCard(card);
    const safe = String(c._id);
    fs.writeFileSync(path.join(OUT_DIR, `${safe}.md`), md);
    fs.writeFileSync(path.join(OUT_DIR, `${safe}.json`), JSON.stringify(card, null, 2));
  }

  const index = cards.map(c => ({
    contactId: c.contact.id,
    name: c.contact.name,
    city: c.contact.city,
    keyword: c.keyword.keyword,
    rank: c.ranking.userRank,
    rating: c.place?.rating,
    reviews: c.place?.reviews,
    velocityAvg: c.velocity?.avgPerMonthRecent,
    competitorsAhead: c.ranking?.competitorsAhead?.length,
  }));
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, 'README.md'),
    [
      '# Test schede visibilità cold call',
      '',
      `Generato: ${new Date().toISOString()}`,
      '',
      'Pipeline: Claude keyword → SerpAPI place/ranking → SerpAPI reviews velocity.',
      'Serper non usato (account senza crediti).',
      '',
      '| Contatto | Keyword | Rank | Rating | Rec | Velocità/mese | Ahead |',
      '|----------|---------|------|--------|-----|---------------|-------|',
      ...index.map(
        r =>
          `| ${r.name} | ${r.keyword} | ${r.rank} | ${r.rating ?? '?'} | ${r.reviews ?? '?'} | ${r.velocityAvg ?? '?'} | ${r.competitorsAhead ?? '?'} |`
      ),
      '',
    ].join('\n')
  );

  console.log('\nDone →', OUT_DIR);
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
