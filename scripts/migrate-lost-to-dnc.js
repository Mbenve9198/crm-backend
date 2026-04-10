import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';
import Activity from '../models/activityModel.js';

/**
 * Migrazione: sposta in "do_not_contact" i lead Smartlead importati per errore
 * come "lost before free trial" che in realtà non sono mai stati lavorati.
 *
 * Criteri:
 *   - status = "lost before free trial"
 *   - source = "smartlead_outbound"
 *   - hanno esattamente 1 sola activity
 */

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI (o MONGO_URI) non impostata');
  }

  await mongoose.connect(mongoUri);

  const candidates = await Contact.find({
    status: 'lost before free trial',
    source: 'smartlead_outbound'
  }).select('_id name email').lean();

  console.log(`🔍 Trovati ${candidates.length} contatti "lost before free trial" con source smartlead_outbound`);

  if (candidates.length === 0) {
    console.log('✅ Nessun contatto da migrare');
    await mongoose.disconnect();
    return;
  }

  const candidateIds = candidates.map(c => c._id);

  const activityCounts = await Activity.aggregate([
    { $match: { contact: { $in: candidateIds } } },
    { $group: { _id: '$contact', count: { $sum: 1 } } }
  ]);

  const countMap = new Map(activityCounts.map(r => [String(r._id), r.count]));

  const toUpdate = candidates.filter(c => {
    const count = countMap.get(String(c._id)) || 0;
    return count <= 1;
  });

  console.log(`📋 Di questi, ${toUpdate.length} hanno ≤1 activity (da migrare a do_not_contact)`);
  console.log(`   ${candidates.length - toUpdate.length} hanno >1 activity (restano lost before free trial)`);

  if (toUpdate.length === 0) {
    console.log('✅ Nessun contatto da migrare');
    await mongoose.disconnect();
    return;
  }

  const idsToUpdate = toUpdate.map(c => c._id);

  const result = await Contact.updateMany(
    { _id: { $in: idsToUpdate } },
    { $set: { status: 'do_not_contact' } }
  );

  console.log(`✅ Migrazione completata: ${result.modifiedCount} contatti aggiornati a "do_not_contact"`);

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('❌ Migrazione fallita:', err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
