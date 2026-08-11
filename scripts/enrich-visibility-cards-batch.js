#!/usr/bin/env node
/**
 * Genera visibilityCard su contatti cold call (batch).
 *
 * Uso:
 *   node scripts/enrich-visibility-cards-batch.js
 *   node scripts/enrich-visibility-cards-batch.js --n=10
 *   node scripts/enrich-visibility-cards-batch.js --dry-run
 *   node scripts/enrich-visibility-cards-batch.js --force --n=5
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { buildVisibilityCard } from '../services/visibilityCardPipeline.js';

dotenv.config();

const LIST = 'Cold Call - Vicini Clienti';
const DEFAULT_N = 10;
const SLEEP_MS = 2500;

const argv = process.argv.slice(2);
const nArg = argv.find((a) => a.startsWith('--n='));
const N = nArg ? Number(nArg.split('=')[1]) : DEFAULT_N;
const DRY_RUN = argv.includes('--dry-run');
const FORCE = argv.includes('--force');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const mongo = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongo) throw new Error('MONGODB_URI / MONGO_URI mancante');
  if (!process.env.SERPAPI_KEY) throw new Error('SERPAPI_KEY mancante');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY mancante');

  await mongoose.connect(mongo);
  const Contact = (await import('../models/contactModel.js')).default;

  const query = {
    lists: LIST,
    status: 'da contattare',
    phone: { $regex: '^\\+' },
    'properties.place_id': { $exists: true, $nin: [null, ''] },
  };

  if (!FORCE) {
    // Riprova anche stub senza place (arricchimenti falliti salvati per errore in passato)
    query.$or = [
      { 'properties.visibilityCard': { $exists: false } },
      { 'properties.visibilityCard': null },
      { 'properties.visibilityCard.place': { $exists: false } },
      { 'properties.visibilityCard.place': null },
      { 'properties.visibilityCard.ranking.error': 'no place' },
    ];
  }

  const contacts = await Contact.find(query)
    .select('name status phone properties')
    .sort({ updatedAt: -1 })
    .limit(N)
    .lean();

  console.log(
    `Trovati ${contacts.length} contatti (n=${N}, dry-run=${DRY_RUN}, force=${FORCE})`
  );

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    const label = `${i + 1}/${contacts.length} ${c.name} (${c._id})`;
    console.log(`\n=== ${label} ===`);

    try {
      const card = await buildVisibilityCard(c);
      console.log(
        `keyword: ${card.ranking?.selectedKeyword || card.keyword?.keyword} | rank: ${card.ranking?.userRank} | velocity: ${card.velocity?.avgPerMonthRecent ?? 'n/d'}`
      );

      if (DRY_RUN) {
        console.log('[dry-run] skip save');
        ok += 1;
      } else {
        await Contact.updateOne(
          { _id: c._id },
          {
            $set: {
              'properties.visibilityCard': card,
              'properties.visibilityCardGeneratedAt': card.generatedAt,
            },
          }
        );
        console.log('saved');
        ok += 1;
      }
    } catch (err) {
      fail += 1;
      console.error(`ERR ${c.name}:`, err.message || err);
    }

    if (i < contacts.length - 1) {
      await sleep(SLEEP_MS);
    }
  }

  console.log(`\nFatto: ok=${ok} fail=${fail} (dry-run=${DRY_RUN})`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
