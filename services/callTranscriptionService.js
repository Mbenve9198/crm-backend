import Call from '../models/callModel.js';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

async function downloadRecordingAudio(recordingSid) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.wav`;
  const auth = `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`;

  const resp = await fetch(url, {
    headers: { 'Authorization': auth },
    redirect: 'follow'
  });

  if (!resp.ok) throw new Error(`Download recording failed: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

const TRANSCRIPTION_PROMPT = `Trascrivi questa chiamata telefonica di vendita in italiano.
Ci sono due persone: un venditore (SALES) e un ristoratore (LEAD).

Formato:
[SALES]: testo...
[LEAD]: testo...

Se non riesci a sentire qualcosa, scrivi [inaudibile].
Alla fine aggiungi:

---
RIASSUNTO: Breve riassunto (3-5 frasi) con i punti chiave.
NOTE CHIAVE:
- informazioni utili emerse (nome proprietario, obiezioni, interessi, tempistiche, ecc.)

---ANALISI---
Produci un JSON valido con questa struttura esatta:
{
  "objections": [{"objection": "testo obiezione", "handling": "come il sales l'ha gestita", "effective": true/false}],
  "closing_technique": "tecnica usata per chiudere o avanzare la conversazione (o null se non applicabile)",
  "lead_preparation": "quanto era informato il lead prima della chiamata, cosa sapeva/non sapeva del prodotto",
  "key_moment": "il punto di svolta della conversazione, positivo o negativo",
  "outcome_reason": "perche' la chiamata e' finita con questo esito",
  "sales_score": 1-5
}`;

const ANALYSIS_ONLY_PROMPT = `Analizza questa trascrizione di una chiamata di vendita e produci SOLO il blocco JSON di analisi.

TRASCRIZIONE:
{TRANSCRIPT}

Produci un JSON valido con questa struttura esatta:
{
  "objections": [{"objection": "testo obiezione", "handling": "come il sales l'ha gestita", "effective": true/false}],
  "closing_technique": "tecnica usata per chiudere o avanzare la conversazione (o null se non applicabile)",
  "lead_preparation": "quanto era informato il lead prima della chiamata, cosa sapeva/non sapeva del prodotto",
  "key_moment": "il punto di svolta della conversazione, positivo o negativo",
  "outcome_reason": "perche' la chiamata e' finita con questo esito",
  "sales_score": 1-5
}

Rispondi SOLO con il JSON, nient'altro.`;

async function transcribeWithGemini(audioBuffer) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const payload = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: 'audio/wav',
            data: audioBuffer.toString('base64'),
          }
        },
        { text: TRANSCRIPTION_PROMPT }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 6000,
    }
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.substring(0, 200)}`);
  }

  const result = await resp.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');

  return text;
}

export function parseCallAnalysis(transcript) {
  if (!transcript) return null;

  const marker = '---ANALISI---';
  const idx = transcript.indexOf(marker);
  if (idx === -1) return null;

  const jsonPart = transcript.substring(idx + marker.length).trim();

  try {
    const startBrace = jsonPart.indexOf('{');
    const endBrace = jsonPart.lastIndexOf('}');
    if (startBrace === -1 || endBrace === -1) return null;

    const parsed = JSON.parse(jsonPart.substring(startBrace, endBrace + 1));

    return {
      objections: Array.isArray(parsed.objections) ? parsed.objections.map(o => ({
        objection: String(o.objection || ''),
        handling: String(o.handling || ''),
        effective: Boolean(o.effective),
      })) : [],
      closingTechnique: parsed.closing_technique || null,
      leadPreparation: parsed.lead_preparation || null,
      keyMoment: parsed.key_moment || null,
      outcomeReason: parsed.outcome_reason || null,
      salesScore: typeof parsed.sales_score === 'number' ? Math.min(5, Math.max(1, parsed.sales_score)) : null,
    };
  } catch {
    return null;
  }
}

export async function analyzeExistingTranscript(transcriptText) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const prompt = ANALYSIS_ONLY_PROMPT.replace('{TRANSCRIPT}', transcriptText.substring(0, 8000));

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.substring(0, 200)}`);
  }

  const result = await resp.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const parsed = JSON.parse(text.substring(start, end + 1));
    return {
      objections: Array.isArray(parsed.objections) ? parsed.objections.map(o => ({
        objection: String(o.objection || ''),
        handling: String(o.handling || ''),
        effective: Boolean(o.effective),
      })) : [],
      closingTechnique: parsed.closing_technique || null,
      leadPreparation: parsed.lead_preparation || null,
      keyMoment: parsed.key_moment || null,
      outcomeReason: parsed.outcome_reason || null,
      salesScore: typeof parsed.sales_score === 'number' ? Math.min(5, Math.max(1, parsed.sales_score)) : null,
    };
  } catch {
    return null;
  }
}

export async function transcribeCall(callId) {
  const call = await Call.findById(callId);
  if (!call) throw new Error(`Call ${callId} not found`);
  if (!call.recordingSid) throw new Error(`Call ${callId} has no recording`);
  if (call.transcript && call.callAnalysis) return call.transcript;

  if (call.transcript && !call.callAnalysis) {
    const analysis = parseCallAnalysis(call.transcript) || await analyzeExistingTranscript(call.transcript);
    if (analysis) {
      call.callAnalysis = analysis;
      await call.save();
    }
    return call.transcript;
  }

  const audio = await downloadRecordingAudio(call.recordingSid);
  const transcript = await transcribeWithGemini(audio);

  call.transcript = transcript;
  call.transcriptGeneratedAt = new Date();

  const analysis = parseCallAnalysis(transcript);
  if (analysis) {
    call.callAnalysis = analysis;
  }

  await call.save();
  return transcript;
}

export async function transcribeCallByRecordingSid(recordingSid) {
  const call = await Call.findOne({ recordingSid });
  if (!call) return null;
  if (call.transcript && call.callAnalysis) return call.transcript;

  return transcribeCall(call._id);
}

export async function batchTranscribeForContact(contactId, { limit = 5, minDuration = 30 } = {}) {
  const calls = await Call.find({
    contact: contactId,
    recordingSid: { $ne: null },
    $or: [
      { transcript: { $eq: null } },
      { callAnalysis: { $eq: null } },
    ],
    recordingDuration: { $gte: minDuration },
  }).sort({ createdAt: -1 }).limit(limit);

  const results = [];
  for (const call of calls) {
    try {
      const transcript = await transcribeCall(call._id);
      results.push({ callId: call._id, success: true, length: transcript.length });
    } catch (err) {
      results.push({ callId: call._id, success: false, error: err.message });
    }
  }
  return results;
}

export default { transcribeCall, transcribeCallByRecordingSid, batchTranscribeForContact, parseCallAnalysis, analyzeExistingTranscript };
