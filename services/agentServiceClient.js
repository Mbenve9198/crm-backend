import axios from 'axios';
import agentLogger from './agentLogger.js';

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8100';
const TIMEOUT_MS = parseInt(process.env.AGENT_SERVICE_TIMEOUT_MS || '120000');

const client = axios.create({
  baseURL: AGENT_SERVICE_URL,
  timeout: TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' }
});

function serializeContact(contact) {
  const p = contact.properties || {};
  return {
    name: contact.name,
    email: contact.email,
    phone: contact.phone || null,
    city: p.city || p['Città'] || p.location || null,
    address: p.full_address || p['Indirizzo'] || null,
    rating: p.rating || p.Rating || null,
    reviews: p.reviews_count || p.Recensioni || null,
    source: contact.source,
    category: p.category || p.business_type || null,
    website: p.site || p.Website || null,
    google_maps_link: p.google_maps_link || null,
    contact_person: p.contact_person || null
  };
}

function serializeMessages(messages) {
  return (messages || []).map(m => ({
    role: m.role,
    content: m.content,
    channel: m.channel || 'email',
    created_at: m.createdAt?.toISOString?.() || null
  }));
}

export async function callAgentProcess({
  contact, conversation, leadMessage, category, confidence, extracted, fromEmail
}) {
  const identity = conversation.agentIdentity || { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' };

  const payload = {
    contact: serializeContact(contact),
    rank_checker_data: contact.rankCheckerData || null,
    conversation_id: conversation._id.toString(),
    messages: serializeMessages(conversation.messages),
    stage: conversation.stage || 'initial_reply',
    lead_source: conversation.context?.leadSource || 'smartlead_outbound',
    lead_message: leadMessage,
    classification: {
      category: category || 'NEUTRAL',
      confidence: confidence || 0.5,
      extracted: extracted || {}
    },
    smartlead_data: conversation.context?.smartleadData ? {
      campaign_id: String(conversation.context.smartleadData.campaignId || ''),
      lead_id: String(conversation.context.smartleadData.leadId || ''),
      sequence_number: null
    } : null,
    existing_objections: conversation.context?.objections || [],
    existing_pain_points: conversation.context?.painPoints || [],
    conversation_summary: conversation.context?.conversationSummary || null,
    is_first_contact: false,
    agent_identity: { name: identity.name, surname: identity.surname, role: identity.role }
  };

  agentLogger.info('agent_service_call', {
    conversationId: conversation._id,
    data: { endpoint: '/agent/process', contact: contact.email }
  });

  const response = await client.post('/agent/process', payload);
  return response.data;
}

export async function callAgentProactive({ task, contact, conversation }) {
  const identity = conversation?.agentIdentity || { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' };

  const payload = {
    task_type: task.type,
    contact: serializeContact(contact),
    conversation_id: conversation?._id?.toString() || null,
    messages: serializeMessages(conversation?.messages || []),
    lead_source: contact.source || 'smartlead_outbound',
    rank_checker_data: contact.rankCheckerData || null,
    smartlead_data: conversation?.context?.smartleadData ? {
      campaign_id: String(conversation.context.smartleadData.campaignId || ''),
      lead_id: String(conversation.context.smartleadData.leadId || '')
    } : null,
    agent_identity: { name: identity.name, surname: identity.surname, role: identity.role },
    task_context: task.context || {},
    previous_insights: conversation?.context ? {
      objections: conversation.context.objections || [],
      pain_points: conversation.context.painPoints || []
    } : null,
    days_since_last_contact: conversation?.updatedAt
      ? Math.floor((Date.now() - new Date(conversation.updatedAt).getTime()) / (24 * 60 * 60 * 1000))
      : null,
    last_outcome: conversation?.outcome || null
  };

  agentLogger.info('agent_service_call', {
    conversationId: conversation?._id,
    data: { endpoint: '/agent/proactive', type: task.type, contact: contact.email }
  });

  const response = await client.post('/agent/proactive', payload);
  return response.data;
}

export async function callAgentResume({ threadId, updatedContext }) {
  agentLogger.info('agent_service_call', {
    data: { endpoint: '/agent/resume', thread_id: threadId }
  });

  const response = await client.post('/agent/resume', {
    thread_id: threadId,
    updated_context: updatedContext || {}
  });
  return response.data;
}

export async function checkAgentHealth() {
  try {
    const response = await client.get('/health', { timeout: 5000 });
    return response.data?.status === 'ok';
  } catch {
    return false;
  }
}

export default { callAgentProcess, callAgentProactive, callAgentResume, checkAgentHealth };
