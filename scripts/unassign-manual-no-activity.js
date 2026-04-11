import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';
import Activity from '../models/activityModel.js';
import User from '../models/userModel.js';

/**
 * Rimuove l'owner (Marco Benvenuti) dai contatti con source "manual"
 * che non hanno nessuna activity.
 */

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI (o MONGO_URI) non impostata');
  }

  await mongoose.connect(mongoUri);

  const marco = await User.findOne({
    firstName: { $regex: /marco/i },
    lastName: { $regex: /benvenuti/i }
  }).lean();

  if (!marco) {
    console.log('❌ Utente "Marco Benvenuti" non trovato nel database');
    await mongoose.disconnect();
    return;
  }

  console.log(`👤 Trovato Marco Benvenuti: ${marco._id} (${marco.email})`);

  const candidates = await Contact.find({
    source: 'manual',
    owner: marco._id
  }).select('_id name email').lean();

  console.log(`🔍 Trovati ${candidates.length} contatti con source "manual" e owner Marco Benvenuti`);

  if (candidates.length === 0) {
    console.log('✅ Nessun contatto da aggiornare');
    await mongoose.disconnect();
    return;
  }

  const candidateIds = candidates.map(c => c._id);

  const withActivities = await Activity.aggregate([
    { $match: { contact: { $in: candidateIds } } },
    { $group: { _id: '$contact' } }
  ]);

  const hasActivitySet = new Set(withActivities.map(r => String(r._id)));

  const toUnassign = candidates.filter(c => !hasActivitySet.has(String(c._id)));

  console.log(`📋 Di questi, ${toUnassign.length} non hanno attività (da rimuovere owner)`);
  console.log(`   ${candidates.length - toUnassign.length} hanno attività (restano assegnati)`);

  if (toUnassign.length === 0) {
    console.log('✅ Nessun contatto da aggiornare');
    await mongoose.disconnect();
    return;
  }

  const idsToUpdate = toUnassign.map(c => c._id);

  const result = await Contact.collection.updateMany(
    { _id: { $in: idsToUpdate } },
    { $set: { owner: null } }
  );

  console.log(`✅ Completato: ${result.modifiedCount} contatti ora senza owner ("Non assegnato")`);

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
