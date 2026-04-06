/**
 * Dry-run: esegue lo scan senza creare task.
 * Mostra i candidati, i loro score, e perché sono stati selezionati.
 *
 * Uso: node scripts/dry_run_scanner.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { scanReactivationCandidates, createReactivationTasks } from '../services/contactScannerService.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connesso a MongoDB\n');

  console.log('🔍 Scanning contatti per riattivazione (dry-run)...\n');
  const candidates = await scanReactivationCandidates(30);

  console.log(`Trovati ${candidates.length} candidati\n`);

  if (candidates.length === 0) {
    console.log('Nessun candidato trovato. Controlla i parametri MIN_DAYS/MAX_DAYS.');
    await mongoose.disconnect();
    return;
  }

  // Score distribution
  const scores = candidates.map(c => c.score);
  console.log(`📊 Distribuzione score:`);
  console.log(`   Min: ${Math.min(...scores)} | Max: ${Math.max(...scores)} | Media: ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}`);
  console.log(`   Warm (>=50): ${candidates.filter(c => c.score >= 50).length}`);
  console.log(`   Cold (20-49): ${candidates.filter(c => c.score >= 20 && c.score < 50).length}`);
  console.log(`   Low (<20): ${candidates.filter(c => c.score < 20).length}`);

  // Status distribution
  const byStatus = {};
  for (const c of candidates) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  }
  console.log(`\n📋 Per status: ${JSON.stringify(byStatus)}`);

  // Source distribution
  const bySource = {};
  for (const c of candidates) {
    bySource[c.source] = (bySource[c.source] || 0) + 1;
  }
  console.log(`📋 Per source: ${JSON.stringify(bySource)}`);

  // Top candidates
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  TOP ${Math.min(15, candidates.length)} CANDIDATI PER RIATTIVAZIONE`);
  console.log(`${'═'.repeat(80)}\n`);

  for (const c of candidates.slice(0, 15)) {
    const daysAgo = Math.floor((Date.now() - new Date(c.lastActivityAt).getTime()) / (24 * 60 * 60 * 1000));
    console.log(`  Score: ${c.score} | ${c.name}`);
    console.log(`    Email: ${c.email || 'N/A'} | Tel: ${c.phone || 'N/A'}`);
    console.log(`    Status: ${c.status} | Source: ${c.source}`);
    console.log(`    Ultima activity: ${daysAgo}d fa | Activities: ${c.activityCount} | Calls: ${c.callCount}`);
    console.log(`    Last call: ${c.lastCallOutcome || 'N/A'} | Notes: ${c.lastCallHasNotes ? 'sì' : 'no'} | Recording: ${c.lastCallHasRecording ? 'sì' : 'no'}`);
    if (c.properties?.callbackAt) {
      console.log(`    ⚠️  Callback scaduto: ${c.properties.callbackAt}`);
    }
    console.log('');
  }

  // Simula la creazione dei task
  const tasks = createReactivationTasks(candidates, 10);
  console.log(`${'═'.repeat(80)}`);
  console.log(`  TASK CHE VERREBBERO CREATI (limit 10)`);
  console.log(`${'═'.repeat(80)}\n`);

  for (const t of tasks) {
    const c = candidates.find(cc => cc._id.toString() === t.contact.toString());
    console.log(`  ${t.type} | Score ${t.score} | ${c?.name || '?'}`);
    console.log(`    Schedule: ${t.scheduledAt.toISOString().slice(0, 16)} | Priority: ${t.priority}`);
    console.log(`    Reason: ${t.context.reason}`);
    console.log('');
  }

  await mongoose.disconnect();
  console.log('✅ Fatto (nessun task creato — dry run).');
}

run().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
