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
import { fileURLToPath } from 'url';
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

function guessNeighborhood(address = '', city = '') {
  const a = String(address || '');
  // pattern comuni IT: "Via X, N, CAP Città" — quartiere a volte nel nome locale, non in address
  // Heuristic: per Roma prova a leggere pezzi noti dal nome/address se presenti
  const known = [
    'Trastevere', 'San Lorenzo', 'Testaccio', 'Prati', 'Ostiense', 'Centocelle',
    'Pigneto', 'Monti', 'Esquilino', 'Flaminio', 'Parioli', 'Eur', 'Navigli',
    'Brera', 'Isola', 'Porta Venezia', 'San Salvario', 'Centro',
  ];
  const blob = `${a} ${city}`;
  return known.find(k => new RegExp(k, 'i').test(blob)) || null;
}

const TOURIST_CITIES = new Set([
  'roma', 'rome', 'milano', 'milan', 'firenze', 'florence', 'venezia', 'venice',
  'napoli', 'naples', 'torino', 'turin', 'bologna', 'verona', 'genova', 'genoa',
  'palermo', 'catania', 'pisa', 'siena', 'amalfi', 'capri', 'como', 'rimini',
  'livorno', 'la spezia', 'cinque terre',
]);

function isTouristCity(city = '') {
  const c = normalize(city);
  return TOURIST_CITIES.has(c) || [...TOURIST_CITIES].some(t => c.includes(t));
}

async function pickKeyword({ name, category, city, address }) {
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

async function rankForKeywordOnce(place, keyword) {
  if (!place?.lat || !place?.lng) return { error: 'missing coords', keyword, resultsReturned: 0 };
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
    userRank: userRank ?? (results.length ? 'Fuori top risultati restituiti' : 'Nessun risultato'),
    resultsReturned: results.length,
    user: userRow ? { rating: userRow.rating, reviews: userRow.reviews, type: userRow.type } : null,
    competitorsAhead: ahead.slice(0, 5),
    top3: results.slice(0, 3).map(r => ({
      rank: r.position,
      name: r.title,
      rating: r.rating,
      reviews: r.reviews,
    })),
    found: userRank != null,
  };
}

/** Prova keyword principale + alt finché c'è un rank trovabile o risultati utili. */
async function rankForKeyword(place, keywordObj) {
  const tried = [];
  const queue = [keywordObj.keyword, ...(keywordObj.alt_keywords || [])].filter(Boolean);
  let best = null;
  for (const kw of queue) {
    const r = await rankForKeywordOnce(place, kw);
    tried.push({ keyword: kw, resultsReturned: r.resultsReturned, userRank: r.userRank });
    if (!best) best = r;
    if (r.found) {
      best = { ...r, keywordTried: tried, selectedKeyword: kw };
      break;
    }
    // preferisci comunque la query con più risultati locali
    if ((r.resultsReturned || 0) > (best.resultsReturned || 0)) best = r;
  }
  return { ...best, keywordTried: tried, selectedKeyword: best.keyword };
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
    `- **${ranking?.selectedKeyword || keyword.keyword}**`,
    `- audience: ${keyword.audience || 'n/d'} · lang: ${keyword.keyword_lang || 'n/d'} · tourist_city: ${keyword.touristCity ? 'yes' : 'no'}`,
    `- rationale: ${keyword.rationale || ''}`,
    `- proposte: ${keyword.keyword}${(keyword.alt_keywords || []).length ? ' · ' + keyword.alt_keywords.join(' · ') : ''}`,
    `- usata per ranking: ${ranking?.selectedKeyword || keyword.keyword}`,
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
    `- keyword: **${ranking?.selectedKeyword || ranking?.keyword || keyword.keyword}**`,
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
  const kwHook = ranking?.selectedKeyword || keyword.keyword;
  lines.push('', '## Hook cold call (bozza da scheda)');
  const rankTxt = ranking?.userRank;
  const c1 = comps[0];
  if (typeof rankTxt === 'number' && c1) {
    lines.push(
      `> Su Maps, chi cerca “${kwHook}” vede prima **${c1.name}** (#${c1.rank}, ${c1.reviews} rec). Voi risultate #${rankTxt} con ${place?.reviews ?? '?'} recensioni (⭐ ${place?.rating ?? '?'}).`
    );
  } else if (c1) {
    lines.push(
      `> Su Maps per “${kwHook}” i primi sono guidati da **${c1.name}** (${c1.reviews} rec). Voi con ${place?.reviews ?? '?'} recensioni siete fuori dai primi risultati locali.`
    );
  } else {
    lines.push(`> Avete ${place?.reviews ?? '?'} recensioni a ⭐ ${place?.rating ?? '?'}; velocity recente ~${velocity?.avgPerMonthRecent ?? '?'} rec/mese.`);
  }
  lines.push('');
  return lines.join('\n');
}

export {
  pickKeyword,
  resolvePlace,
  rankForKeyword,
  reviewVelocity,
  serp,
};

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI || process.env.MONGO_URI);
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

    const ranking = place ? await rankForKeyword(place, keyword) : { error: 'no place' };
    console.log('keyword picked:', keyword.keyword, '| audience:', keyword.audience, '| alts:', keyword.alt_keywords);
    console.log('rank:', ranking.userRank, 'via', ranking.selectedKeyword, 'ahead:', ranking.competitorsAhead?.length);

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

if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
