import Contact from '../models/contactModel.js';
import User from '../models/userModel.js';
import Activity from '../models/activityModel.js';
import { classifyReply } from '../services/replyClassifierService.js';
import { updateLeadCategory, resumeLead, mapAiCategoryToSmartlead, extractLeadId, stripHtml } from '../services/smartleadApiService.js';
import { sendSmartleadInterestedNotification } from '../services/emailNotificationService.js';

/**
 * Controller per i webhook Smartlead
 * Flusso: Webhook → AI classifica → mappa campi → crea/aggiorna contatto CRM
 * 
 * Nessun intermediario: i dati dal webhook vengono mappati direttamente al modello Contact
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPER: Mappa dati webhook Smartlead → modello Contact CRM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Estrae e mappa tutti i campi dal payload webhook Smartlead al formato CRM
 */
const mapWebhookToContact = (webhookData) => {
  // Dati lead dal webhook (Smartlead invia in vari formati)
  const leadData = webhookData.lead_data || webhookData.lead || {};
  const customFields = leadData.custom_fields || {};

  // Nome: priorità company_name > first+last > to_name
  const firstName = leadData.first_name || webhookData.first_name || '';
  const lastName = leadData.last_name || webhookData.last_name || '';
  const companyName = leadData.company_name || webhookData.company_name || customFields.company_name || '';
  const fullName = companyName || [firstName, lastName].filter(Boolean).join(' ') || webhookData.to_name || 'Lead Smartlead';

  // Email
  const email = (webhookData.to_email || webhookData.to || leadData.email || '').toLowerCase().trim();

  // Telefono: dal lead_data o da custom_fields
  const phone = leadData.phone_number || customFields.phone || customFields.Phone || customFields.phone_number || null;

  // Website
  const website = leadData.website || customFields.website || customFields.Website || customFields.site || null;

  // Location
  const location = leadData.location || customFields.location || customFields.Location || customFields.city || customFields.City || null;

  // LinkedIn
  const linkedin = leadData.linkedin_profile || customFields.linkedin || customFields.LinkedIn || null;

  // Campagna e lead ID (Smartlead usa sl_email_lead_id nel webhook, non lead_id)
  const campaignId = webhookData.campaign_id;
  const campaignName = webhookData.campaign_name;
  const leadId = extractLeadId(webhookData);

  // Costruisci properties dal webhook (tutti i campi utili)
  const properties = {};

  if (website) properties.site = website;
  if (location) properties.location = location;
  if (linkedin) properties.linkedin = linkedin;
  if (firstName) properties.first_name = firstName;
  if (lastName) properties.last_name = lastName;
  if (companyName && companyName !== fullName) properties.company_name = companyName;

  // Mappa tutti i custom_fields di Smartlead nelle properties
  for (const [key, value] of Object.entries(customFields)) {
    if (value && typeof value === 'string' && value.trim() && value !== '--') {
      const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
      properties[`smartlead_${normalizedKey}`] = value;
    }
  }

  // Metadata campagna
  properties.smartlead_campaign_id = campaignId;
  properties.smartlead_campaign_name = campaignName;
  properties.smartlead_lead_id = leadId;
  properties.smartlead_imported_at = new Date().toISOString();

  return {
    name: fullName,
    email,
    phone,
    website,
    location,
    linkedin,
    properties,
    campaignId,
    campaignName,
    leadId,
    customFields
  };
};

/**
 * Crea o aggiorna un contatto nel CRM direttamente dal webhook
 */
