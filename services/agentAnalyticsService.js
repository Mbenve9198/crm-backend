import Anthropic from '@anthropic-ai/sdk';
import Conversation from '../models/conversationModel.js';
import ConversationOutcome from '../models/conversationOutcomeModel.js';
import KnowledgeChunk from '../models/knowledgeChunkModel.js';
import { sendAgentHumanReviewEmail } from './emailNotificationService.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Chiude una conversazione e crea un outcome per il learning
 */
export const closeConversation = async (conversationId, outcome, humanFeedback = null) => {
  const conversation = await Conversation.findById(conversationId)
    .populate('contact', 'name email status');
  if (!conversation) return null;

  conversation.status = outcome === 'dnc' ? 'dead' : 'converted';
  conversation.outcome = outcome;
  await conversation.save();

  const humanMessages = conversation.messages.filter(m => m.role === 'human').length;
  const agentMessages = conversation.messages.filter(m => m.role === 'agent').length;

  const outcomeDoc = new ConversationOutcome({
    conversation: conversation._id,
    contact: conversation.contact._id || conversation.contact,
    outcome,
    convertedToStatus: conversation.contact?.status,
    totalMessages: conversation.messages.length,
    agentMessages,
    humanMessages,
    daysToOutcome: Math.ceil((Date.now() - conversation.createdAt) / (1000 * 60 * 60 * 24)),
    channelsUsed: [...new Set(conversation.messages.map(m => m.channel))],
    humanFeedback: humanFeedback || undefined
  });

  await outcomeDoc.save();
  return outcomeDoc;
};

/**
 * Analisi batch settimanale delle conversazioni.
 * Usa Claude per identificare pattern, suggerire miglioramenti al prompt,
 * e aggiornare la knowledge base con nuovi insight.
 */
export const runWeeklyAnalysis = async () => {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const outcomes = await ConversationOutcome.find({ createdAt: { $gte: oneWeekAgo } })
    .populate({
      path: 'conversation',
      select: 'messages stage context metrics agentIdentity'
    })
    .populate('contact', 'name email source')
    .lean();

  if (outcomes.length === 0) {
    console.log('ℹ️ Nessun outcome questa settimana, skip analisi');
    return null;
  }

  const summary = {
    total: outcomes.length,
    converted: outcomes.filter(o => ['converted', 'call_booked'].includes(o.outcome)).length,
    lost: outcomes.filter(o => o.outcome === 'lost').length,
    dnc: outcomes.filter(o => o.outcome === 'dnc').length,
    stale: outcomes.filter(o => o.outcome === 'stale').length,
    avgMessages: outcomes.reduce((acc, o) => acc + (o.totalMessages || 0), 0) / outcomes.length,
    avgDays: outcomes.reduce((acc, o) => acc + (o.daysToOutcome || 0), 0) / outcomes.length,
    humanInterventions: outcomes.reduce((acc, o) => acc + (o.humanMessages || 0), 0),
    channels: {}
  };

  for (const o of outcomes) {
    for (const ch of (o.channelsUsed || [])) {
      summary.channels[ch] = (summary.channels[ch] || 0) + 1;
    }
  }

  const conversationSamples = outcomes.slice(0, 10).map(o => {
    const conv = o.conversation;
    if (!conv) return null;
    return {
      outcome: o.outcome,
      stage: conv.stage,
      messages: (conv.messages || []).slice(-6).map(m => ({
        role: m.role,
        content: (m.content || '').substring(0, 300)
      })),
      objections: conv.context?.objections || [],
      feedback: o.humanFeedback?.notes
    };
  }).filter(Boolean);

  try {
    const analysisPrompt = `Analizza queste ${outcomes.length} conversazioni dell'AI Sales Agent di MenuChat dell'ultima settimana.

METRICHE:
- Totale: ${summary.total}
- Convertiti: ${summary.converted} (${((summary.converted / summary.total) * 100).toFixed(1)}%)
- Persi: ${summary.lost}
- Do Not Contact: ${summary.dnc}
- Stale: ${summary.stale}
- Media messaggi: ${summary.avgMessages.toFixed(1)}
- Media giorni: ${summary.avgDays.toFixed(1)}
- Interventi umani: ${summary.humanInterventions}

CAMPIONE CONVERSAZIONI:
${JSON.stringify(conversationSamples, null, 2)}

Rispondi in italiano con:
1. PATTERN PRINCIPALI: cosa ha funzionato e cosa no (max 5 punti)
2. OBIEZIONI PIÙ FREQUENTI: quali obiezioni sono emerse e come sono state gestite
3. RACCOMANDAZIONI: 3 azioni concrete per migliorare il prompt/le risposte dell'agente
4. KNOWLEDGE BASE: se ci sono nuove informazioni da aggiungere alla knowledge base

Formato: testo strutturato, conciso, orientato all'azione.`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: analysisPrompt }]
    });

    const analysisText = response.content[0].text;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 ANALISI SETTIMANALE AI AGENT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(analysisText);

    return { summary, analysis: analysisText, sampleCount: conversationSamples.length };
  } catch (error) {
    console.error('❌ Errore analisi settimanale:', error);
    return { summary, analysis: null, error: error.message };
  }
};

/**
 * Aggiorna l'effectiveness di un knowledge chunk basato sull'uso
 */
export const updateChunkEffectiveness = async (chunkId, wasEffective) => {
  const chunk = await KnowledgeChunk.findById(chunkId);
  if (!chunk) return;

  chunk.usageCount = (chunk.usageCount || 0) + 1;
  chunk.lastUsed = new Date();

  const currentEff = chunk.effectiveness || 0.5;
  const weight = 0.1;
  chunk.effectiveness = wasEffective
    ? Math.min(1, currentEff + weight * (1 - currentEff))
    : Math.max(0, currentEff - weight * currentEff);

  await chunk.save();
};

export default {
  closeConversation,
  runWeeklyAnalysis,
  updateChunkEffectiveness
};
