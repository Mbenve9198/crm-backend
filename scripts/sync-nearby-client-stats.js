#!/usr/bin/env node
/**
 * Sincronizza stats recensioni dei clienti-ancora sui lead Vicini.
 *
 * Per ogni `cliente_vicino` unico: match via GET /api/restaurants/similar,
 * salva su contact.properties.nearbyClientStats (+ visibilityCard.nearbyClientStats).
 *
 * Uso:
 *   node scripts/sync-nearby-client-stats.js
 *   node scripts/sync-nearby-client-stats.js --dry-run
 *   node scripts/sync-nearby-client-stats.js --only-verified
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  fetchNearbyClientStatsMap,
  formatNearbyClientProof,
} from '../services/nearbyClientStatsService.js';
import { normalizeName } from '../services/nearbyClientVerify.js';

dotenv.config();

const LIST = 'Cold Call - Vicini Clienti';
const OUT = 'analysis/coldcall-alessandro/nearby-client-stats.json';
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ONLY_VERIFIED = argv.includes('--only-verified');

async function main() {
  const mongo = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongo) throw new Error('MONGODB_URI mancante');
  if (!process.env.CRM_API_URL) throw new Error('CRM_API_URL mancante');
  if (!process.env.CRM_API_KEY) throw new Error('CRM_API_KEY mancante');

  await mongoose.connect(mongo);
  const Contact = (await import('../models/contactModel.js')).default;

  const match = {
    lists: LIST,
    'properties.cliente_vicino': { $exists: true, $nin: [null, ''] },
  };
  if (ONLY_VERIFIED) match['properties.nearbyVerified'] = true;

  const grouped = await Contact.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$properties.cliente_vicino',
        cities: { $push: '$properties.city' },
        n: { $sum: 1 },
        ids: { $push: '$_id' },
      },
    },
    { $sort: { n: -1 } },
  ]);

  function majorityCity(cities) {
    const counts = new Map();
    for (const c of cities || []) {
      const t = typeof c === 'string' ? c.trim() : '';
      if (!t) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    let best = null;
    let bestN = 0;
    for (const [c, n] of counts) {
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    return best;
  }

  const anchors = grouped.map((g) => ({
    name: g._id,
    city: majorityCity(g.cities),
  }));

  console.log(`Ancore uniche: ${anchors.length} (dry-run=${DRY_RUN}, only-verified=${ONLY_VERIFIED})`);
  const statsMap = await fetchNearbyClientStatsMap(anchors);

  const report = [];
  let matched = 0;
  let updatedContacts = 0;

  for (const g of grouped) {
    const stats = statsMap.get(normalizeName(g._id)) || null;
    const proof = formatNearbyClientProof(stats);
    report.push({
      anchor: g._id,
      leads: g.n,
      matched: !!stats,
      restaurant: stats,
      proof,
    });

    if (!stats) {
      console.log(`✗ ${g._id} (${g.n} lead) — no match`);
      continue;
    }
    matched += 1;
    console.log(
      `✓ ${g._id} → ${stats.name} +${stats.reviewsGained} in ${stats.monthsActive}m (${stats.initialReviewCount}→${stats.currentReviewCount}) start ${String(stats.startedAt).slice(0, 10)}`
    );

    if (DRY_RUN) continue;

    const res = await Contact.updateMany(
      { _id: { $in: g.ids } },
      {
        $set: {
          'properties.nearbyClientStats': stats,
          'properties.nearbyClientStatsSyncedAt': stats.syncedAt,
          'properties.visibilityCard.nearbyClientStats': stats,
        },
      }
    );
    updatedContacts += res.modifiedCount || 0;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    `\nMatch ${matched}/${grouped.length} ancore; contatti aggiornati=${updatedContacts}; report → ${OUT}`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
