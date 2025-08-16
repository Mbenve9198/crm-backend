import mongoose from 'mongoose';
import Call from '../models/callModel.js';
import Activity from '../models/activityModel.js';
import dotenv from 'dotenv';

dotenv.config();

async function nukeCalls() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('🔥 ELIMINAZIONE TOTALE CHIAMATE');
  
  const calls = await Call.find({});
  console.log(`Trovate ${calls.length} chiamate da eliminare`);
  
  await Call.deleteMany({});
  console.log('✅ Tutte le chiamate eliminate');
  
  const activities = await Activity.find({ type: 'call' });
  console.log(`Trovate ${activities.length} activity di chiamata da eliminare`);
  
  await Activity.deleteMany({ type: 'call' });
  console.log('✅ Tutte le activity di chiamata eliminate');
  
  await mongoose.disconnect();
  console.log('🎉 DATABASE PULITO COMPLETAMENTE');
}

nukeCalls().catch(console.error); 