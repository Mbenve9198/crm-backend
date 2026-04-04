import axios from 'axios';

/**
 * Service per interagire con le API di Smartlead
 * Aggiorna categorie lead, gestisce pause/resume sequenze
 * 
 * Docs: https://server.smartlead.ai/api/v1
 * Rate limit: 10 requests ogni 2 secondi
 */

const SMARTLEAD_API_BASE = 'https://server.smartlead.ai/api/v1';

const getApiKey = () => {
  const key = process.env.SMARTLEAD_API_KEY;
  if (!key) throw new Error('SMARTLEAD_API_KEY non configurata');
  return key;
};

const buildUrl = (path) => `${SMARTLEAD_API_BASE}${path}?api_key=${getApiKey()}`;

// Cache categorie (TTL 1 ora)
let categoriesCache = null;
let categoriesCacheTime = null;

/**
 * Recupera le categorie disponibili su Smartlead
 */
export const fetchCategories = async () => {
  try {
    const response = await axios.get(buildUrl('/leads/fetch-categories'), { timeout: 15000 });
    return response.data;
  } catch (error) {
    console.error('❌ Errore fetch categorie Smartlead:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Ottiene l'ID della categoria per nome (con cache)
 */
export const getCategoryIdByName = async (categoryName) => {
  try {
    if (categoriesCache && categoriesCacheTime && (Date.now() - categoriesCacheTime < 3600000)) {
      const cached = categoriesCache.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
      return cached ? cached.id : null;
    }
    categoriesCache = await fetchCategories();
    categoriesCacheTime = Date.now();
    const category = categoriesCache.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
    return category ? category.id : null;
  } catch (error) {
    console.error('❌ Errore getCategoryIdByName:', error.message);
    return null;
  }
};

/**
 * Aggiorna la categoria di un lead in una campagna
 * POST /campaigns/{campaign_id}/leads/{lead_id}/category
 * 
 * @param {number} campaignId - ID campagna
 * @param {number} leadId - sl_email_lead_id dal webhook
 * @param {string} categoryName - "Interested", "Not Interested", "Out Of Office"
 * @param {boolean} pauseLead - true = ferma la sequenza
 */
export const updateLeadCategory = async (campaignId, leadId, categoryName, pauseLead = false) => {
  try {
    if (!campaignId || !leadId) {
      console.warn(`⚠️ campaignId (${campaignId}) o leadId (${leadId}) mancante, skip aggiornamento Smartlead`);
      return { success: false, reason: 'campaignId o leadId mancante' };
    }

    const categoryId = await getCategoryIdByName(categoryName);
    if (!categoryId) {
      console.warn(`⚠️ Categoria "${categoryName}" non trovata su Smartlead`);
      return { success: false, reason: `Categoria "${categoryName}" non trovata` };
    }

    console.log(`🏷️ Smartlead API: POST /campaigns/${campaignId}/leads/${leadId}/category → "${categoryName}" (id: ${categoryId}, pause: ${pauseLead})`);

    const response = await axios.post(
      buildUrl(`/campaigns/${campaignId}/leads/${leadId}/category`),
      { category_id: categoryId, pause_lead: pauseLead },
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );

    console.log(`✅ Categoria Smartlead aggiornata: lead ${leadId} → "${categoryName}"${pauseLead ? ' + lead in pausa' : ''}`);
    return { success: true, data: response.data, categoryId, categoryName, paused: pauseLead };
  } catch (error) {
    console.error('❌ Errore aggiornamento categoria Smartlead:', error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
};

/**
 * Riprende un lead messo in pausa (riattiva la sequenza)
 * POST /campaigns/{campaign_id}/leads/{lead_id}/resume
 * 
 * Usato per OUT_OF_OFFICE: Smartlead stoppa la sequenza su ogni reply,
 * ma noi vogliamo che continui se è solo un auto-reply.
 */
export const resumeLead = async (campaignId, leadId) => {
  try {
    if (!campaignId || !leadId) {
      console.warn(`⚠️ campaignId (${campaignId}) o leadId (${leadId}) mancante, skip resume`);
      return { success: false, reason: 'campaignId o leadId mancante' };
    }

    console.log(`▶️ Smartlead API: POST /campaigns/${campaignId}/leads/${leadId}/resume`);

    const response = await axios.post(
      buildUrl(`/campaigns/${campaignId}/leads/${leadId}/resume`),
      { resume_lead_with_delay_days: 0 },
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );

    console.log(`✅ Lead ${leadId} riattivato nella campagna ${campaignId}`);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('❌ Errore resume lead Smartlead:', error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
};

/**
 * Mappa la categoria AI alla categoria Smartlead + azione sulla sequenza
 */
export const mapAiCategoryToSmartlead = (aiCategory) => {
  switch (aiCategory) {
    case 'INTERESTED': return { smartleadCategory: 'Interested', shouldPause: true };
    case 'NEUTRAL': return { smartleadCategory: 'Information Request', shouldPause: true };
    case 'NOT_INTERESTED': return { smartleadCategory: 'Not Interested', shouldPause: true };
    case 'DO_NOT_CONTACT': return { smartleadCategory: 'Do Not Contact', shouldPause: true };
    case 'OUT_OF_OFFICE': return { smartleadCategory: 'Out Of Office', shouldPause: false };
    default: return { smartleadCategory: null, shouldPause: false };
  }
};

/**
 * Recupera la cronologia messaggi per un lead in una campagna
 * GET /campaigns/{campaign_id}/leads/{lead_id}/message-history
 */
export const fetchMessageHistory = async (campaignId, leadId) => {
  try {
    if (!campaignId || !leadId) return [];

    const response = await axios.get(
      buildUrl(`/campaigns/${campaignId}/leads/${leadId}/message-history`),
      { timeout: 15000 }
    );

    return response.data?.history || [];
  } catch (error) {
    console.error('❌ Errore fetch message history:', error.response?.data || error.message);
    return [];
  }
};

/**
 * Risponde in-thread a un lead tramite Smartlead.
 * Richiede email_stats_id (il campo stats_id dal message-history).
 * Se non fornito, lo recupera automaticamente.
 */
export const replyToEmailThread = async (campaignId, leadId, emailBody, emailStatsId) => {
  try {
    if (!campaignId || !emailBody) {
      return { success: false, reason: 'Parametri mancanti (campaignId, emailBody)' };
    }

    if (!emailStatsId && leadId) {
      const history = await fetchMessageHistory(campaignId, leadId);
      if (history.length > 0) {
        emailStatsId = history[history.length - 1].stats_id;
        console.log(`📋 email_stats_id recuperato dal message-history (ultimo): ${emailStatsId}`);
      }
    }

    if (!emailStatsId) {
      return { success: false, reason: 'email_stats_id non trovato — il lead potrebbe non avere messaggi nella campagna' };
    }

    const body = {
      email_stats_id: emailStatsId,
      email_body: emailBody,
      add_signature: true
    };

    console.log(`📧 Smartlead API: reply-email-thread (stats_id: ${emailStatsId})`);

    const response = await axios.post(
      buildUrl(`/campaigns/${campaignId}/reply-email-thread`),
      body,
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );

    console.log(`✅ Reply inviata via Smartlead thread`);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('❌ Errore reply-email-thread:', error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
};

/**
 * Recupera tutti i dati di un lead da Smartlead tramite email
 * GET /leads/?api_key=${API_KEY}&email=${email}
 * 
 * Restituisce: id, first_name, last_name, email, phone_number, company_name,
 *              website, location, custom_fields, linkedin_profile, lead_campaign_data
 */
export const fetchLeadByEmail = async (email) => {
  try {
    if (!email) return null;

    console.log(`🔍 Smartlead API: fetch lead by email ${email}`);

    const response = await axios.get(
      `${SMARTLEAD_API_BASE}/leads/?api_key=${getApiKey()}&email=${encodeURIComponent(email)}`,
      { timeout: 15000 }
    );

    if (response.data && response.data.email) {
      console.log(`✅ Lead trovato su Smartlead: ${response.data.company_name || response.data.email} (ID: ${response.data.id})`);
      return response.data;
    }

    console.log(`ℹ️ Lead non trovato su Smartlead per email: ${email}`);
    return null;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`ℹ️ Lead non trovato su Smartlead: ${email}`);
      return null;
    }
    console.error('❌ Errore fetch lead Smartlead:', error.response?.data || error.message);
    return null;
  }
};

/**
 * Estrae il lead ID corretto dal webhook payload
 * Smartlead usa campi diversi a seconda dell'evento:
 * - EMAIL_REPLY: sl_email_lead_id
 * - LEAD_CATEGORY_UPDATED: lead_id o sl_email_lead_id
 */
export const extractLeadId = (webhookData) => {
  return webhookData.sl_email_lead_id
    || webhookData.lead_id
    || webhookData.sl_lead_id
    || null;
};

/**
 * Estrae il testo pulito da HTML (utility)
 */
export const stripHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>.*<\/style>/gmi, '')
    .replace(/<script[^>]*>.*<\/script>/gmi, '')
    .replace(/<[^>]+>/gm, ' ')
    .replace(/\s\s+/g, ' ')
    .trim();
};

export default {
  fetchCategories,
  getCategoryIdByName,
  updateLeadCategory,
  resumeLead,
  fetchLeadByEmail,
  mapAiCategoryToSmartlead,
  extractLeadId,
  stripHtml,
  fetchMessageHistory,
  replyToEmailThread
};
