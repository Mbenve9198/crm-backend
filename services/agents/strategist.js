import Anthropic from '@anthropic-ai/sdk';
import { buildStrategistPrompt } from './prompts/strategist.js';
import agentLogger from '../agentLogger.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function plan(leadMessage, researchData, playbook, conversation) {
  const systemPrompt = buildStrategistPrompt(playbook);

  const userContent = buildStrategistInput(leadMessage, researchData, conversation);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 10000,
    temperature: 1,
    thinking: { type: 'enabled', budget_tokens: 6000 },
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }]
  });

  let thinkingText = '';
  let outputText = '';
  for (const block of response.content) {
    if (block.type === 'thinking') thinkingText += block.thinking;
    if (block.type === 'text') outputText += block.text;
  }

  if (thinkingText) {
    agentLogger.info('strategist_thinking', {
      conversationId: conversation._id,
      data: thinkingText.substring(0, 2000)
    });
  }

  try {
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in strategist output');
    const strategy = JSON.parse(jsonMatch[0]);

    strategy.thinking = thinkingText;
    strategy.inputTokens = response.usage?.input_tokens || 0;
    strategy.outputTokens = response.usage?.output_tokens || 0;

    return strategy;
  } catch (err) {
    agentLogger.error('strategist_parse_error', {
      conversationId: conversation._id,
      data: { error: err.message, raw: outputText.substring(0, 500) }
    });
    return getDefaultStrategy(playbook, researchData);
  }
}

function buildStrategistInput(leadMessage, data, conversation) {
  let input = `MESSAGGIO DEL LEAD:\n"${leadMessage}"\n\n`;

  input += `DATI DISPONIBILI:\n`;
  input += `- Ristorante: ${data.contact.name}\n`;
  input += `- Citta: ${data.contact.city || 'N/A'}\n`;
  if (data.contact.phone) input += `- Telefono: ${data.contact.phone}\n`;
  if (data.contact.rating) input += `- Rating Google: ${data.contact.rating}/5\n`;
  if (data.contact.reviews) input += `- Recensioni Google: ${data.contact.reviews}\n`;

  if (data.ranking) {
    input += `\nDATA RANK CHECKER:\n`;
    input += `- Keyword: "${data.ranking.keyword}"\n`;
    if (data.ranking.mainRank) input += `- Posizione: ${data.ranking.mainRank}°\n`;
    if (data.ranking.competitorsAhead) input += `- Competitor davanti: ${data.ranking.competitorsAhead}\n`;
    if (data.ranking.estimatedLostCustomers) input += `- Clienti persi/settimana: ~${data.ranking.estimatedLostCustomers}\n`;
    if (data.ranking.dailyCovers) input += `- Coperti/giorno: ${data.ranking.dailyCovers}\n`;
    const est = data.ranking.dailyCovers > 0 ? Math.round(data.ranking.dailyCovers * 14 * 0.06) : null;
    if (est) input += `- Stima recensioni in 2 settimane prova: ~${est}\n`;
  }

  if (data.competitors.length > 0) {
    input += `\nCOMPETITOR:\n`;
    data.competitors.forEach(c => {
      input += `- ${c.name}: posizione ${c.rank}, rating ${c.rating || '?'}, ${c.reviews || '?'} recensioni\n`;
    });
  }

  if (data.similarClients.length > 0) {
    input += `\nCLIENTI MENUCHAT SIMILI (usa questi come social proof):\n`;
    data.similarClients.forEach(c => {
      input += `- ${c.name} (${c.city}): da ${c.initialReviews} a ${c.currentReviews} recensioni in ${c.monthsActive} mesi (+${c.reviewsGained})\n`;
      if (c.menuUrl) input += `  Menu: ${c.menuUrl}\n`;
    });
  } else if (data.fallbackCaseStudies.length > 0) {
    input += `\nCASE STUDY GENERICI (nessun cliente trovato nella zona):\n`;
    data.fallbackCaseStudies.forEach(c => {
      input += `- ${c.name} (${c.city}): ${c.result}\n`;
    });
  }

  if (data.emailHistory.length > 0) {
    input += `\nSTORICO EMAIL:\n`;
    data.emailHistory.forEach(e => {
      input += `[${e.type}] ${e.subject}: ${e.body.substring(0, 200)}...\n`;
    });
    if (data.sequenceNumber) input += `Il lead sta rispondendo alla sequenza email #${data.sequenceNumber}\n`;
  }

  const existingObjs = conversation.context?.objections || [];
  if (existingObjs.length > 0) {
    input += `\nOBIEZIONI GIA EMERSE: ${existingObjs.join(', ')}\n`;
  }

  const existingPPs = conversation.context?.painPoints || [];
  if (existingPPs.length > 0) {
    input += `PAIN POINTS RILEVATI: ${existingPPs.join(', ')}\n`;
  }

  input += `\nFASE: ${conversation.stage || 'initial_reply'}\n`;
  input += `MESSAGGI SCAMBIATI: ${conversation.messages?.length || 0}\n`;

  return input;
}

function getDefaultStrategy(playbook, data) {
  return {
    approach: 'social_proof',
    mainAngle: 'Usa dati disponibili per creare interesse',
    painPointToUse: null,
    socialProof: data.similarClients?.[0] ? {
      clientName: data.similarClients[0].name,
      data: `${data.similarClients[0].reviewsGained} recensioni in ${data.similarClients[0].monthsActive} mesi`,
      menuUrl: data.similarClients[0].menuUrl || null
    } : null,
    cta: data.contact?.phone ? 'confirm_number' : 'ask_number',
    ctaDetails: data.contact?.phone ? `Conferma ${data.contact.phone}` : 'Chiedi il numero',
    tone: 'consultivo',
    maxWords: playbook.maxWords || 100,
    doNot: playbook.doNot || [],
    channelToUse: 'email',
    thinking: '(fallback strategy)',
    inputTokens: 0,
    outputTokens: 0
  };
}

export default { plan };
