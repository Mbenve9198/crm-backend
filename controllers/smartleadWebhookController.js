import crypto from 'crypto';
import Contact from '../models/contactModel.js';
import User from '../models/userModel.js';
import Activity from '../models/activityModel.js';
import AssignmentState from '../models/assignmentStateModel.js';
import { classifyReply } from '../services/replyClassifierService.js';
import { updateLeadCategory, resumeLead, fetchLeadByEmail, mapAiCategoryToSmartlead, extractLeadId, stripHtml } from '../services/smartleadApiService.js';
import { sendSmartleadInterestedNotification } from '../services/emailNotificationService.js';
import { handleAgentConversation, routeLeadReply } from '../services/salesAgentService.js';

const processedWebhooks = new Map();
const DEDUP_TTL_MS = 10 * 60 * 1000;

const isDuplicate = (key) => {
  const now = Date.now();
  // Pulizia periodica delle entry scadute
  if (processedWebhooks.size > 500) {
    for (const [k, ts] of processedWebhooks) {
      if (now - ts > DEDUP_TTL_MS) processedWebhooks.delete(k);
    }
  }
  if (processedWebhooks.has(key) && now - processedWebhooks.get(key) < DEDUP_TTL_MS) {
    return true;
  }
  processedWebhooks.set(key, now);
  return false;
};

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
 * Estrae dati base dal webhook (disponibili immediatamente senza API call)
 */
const extractWebhookBasicData = (webhookData) => {
  const email = (webhookData.to_email || webhookData.to || '').toLowerCase().trim();
  const campaignId = webhookData.campaign_id;
  const campaignName = webhookData.campaign_name;
  const leadId = extractLeadId(webhookData);
  const toName = webhookData.to_name || '';

  return { email, campaignId, campaignName, leadId, toName };
};

/**
 * Mappa i dati completi del lead (da Smartlead API) al formato Contact CRM
 * 
 * Campi Smartlead → CRM:
 * - company_name → name
 * - email → email
 * - phone_number → phone
 * - custom_fields.location_link → properties.google_maps_link
 * - custom_fields.rating_prospect → properties.rating
 * - custom_fields.reviews_prospect → properties.reviews_count
 * - website → properties.site
 * - location → properties.location
 * - linkedin_profile → properties.linkedin
 * - custom_fields.* → properties.smartlead_*
 */
const mapLeadDataToContact = (smartleadLead, webhookBasic) => {
  const customFields = smartleadLead.custom_fields || {};

  // Nome: company_name > first+last > to_name dal webhook
  const firstName = smartleadLead.first_name || '';
  const lastName = smartleadLead.last_name || '';
  const companyName = smartleadLead.company_name || '';
  const fullName = companyName || [firstName, lastName].filter(Boolean).join(' ') || webhookBasic.toName || 'Lead Smartlead';

  // Telefono
  const phone = smartleadLead.phone_number || customFields.phone || customFields.Phone || null;

  // Website
  const website = smartleadLead.website || customFields.website || customFields.Website || null;

  // Location (testo) e Google Maps link (da custom_fields)
  const locationText = smartleadLead.location || customFields.city || customFields.City || null;
  const googleMapsLink = customFields.location_link || customFields.Location_Link || customFields.google_maps_link || null;

  // LinkedIn
  const linkedin = smartleadLead.linkedin_profile || customFields.linkedin || null;

  // Rating e recensioni (da custom_fields)
  const rating = customFields.rating_prospect || customFields.rating || null;
  const reviewsCount = customFields.reviews_prospect || customFields.reviews || customFields.reviews_count || null;

  // Properties per il CRM
  const properties = {};

  // Dati principali
  if (website) properties.site = website;
  if (locationText) properties.location = locationText;
  if (linkedin) properties.linkedin = linkedin;
  if (googleMapsLink) properties.google_maps_link = googleMapsLink;
  if (rating) properties.rating = rating;
  if (reviewsCount) properties.reviews_count = reviewsCount;
  if (firstName) properties.first_name = firstName;
  if (lastName) properties.last_name = lastName;
  if (companyName && companyName !== fullName) properties.company_name = companyName;

  // Mappa tutti i custom_fields nelle properties (escludi copy email lunghe per non inquinare)
  const skipFields = ['copy_email_1_final', 'copy_email_2', 'copy_email_3', 'copy_email_4',
    'outbound_email_final_def', 'follow_up_email_finale', 'break_up_email_final',
    'location_link', 'rating_prospect', 'reviews_prospect'];

  for (const [key, value] of Object.entries(customFields)) {
    const keyLower = key.toLowerCase();
    if (skipFields.some(s => keyLower.includes(s.toLowerCase()))) continue;
    if (value && typeof value === 'string' && value.trim() && value !== '--' && value.length < 500) {
      const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
      properties[`smartlead_${normalizedKey}`] = value;
    }
  }

  // Metadata campagna
  properties.smartlead_campaign_id = webhookBasic.campaignId;
  properties.smartlead_campaign_name = webhookBasic.campaignName;
  properties.smartlead_lead_id = webhookBasic.leadId || smartleadLead.id;
  properties.smartlead_imported_at = new Date().toISOString();

  return {
    name: fullName,
    email: webhookBasic.email,
    phone,
    website,
    location: locationText,
    googleMapsLink,
    rating,
    reviewsCount,
    linkedin,
    properties,
    campaignId: webhookBasic.campaignId,
    campaignName: webhookBasic.campaignName,
    leadId: webhookBasic.leadId || smartleadLead.id,
    customFields
  };
};

