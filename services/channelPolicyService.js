/**
 * Policy layer deterministico per orchestrazione multicanale.
 * L'AI può suggerire un canale, ma qui imponiamo vincoli hard:
 * - Dopo inbound, il canale corrente è quello della risposta
 * - Non eseguire azioni (tool) su canali diversi dal currentChannel
 */

export function getCurrentChannel(conversation) {
  return conversation?.channelState?.currentChannel || conversation?.channel || 'email';
}

export function applyChannelPolicyToAgentResponse(agentResponse, conversation) {
  if (!agentResponse) return agentResponse;

  const forcedChannel = getCurrentChannel(conversation);
  const out = { ...agentResponse };

  // Forza il canale della bozza/risposta
  out.channel = forcedChannel;

  // Filtra tool intents incoerenti col canale corrente
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

