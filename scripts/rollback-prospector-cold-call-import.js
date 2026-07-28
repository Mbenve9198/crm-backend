/**
 * Rollback import cold call "prospector" (ristoranti vicini ai clienti).
 *
 * Identifica i contatti tramite properties.prospector_cold_call creati in una data.
 * Li sposta in una lista dedicata e li rimuove dalla coda "da contattare" della dashboard.
 *
 * Usage:
 *   node scripts/rollback-prospector-cold-call-import.js --dry-run
 *   node scripts/rollback-prospector-cold-call-import.js --execute
 *
 * Options:
 *   --date=YYYY-MM-DD   Data import (default: oggi UTC)
 *   --list="Nome Lista" Nome lista cold call (default: Cold Call - Vicini Clienti)
 */

import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';

const COLD_CALL_LIST = 'Cold Call - Vicini Clienti';

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const execute = args.includes('--execute');
  if (!dryRun && !execute) {
    console.error('Specificare --dry-run oppure --execute');
    process.exit(1);
  }
  const dateArg = args.find((a) => a.startsWith('--date='));
  const listArg = args.find((a) => a.startsWith('--list='));
  const dateStr = dateArg ? dateArg.split('=')[1] : new Date().toISOString().slice(0, 10);
  const listName = listArg ? listArg.slice('--list='.length) : COLD_CALL_LIST;
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);
  return { dryRun, listName, dayStart, dayEnd, dateStr };
}

async function run() {
  const { dryRun, listName, dayStart, dayEnd, dateStr } = parseArgs();
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI non impostata');

  await mongoose.connect(mongoUri);

  const filter = {
    'properties.prospector_cold_call': { $exists: true, $ne: null },
    createdAt: { $gte: dayStart, $lte: dayEnd },
  };

  const contacts = await Contact.find(filter).select('_id name status owner lists createdAt').lean();
  console.log(`\n📋 Trovati ${contacts.length} contatti prospector del ${dateStr}`);
  if (contacts.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const byOwner = {};
  const byStatus = {};
  for (const c of contacts) {
    const ownerKey = c.owner ? String(c.owner) : 'null';
    byOwner[ownerKey] = (byOwner[ownerKey] || 0) + 1;
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  }
  console.log('   Per status:', byStatus);
  console.log('   Per owner:', byOwner);
  console.log(`   Azione: aggiungi lista "${listName}" (status invariato — lavorabili da tab Contatti)`);

  if (dryRun) {
    console.log('\n🔍 Dry-run: nessuna modifica applicata.');
    await mongoose.disconnect();
    return;
  }

  const ids = contacts.map((c) => c._id);
  const result = await Contact.updateMany(
    { _id: { $in: ids } },
    { $addToSet: { lists: listName } }
  );

  console.log(`\n✅ Aggiornati ${result.modifiedCount} contatti.`);
  console.log(`   Lista: "${listName}"`);
  console.log('   La dashboard esclude automaticamente i contatti in questa lista dalla colonna "Da contattare".');
  console.log('\n   Per lavorarli: tab Contatti → filtra per lista "' + listName + '".');

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('❌ Errore:', err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
