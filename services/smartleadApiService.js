import axios from 'axios';

/**
 * Service per interagire con le API di Smartlead
 * Aggiorna categorie lead e gestisce pause sequenze
 * 
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
 * Aggiorna la categoria di un lead in una campagna e opzionalmente mette in pausa
 */
export const updateLeadCategory = async (campaignId, leadId, categoryName, pauseLead = false) => {
  try {
    if (!campaignId || !leadId) {
      console.warn('⚠️ campaignId o leadId mancante, skip aggiornamento Smartlead');
      return { success: false, reason: 'campaignId o leadId mancante' };
    }

    const categoryId = await getCategoryIdByName(categoryName);
    if (!categoryId) {
      console.warn(`⚠️ Categoria "${categoryName}" non trovata su Smartlead`);
      return { success: false, reason: `Categoria "${categoryName}" non trovata` };
    }

    console.log(`🏷️ Smartlead: lead ${leadId} → "${categoryName}" (pause: ${pauseLead})`);

    const response = await axios.post(
      buildUrl(`/campaigns/${campaignId}/leads/${leadId}/category`),
      { category_id: categoryId, pause_lead: pauseLead },
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );

    console.log(`✅ Categoria Smartlead aggiornata: lead ${leadId} → "${categoryName}"`);
    return { success: true, data: response.data, categoryId, categoryName, paused: pauseLead };
  } catch (error) {
    console.error('❌ Errore aggiornamento categoria Smartlead:', error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
};

/**
 * Mappa la categoria AI alla categoria Smartlead + azione sulla sequenza
 */
export const mapAiCategoryToSmartlead = (aiCategory) => {
  switch (aiCategory) {
    case 'INTERESTED': return { smartleadCategory: 'Interested', shouldPause: true };
    case 'NOT_INTERESTED': return { smartleadCategory: 'Not Interested', shouldPause: true };
    case 'OUT_OF_OFFICE': return { smartleadCategory: 'Out Of Office', shouldPause: false };
    default: return { smartleadCategory: null, shouldPause: false };
  }
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
  mapAiCategoryToSmartlead,
  stripHtml
};
