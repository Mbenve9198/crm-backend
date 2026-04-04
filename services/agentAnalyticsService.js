import Anthropic from '@anthropic-ai/sdk';
import Conversation from '../models/conversationModel.js';
import ConversationOutcome from '../models/conversationOutcomeModel.js';
import KnowledgeChunk from '../models/knowledgeChunkModel.js';
import AgentLog from '../models/agentLogModel.js';
import AgentFeedback from '../models/agentFeedbackModel.js';
import { sendAgentHumanReviewEmail } from './emailNotificationService.js';
import agentLogger from './agentLogger.js';

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

  // Aggiorna effectiveness dei knowledge chunks usati in questa conversazione
  const wasSuccessful = ['converted', 'call_booked'].includes(outcome);
  const feedbacks = await AgentFeedback.find({ conversation: conversationId }).lean();
  const approvedFeedbacks = feedbacks.filter(f => f.action === 'approved');

  if (feedbacks.length > 0) {
    const chunks = await KnowledgeChunk.find({
      isActive: true,
      lastUsed: { $gte: new Date(conversation.createdAt) }
    });

    for (const chunk of chunks) {
      await updateChunkEffectiveness(chunk._id, wasSuccessful && approvedFeedbacks.length > 0);
    }
  }

  return outcomeDoc;
};

