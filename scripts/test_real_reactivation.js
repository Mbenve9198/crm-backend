/**
 * TEST REALE: prende contatti veri dal CRM con storico chiamate,
 * trascrive una registrazione con Gemini, costruisce il payload arricchito
 * e chiama l'agente di produzione per vedere come si comporta.
 *
 * Uso: node scripts/test_real_reactivation.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8100';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY env var required'); process.exit(1); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function transcribeRecording(recordingSid) {
  const audioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.wav`;
  const auth = `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`;

  const audioResp = await fetch(audioUrl, { headers: { 'Authorization': auth }, redirect: 'follow' });
  if (!audioResp.ok) throw new Error(`Download failed: ${audioResp.status}`);
  const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

  const payload = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'audio/wav', data: audioBuffer.toString('base64') } },
        { text: `Trascrivi questa chiamata telefonica di vendita in italiano.
Ci sono due persone: un venditore (SALES) e un ristoratore (LEAD).

Formato:
[SALES]: testo...
[LEAD]: testo...

Alla fine aggiungi:
---
RIASSUNTO: Breve riassunto (3-5 frasi).
NOTE CHIAVE:
- informazioni utili emerse` }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
  const result = await resp.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

function serializeContact(contact) {
  const p = contact.properties || {};
  const rc = contact.rankCheckerData || {};
  const rcR = rc.restaurantData || {};

  return {
    name: contact.name,
    email: contact.email,
    phone: contact.phone || null,
    city: p.city || p['Città'] || p.location || null,
    address: p.full_address || p['Indirizzo'] || rcR.address || null,
    rating: p.rating || p.Rating || rcR.rating || null,
    reviews: p.reviews_count || p.Recensioni || rcR.reviewCount || null,
    source: contact.source,
    category: p.category || p.business_type || null,
    website: p.site || p.Website || null,
    google_maps_link: p.google_maps_link || p.googleMapsUrl || null,
    contact_person: p.contact_person || p.contactName || null,
    place_id: rc.placeId || null,
    coordinates: rcR.coordinates || null,
    call_requested: p.callRequested || false,
    call_preference: p.callPreference || null,
    status: contact.status || null,
    notes: p.notes || null,
    callback_at: p.callbackAt || null,
    callback_note: p.callbackNote || null,
  };
}

function serializeRankCheckerData(contact) {
  const rc = contact.rankCheckerData;
  if (!rc) return null;
  const ranking = rc.ranking || {};
  const full = ranking.fullResults || {};
  return {
    keyword: rc.keyword, dailyCovers: rc.dailyCovers, hasDigitalMenu: rc.hasDigitalMenu,
    estimatedMonthlyReviews: rc.estimatedMonthlyReviews, placeId: rc.placeId,
    ranking: {
      mainRank: ranking.mainRank, competitorsAhead: ranking.competitorsAhead,
      estimatedLostCustomers: ranking.estimatedLostCustomers,
      fullResults: {
        competitors: (full.competitors || []).slice(0, 5).map(c => ({
          name: c.name, rank: c.rank, rating: c.rating, reviews: c.reviews, place_id: c.place_id
        })),
        mainResult: full.mainResult ? { rank: full.mainResult.rank, coordinates: full.mainResult.coordinates } : null,
      },
    },
    restaurantData: { address: rcR?.address, rating: rcR?.rating, reviewCount: rcR?.reviewCount, coordinates: rcR?.coordinates },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function run() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('✅ Connesso a MongoDB');

  // Verifica che l'agente sia raggiungibile
  try {
    const h = await fetch(`${AGENT_URL}/health`);
    if (!h.ok) throw new Error(`${h.status}`);
    console.log(`✅ Agente raggiungibile su ${AGENT_URL}\n`);
  } catch (e) {
    console.error(`❌ Agente non raggiungibile su ${AGENT_URL}: ${e.message}`);
    await mongoose.disconnect();
    return;
  }

  const callsColl = db.collection('calls');
  const contactsColl = db.collection('contacts');
  const actColl = db.collection('activities');

  // Trova un contatto con MOLTE chiamate e almeno una registrazione
  const richContacts = await callsColl.aggregate([
    { $match: { recordingSid: { $ne: null }, recordingDuration: { $gte: 30 } } },
    { $group: { _id: '$contact', callCount: { $sum: 1 }, lastCall: { $max: '$createdAt' } } },
    { $match: { callCount: { $gte: 3 } } },
    { $sort: { callCount: -1 } },
    { $limit: 2 }
  ]).toArray();

  if (richContacts.length === 0) {
    console.log('❌ Nessun contatto con storico ricco trovato');
    await mongoose.disconnect();
    return;
  }

  for (const rc of richContacts) {
    const contact = await contactsColl.findOne({ _id: rc._id });
    if (!contact) continue;

    console.log('═'.repeat(70));
    console.log(`  TEST REALE: ${contact.name}`);
    console.log(`  Email: ${contact.email} | Status: ${contact.status}`);
    console.log(`  Chiamate: ${rc.callCount} | Source: ${contact.source}`);
    console.log('═'.repeat(70));

    // Carica chiamate
    const calls = await callsColl.find({ contact: contact._id })
      .sort({ createdAt: -1 }).limit(10).toArray();

    // Trascrivi la registrazione più lunga con outcome positivo
    let transcribedCall = null;
    const bestCall = calls.find(c => c.recordingSid && c.recordingDuration >= 30 &&
      ['callback', 'interested', 'meeting-set'].includes(c.outcome));

    if (bestCall) {
      console.log(`\n🎙️ Trascrizione chiamata del ${bestCall.createdAt?.toISOString()?.slice(0,10)} (${bestCall.recordingDuration}s)...`);
      try {
        const transcript = await transcribeRecording(bestCall.recordingSid);
        transcribedCall = { ...bestCall, transcript };
        console.log(`   ✅ Trascrizione completata (${transcript?.length || 0} chars)`);
        // Mostra prime righe
        const lines = transcript?.split('\n').slice(0, 8) || [];
        for (const l of lines) console.log(`   ${l}`);
        if (lines.length < (transcript?.split('\n').length || 0)) console.log(`   ... (${transcript?.split('\n').length} righe totali)`);
      } catch (e) {
        console.log(`   ❌ Trascrizione fallita: ${e.message}`);
      }
    }

    // Carica activities
    const activities = await actColl.find({ contact: contact._id })
      .sort({ createdAt: -1 }).limit(30).toArray();

    const callActs = activities.filter(a => a.type === 'call');
    const statusChanges = activities
      .filter(a => a.type === 'status_change' && a.data?.statusChange)
      .map(a => `${a.data.statusChange.oldStatus} → ${a.data.statusChange.newStatus}`);

    // Costruisci il payload arricchito
    const callHistory = calls.map(c => ({
      date: c.createdAt?.toISOString() || null,
      duration_seconds: c.duration || 0,
      outcome: c.outcome || null,
      notes: c.notes || null,
      transcript: (c.twilioCallSid === transcribedCall?.twilioCallSid) ? transcribedCall.transcript : null,
      initiated_by: null,
    }));

    const crmEnrichment = {
      call_history: callHistory,
      activity_summary: {
        total_activities: activities.length,
        calls_made: callActs.length,
        calls_answered: callActs.filter(a => a.data?.callOutcome && !['no-answer', 'busy'].includes(a.data.callOutcome)).length,
        last_call_date: callActs[0]?.createdAt?.toISOString() || null,
        last_call_outcome: callActs[0]?.data?.callOutcome || null,
        notes_count: activities.filter(a => a.type === 'note').length,
        emails_count: activities.filter(a => a.type === 'email').length,
        whatsapp_count: activities.filter(a => a.type === 'whatsapp').length,
        status_changes: statusChanges.length > 0 ? statusChanges : undefined,
      },
    };

    const payload = {
      task_type: 'reactivation',
      contact: serializeContact(contact),
      lead_source: contact.source || 'smartlead_outbound',
      rank_checker_data: serializeRankCheckerData(contact),
      agent_identity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
      task_context: { reason: 'Test reale — lead con storico ricco' },
      days_since_last_contact: Math.floor((Date.now() - (rc.lastCall?.getTime() || Date.now())) / (24*60*60*1000)),
      last_outcome: calls[0]?.outcome || null,
      crm_enrichment: crmEnrichment,
    };

    console.log(`\n📦 Payload: ${JSON.stringify(payload).length} bytes`);
    console.log(`   Chiamate incluse: ${callHistory.length}`);
    console.log(`   Con trascrizione: ${callHistory.filter(c => c.transcript).length}`);
    console.log(`   Activities: ${activities.length}`);

    // Chiama l'agente
    console.log(`\n🤖 Chiamata agente /agent/proactive ...`);
    const startTime = Date.now();
    try {
      const agentResp = await fetch(`${AGENT_URL}/agent/proactive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const elapsed = Date.now() - startTime;

      if (!agentResp.ok) {
        const errText = await agentResp.text();
        console.log(`   ❌ Errore ${agentResp.status}: ${errText.substring(0, 500)}`);
        continue;
      }

      const data = await agentResp.json();

      console.log(`   ✅ Risposta in ${elapsed}ms`);
      console.log(`\n${'─'.repeat(70)}`);
      console.log(`  ACTION: ${data.action}`);
      console.log(`  CHANNEL: ${data.channel}`);
      console.log(`  TOKENS: ${data.total_tokens}`);
      console.log(`  COSTO: $${data.estimated_cost_usd?.toFixed(4) || '?'}`);
      console.log(`  TEMPO: ${data.processing_time_ms}ms`);

      if (data.strategy) {
        console.log(`\n  📋 STRATEGIA:`);
        console.log(`  Approccio: ${data.strategy.approach || 'N/A'}`);
        console.log(`  Angolo: ${data.strategy.main_angle || 'N/A'}`);
        console.log(`  Tono: ${data.strategy.tone || 'N/A'}`);
        if (data.strategy.reasoning) {
          console.log(`  Reasoning: ${data.strategy.reasoning.substring(0, 400)}...`);
        }
      }

      if (data.draft) {
        console.log(`\n  📧 DRAFT EMAIL:`);
        console.log(`  ${'─'.repeat(50)}`);
        console.log(data.draft.split('\n').map(l => `  ${l}`).join('\n'));
        console.log(`  ${'─'.repeat(50)}`);
      }

      if (data.tool_intents?.length > 0) {
        console.log(`\n  🔧 TOOL INTENTS:`);
        for (const t of data.tool_intents) {
          console.log(`  - ${t.tool}: ${JSON.stringify(t.params).substring(0, 200)}`);
        }
      }

      if (data.thinking) {
        console.log(`\n  🧠 THINKING (prime 600 chars):`);
        console.log(data.thinking.substring(0, 600));
      }

      console.log(`\n${'─'.repeat(70)}`);

    } catch (e) {
      console.log(`   ❌ Errore chiamata agente: ${e.message}`);
    }

    console.log('\n');
  }

  await mongoose.disconnect();
  console.log('✅ Fatto.');
}

run().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
