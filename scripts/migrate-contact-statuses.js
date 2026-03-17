import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';

/**
 * Migrazione status contatti:
 * - "non interessato" -> "lost before free trial"
 * - "lost" -> "lost before free trial" (default conservativo)
 *
 * Nota: se vuoi distinguere "lost after free trial" in modo accurato,
 * serve una regola basata su history Activity/status_change (non implementata qui).
 */

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI (o MONGO_URI) non impostata');
  }

  await mongoose.connect(mongoUri);

  const res1 = await Contact.updateMany(
    { status: 'non interessato' },
    { $set: { status: 'lost before free trial' } }
  );

  const res2 = await Contact.updateMany(
    { status: 'lost' },
    { $set: { status: 'lost before free trial' } }
  );

  console.log('✅ Migrazione completata');
  console.log('- non interessato -> lost before free trial:', res1.modifiedCount);
  console.log('- lost -> lost before free trial:', res2.modifiedCount);

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

