/**
 * CLI test: scheda visibilità Google per cold call (Vicini Clienti).
 * Pipeline in services/visibilityCardPipeline.js; hook da coldCallScriptService.
 *
 * Uso:
 *   node scripts/test-visibility-card.js
 *   node scripts/test-visibility-card.js --n=3
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import {
  buildVisibilityCard,
  contactBaseFromDoc,
} from '../services/visibilityCardPipeline.js';
import { mapsHookFromCard } from '../services/coldCallScriptService.js';

const LIST = 'Cold Call - Vicini Clienti';
const OUT_DIR = 'analysis/coldcall-alessandro/visibility-cards-test';
const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '--n=3').split('=')[1]) || 3;

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
  lines.push('', '## Hook cold call (da script service)');
  const hook = mapsHookFromCard(card);
  lines.push(hook ? `> ${hook}` : '> (nessun hook Maps — rank/keyword mancanti)');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  if (!process.env.SERPAPI_KEY) throw new Error('SERPAPI_KEY mancante');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY mancante');
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
    throw new Error('MONGODB_URI / MONGO_URI mancante');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI || process.env.MONGO_URI);
  await client.connect();
  const db = client.db();

  const cold = await db
    .collection('contacts')
    .find({ lists: LIST, status: 'da contattare' })
    .project({ name: 1, status: 1, phone: 1, properties: 1, owner: 1 })
    .toArray();
  const called = new Set(
    (
      await db.collection('calls').distinct('contact', {
        contact: { $in: cold.map((c) => c._id) },
      })
    ).map(String)
  );
  const pool = cold.filter(
    (c) => !called.has(String(c._id)) && c.properties?.place_id && c.properties?.category
  );

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

  console.log(
    'Picked',
    picked.map((c) => `${c.name} | ${c.properties.city} | ${c.properties.category}`)
  );

  const cards = [];
  for (const c of picked) {
    console.log('\n===', c.name, '===');
    // ensure base shape for logs even before pipeline
    console.log('base:', contactBaseFromDoc(c).id);

    const card = await buildVisibilityCard(c);
    cards.push(card);

    console.log('keyword:', card.keyword?.keyword);
    console.log('place:', card.place?.name, card.place?.rating, card.place?.reviews);
    console.log(
      'rank:',
      card.ranking?.userRank,
      'via',
      card.ranking?.selectedKeyword,
      'ahead:',
      card.ranking?.competitorsAhead?.length
    );
    console.log(
      'velocity avg/mo:',
      card.velocity?.avgPerMonthRecent,
      'fetched',
      card.velocity?.fetched
    );

    const safe = String(c._id);
    fs.writeFileSync(path.join(OUT_DIR, `${safe}.md`), renderCard(card));
    fs.writeFileSync(path.join(OUT_DIR, `${safe}.json`), JSON.stringify(card, null, 2));
  }

  const index = cards.map((c) => ({
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
      'Pipeline: services/visibilityCardPipeline.js (Claude keyword → SerpAPI place/ranking/velocity).',
      'Hook: coldCallScriptService.mapsHookFromCard.',
      '',
      '| Contatto | Keyword | Rank | Rating | Rec | Velocità/mese | Ahead |',
      '|----------|---------|------|--------|-----|---------------|-------|',
      ...index.map(
        (r) =>
          `| ${r.name} | ${r.keyword} | ${r.rank} | ${r.rating ?? '?'} | ${r.reviews ?? '?'} | ${r.velocityAvg ?? '?'} | ${r.competitorsAhead ?? '?'} |`
      ),
      '',
    ].join('\n')
  );

  console.log('\nDone →', OUT_DIR);
  await client.close();
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
