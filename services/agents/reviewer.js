import Anthropic from '@anthropic-ai/sdk';
import { buildReviewerPrompt } from './prompts/reviewer.js';
import { summarizeDataForReviewer } from './researcher.js';
import agentLogger from '../agentLogger.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function check(draft, strategy, researchData, source, stage) {
  const isFirstContact = stage === 'initial_reply' && (
    source === 'inbound_rank_checker' ||
    (source === 'smartlead_outbound')
  );

  const maxWords = strategy.maxWords || 100;
  const doNotList = strategy.doNot || [];
  const availableDataSummary = summarizeDataForReviewer(researchData);

  const systemPrompt = buildReviewerPrompt(isFirstContact, source, maxWords, doNotList, availableDataSummary);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: 'user', content: `MESSAGGIO DA CONTROLLARE:\n\n${draft}` }]
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in reviewer output');
    const result = JSON.parse(jsonMatch[0]);

    agentLogger.info('reviewer_result', {
      data: { pass: result.pass, violations: result.violations, wordCount: draft.split(/\s+/).length }
    });

    return {
      pass: result.pass === true,
      violations: result.violations || [],
      feedback: result.feedback || ''
    };
  } catch (err) {
    agentLogger.warn('reviewer_parse_error', { data: { error: err.message, raw: text.substring(0, 300) } });
    return { pass: false, violations: ['reviewer_parse_error'], feedback: 'Errore nel parsing della review. Riscrivere il messaggio.' };
  }
}

export default { check };
