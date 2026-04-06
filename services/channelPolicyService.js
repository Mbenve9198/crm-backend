/**
 * Policy layer deterministico per orchestrazione multicanale.
 * - reactive (default): dopo inbound, il canale corrente è quello della risposta;
 *   non eseguire tool cross-canale.
 * - proactive: outreach pianificato (task) — consenti email + WhatsApp nello stesso giro
 *   (es. email subito + job template in coda).
 */

export function getCurrentChannel(conversation) {
  return conversation?.channelState?.currentChannel || conversation?.channel || 'email';
}

export function applyChannelPolicyToAgentResponse(agentResponse, conversation, options = {}) {
  if (!agentResponse) return agentResponse;

  const flow = options.flow || 'reactive';
  const forcedChannel = getCurrentChannel(conversation);
  const out = { ...agentResponse };

  if (flow === 'proactive') {
    // Non sovrascrivere il canale della bozza (l’agente può aver scelto email come primario).
    // Non filtrare tool_intents: esecuzione con channelGuardrail "outreach" in taskProcessor.
    return out;
  }

  // reactive: forza il canale della bozza/risposta al thread corrente
  out.channel = forcedChannel;

  if (Array.isArray(out.tool_intents)) {
    out.tool_intents = out.tool_intents.filter((intent) => {
      const tool = intent?.tool;
      if (!tool) return true;

      if (forcedChannel === 'email' && tool === 'send_whatsapp') return false;
      if (forcedChannel === 'whatsapp' && (tool === 'send_email' || tool === 'send_email_reply')) return false;
      return true;
    });
  }

  return out;
}

