#!/usr/bin/env node
/**
 * Genera visibilityCard solo su lead DAVVERO vicini a clienti Menu Chat.
 *
 * Filtri:
 *   - lista Cold Call - Vicini Clienti
 *   - cliente_vicino presente
 *   - dist_m import ≤ --max-dist-m (default 1000)
 *   - re-geo haversine lead.place ↔ ancora Menu Chat ≤ max-dist-m
 *
 * Uso:
 *   node scripts/enrich-visibility-cards-batch.js --n=50
 *   node scripts/enrich-visibility-cards-batch.js --n=20 --dry-run
 *   node scripts/enrich-visibility-cards-batch.js --verify-only --n=100
 *   node scripts/enrich-visibility-cards-batch.js --max-dist-m=1500 --force --n=30
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  buildVisibilityCard,
  resolvePlace,
} from '../services/visibilityCardPipeline.js';
import {
  buildAnchorIndex,
  lookupAnchor,
  verifyNearby,
  NEARBY_DEFAULT_MAX_DIST_M,
} from '../services/nearbyClientVerify.js';

dotenv.config();

const LIST = 'Cold Call - Vicini Clienti';
const DEFAULT_N = 50;
const DEFAULT_STATUSES = ['da contattare', 'da richiamare'];
// Serper: override con ENRICH_SLEEP_MS
const SLEEP_MS = Number(process.env.ENRICH_SLEEP_MS) || 2000;

const argv = process.argv.slice(2);
const nArg = argv.find((a) => a.startsWith('--n='));
const distArg = argv.find((a) => a.startsWith('--max-dist-m='));
const statusArg = argv.find((a) => a.startsWith('--status='));
const ALL = argv.includes('--all');
const N = ALL ? null : nArg ? Number(nArg.split('=')[1]) : DEFAULT_N;
const MAX_DIST_M = distArg ? Number(distArg.split('=')[1]) : NEARBY_DEFAULT_MAX_DIST_M;
const DRY_RUN = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const VERIFY_ONLY = argv.includes('--verify-only');
const STATUSES = statusArg
  ? statusArg
      .split('=')[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : DEFAULT_STATUSES;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function importDistM(props = {}) {
  if (props.dist_m != null && props.dist_m !== '') {
    const n = Number(props.dist_m);
    return Number.isFinite(n) ? n : null;
  }
  if (props.dist_km != null && props.dist_km !== '') {
    const n = Number(props.dist_km);
    return Number.isFinite(n) ? n * 1000 : null;
  }
  return null;
}

async function main() {
  const mongo = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongo) throw new Error('MONGODB_URI / MONGO_URI mancante');
  if (!process.env.SERPER_API_KEY && !process.env.SERPER_KEY && !process.env.SERPAPI_KEY) {
    throw new Error('SERPER_API_KEY (o SERPAPI_KEY) mancante');
  }
  if (!VERIFY_ONLY && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY mancante');
  }

  await mongoose.connect(mongo);
  const Contact = (await import('../models/contactModel.js')).default;

  const query = {
    lists: LIST,
    status: { $in: STATUSES },
    phone: { $regex: '^\\+' },
    'properties.place_id': { $exists: true, $nin: [null, ''] },
    'properties.cliente_vicino': { $exists: true, $nin: [null, ''] },
    $expr: {
      $lte: [
        {
          $convert: {
            input: '$properties.dist_m',
            to: 'double',
            onError: 1e12,
            onNull: 1e12,
          },
        },
        MAX_DIST_M,
      ],
    },
  };

  if (!FORCE) {
    query['properties.nearbyVerified'] = { $ne: false };
    if (!VERIFY_ONLY) {
      query.$or = [
        { 'properties.visibilityCard': { $exists: false } },
        { 'properties.visibilityCard': null },
        { 'properties.visibilityCard.place': { $exists: false } },
        { 'properties.visibilityCard.place': null },
        { 'properties.visibilityCard.place.name': { $exists: false } },
        { 'properties.visibilityCard.place.name': null },
        { 'properties.visibilityCard.place.name': '' },
        { 'properties.visibilityCard.ranking.error': 'no place' },
      ];
    } else {
      query.$or = [
        { 'properties.nearbyVerified': { $exists: false } },
        { 'properties.nearbyVerified': null },
      ];
    }
  }

  const totalNeed = await Contact.countDocuments(query);
  const targetN = ALL ? totalNeed : N;
  if (!targetN || targetN < 1) {
    console.log(`Nessun contatto da processare (match=${totalNeed}).`);
    await mongoose.disconnect();
    return;
  }

  const pool = await Contact.find(query)
    .select('name status phone properties')
    .sort({ 'properties.dist_m': 1, updatedAt: -1 })
    .limit(ALL ? targetN : Math.max(targetN * 3, targetN))
    .lean();

  const cityHintByAnchor = {};
  for (const c of pool) {
    const a = c.properties?.cliente_vicino;
    if (a && !cityHintByAnchor[a] && c.properties?.city) {
      cityHintByAnchor[a] = c.properties.city;
    }
  }
  const uniqueAnchors = [...new Set(pool.map((c) => c.properties?.cliente_vicino).filter(Boolean))];

  console.log(
    `Pool ${pool.length}/${totalNeed} (n=${targetN}${ALL ? ' --all' : ''}, provider=${process.env.SERPER_API_KEY || process.env.SERPER_KEY ? 'serper' : 'serpapi'}, statuses=${STATUSES.join(',')}, maxDist=${MAX_DIST_M}m, dry-run=${DRY_RUN}, force=${FORCE}, verify-only=${VERIFY_ONLY})`
  );
  console.log(`Ancore uniche da risolvere: ${uniqueAnchors.length}`);

  const anchorIndex = await buildAnchorIndex(Contact, {
    anchors: uniqueAnchors,
    cityHintByAnchor,
  });
  for (const a of uniqueAnchors) {
    const hit = lookupAnchor(anchorIndex, a);
    console.log(
      `  ancora «${a}» → ${hit?.source || '?'} ${hit?.lat != null ? `@ ${hit.lat.toFixed(4)},${hit.lng.toFixed(4)}` : '(unresolved)'}`
    );
  }

  const contacts = pool.slice(0, targetN);
  let ok = 0;
  let skippedNearby = 0;
  let fail = 0;

  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    const props = c.properties || {};
    const label = `${i + 1}/${contacts.length} ${c.name} (${c._id})`;
    console.log(`\n=== ${label} ===`);
    console.log(
      `import: vicino=${props.cliente_vicino} dist_m=${props.dist_m} city=${props.city || '?'}`
    );

    try {
      const place = await resolvePlace(c);
      if (!place?.lat || !place?.lng) {
        throw Object.assign(new Error('place senza coords'), { code: 'NO_PLACE' });
      }

      const anchor = lookupAnchor(anchorIndex, props.cliente_vicino);
      const verdict = verifyNearby({
        leadLat: place.lat,
        leadLng: place.lng,
        anchor,
        maxDistM: MAX_DIST_M,
        importDistM: importDistM(props),
      });

      console.log(
        `verify: ok=${verdict.ok} dist=${verdict.distM ?? 'n/d'}m reason=${verdict.reason} ancora=${verdict.anchor?.name || props.cliente_vicino}`
      );

      if (!verdict.ok) {
        skippedNearby += 1;
        if (!DRY_RUN) {
          await Contact.updateOne(
            { _id: c._id },
            {
              $set: {
                'properties.nearbyVerified': false,
                'properties.nearbyVerifiedDistM': verdict.distM,
                'properties.nearbyVerifiedReason': verdict.reason,
                'properties.nearbyVerifiedAt': new Date().toISOString(),
                'properties.nearbyAnchorName': verdict.anchor?.name || props.cliente_vicino,
              },
            }
          );
          console.log('marked nearbyVerified=false (no card save)');
        } else {
          console.log('[dry-run] would mark nearbyVerified=false');
        }
      } else if (VERIFY_ONLY) {
        ok += 1;
        if (!DRY_RUN) {
          await Contact.updateOne(
            { _id: c._id },
            {
              $set: {
                'properties.nearbyVerified': true,
                'properties.nearbyVerifiedDistM': verdict.distM,
                'properties.nearbyVerifiedReason': 'ok',
                'properties.nearbyVerifiedAt': new Date().toISOString(),
                'properties.nearbyAnchorName': verdict.anchor?.name || props.cliente_vicino,
              },
            }
          );
          console.log('marked nearbyVerified=true');
        } else {
          console.log('[dry-run] would mark nearbyVerified=true');
        }
      } else {
        const card = await buildVisibilityCard(c, { place });
        card.nearbyVerification = {
          ok: true,
          distM: verdict.distM,
          anchorName: verdict.anchor?.name || props.cliente_vicino,
          anchorSource: verdict.anchor?.source,
        };
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
                'properties.nearbyVerified': true,
                'properties.nearbyVerifiedDistM': verdict.distM,
                'properties.nearbyVerifiedReason': 'ok',
                'properties.nearbyVerifiedAt': new Date().toISOString(),
                'properties.nearbyAnchorName': verdict.anchor?.name || props.cliente_vicino,
              },
            }
          );
          console.log('saved card + nearbyVerified=true');
          ok += 1;
        }
      }
    } catch (err) {
      fail += 1;
      console.error(`ERR ${c.name}:`, err.message || err);
    }

    if (i < contacts.length - 1) {
      await sleep(SLEEP_MS);
    }
  }

  console.log(
    `\nFatto: ok=${ok} skippedNearby=${skippedNearby} fail=${fail} (dry-run=${DRY_RUN}, verify-only=${VERIFY_ONLY}, maxDist=${MAX_DIST_M})`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