/**
 * Analisi batch settimanale delle conversazioni.
 * Identifica pattern, gestisce drop-off analysis, suggerisce miglioramenti.
 * I risultati vengono persistiti su DB e inviati via email al team.
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

  // Drop-off analysis: conversazioni attive dove il lead non risponde da >3 giorni
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const staleConversations = await Conversation.find({
    status: { $in: ['active', 'paused'] },
    updatedAt: { $lte: threeDaysAgo }
  }).populate('contact', 'name email source').lean();

  const dropOffData = staleConversations.map(conv => {
    const lastLeadMsg = [...(conv.messages || [])].reverse().find(m => m.role === 'lead');
    const lastAgentMsg = [...(conv.messages || [])].reverse().find(m => m.role === 'agent');
    return {
      contactName: conv.contact?.name,
      source: conv.context?.leadSource,
      stage: conv.stage,
      objections: conv.context?.objections || [],
      lastLeadMessage: lastLeadMsg?.content?.substring(0, 200) || 'N/A',
      lastAgentMessage: lastAgentMsg?.content?.substring(0, 200) || 'N/A',
      silentDays: Math.ceil((Date.now() - new Date(conv.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
    };
  });

  if (outcomes.length === 0 && dropOffData.length === 0) {
    agentLogger.info('weekly_analysis_skip', { data: 'Nessun outcome e nessun drop-off' });
    return null;
  }

  const summary = {
    total: outcomes.length,
    converted: outcomes.filter(o => ['converted', 'call_booked'].includes(o.outcome)).length,
    lost: outcomes.filter(o => o.outcome === 'lost').length,
    dnc: outcomes.filter(o => o.outcome === 'dnc').length,
    stale: outcomes.filter(o => o.outcome === 'stale').length,
    avgMessages: outcomes.length > 0 ? outcomes.reduce((acc, o) => acc + (o.totalMessages || 0), 0) / outcomes.length : 0,
    avgDays: outcomes.length > 0 ? outcomes.reduce((acc, o) => acc + (o.daysToOutcome || 0), 0) / outcomes.length : 0,
    humanInterventions: outcomes.reduce((acc, o) => acc + (o.humanMessages || 0), 0),
    dropOffs: dropOffData.length,
    channels: {}
  };

  for (const o of outcomes) {
    for (const ch of (o.channelsUsed || [])) {
      summary.channels[ch] = (summary.channels[ch] || 0) + 1;
    }
  }

  // Aggrega obiezioni piu frequenti dalle conversazioni
  const objectionCounts = {};
  for (const o of outcomes) {
    for (const obj of (o.conversation?.context?.objections || [])) {
      objectionCounts[obj] = (objectionCounts[obj] || 0) + 1;
    }
  }
  for (const conv of staleConversations) {
    for (const obj of (conv.context?.objections || [])) {
      objectionCounts[obj] = (objectionCounts[obj] || 0) + 1;
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
      painPoints: conv.context?.painPoints || [],
      feedback: o.humanFeedback?.notes
    };
  }).filter(Boolean);

  try {
    const analysisPrompt = `Analizza queste conversazioni dell'AI Sales Agent di MenuChat dell'ultima settimana.

METRICHE OUTCOME:
- Totale chiuse: ${summary.total}
- Convertiti (call/SQL): ${summary.converted} (${summary.total > 0 ? ((summary.converted / summary.total) * 100).toFixed(1) : 0}%)
- Persi: ${summary.lost}
- Do Not Contact: ${summary.dnc}
- Stale: ${summary.stale}
- Media messaggi per conversazione: ${summary.avgMessages.toFixed(1)}
- Media giorni per chiusura: ${summary.avgDays.toFixed(1)}
- Interventi umani totali: ${summary.humanInterventions}

DROP-OFF (lead che hanno smesso di rispondere, ${dropOffData.length} totali):
${JSON.stringify(dropOffData.slice(0, 5), null, 2)}

OBIEZIONI PIÙ FREQUENTI:
${JSON.stringify(objectionCounts, null, 2)}

CAMPIONE CONVERSAZIONI CHIUSE:
${JSON.stringify(conversationSamples, null, 2)}

Rispondi in italiano con un report strutturato:
1. CONVERSION RATE ANALYSIS: tasso di conversione, trend, e confronto con la settimana precedente se possibile
2. PATTERN VINCENTI: cosa ha funzionato nelle conversazioni convertite (max 3 punti)
3. PATTERN DI FALLIMENTO: cosa ha causato le perdite e i drop-off (max 3 punti)
4. OBIEZIONI: classifica delle obiezioni più frequenti con suggerimenti su come migliorare la gestione
5. DROP-OFF ANALYSIS: perché i lead smettono di rispondere? Qual è l'ultimo messaggio dell'agente che precede il silenzio?
6. RACCOMANDAZIONI PRIORITARIE: 3 azioni concrete e specifiche per migliorare il tasso di conversione nella prossima settimana
7. KNOWLEDGE BASE: nuovi chunk da aggiungere o aggiornare (se necessario)

Formato: testo strutturato, conciso, orientato all'azione. Max 1500 parole.`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{ role: 'user', content: analysisPrompt }]
    });

    const analysisText = response.content[0].text;

    // Persisti il report nel log strutturato
    agentLogger.info('weekly_analysis_completed', {
      data: {
        summary,
        objectionCounts,
        dropOffCount: dropOffData.length,
        sampleCount: conversationSamples.length,
        analysis: analysisText.substring(0, 3000)
      }
    });

    // Invia report via email al team
    try {
      const { sendWeeklyAnalysisReport } = await import('./emailNotificationService.js');
      if (typeof sendWeeklyAnalysisReport === 'function') {
        await sendWeeklyAnalysisReport({ summary, analysis: analysisText, dropOffs: dropOffData.length, objectionCounts });
      }
    } catch {
      console.log('ℹ️ sendWeeklyAnalysisReport non disponibile, report solo su log');
    }

    // Analisi feedback umano per apprendimento
    let feedbackAnalysisResult = null;
    try {
      const feedbacks = await AgentFeedback.find({ createdAt: { $gte: oneWeekAgo } }).lean();

      if (feedbacks.length >= 3) {
        const fbStats = {
          total: feedbacks.length,
          approved: feedbacks.filter(f => f.action === 'approved').length,
          modified: feedbacks.filter(f => f.action === 'modified').length,
          discarded: feedbacks.filter(f => f.action === 'discarded').length
        };
        fbStats.approvalRate = ((fbStats.approved / fbStats.total) * 100).toFixed(1);

        const discardReasons = {};
        for (const f of feedbacks.filter(fb => fb.action === 'discarded')) {
          discardReasons[f.discardReason || 'other'] = (discardReasons[f.discardReason || 'other'] || 0) + 1;
        }

        const modificationSamples = feedbacks
          .filter(f => f.action === 'modified' && f.agentDraft && f.finalSent)
          .slice(0, 5)
          .map(f => ({
            agentWrote: f.agentDraft.substring(0, 300),
            humanChanged: f.finalSent.substring(0, 300),
            stage: f.conversationContext?.stage,
            source: f.conversationContext?.source
          }));

        const feedbackAnalysis = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: `Analizza questi feedback umani sulle risposte dell'AI Sales Agent di MenuChat.

STATISTICHE:
- Tasso di approvazione: ${fbStats.approvalRate}%
- Approvati senza modifiche: ${fbStats.approved}
- Modificati: ${fbStats.modified}
- Scartati: ${fbStats.discarded}
- Motivi scarto: ${JSON.stringify(discardReasons)}

CAMPIONE MODIFICHE (cosa l'agente ha scritto vs cosa l'umano ha cambiato):
${JSON.stringify(modificationSamples, null, 2)}

Rispondi in italiano con JSON valido:
{
  "patterns": ["pattern errore 1", "pattern errore 2"],
  "rules": ["SEMPRE fai X quando Y", "MAI fare X quando Y"],
  "goldenExamples": ["esempio messaggio efficace approvato senza modifiche"]
}` }]
        });

        try {
          const parsed = JSON.parse(feedbackAnalysis.content[0].text.match(/\{[\s\S]*\}/)?.[0] || '{}');
          feedbackAnalysisResult = parsed;

          if (parsed.rules && parsed.rules.length > 0) {
            for (const rule of parsed.rules) {
              const existing = await KnowledgeChunk.findOne({ category: 'learned_rule', content: rule });
              if (!existing) {
                await KnowledgeChunk.create({
                  content: rule,
                  category: 'learned_rule',
                  tags: ['feedback', 'auto-learned'],
                  source: 'feedback',
                  effectiveness: 0.7
                });
              }
            }
            agentLogger.info('learned_rules_created', { data: { count: parsed.rules.length, rules: parsed.rules } });
          }
        } catch {
          agentLogger.warn('feedback_analysis_parse_error', { data: feedbackAnalysis.content[0].text.substring(0, 500) });
        }

        agentLogger.info('feedback_analysis_completed', { data: { fbStats, feedbackAnalysisResult } });
      }
    } catch (fbErr) {
      agentLogger.warn('feedback_analysis_error', { data: fbErr.message });
    }

    return { summary, analysis: analysisText, sampleCount: conversationSamples.length, dropOffs: dropOffData.length, feedbackAnalysis: feedbackAnalysisResult };
  } catch (error) {
    agentLogger.error('weekly_analysis_error', { data: error.message });
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