const createOrUpdateCrmContact = async (mappedData, status, activityData = null) => {
  const { name, email, phone, properties } = mappedData;

  if (!email) {
    console.warn('⚠️ Email mancante nel webhook, impossibile creare contatto');
    return null;
  }

  // Trova owner di default
  let defaultOwner;
  if (process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL) {
    defaultOwner = await User.findOne({ email: process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL.toLowerCase() });
  }
  if (!defaultOwner) {
    defaultOwner = await User.findOne({ role: { $in: ['admin', 'manager'] }, isActive: true }).sort({ createdAt: 1 });
  }
  if (!defaultOwner) {
    throw new Error('Nessun owner disponibile nel CRM');
  }

  let contact = await Contact.findOne({ email });
  let isNew = false;

  if (contact) {
    console.log(`🔄 Contatto esistente: ${contact.name} (${email})`);

    // Aggiungi alla lista Smartlead se non presente
    if (!contact.lists.includes('Smartlead Outbound Email')) {
      contact.lists.push('Smartlead Outbound Email');
    }

    // Aggiorna source solo se era manual
    if (contact.source === 'manual') contact.source = 'smartlead_outbound';

    // Aggiorna telefono se mancante
    if (!contact.phone && phone) contact.phone = phone;

    // Aggiorna status: solo se il nuovo è "più avanzato" o è "interessato"
    const hierarchy = ['da contattare', 'contattato', 'da richiamare', 'interessato', 'non interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'];
    const currentIdx = hierarchy.indexOf(contact.status);
    const newIdx = hierarchy.indexOf(status);
    if (newIdx > currentIdx || status === 'interessato') {
      contact.status = status;
      if (['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'].includes(status)) {
        if (contact.mrr === undefined || contact.mrr === null) contact.mrr = 0;
      }
    }

    // Merge properties
    contact.properties = { ...contact.properties, ...properties };
    contact.lastModifiedBy = defaultOwner._id;
    await contact.save();

  } else {
    console.log(`🆕 Nuovo contatto: ${name} (${email})`);
    isNew = true;

    contact = new Contact({
      name,
      email,
      phone: phone || undefined,
      lists: ['Smartlead Outbound Email'],
      status,
      mrr: ['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'].includes(status) ? 0 : undefined,
      source: 'smartlead_outbound',
      properties,
      owner: defaultOwner._id,
      createdBy: defaultOwner._id
    });
    await contact.save();

    await defaultOwner.updateStats({ newContact: true });
    await defaultOwner.save();
  }

  // Crea attività se fornita
  if (activityData) {
    try {
      const activity = new Activity({
        contact: contact._id,
        type: activityData.type || 'email',
        title: activityData.title || 'Attività da Smartlead',
        description: activityData.description || '',
        data: activityData.data || {},
        createdBy: defaultOwner._id
      });
      await activity.save();
      console.log(`📝 Attività creata: ${activity._id}`);
    } catch (err) {
      console.error('❌ Errore creazione attività:', err.message);
    }
  }

  return { contact, isNew };
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HANDLER PRINCIPALE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /api/inbound/smartlead-webhook
 * Handler principale per tutti i webhook Smartlead
 */
export const handleSmartleadWebhook = async (req, res) => {
  try {
    const webhookData = req.body;
    const eventType = webhookData.event_type;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📨 WEBHOOK SMARTLEAD: ${eventType}`);
    console.log(`   to_email: ${webhookData.to_email}, sl_email_lead_id: ${webhookData.sl_email_lead_id}, campaign_id: ${webhookData.campaign_id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    switch (eventType) {
      case 'EMAIL_REPLY':
        await handleEmailReply(webhookData);
        break;

      case 'LEAD_CATEGORY_UPDATED':
        await handleLeadCategoryUpdated(webhookData);
        break;

      case 'EMAIL_SENT':
        console.log(`📧 EMAIL_SENT per: ${webhookData.to_email || webhookData.to} — solo log`);
        break;

      default:
        console.log(`ℹ️ Evento non gestito: ${eventType}`);
    }

    return res.status(200).json({ success: true, message: `${eventType} processed` });

  } catch (error) {
    console.error('❌ Errore webhook Smartlead:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMAIL_REPLY: AI classifica → Smartlead API → CRM → notifica
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const handleEmailReply = async (webhookData) => {
  const mapped = mapWebhookToContact(webhookData);
  const replyMessage = webhookData.reply_message || {};
  const replyBody = replyMessage.html || webhookData.reply_body || '';
  const replyText = replyMessage.text || webhookData.preview_text || stripHtml(replyBody);
  const subject = webhookData.subject;

  console.log(`💬 EMAIL_REPLY da: ${mapped.email}`);
  console.log(`   Nome: ${mapped.name}`);
  console.log(`   Campagna: ${mapped.campaignName} (ID: ${mapped.campaignId})`);
  console.log(`   Lead ID Smartlead: ${mapped.leadId || 'N/A'}`);
  console.log(`   Preview: ${replyText.substring(0, 150)}...`);

  // 1. Classifica con AI
  const aiResult = await classifyReply(replyText, {
    restaurantName: mapped.name,
    campaignName: mapped.campaignName,
    subject
  });

  const { category, confidence, reason, shouldStopSequence } = aiResult;
  const emoji = category === 'INTERESTED' ? '✨' : category === 'NOT_INTERESTED' ? '🚫' : '📋';

  console.log(`${emoji} AI: ${category} (${(confidence * 100).toFixed(0)}%) — ${reason}`);
  console.log(`   Stop sequenza: ${shouldStopSequence ? 'SÌ' : 'NO'}`);

  // 2. Aggiorna categoria su Smartlead via API
  const { smartleadCategory, shouldPause } = mapAiCategoryToSmartlead(category);
  if (smartleadCategory && mapped.campaignId && mapped.leadId) {
    const slResult = await updateLeadCategory(mapped.campaignId, mapped.leadId, smartleadCategory, shouldPause);
    if (slResult.success) {
      console.log(`✅ Smartlead: ${smartleadCategory}${shouldPause ? ' + sequenza fermata' : ''}`);
    } else {
      console.warn(`⚠️ Smartlead update fallito: ${slResult.reason || slResult.error}`);
    }
  }

  // 3. Azioni in base alla categoria
  if (category === 'INTERESTED') {
    // Crea/aggiorna contatto CRM come "interessato"
    const result = await createOrUpdateCrmContact(mapped, 'interessato', {
      type: 'email',
      title: '✨ Lead INTERESSATO (AI) — Risposta positiva',
      description: `Campagna: ${mapped.campaignName}\n\n🤖 AI: ${category} (${(confidence * 100).toFixed(0)}%)\nMotivo: ${reason}\n\nRisposta:\n${replyText}`,
      data: {
        emailSubject: subject,
        campaignId: mapped.campaignId,
        campaignName: mapped.campaignName,
        aiClassification: { category, confidence, reason },
        replyText: replyText.substring(0, 2000),
        repliedAt: webhookData.event_timestamp
      }
    });

    if (result) {
      console.log(`${result.isNew ? '🆕' : '🔄'} CRM: contatto ${result.contact.name} → interessato`);
    }

    // Invia notifica email al team
    const emailResult = await sendSmartleadInterestedNotification({
      email: mapped.email,
      name: mapped.name,
      phone: mapped.phone,
      campaignName: mapped.campaignName,
      replyText,
      aiClassification: { category, confidence, reason },
      subject,
      website: mapped.website,
      location: mapped.location,
      customFields: mapped.customFields
    });
    if (emailResult.success) console.log(`📧 Notifica team inviata!`);

  } else if (category === 'NOT_INTERESTED') {
    // Crea/aggiorna contatto CRM come "non interessato" (per tracking)
    await createOrUpdateCrmContact(mapped, 'non interessato', {
      type: 'email',
      title: '🚫 Lead NON INTERESSATO (AI)',
      description: `Campagna: ${mapped.campaignName}\n\n🤖 AI: ${category} (${(confidence * 100).toFixed(0)}%)\nMotivo: ${reason}\n\nRisposta:\n${replyText}`,
      data: {
        emailSubject: subject,
        campaignId: mapped.campaignId,
        campaignName: mapped.campaignName,
        aiClassification: { category, confidence, reason },
        replyText: replyText.substring(0, 2000),
        repliedAt: webhookData.event_timestamp
      }
    });
    console.log(`🚫 CRM: contatto salvato come non interessato`);

  } else {
    // OUT_OF_OFFICE: nessuna azione CRM
    // Smartlead potrebbe aver gia fermato la sequenza al ricevimento della reply
    // (se stop_lead_settings = "REPLY_TO_AN_EMAIL"), quindi RESUME per far continuare
    console.log(`📋 OUT_OF_OFFICE — riattivo la sequenza su Smartlead`);

    if (mapped.campaignId && mapped.leadId) {
      // 1. Imposta categoria "Out Of Office" senza pausa
      await updateLeadCategory(mapped.campaignId, mapped.leadId, 'Out Of Office', false);
      // 2. Resume esplicito per riattivare la sequenza
      const resumeResult = await resumeLead(mapped.campaignId, mapped.leadId);
      if (resumeResult.success) {
        console.log(`▶️ Sequenza riattivata per lead ${mapped.leadId}`);
      } else {
        console.warn(`⚠️ Resume fallito: ${resumeResult.reason || resumeResult.error}`);
      }
    }
  }

  console.log(`✅ EMAIL_REPLY processato [${mapped.email} → ${category}]`);
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LEAD_CATEGORY_UPDATED: gestisce cambio categoria manuale su Smartlead
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const handleLeadCategoryUpdated = async (webhookData) => {
  const mapped = mapWebhookToContact(webhookData);
  const leadCategory = webhookData.lead_category || {};
  const newCategoryName = leadCategory.new_name || webhookData.category || '';
  const oldCategoryName = leadCategory.old_name || '';
  const lastReply = webhookData.last_reply || webhookData.lastReply || {};

  console.log(`🏷️ LEAD_CATEGORY_UPDATED: ${mapped.email}`);
  console.log(`   ${oldCategoryName || 'N/A'} → ${newCategoryName}`);

  const categoryLower = newCategoryName.toLowerCase();

  if (categoryLower === 'interested') {
    const result = await createOrUpdateCrmContact(mapped, 'interessato', {
      type: 'email',
      title: 'Lead categorizzato come INTERESSATO (Smartlead)',
      description: `Categoria cambiata: ${oldCategoryName || 'N/A'} → ${newCategoryName}\nCampagna: ${mapped.campaignName}\n\nUltima risposta:\n${lastReply.email_body ? stripHtml(lastReply.email_body).substring(0, 500) : 'N/A'}`,
      data: { campaignId: mapped.campaignId, campaignName: mapped.campaignName, oldCategory: oldCategoryName, newCategory: newCategoryName }
    });
    if (result) console.log(`✅ CRM: ${result.isNew ? 'creato' : 'aggiornato'} come interessato`);

  } else if (['not interested', 'not_interested', 'do not contact', 'do_not_contact'].includes(categoryLower)) {
    await createOrUpdateCrmContact(mapped, 'non interessato', {
      type: 'status_change',
      title: `Lead NON INTERESSATO (Smartlead: ${newCategoryName})`,
      description: `Campagna: ${mapped.campaignName}\nCategoria: ${oldCategoryName || 'N/A'} → ${newCategoryName}`,
      data: { campaignId: mapped.campaignId, campaignName: mapped.campaignName, oldCategory: oldCategoryName, newCategory: newCategoryName }
    });
    console.log(`🚫 CRM: contatto salvato come non interessato`);

  } else {
    console.log(`ℹ️ Categoria "${newCategoryName}" — nessuna azione CRM specifica`);
  }
};

export default { handleSmartleadWebhook };
