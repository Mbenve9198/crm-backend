import AgentLog from '../models/agentLogModel.js';

/**
 * Logger strutturato per l'AI Sales Agent.
 * Scrive su console (formato leggibile) E su MongoDB (per query in produzione).
 */

const LEVEL_PREFIX = {
  info: '🤖',
  warn: '⚠️',
  error: '❌'
};

const log = async ({ level = 'info', event, conversationId, contactEmail, data }) => {
  const prefix = LEVEL_PREFIX[level] || '📋';
  const ctx = contactEmail ? ` [${contactEmail}]` : conversationId ? ` [conv:${conversationId}]` : '';
  const dataStr = data ? ` ${typeof data === 'string' ? data : JSON.stringify(data).substring(0, 300)}` : '';

  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `${prefix} Agent:${ctx} ${event}${dataStr}`
  );

  try {
    await AgentLog.create({ level, event, conversationId, contactEmail, data, createdAt: new Date() });
  } catch {
    // Non bloccare mai il flusso per un errore di logging
  }
};

const info = (event, opts = {}) => log({ level: 'info', event, ...opts });
const warn = (event, opts = {}) => log({ level: 'warn', event, ...opts });
const error = (event, opts = {}) => log({ level: 'error', event, ...opts });

export default { log, info, warn, error };
