/**
 * Test: trascrizione con Google Gemini 2.0 Flash (supporta audio nativo).
 *
 * Uso: node scripts/test_gemini_transcription.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY env var required'); process.exit(1); }

async function downloadRecording(recordingSid) {
  const audioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.wav`;
  const authHeader = `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`;

  const resp = await fetch(audioUrl, {
    headers: { 'Authorization': authHeader },
    redirect: 'follow'
  });

  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function transcribeWithGemini(audioBuffer) {
  const base64Audio = audioBuffer.toString('base64');

  const payload = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: 'audio/wav',
            data: base64Audio,
          }
        },
        {
          text: `Trascrivi questa chiamata telefonica di vendita in italiano. 
Ci sono due persone: un venditore (SALES) e un ristoratore (LEAD).
Il venditore chiama per conto di MenuChat, un sistema di gestione recensioni per ristoranti.

Formato output:

[SALES]: testo...
[LEAD]: testo...

Se non riesci a sentire qualcosa, scrivi [inaudibile].
Alla fine della trascrizione, aggiungi:

---
RIASSUNTO: Un breve riassunto (3-5 frasi) della conversazione con i punti chiave emersi.
OUTCOME: [interested/callback/not-interested/voicemail/no-answer]
NOTE CHIAVE: lista puntata delle informazioni utili emerse (nome del proprietario, obiezioni, interessi, tempistiche, ecc.)`
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4000,
    }
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errorText}`);
  }

  const result = await resp.json();

  if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
    return {
      text: result.candidates[0].content.parts[0].text,
      usage: result.usageMetadata,
    };
  }

  throw new Error(`Risposta Gemini inattesa: ${JSON.stringify(result)}`);
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('✅ Connesso a MongoDB\n');

  const callsColl = db.collection('calls');

  // Trova registrazioni con outcome positivo e durata 30-600s
  const testCalls = await callsColl.find({
    recordingSid: { $ne: null, $exists: true },
    recordingDuration: { $gte: 30, $lte: 600 },
    outcome: { $in: ['callback', 'interested'] }
  }).sort({ createdAt: -1 }).limit(3).toArray();

  if (testCalls.length === 0) {
    console.log('❌ Nessuna registrazione trovata');
    await mongoose.disconnect();
    return;
  }

  // ── Test 1: prima registrazione ──
  const call = testCalls[0];
  const contact = await db.collection('contacts').findOne({ _id: call.contact });

  console.log(`📞 Test su chiamata: ${call.twilioCallSid}`);
  console.log(`   Data: ${call.createdAt}`);
  console.log(`   Durata: ${call.duration}s | Rec: ${call.recordingDuration}s`);
  console.log(`   Outcome: ${call.outcome}`);
  console.log(`   Note manuali: ${call.notes || 'nessuna'}`);
  console.log(`   Contatto: ${contact?.name || 'N/A'} (${contact?.email || 'N/A'})`);

  // Scarica
  console.log(`\n🔊 Download registrazione...`);
  const audioBuffer = await downloadRecording(call.recordingSid);
  console.log(`   Scaricato: ${Math.round(audioBuffer.length / 1024)} KB`);

  // Trascrivi
  console.log(`\n🤖 Trascrizione con Gemini 2.0 Flash...`);
  const startTime = Date.now();
  const result = await transcribeWithGemini(audioBuffer);
  const elapsed = Date.now() - startTime;

  console.log(`   Tempo: ${elapsed}ms`);
  if (result.usage) {
    console.log(`   Token: prompt=${result.usage.promptTokenCount} output=${result.usage.candidatesTokenCount} total=${result.usage.totalTokenCount}`);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  TRASCRIZIONE — ${contact?.name || 'Lead'}`);
  console.log(`${'═'.repeat(60)}\n`);
  console.log(result.text);
  console.log(`\n${'═'.repeat(60)}`);

  // ── Test 2: seconda registrazione (se disponibile) ──
  if (testCalls.length >= 2) {
    const call2 = testCalls[1];
    const contact2 = await db.collection('contacts').findOne({ _id: call2.contact });

    console.log(`\n\n📞 Test #2: ${call2.twilioCallSid}`);
    console.log(`   Contatto: ${contact2?.name || 'N/A'}`);
    console.log(`   Durata: ${call2.duration}s | Rec: ${call2.recordingDuration}s`);
    console.log(`   Outcome: ${call2.outcome}`);

    const audio2 = await downloadRecording(call2.recordingSid);
    console.log(`   Audio: ${Math.round(audio2.length / 1024)} KB`);

    const start2 = Date.now();
    const result2 = await transcribeWithGemini(audio2);
    console.log(`   Tempo: ${Date.now() - start2}ms`);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  TRASCRIZIONE — ${contact2?.name || 'Lead'}`);
    console.log(`${'═'.repeat(60)}\n`);
    console.log(result2.text);
    console.log(`\n${'═'.repeat(60)}`);
  }

  // ── Costi stimati ──
  const avgDur = await callsColl.aggregate([
    { $match: { recordingDuration: { $gt: 0 } } },
    { $group: { _id: null, totalSec: { $sum: '$recordingDuration' }, count: { $sum: 1 } } }
  ]).toArray();

  if (avgDur.length > 0) {
    const totalHours = avgDur[0].totalSec / 3600;
    // Gemini 2.0 Flash: audio input ~free tier molto generoso, poi ~$0.00001575/sec
    const estimatedCost = avgDur[0].totalSec * 0.00001575;
    console.log(`\n📊 Stima costi per ${avgDur[0].count} registrazioni (${Math.round(totalHours)}h):`);
    console.log(`   Gemini 2.0 Flash: ~$${estimatedCost.toFixed(2)} totale`);
    console.log(`   OpenAI Whisper: ~$${(avgDur[0].totalSec / 60 * 0.006).toFixed(2)} totale`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Fatto.');
}

run().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
