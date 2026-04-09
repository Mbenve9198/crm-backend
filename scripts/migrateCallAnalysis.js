/**
 * Migration script: add structured callAnalysis to existing Call records.
 *
 * Pass 1: Calls with transcript but no callAnalysis -> re-analyze text (no audio download).
 * Pass 2: Calls with recordingSid but no transcript -> download audio + full transcription.
 *
 * Usage: node scripts/migrateCallAnalysis.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Call from '../models/callModel.js';
import { transcribeCall, analyzeExistingTranscript } from '../services/callTranscriptionService.js';

const MONGO_URI = process.env.MONGODB_URI;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  // Pass 1: existing transcripts without analysis
  const withTranscript = await Call.find({
    transcript: { $ne: null, $exists: true },
    $or: [
      { callAnalysis: null },
      { callAnalysis: { $exists: false } },
    ],
  }).sort({ createdAt: -1 });

  console.log(`\nPass 1: ${withTranscript.length} calls with transcript but no analysis`);

  let pass1Success = 0;
  let pass1Fail = 0;
  for (const call of withTranscript) {
    try {
      const analysis = await analyzeExistingTranscript(call.transcript);
      if (analysis) {
        call.callAnalysis = analysis;
        await call.save();
        pass1Success++;
        console.log(`  ✓ ${call._id} (score: ${analysis.salesScore}, objections: ${analysis.objections?.length || 0})`);
      } else {
        pass1Fail++;
        console.log(`  ✗ ${call._id} — analysis returned null`);
      }
    } catch (err) {
      pass1Fail++;
      console.log(`  ✗ ${call._id} — ${err.message}`);
    }
    // Rate limit: Gemini free tier
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`Pass 1 done: ${pass1Success} success, ${pass1Fail} failed`);

  // Pass 2: calls with recording but no transcript at all
  const withoutTranscript = await Call.find({
    recordingSid: { $ne: null, $exists: true },
    transcript: { $eq: null },
    status: 'completed',
    recordingDuration: { $gte: 20 },
  }).sort({ createdAt: -1 });

  console.log(`\nPass 2: ${withoutTranscript.length} calls with recording but no transcript`);

  let pass2Success = 0;
  let pass2Fail = 0;
  for (const call of withoutTranscript) {
    try {
      await transcribeCall(call._id);
      pass2Success++;
      const updated = await Call.findById(call._id).lean();
      console.log(`  ✓ ${call._id} (transcript: ${updated.transcript?.length || 0} chars, analysis: ${updated.callAnalysis ? 'yes' : 'no'})`);
    } catch (err) {
      pass2Fail++;
      console.log(`  ✗ ${call._id} — ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log(`Pass 2 done: ${pass2Success} success, ${pass2Fail} failed`);

  console.log('\nMigration complete.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
