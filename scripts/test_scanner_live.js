/**
 * Test live: prende i top 2 candidati dallo scanner, trascrive le registrazioni,
 * costruisce il payload arricchito e chiama l'agente.
 *
 * Uso: node scripts/test_scanner_live.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { scanReactivationCandidates } from '../services/contactScannerService.js';
import Contact from '../models/contactModel.js';
import Call from '../models/callModel.js';
import Activity from '../models/activityModel.js';

const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8100';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyA3k3Gc5yNPtq4dT8vtf6YWVJZwMCnBtcE';

async function transcribeRecording(recordingSid) {
  const audioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.wav`;
  const auth = `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`;
  const audioResp = await fetch(audioUrl, { headers: { 'Authorization': auth }, redirect: 'follow' });
  if (!audioResp.ok) throw new Error(`Download failed: ${audioResp.status}`);
  const buf = Buffer.from(await audioResp.arrayBuffer());

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: 'audio/wav', data: buf.toString('base64') } },
          { text: `Trascrivi questa chiamata di vendita in italiano. Formato: [SALES]: ... [LEAD]: ... Alla fine: --- RIASSUNTO + NOTE CHIAVE.` }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
      })
    }
  );
  if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
  const r = await resp.json();
  return r.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

function serializeContact(contact) {
  const p = contact.properties || {};
  const rc = contact.rankCheckerData || {};
  const rcR = rc.restaurantData || {};
  return {
    name: contact.name, email: contact.email, phone: contact.phone || null,
    city: p.city || p['Città'] || p.location || null,
    address: p.full_address || p['Indirizzo'] || rcR.address || null,
    rating: p.rating || p.Rating || rcR.rating || null,
    reviews: p.reviews_count || p.Recensioni || rcR.reviewCount || null,
    source: contact.source, category: p.category || p.business_type || null,
    website: p.site || p.Website || null,
    google_maps_link: p.google_maps_link || p.googleMapsUrl || null,
    contact_person: p.contact_person || p.contactName || null,
    place_id: rc.placeId || null, coordinates: rcR.coordinates || null,
    call_requested: p.callRequested || false, call_preference: p.callPreference || null,
    status: contact.status || null, notes: p.notes || null,
    callback_at: p.callbackAt || null, callback_note: p.callbackNote || null,
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
    ranking: { mainRank: ranking.mainRank, competitorsAhead: ranking.competitorsAhead,
      estimatedLostCustomers: ranking.estimatedLostCustomers,
      fullResults: {
        competitors: (full.competitors || []).slice(0, 5).map(c => ({ name: c.name, rank: c.rank, rating: c.rating, reviews: c.reviews, place_id: c.place_id })),
        mainResult: full.mainResult ? { rank: full.mainResult.rank, coordinates: full.mainResult.coordinates } : null
      }
    },
    restaurantData: { address: rc.restaurantData?.address, rating: rc.restaurantData?.rating, reviewCount: rc.restaurantData?.reviewCount, coordinates: rc.restaurantData?.coordinates }
  };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connesso a MongoDB');

  try {
    const h = await fetch(`${AGENT_URL}/health`);
    if (!h.ok) throw new Error();
    console.log(`✅ Agente online su ${AGENT_URL}\n`);
  } catch { console.error(`❌ Agente non raggiungibile`); await mongoose.disconnect(); return; }

  const candidates = await scanReactivationCandidates(3);
  console.log(`🔍 ${candidates.length} candidati dal scanner\n`);

  for (const cand of candidates.slice(0, 2)) {
    const contact = await Contact.findById(cand._id).lean();
    if (!contact) continue;

    console.log('═'.repeat(70));
    console.log(`  ${contact.name} | Score: ${cand.score}`);
    console.log(`  Status: ${contact.status} | Calls: ${cand.callCount} | Last call: ${cand.lastCallOutcome}`);
    console.log('═'.repeat(70));

    // Load and enrich calls
    const calls = await Call.find({ contact: contact._id }).sort({ createdAt: -1 }).limit(10).lean();
    const bestCall = calls.find(c => c.recordingSid && c.recordingDuration >= 30 && ['callback', 'interested'].includes(c.outcome));

    let transcript = null;
    if (bestCall) {
      console.log(`\n🎙️ Trascrizione (${bestCall.recordingDuration}s)...`);
      try {
        transcript = await transcribeRecording(bestCall.recordingSid);
        console.log(`   ✅ ${transcript?.length || 0} chars`);
      } catch (e) { console.log(`   ❌ ${e.message}`); }
    }

    const callHistory = calls.map(c => ({
      date: c.createdAt?.toISOString() || null,
      duration_seconds: c.duration || 0,
      outcome: c.outcome || null,
      notes: c.notes || null,
      transcript: c.twilioCallSid === bestCall?.twilioCallSid ? transcript : null,
      initiated_by: null,
    }));

    const activities = await Activity.find({ contact: contact._id }).sort({ createdAt: -1 }).limit(30).lean();
    const callActs = activities.filter(a => a.type === 'call');
    const statusChanges = activities.filter(a => a.type === 'status_change' && a.data?.statusChange)
      .map(a => `${a.data.statusChange.oldStatus} → ${a.data.statusChange.newStatus}`);

    const payload = {
      task_type: cand.score >= 50 ? 'reactivation_warm' : 'reactivation_cold',
      contact: serializeContact(contact),
      lead_source: contact.source || 'smartlead_outbound',
      rank_checker_data: serializeRankCheckerData(contact),
      agent_identity: { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' },
      task_context: { reason: `Score ${cand.score}: ${contact.status}, last call ${cand.lastCallOutcome}, ${cand.callCount} calls`, score: cand.score },
      days_since_last_contact: Math.floor((Date.now() - new Date(cand.lastActivityAt).getTime()) / (24*60*60*1000)),
      last_outcome: cand.lastCallOutcome || null,
      crm_enrichment: {
        call_history: callHistory,
        activity_summary: {
          total_activities: activities.length,
          calls_made: callActs.length,
          calls_answered: callActs.filter(a => a.data?.callOutcome && !['no-answer','busy'].includes(a.data.callOutcome)).length,
          last_call_date: callActs[0]?.createdAt?.toISOString() || null,
          last_call_outcome: callActs[0]?.data?.callOutcome || null,
          status_changes: statusChanges.length > 0 ? statusChanges : undefined,
        }
      }
    };

    console.log(`\n🤖 Calling agent...`);
    const start = Date.now();
    try {
      const resp = await fetch(`${AGENT_URL}/agent/proactive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const elapsed = Date.now() - start;
      if (!resp.ok) { console.log(`   ❌ ${resp.status}: ${(await resp.text()).slice(0, 300)}`); continue; }
      const data = await resp.json();

      console.log(`   ✅ ${elapsed}ms | ${data.action} | $${data.estimated_cost_usd?.toFixed(4)}`);

      if (data.strategy) {
        console.log(`\n  📋 Strategia: ${(data.strategy.approach || data.strategy.main_angle || '').slice(0, 200)}`);
      }
      if (data.draft) {
        console.log(`\n  📧 DRAFT:\n  ${'─'.repeat(50)}`);
        console.log(data.draft.split('\n').map(l => `  ${l}`).join('\n'));
        console.log(`  ${'─'.repeat(50)}`);
      }
      if (data.tool_intents?.length) {
        console.log(`\n  🔧 Intents: ${data.tool_intents.map(t => t.tool).join(', ')}`);
      }
    } catch (e) { console.log(`   ❌ ${e.message}`); }

    console.log('\n');
  }

  await mongoose.disconnect();
  console.log('✅ Fatto.');
}

run().catch(err => { console.error('❌', err); process.exit(1); });