/**
 * Crea dati mappati dal solo webhook (fallback se fetch API fallisce)
 */
const mapWebhookOnlyToContact = (webhookBasic) => {
  return {
    name: webhookBasic.toName || 'Lead Smartlead',
    email: webhookBasic.email,
    phone: null,
    website: null,
    location: null,
    googleMapsLink: null,
    rating: null,
    reviewsCount: null,
    linkedin: null,
    properties: {
      smartlead_campaign_id: webhookBasic.campaignId,
      smartlead_campaign_name: webhookBasic.campaignName,
      smartlead_lead_id: webhookBasic.leadId,
      smartlead_imported_at: new Date().toISOString()
    },
    campaignId: webhookBasic.campaignId,
    campaignName: webhookBasic.campaignName,
    leadId: webhookBasic.leadId,
    customFields: {}
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

  // Trova owner di default (fallback generale)
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

  // Aggiorna status: solo se il nuovo è "più avanzato"
  const hierarchy = [
    'da contattare',
    'contattato',
    'da richiamare',
    'interessato',
    'ghosted/bad timing',
    'qr code inviato',
    'free trial iniziato',
    'won',
    'lost before free trial',
    'lost after free trial',
    'bad_data',
    'non_qualificato'
  ];
    const currentIdx = hierarchy.indexOf(contact.status);
    const newIdx = hierarchy.indexOf(status);
    if (newIdx > currentIdx) {
      contact.status = status;
      if (['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost before free trial', 'lost after free trial'].includes(status)) {
        if (contact.mrr === undefined || contact.mrr === null) contact.mrr = 0;
      }
    }

    // Merge properties
    contact.properties = { ...contact.properties, ...properties };
    contact.lastModifiedBy = defaultOwner._id;
    await contact.save();

  } else {
    // Se il lead è classificato come "lost before free trial", non creare un nuovo contatto in CRM
    if (status === 'lost before free trial') {
      console.log(`🚫 Smartlead: skip creazione nuovo contatto lost before free trial (${email})`);
      return null;
    }

    console.log(`🆕 Nuovo contatto: ${name} (${email})`);
    isNew = true;

    // Round robin per nuovi lead Smartlead
    let ownerForNewContact = defaultOwner;
    const isSmartleadLead = !!properties.smartlead_campaign_id;

    if (isSmartleadLead) {
      const roundRobinEmails = [
        'alessandro.totti@menuchat.it',
        'emanuele.funai@menuchat.it',
        'marco@menuchat.com'
      ];

      // Recupera utenti per le email configurate (filtra solo attivi)
      const owners = await User.find({
        email: { $in: roundRobinEmails },
        isActive: true
      }).sort({ createdAt: 1 });

      if (owners.length > 0) {
        // Allinea l'ordine degli owner a quello delle email
        const orderedOwners = roundRobinEmails
          .map(emailVal => owners.find(u => u.email === emailVal))
          .filter(Boolean);

        if (orderedOwners.length > 0) {
          // Legge/crea stato round robin
          const key = 'smartlead_round_robin';
          let state = await AssignmentState.findOne({ key });
          if (!state) {
            state = await AssignmentState.create({ key, lastIndex: -1 });
          }

          const nextIndex = (state.lastIndex + 1) % orderedOwners.length;
          ownerForNewContact = orderedOwners[nextIndex];

          state.lastIndex = nextIndex;
          await state.save();

          console.log(`🎯 Round robin Smartlead → owner: ${ownerForNewContact.email} (index: ${nextIndex})`);
        }
      }
    }

    contact = new Contact({
      name,
      email,
      phone: phone || undefined,
      lists: ['Smartlead Outbound Email'],
      status,
      mrr: ['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost before free trial', 'lost after free trial'].includes(status) ? 0 : undefined,
      source: 'smartlead_outbound',
      properties,
      owner: ownerForNewContact._id,
      createdBy: ownerForNewContact._id
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

    // Idempotency: deduplicazione webhook con chiave composita
    const dedupKey = crypto.createHash('md5').update(
      `${eventType}:${webhookData.campaign_id}:${webhookData.sl_email_lead_id || webhookData.to_email}:${webhookData.event_timestamp || ''}`
    ).digest('hex');
    if (isDuplicate(dedupKey)) {
      console.log(`⏭️ WEBHOOK DUPLICATO (skip): ${eventType} per ${webhookData.to_email}`);
      return res.status(200).json({ success: true, message: 'duplicate_skipped' });
    }

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
  const webhookBasic = extractWebhookBasicData(webhookData);
  const replyMessage = webhookData.reply_message || {};
  const replyBody = replyMessage.html || webhookData.reply_body || '';
  const replyText = replyMessage.text || webhookData.preview_text || stripHtml(replyBody);
  const subject = webhookData.subject;
  const fromEmail = webhookData.from_email || webhookData.from || '';

  console.log(`💬 EMAIL_REPLY da: ${webhookBasic.email}`);
  console.log(`   Nome (webhook): ${webhookBasic.toName}`);
  console.log(`   Campagna: ${webhookBasic.campaignName} (ID: ${webhookBasic.campaignId})`);
  console.log(`   Lead ID Smartlead: ${webhookBasic.leadId || 'N/A'}`);
  console.log(`   From (sender): ${fromEmail}`);
  console.log(`   Preview: ${replyText.substring(0, 150)}...`);

  // 1. Classifica con AI + estrai entità
  const aiResult = await classifyReply(replyText, {
    restaurantName: webhookBasic.toName,
    campaignName: webhookBasic.campaignName,
    subject
  });

  const { category, confidence, reason, shouldStopSequence, extracted } = aiResult;
  const emojiMap = { INTERESTED: '✨', NEUTRAL: '🔵', NOT_INTERESTED: '🚫', DO_NOT_CONTACT: '🛑', OUT_OF_OFFICE: '📋' };

  console.log(`${emojiMap[category] || '❓'} AI: ${category} (${(confidence * 100).toFixed(0)}%) — ${reason}`);
  console.log(`   Stop sequenza: ${shouldStopSequence ? 'SÌ' : 'NO'}`);
  if (extracted?.phone) console.log(`   📱 Telefono estratto dalla risposta: ${extracted.phone}`);
  if (extracted?.contactName) console.log(`   👤 Contatto estratto: ${extracted.contactName}`);

  // 2. Aggiorna categoria su Smartlead via API
  const { smartleadCategory, shouldPause } = mapAiCategoryToSmartlead(category);
  if (smartleadCategory && webhookBasic.campaignId && webhookBasic.leadId) {
    const slResult = await updateLeadCategory(webhookBasic.campaignId, webhookBasic.leadId, smartleadCategory, shouldPause);
    if (slResult.success) {
      console.log(`✅ Smartlead: ${smartleadCategory}${shouldPause ? ' + sequenza fermata' : ''}`);
    } else {
      console.warn(`⚠️ Smartlead update fallito: ${slResult.reason || slResult.error}`);
    }
  }

  const activityData = {
    emailSubject: subject,
    campaignId: webhookBasic.campaignId,
    campaignName: webhookBasic.campaignName,
    aiClassification: { category, confidence, reason },
    extractedEntities: extracted || {},
    replyText: replyText.substring(0, 2000),
    repliedAt: webhookData.event_timestamp,
    fromEmail
  };

  // 3. Azioni in base alla categoria
  if (category === 'INTERESTED') {
    console.log(`🔍 Recupero dati completi del lead da Smartlead...`);
    const smartleadLead = await fetchLeadByEmail(webhookBasic.email);

    let mapped;
    if (smartleadLead) {
      mapped = mapLeadDataToContact(smartleadLead, webhookBasic);
      console.log(`✅ Dati lead recuperati: ${mapped.name} | Tel: ${mapped.phone || 'N/A'} | Rating: ${mapped.rating || 'N/A'} | Recensioni: ${mapped.reviewsCount || 'N/A'}`);
    } else {
      console.warn(`⚠️ Impossibile recuperare dati da Smartlead, uso solo dati webhook`);
      mapped = mapWebhookOnlyToContact(webhookBasic);
    }

    // CRM hydration: popola dati estratti dalla risposta
    hydrateFromExtracted(mapped, extracted);

    const result = await createOrUpdateCrmContact(mapped, 'da contattare', {
      type: 'email',
      title: '✨ Lead INTERESSATO (AI) — Risposta positiva',
      description: `Campagna: ${mapped.campaignName}\n\n🤖 AI: ${category} (${(confidence * 100).toFixed(0)}%)\nMotivo: ${reason}\n\nRisposta:\n${replyText}`,
      data: activityData
    });

    if (result) {
      console.log(`${result.isNew ? '🆕' : '🔄'} CRM: contatto ${result.contact.name} → da contattare`);

      // Route to AI agent or direct handoff
      const routing = routeLeadReply(category, confidence, extracted, replyText);
      if (routing.action === 'direct_handoff') {
        console.log(`🎯 Direct handoff → team vendite (lead caldo con telefono)`);
      } else if (routing.action === 'agent') {
        try {
          const agentResult = await handleAgentConversation({
            contact: result.contact,
            replyText,
            category,
            confidence,
            extracted,
            fromEmail,
            webhookBasic
          });
          console.log(`🤖 Agent: ${agentResult.action} (stage: ${agentResult.conversation?.stage || 'N/A'})`);
        } catch (agentErr) {
          console.error('⚠️ Errore agent (non bloccante):', agentErr.message);
        }
      }
    }

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

  } else if (category === 'NEUTRAL') {
    // NEUTRAL: ferma sequenza, salva nel CRM per tracking ma NON notifica il team
    const smartleadLead = await fetchLeadByEmail(webhookBasic.email);
    const mapped = smartleadLead
      ? mapLeadDataToContact(smartleadLead, webhookBasic)
      : mapWebhookOnlyToContact(webhookBasic);

    hydrateFromExtracted(mapped, extracted);

    const neutralResult = await createOrUpdateCrmContact(mapped, 'da contattare', {
      type: 'email',
      title: '🔵 Lead NEUTRAL (AI) — Risposta ambigua',
      description: `Campagna: ${mapped.campaignName}\n\n🤖 AI: ${category} (${(confidence * 100).toFixed(0)}%)\nMotivo: ${reason}\n\nRisposta:\n${replyText}`,
      data: activityData
    });
    console.log(`🔵 CRM: contatto salvato come da contattare (NEUTRAL — nessuna notifica team)`);

    // Route NEUTRAL leads to AI agent for nurturing
    if (neutralResult?.contact) {
      try {
        const agentResult = await handleAgentConversation({
          contact: neutralResult.contact,
          replyText,
          category,
          confidence,
          extracted,
          fromEmail,
          webhookBasic
        });
        console.log(`🤖 Agent (NEUTRAL): ${agentResult.action}`);
      } catch (agentErr) {
        console.error('⚠️ Errore agent NEUTRAL (non bloccante):', agentErr.message);
      }
    }

  } else if (category === 'NOT_INTERESTED' || category === 'DO_NOT_CONTACT') {
    const smartleadLead = await fetchLeadByEmail(webhookBasic.email);
    const mapped = smartleadLead
      ? mapLeadDataToContact(smartleadLead, webhookBasic)
      : mapWebhookOnlyToContact(webhookBasic);

    await createOrUpdateCrmContact(mapped, 'lost before free trial', {
      type: 'email',
      title: category === 'DO_NOT_CONTACT'
        ? '🛑 Lead DO NOT CONTACT (AI)'
        : '🚫 Lead NON INTERESSATO (AI)',
      description: `Campagna: ${mapped.campaignName}\n\n🤖 AI: ${category} (${(confidence * 100).toFixed(0)}%)\nMotivo: ${reason}\n\nRisposta:\n${replyText}`,
      data: activityData
    });
    console.log(`🚫 CRM: contatto salvato come lost before free trial`);

  } else {
    console.log(`📋 OUT_OF_OFFICE — riattivo la sequenza su Smartlead`);

    if (webhookBasic.campaignId && webhookBasic.leadId) {
      await updateLeadCategory(webhookBasic.campaignId, webhookBasic.leadId, 'Out Of Office', false);
      const resumeResult = await resumeLead(webhookBasic.campaignId, webhookBasic.leadId);
      if (resumeResult.success) {
        console.log(`▶️ Sequenza riattivata per lead ${webhookBasic.leadId}`);
      } else {
        console.warn(`⚠️ Resume fallito: ${resumeResult.reason || resumeResult.error}`);
      }
    }
  }

  console.log(`✅ EMAIL_REPLY processato [${webhookBasic.email} → ${category}]`);
};

/**
 * Popola dati del contatto con entità estratte dalla risposta AI
 */
const hydrateFromExtracted = (mapped, extracted) => {
  if (!extracted) return;

  if (extracted.phone && !mapped.phone) {
    mapped.phone = extracted.phone;
    console.log(`📱 CRM hydration: telefono dalla risposta → ${extracted.phone}`);
  }
  if (extracted.contactName) {
    mapped.properties = mapped.properties || {};
    mapped.properties.contact_person = extracted.contactName;
    console.log(`👤 CRM hydration: contatto → ${extracted.contactName}`);
  }
  if (extracted.availability) {
    mapped.properties = mapped.properties || {};
    mapped.properties.preferred_availability = extracted.availability;
  }
  if (extracted.preferredChannel) {
    mapped.properties = mapped.properties || {};
    mapped.properties.preferred_channel = extracted.preferredChannel;
  }
  if (extracted.specificRequest) {
    mapped.properties = mapped.properties || {};
    mapped.properties.specific_request = extracted.specificRequest;
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LEAD_CATEGORY_UPDATED: gestisce cambio categoria manuale su Smartlead
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const handleLeadCategoryUpdated = async (webhookData) => {
  const webhookBasic = extractWebhookBasicData(webhookData);
  const leadCategory = webhookData.lead_category || {};
  const newCategoryName = leadCategory.new_name || webhookData.category || '';
  const oldCategoryName = leadCategory.old_name || '';
  const lastReply = webhookData.last_reply || webhookData.lastReply || {};

  console.log(`🏷️ LEAD_CATEGORY_UPDATED: ${webhookBasic.email}`);
  console.log(`   ${oldCategoryName || 'N/A'} → ${newCategoryName}`);

  // Fetch dati completi del lead da Smartlead
  const smartleadLead = await fetchLeadByEmail(webhookBasic.email);
  const mapped = smartleadLead
    ? mapLeadDataToContact(smartleadLead, webhookBasic)
    : mapWebhookOnlyToContact(webhookBasic);

  const categoryLower = newCategoryName.toLowerCase();

  if (categoryLower === 'interested') {
    const result = await createOrUpdateCrmContact(mapped, 'da contattare', {
      type: 'email',
      title: 'Lead categorizzato come INTERESSATO (Smartlead)',
      description: `Categoria cambiata: ${oldCategoryName || 'N/A'} → ${newCategoryName}\nCampagna: ${mapped.campaignName}\n\nUltima risposta:\n${lastReply.email_body ? stripHtml(lastReply.email_body).substring(0, 500) : 'N/A'}`,
      data: { campaignId: mapped.campaignId, campaignName: mapped.campaignName, oldCategory: oldCategoryName, newCategory: newCategoryName }
    });
    if (result) console.log(`✅ CRM: ${result.isNew ? 'creato' : 'aggiornato'} come da contattare`);

  } else if (['not interested', 'not_interested', 'do not contact', 'do_not_contact'].includes(categoryLower)) {
    await createOrUpdateCrmContact(mapped, 'lost before free trial', {
      type: 'status_change',
      title: `Lead NON INTERESSATO (Smartlead: ${newCategoryName})`,
      description: `Campagna: ${mapped.campaignName}\nCategoria: ${oldCategoryName || 'N/A'} → ${newCategoryName}`,
      data: { campaignId: mapped.campaignId, campaignName: mapped.campaignName, oldCategory: oldCategoryName, newCategory: newCategoryName }
    });
    console.log(`🚫 CRM: contatto salvato come lost before free trial`);

  } else {
    console.log(`ℹ️ Categoria "${newCategoryName}" — nessuna azione CRM specifica`);
  }
};

export default { handleSmartleadWebhook };
