import axios from 'axios';
import agentLogger from './agentLogger.js';
import Call from '../models/callModel.js';
import Activity from '../models/activityModel.js';

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8100';
const TIMEOUT_MS = parseInt(process.env.AGENT_SERVICE_TIMEOUT_MS || '120000');

const client = axios.create({
  baseURL: AGENT_SERVICE_URL,
  timeout: TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' }
});

function serializeContact(contact) {
  const p = contact.properties || {};
  const rc = contact.rankCheckerData || {};
  const rcRestaurant = rc.restaurantData || {};

  return {
    name: contact.name,
    email: contact.email,
    phone: contact.phone || null,
    city: p.city || p['Città'] || p.location || _extractCityFromAddress(rcRestaurant.address) || null,
    address: p.full_address || p['Indirizzo'] || rcRestaurant.address || null,
    rating: p.rating || p.Rating || rcRestaurant.rating || null,
    reviews: p.reviews_count || p.Recensioni || rcRestaurant.reviewCount || null,
    source: contact.source,
    category: p.category || p.business_type || null,
    website: p.site || p.Website || null,
    google_maps_link: p.google_maps_link || p.googleMapsUrl || null,
    contact_person: p.contact_person || p.contactName || null,
    place_id: rc.placeId || null,
    coordinates: rcRestaurant.coordinates || null,
    call_requested: p.callRequested || false,
    call_preference: p.callPreference || null,
    status: contact.status || null,
    notes: p.notes || null,
    callback_at: p.callbackAt || null,
    callback_note: p.callbackNote || null,
  };
}

