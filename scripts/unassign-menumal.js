import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';
import User from '../models/userModel.js';

/**
 * Rimuove l'owner (Federico Desantis) dai contatti nella lista "Lista Menumal".
 */

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI (o MONGO_URI) non impostata');
  }

  await mongoose.connect(mongoUri);

  const federico = await User.findOne({
    firstName: { $regex: /federico/i },
  }).lean();

  if (!federico) {
    console.log('❌ Utente "Federico" non trovato nel database');
    await mongoose.disconnect();
    return;
  }

  console.log(`👤 Trovato ${federico.firstName} ${federico.lastName}: ${federico._id} (${federico.email})`);

  const candidates = await Contact.find({
    lists: 'Lista Menumal',
    owner: federico._id,
  }).select('_id name email').lean();

  console.log(`🔍 Trovati ${candidates.length} contatti nella lista "Lista Menumal" assegnati a Federico Desantis`);

  if (candidates.length === 0) {
    console.log('✅ Nessun contatto da aggiornare');
    await mongoose.disconnect();
    return;
  }

  const idsToUpdate = candidates.map(c => c._id);

  const result = await Contact.collection.updateMany(
    { _id: { $in: idsToUpdate } },
    { $set: { owner: null } }
  );

  console.log(`✅ Completato: ${result.modifiedCount} contatti ora senza owner`);

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
