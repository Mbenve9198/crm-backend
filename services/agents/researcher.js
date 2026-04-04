import { toolSearchSimilarClients, toolResearchBusiness } from '../agentToolsService.js';
import { fetchMessageHistory, fetchLeadByEmail, stripHtml } from '../smartleadApiService.js';
import agentLogger from '../agentLogger.js';

export async function gather(contact, conversation, leadMessage) {
  const data = {
    contact: extractContactData(contact),
    ranking: null,
    competitors: [],
    similarClients: [],
    fallbackCaseStudies: [],
    emailHistory: [],
    sequenceNumber: null,
    googleMaps: null
  };

  if (contact.rankCheckerData) {
    const rc = contact.rankCheckerData;
    data.ranking = {
      keyword: rc.keyword,
      mainRank: rc.ranking?.mainRank,
      competitorsAhead: rc.ranking?.competitorsAhead,
      estimatedLostCustomers: rc.ranking?.estimatedLostCustomers,
      dailyCovers: rc.dailyCovers,
      hasDigitalMenu: rc.hasDigitalMenu,
      estimatedMonthlyReviews: rc.estimatedMonthlyReviews
    };
    data.competitors = (rc.ranking?.fullResults?.competitors || []).slice(0, 3).map(c => ({
      name: c.name,
      rank: c.rank,
      rating: c.rating,
      reviews: c.reviews
    }));
  }

  if (!data.contact.rating || !data.contact.reviews) {
    try {
      const businessName = contact.name;
      const city = data.contact.city;
      if (businessName && city) {
        const gmData = await toolResearchBusiness({ business_name: businessName, city });
        if (gmData && !gmData.error) {
          data.googleMaps = gmData;
          if (!data.contact.rating && gmData.rating) data.contact.rating = gmData.rating;
          if (!data.contact.reviews && gmData.reviews) data.contact.reviews = gmData.reviews;
        }
      }
    } catch (err) {
      agentLogger.warn('researcher_serpapi_error', { data: err.message });
    }
  }

  try {
    const cuisineType = data.contact.category || data.googleMaps?.type || 'ristorante';
    const city = data.contact.city;
    const result = await toolSearchSimilarClients({ cuisine_type: cuisineType, city: city || undefined });
    if (result?.clients?.length > 0) {
      data.similarClients = result.clients;
    }
    if (result?.fallback_case_studies?.length > 0) {
      data.fallbackCaseStudies = result.fallback_case_studies;
    }
  } catch (err) {
    agentLogger.warn('researcher_similar_clients_error', { data: err.message });
  }

  const slData = conversation.context?.smartleadData;
  if (slData?.campaignId && slData?.leadId) {
    try {
      const history = await fetchMessageHistory(slData.campaignId, slData.leadId);
      if (history && history.length > 0) {
        data.emailHistory = history.slice(-5).map(msg => ({
          type: msg.type === 'SENT' ? 'NOI' : 'LEAD',
          subject: msg.subject || '',
          body: stripHtml(msg.email_body || '').substring(0, 400)
        }));
      }

      const slLead = await fetchLeadByEmail(contact.email);
      if (slLead?.lead_campaign_data?.[0]?.last_email_sequence_sent) {
        data.sequenceNumber = slLead.lead_campaign_data[0].last_email_sequence_sent;
      }
    } catch {
      // non bloccante
    }
  }

  return data;
}

function extractContactData(contact) {
  const p = contact.properties || {};
  return {
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    city: p.city || p['Città'] || p.location || '',
    address: p.full_address || p['Indirizzo'] || '',
    rating: p.rating || p.Rating || null,
    reviews: p.reviews_count || p.Recensioni || null,
    googleMapsLink: p.google_maps_link || '',
    website: p.site || p.Website || '',
    category: p.category || p.business_type || '',
    source: contact.source,
    contactPerson: p.contact_person || ''
  };
}

export function summarizeDataForReviewer(data) {
  const parts = [];
  parts.push(`Nome: ${data.contact.name}`);
  if (data.contact.phone) parts.push(`Telefono: ${data.contact.phone}`);
  if (data.contact.rating) parts.push(`Rating: ${data.contact.rating}`);
  if (data.contact.reviews) parts.push(`Recensioni: ${data.contact.reviews}`);
  if (data.ranking?.mainRank) parts.push(`Posizione Maps: ${data.ranking.mainRank} per "${data.ranking.keyword}"`);
  if (data.ranking?.estimatedLostCustomers) parts.push(`Clienti persi/settimana: ~${data.ranking.estimatedLostCustomers}`);
  if (data.ranking?.dailyCovers) parts.push(`Coperti/giorno: ${data.ranking.dailyCovers}`);
  data.competitors.forEach(c => parts.push(`Competitor: ${c.name} (pos ${c.rank}, ${c.reviews} rec)`));
  data.similarClients.forEach(c => parts.push(`Cliente MenuChat: ${c.name} (${c.city}) — ${c.reviewsGained} rec in ${c.monthsActive} mesi`));
  data.fallbackCaseStudies.forEach(c => parts.push(`Case study: ${c.name} (${c.city}) — ${c.result}`));
  return parts.join('\n');
}

export default { gather, summarizeDataForReviewer };
