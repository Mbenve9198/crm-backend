import Anthropic from '@anthropic-ai/sdk';
import { buildWriterPrompt } from './prompts/writer.js';
import agentLogger from '../agentLogger.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function compose(strategy, researchData, conversation, reviewFeedback = null) {
  const identity = conversation.agentIdentity || { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' };

  const systemPrompt = buildWriterPrompt(identity, reviewFeedback)
    .replace('{maxWords}', String(strategy.maxWords || 100));

  const userContent = buildWriterInput(strategy, researchData, conversation);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    temperature: 0.4,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }]
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  agentLogger.info('writer_output', {
    conversationId: conversation._id,
    data: { wordCount: text.split(/\s+/).length, isRetry: !!reviewFeedback }
  });

  return text;
}

function buildWriterInput(strategy, data, conversation) {
  let input = `PIANO STRATEGICO (segui alla lettera):\n${JSON.stringify(strategy, null, 2)}\n\n`;

  const thread = conversation.messages?.slice(-6) || [];
  if (thread.length > 0) {
    input += `ULTIMI MESSAGGI DELLA CONVERSAZIONE:\n`;
    thread.forEach(m => {
      input += `[${m.role.toUpperCase()}]: ${m.content?.substring(0, 300)}\n`;
    });
    input += '\n';
  }

  input += `DATI DEL LEAD:\n`;
  input += `- Nome ristorante: ${data.contact.name}\n`;
  if (data.contact.phone) input += `- Telefono: ${data.contact.phone}\n`;
  if (data.contact.city) input += `- Citta: ${data.contact.city}\n`;

  if (strategy.socialProof) {
    input += `\nSOCIAL PROOF DA CITARE OBBLIGATORIAMENTE:\n`;
    input += `- Cliente: ${strategy.socialProof.clientName}\n`;
    input += `- Risultati: ${strategy.socialProof.data}\n`;
    if (strategy.socialProof.menuUrl) input += `- Menu: ${strategy.socialProof.menuUrl}\n`;
  }

  input += `\nScrivi il messaggio ora. Massimo ${strategy.maxWords || 100} parole.`;

  return input;
}

export default { compose };