async function buildCrmEnrichment(contactId, conversation) {
  const enrichment = {};

  try {
    const calls = await Call.find({ contact: contactId })
      .populate('initiatedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    if (calls.length > 0) {
      enrichment.call_history = calls.map(c => ({
        date: c.createdAt?.toISOString?.() || c.startTime?.toISOString?.() || null,
        duration_seconds: c.duration || 0,
        outcome: c.outcome || null,
        notes: c.notes || null,
        transcript: c.transcript || null,
        initiated_by: c.initiatedBy
          ? `${c.initiatedBy.firstName || ''} ${c.initiatedBy.lastName || ''}`.trim()
          : null,
      }));
    }

    const activities = await Activity.find({ contact: contactId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    if (activities.length > 0) {
      const callActs = activities.filter(a => a.type === 'call');
      const statusChanges = activities
        .filter(a => a.type === 'status_change' && a.data?.statusChange)
        .map(a => `${a.data.statusChange.oldStatus} → ${a.data.statusChange.newStatus}`);

      enrichment.activity_summary = {
        total_activities: activities.length,
        calls_made: callActs.length,
        calls_answered: callActs.filter(a =>
          a.data?.callOutcome && !['no-answer', 'busy'].includes(a.data.callOutcome)
        ).length,
        last_call_date: callActs[0]?.createdAt?.toISOString?.() || null,
        last_call_outcome: callActs[0]?.data?.callOutcome || null,
        notes_count: activities.filter(a => a.type === 'note').length,
        emails_count: activities.filter(a => a.type === 'email').length,
        whatsapp_count: activities.filter(a => a.type === 'whatsapp').length,
        status_changes: statusChanges.length > 0 ? statusChanges : undefined,
      };
    }
  } catch (err) {
    agentLogger.warn('crm_enrichment_error', { data: { contactId, error: err.message } });
  }

  if (conversation?.context) {
    if (conversation.context.humanNotes?.length > 0) {
      enrichment.human_notes = conversation.context.humanNotes.map(n => ({
        note: n.note,
        date: n.at?.toISOString?.() || null,
      }));
    }
    if (conversation.context.conversationSummary) {
      enrichment.conversation_summary = conversation.context.conversationSummary;
    }
  }

  return Object.keys(enrichment).length > 0 ? enrichment : null;
}

function serializeRankCheckerData(contact) {
  const rc = contact.rankCheckerData;
  if (!rc) return null;

  const ranking = rc.ranking || {};
  const fullResults = ranking.fullResults || {};

  return {
    keyword: rc.keyword,
    dailyCovers: rc.dailyCovers,
    hasDigitalMenu: rc.hasDigitalMenu,
    estimatedMonthlyReviews: rc.estimatedMonthlyReviews,
    placeId: rc.placeId,
    ranking: {
      mainRank: ranking.mainRank,
      competitorsAhead: ranking.competitorsAhead,
      estimatedLostCustomers: ranking.estimatedLostCustomers,
      fullResults: {
        userRestaurant: fullResults.userRestaurant || null,
        competitors: (fullResults.competitors || fullResults.mainResult?.competitors || []).slice(0, 5).map(c => ({
          name: c.name,
          rank: c.rank,
          rating: c.rating,
          reviews: c.reviews,
          place_id: c.place_id,
        })),
        mainResult: fullResults.mainResult ? {
          rank: fullResults.mainResult.rank,
          coordinates: fullResults.mainResult.coordinates,
        } : null,
      },
    },
    restaurantData: {
      address: rc.restaurantData?.address || null,
      rating: rc.restaurantData?.rating || null,
      reviewCount: rc.restaurantData?.reviewCount || null,
      coordinates: rc.restaurantData?.coordinates || null,
    },
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

function _extractCityFromAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const parts = address.split(',');
  if (parts.length >= 2) {
    const cityPart = parts[parts.length - 2].trim();
    const tokens = cityPart.split(' ').filter(t => t.length > 2 && !/^\d+$/.test(t));
    return tokens.join(' ') || null;
  }
  return null;
}

export async function callAgentProcess({
  contact, conversation, leadMessage, category, confidence, extracted, fromEmail
}) {
  const identity = conversation.agentIdentity || { name: 'Marco', surname: 'Benvenuti', role: 'co-founder' };
  const contactId = contact._id || conversation.contact;

  const crmEnrichment = await buildCrmEnrichment(contactId, conversation);

  const payload = {
    contact: serializeContact(contact),
    rank_checker_data: serializeRankCheckerData(contact),
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
    agent_identity: { name: identity.name, surname: identity.surname, role: identity.role },
    crm_enrichment: crmEnrichment,
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
  const contactId = contact._id || task.contact;

  const crmEnrichment = await buildCrmEnrichment(contactId, conversation);

  const payload = {
    task_type: task.type,
    contact: serializeContact(contact),
    conversation_id: conversation?._id?.toString() || null,
    messages: serializeMessages(conversation?.messages || []),
    lead_source: contact.source || 'smartlead_outbound',
    rank_checker_data: serializeRankCheckerData(contact),
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
    last_outcome: conversation?.outcome || null,
    crm_enrichment: crmEnrichment,
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

export async function sendFeedbackToAgent({ conversation, contact, agentDraft, finalSent, action, channel, modifications, discardReason, discardNotes }) {
  const contactObj = typeof contact === 'object' ? contact : null;
  const payload = {
    conversation_id: conversation?._id?.toString() || conversation?.toString() || '',
    contact_email: contactObj?.email || '',
    agent_draft: agentDraft || '',
    final_sent: finalSent || null,
    action,
    channel: channel || 'email',
    lead_profile: contactObj ? {
      category: contactObj.properties?.category || contactObj.properties?.business_type || null,
      city: contactObj.properties?.city || contactObj.properties?.location || null,
      source: contactObj.source || null,
      status: contactObj.status || null,
      rating: contactObj.properties?.rating || contactObj.rankCheckerData?.restaurantData?.rating || null,
      reviews: contactObj.properties?.reviews_count || contactObj.rankCheckerData?.restaurantData?.reviewCount || null,
    } : {},
    conversation_context: {},
    modifications: modifications || null,
    discard_reason: discardReason || null,
    discard_notes: discardNotes || null,
  };

  try {
    const response = await client.post('/memory/feedback', payload, { timeout: 15000 });
    agentLogger.info('agent_memory_feedback_sent', {
      data: { action, conversationId: payload.conversation_id, contact: payload.contact_email }
    });
    return response.data;
  } catch (err) {
    agentLogger.warn('agent_memory_feedback_failed', {
      data: { action, error: err.message }
    });
    return null;
  }
}

export async function callAgentPlan(event) {
  agentLogger.info('agent_service_call', {
    data: { endpoint: '/agent/plan', eventType: event.type, contact: event.contact?.email }
  });

  try {
    const response = await client.post('/agent/plan', event, { timeout: 30000 });
    return response.data;
  } catch (err) {
    agentLogger.warn('agent_plan_failed', {
      data: { eventType: event.type, error: err.message }
    });
    return { actions: [], reasoning: `Error: ${err.message}`, confidence: 0 };
  }
}

export async function callAgentSalesManager(reportData) {
  agentLogger.info('agent_service_call', {
    data: { endpoint: '/agent/sales-manager', keys: Object.keys(reportData) }
  });

  try {
    const response = await client.post('/agent/sales-manager', reportData, { timeout: 180000 });
    return response.data;
  } catch (err) {
    agentLogger.error('sales_manager_call_failed', {
      data: { error: err.message }
    });
    return {
      directives: [],
      briefing: { headline: 'Errore', summary: err.message },
      alerts: [],
      performance: {},
      error: err.message,
    };
  }
}

export async function callMemoryConsolidate() {
  try {
    const response = await client.post('/memory/consolidate', {}, { timeout: 60000 });
    return response.data;
  } catch (err) {
    agentLogger.warn('memory_consolidate_failed', { data: { error: err.message } });
    return null;
  }
}

export async function checkAgentHealth() {
  try {
    const response = await client.get('/health', { timeout: 5000 });
    return response.data?.status === 'ok';
  } catch {
    return false;
  }
}

export default {
  callAgentProcess, callAgentProactive, callAgentResume,
  sendFeedbackToAgent, callAgentPlan, callAgentSalesManager,
  callMemoryConsolidate, checkAgentHealth,
};
