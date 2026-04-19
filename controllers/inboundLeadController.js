import Contact from '../models/contactModel.js';
import User from '../models/userModel.js';
import Activity from '../models/activityModel.js';
import AssignmentState from '../models/assignmentStateModel.js';
import { resolveOwnerForSource } from '../services/assignmentService.js';

/**
 * Controller per la gestione dei lead inbound da MenuChat
 * Endpoint PUBBLICO (senza autenticazione) per webhook
 */

/**
 * Riceve e processa lead dal Rank Checker di MenuChat
 * POST /api/inbound/rank-checker-lead
 */
export const receiveRankCheckerLead = async (req, res) => {
  try {
    const { 
      email, 
      phone, 
      phoneWarning, // ⚠️ Warning se numero invalido
      name, // 🆕 Nome contatto (se diverso da restaurantName)
      restaurantName, 
      placeId, 
      keyword, 
      rankingResults,
      qualificationData,
      reportLink, // 🆕 Link al report (singolo)
      reportLinks, // Legacy: supporto vecchio formato
      // 🆕 Dati qualificazione diretti
      hasDigitalMenu,
      willingToAdoptMenu,
      dailyCovers,
      estimatedMonthlyReviews,
      // 🆕 Metadata
      leadSource,
      leadType,
      // 🆕 Richiesta chiamata
      callRequested,
      callPreference,
      callRequestedAt,
      callNote,
      // Dati menu landing (arrivano dal secondo sync dopo creazione menu)
      menuPreviewUrl,
      menuId,
      restaurantId,
      eventType
    } = req.body;

    // Validazione base
    if (!email || !phone || !restaurantName) {
      return res.status(400).json({
        success: false,
        message: 'Email, telefono e nome ristorante sono obbligatori'
      });
    }

    console.log(`📥 INBOUND LEAD: ${restaurantName} (${email})`);
    console.log(`📊 Lead Type: ${leadType || 'N/A'} | Source: ${leadSource || 'N/A'}`);
    
    // 🆕 Determina il link al report (supporto sia nuovo formato che legacy)
    const finalReportLink = reportLink || reportLinks?.baseReport || '';
    if (finalReportLink) {
      console.log(`🔗 Report Link: ${finalReportLink}`);
    }
    
    // 🆕 Log richiesta chiamata
    if (callRequested) {
      console.log(`📞 RICHIESTA CHIAMATA: ${callPreference || 'non specificata'}`);
    }
    
    // ⚠️ Log warning se numero invalido
    if (phoneWarning) {
      console.warn(`⚠️ PHONE WARNING: ${phoneWarning}`);
    }
    
    // 🆕 Dati qualificazione (priorità ai campi diretti, fallback a qualificationData)
    const qualData = {
      hasDigitalMenu: hasDigitalMenu ?? qualificationData?.hasDigitalMenu ?? null,
      dailyCovers: dailyCovers ?? qualificationData?.dailyCovers ?? null,
      estimatedMonthlyReviews: estimatedMonthlyReviews ?? qualificationData?.estimatedMonthlyReviews ?? null,
      willingToAdoptMenu: willingToAdoptMenu ?? qualificationData?.willingToAdoptMenu ?? null,
      qualifiedAt: qualificationData?.qualifiedAt || (hasDigitalMenu !== undefined ? new Date() : null)
    };
    
    if (qualData.dailyCovers) {
      console.log(`📊 Qualificazione: ${qualData.dailyCovers} coperti/giorno, ${qualData.estimatedMonthlyReviews} recensioni/mese, Menu digitale: ${qualData.hasDigitalMenu ? 'Sì' : 'No'}`);
    }

    // Trova l'owner di default per i lead inbound
    let defaultOwner;
    
    // Cerca prima per INBOUND_LEAD_DEFAULT_OWNER_EMAIL
    if (process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL) {
      defaultOwner = await User.findOne({ 
        email: process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL.toLowerCase() 
      });
      
      if (defaultOwner) {
        console.log(`👤 Owner trovato via email: ${defaultOwner.firstName} ${defaultOwner.lastName}`);
      }
    }
    
    // Fallback su primo admin/manager
    if (!defaultOwner) {
      defaultOwner = await User.findOne({ 
        role: { $in: ['admin', 'manager'] },
        isActive: true 
      }).sort({ createdAt: 1 });
      
      if (defaultOwner) {
        console.log(`👤 Owner fallback (primo manager/admin): ${defaultOwner.firstName} ${defaultOwner.lastName}`);
      }
    }

    if (!defaultOwner) {
      console.error('❌ Nessun owner disponibile per il lead inbound');
      return res.status(500).json({
        success: false,
        message: 'Configurazione CRM non completa: nessun owner disponibile'
      });
    }

    // Verifica se esiste già un contatto con questa email
    let contact = await Contact.findOne({ email: email.toLowerCase() });
    
    // Mappa leadSource → source CRM e lista
    const crmSourceMap = {
      'prova-gratuita': {
        source: 'inbound_prova_gratuita',
        list: 'Inbound - Prova Gratuita',
        log: '🚀 Lead da landing PROVA GRATUITA'
      },
      'menu-digitale-landing': {
        source: 'inbound_menu_landing',
        list: 'Inbound - Google Ads Menu',
        log: '📱 Lead da Google Ads Menu Landing'
      },
      'social-proof': {
        source: 'inbound_social_proof',
        list: 'Inbound - Meta Social Proof',
        log: '🎬 Lead da Meta Social Proof'
      },
      'qr-recensioni': {
        source: 'inbound_qr_recensioni',
        list: 'Inbound - Google Ads QR Recensioni',
        log: '⭐ Lead da Google Ads QR Recensioni'
      }
    };
    const defaultConfig = { source: 'inbound_rank_checker', list: 'Inbound - Rank Checker', log: '🎯 Lead da Rank Checker (organic)' };
    const crmConfig = crmSourceMap[leadSource] || defaultConfig;
    const crmSource = crmConfig.source;
    const crmList = crmConfig.list;
    const isProvaGratuita = leadSource === 'prova-gratuita';

    console.log(crmConfig.log);

    const leadData = {
      name: restaurantName,
      email: email.toLowerCase(),
      phone: phone,
      lists: [crmList],
      status: 'da contattare',
      source: crmSource,
      owner: defaultOwner._id,
      rankCheckerData: {
        placeId: placeId,
        keyword: keyword,
        ranking: {
          mainRank: rankingResults?.mainResult?.rank || rankingResults?.userRestaurant?.rank,
          competitorsAhead: rankingResults?.analysis?.competitorsAhead,
          estimatedLostCustomers: rankingResults?.analysis?.estimatedLostCustomers,
          totalResultsFound: rankingResults?.analysis?.totalResultsFound,
          strategicResults: rankingResults?.strategicResults,
          fullResults: rankingResults // Salva tutto per riferimento
        },
        restaurantData: {
          address: rankingResults?.userRestaurant?.address || '',
          rating: rankingResults?.userRestaurant?.rating || null,
          reviewCount: rankingResults?.userRestaurant?.reviews || 0,
          coordinates: {
            lat: rankingResults?.userRestaurant?.coordinates?.lat || null,
            lng: rankingResults?.userRestaurant?.coordinates?.lng || null
          }
        },
        // 🆕 Dati qualificazione
        hasDigitalMenu: qualData.hasDigitalMenu,
        willingToAdoptMenu: qualData.willingToAdoptMenu,
        dailyCovers: qualData.dailyCovers,
        estimatedMonthlyReviews: qualData.estimatedMonthlyReviews,
        qualifiedAt: qualData.qualifiedAt,
        leadCapturedAt: new Date(),
        leadType: leadType || 'INBOUND',
        leadSource: leadSource || 'organic' // organic, paid, etc.
      },
      properties: {
        // 🆕 Nome contatto se diverso da nome ristorante
        contactName: name || null,
        restaurantAddress: rankingResults?.userRestaurant?.address || '',
        googleMapsUrl: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : '',
        // 🆕 Richiesta chiamata
        ...(callRequested && {
          callRequested: true,
          callPreference: callPreference || null,
          callRequestedAt: callRequestedAt || new Date().toISOString(),
          callNote: callNote || null
        }),
        // 🆕 Link singolo al report (accesso rapido dal CRM)
        rankCheckerReport: finalReportLink,
        // ⚠️ Warning se numero telefono invalido
        phoneWarning: phoneWarning || null,
        // Menu landing data (link al menu creato + ID per accesso rapido)
        ...(menuPreviewUrl && { menuPreviewUrl }),
        ...(menuId && { menuId }),
        ...(restaurantId && { menuRestaurantId: restaurantId }),
        // Agent session per conversazione WhatsApp
        ...(req.body.agentSessionId && { agentSessionId: req.body.agentSessionId })
      }
    };

    if (contact) {
      // Contatto esiste → AGGIORNA i dati
      console.log(`🔄 Contatto esistente trovato, aggiorno i dati...`);
      
      // Aggiungi alla lista se non già presente
      if (!contact.lists.includes(crmList)) {
        contact.lists.push(crmList);
      }

      // Aggiorna source solo se era manual
      if (contact.source === 'manual') {
        contact.source = crmSource;
      }
      
      // Aggiorna sempre i dati rank checker (più recenti)
      contact.rankCheckerData = leadData.rankCheckerData;
      contact.markModified('rankCheckerData');

      // Merge properties
      contact.properties = {
        ...contact.properties,
        ...leadData.properties
      };
      contact.markModified('properties');

      contact.lastModifiedBy = defaultOwner._id;

      await contact.save();
      
      console.log(`✅ Contatto aggiornato: ${contact.name} (${contact.email})`);

      // ♻️ "Riattivazione" (opzione B): crea un'activity solo se non ci sono activity da >= 40 giorni
      // Usiamo type esistente ("email") e distinguiamo via data.kind/origin per poter filtrare lato analytics.
      try {
        const REACTIVATION_SILENCE_DAYS = 40;
        const silenceMs = REACTIVATION_SILENCE_DAYS * 24 * 60 * 60 * 1000;

        const lastActivity = await Activity.findOne({ contact: contact._id })
          .sort({ createdAt: -1 })
          .select('createdAt type title');

        const now = new Date();
        const lastAt = lastActivity?.createdAt ? new Date(lastActivity.createdAt) : null;
        const isSilentLongEnough = !lastAt || now.getTime() - lastAt.getTime() >= silenceMs;

        if (isSilentLongEnough) {
          const activity = new Activity({
            contact: contact._id,
            type: 'email',
            title: '♻️ Lead riattivato (Rank Checker)',
            description: `Lead Rank Checker ricevuto su contatto già esistente. Ultima activity: ${
              lastAt ? lastAt.toISOString() : 'mai'
            }`,
            data: {
              kind: 'reactivation',
              origin: 'rank_checker',
              meta: {
                receivedAt: new Date().toISOString(),
                silenceDaysThreshold: REACTIVATION_SILENCE_DAYS,
                lastActivityAt: lastAt ? lastAt.toISOString() : null,
                rankChecker: {
                  placeId,
                  keyword,
                  leadType: leadType || 'INBOUND',
                  leadSource: leadSource || 'organic'
                }
              }
            },
            createdBy: defaultOwner._id
          });

          await activity.save();
          console.log(`📝 Activity riattivazione creata: ${activity._id}`);
        } else {
          console.log(
            `ℹ️ Nessuna riattivazione: ultima activity troppo recente (${lastAt?.toISOString()})`
          );
        }
      } catch (activityErr) {
        // Non bloccare il flusso se l'activity fallisce
        console.warn('⚠️ Errore creazione activity riattivazione Rank Checker:', activityErr.message);
      }
      
      return res.status(200).json({
        success: true,
        message: 'Lead ricevuto e contatto aggiornato',
        data: {
          contactId: contact._id,
          action: 'updated'
        }
      });
      
    } else {
      // Contatto nuovo → CREA
      console.log(`🆕 Creazione nuovo contatto...`);

      const ownerForNewContact = await resolveOwnerForSource(crmSource, defaultOwner);

      leadData.owner = ownerForNewContact._id;
      leadData.createdBy = ownerForNewContact._id;
      
      contact = new Contact(leadData);
      await contact.save();
      
      // Aggiorna statistiche dell'owner
      await defaultOwner.updateStats({ newContact: true });
      await defaultOwner.save();
      
      console.log(`✅ Nuovo contatto creato: ${contact.name} (${contact.email})`);
      
      return res.status(201).json({
        success: true,
        message: 'Lead ricevuto e contatto creato',
        data: {
          contactId: contact._id,
          action: 'created'
        }
      });
    }

  } catch (error) {
    console.error('❌ Errore ricezione lead inbound:', error);
    
    // Errore duplicato email (race condition)
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Contatto già esistente (duplicato)',
        error: 'DUPLICATE_EMAIL'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Riceve e processa lead da WhatsApp Acquisition (funnel MENU o RECENSIONI)
 * POST /api/inbound/acquisition-lead
 */
export const receiveAcquisitionLead = async (req, res) => {
  try {
    const {
      phone,
      name,
      restaurantName,
      funnelType,
      acquisitionData,
      leadSource,
      leadType
    } = req.body;

    if (!phone || !restaurantName) {
      return res.status(400).json({
        success: false,
        message: 'Telefono e nome ristorante sono obbligatori'
      });
    }

    console.log(`📥 INBOUND ACQUISITION LEAD: ${restaurantName} (${funnelType}) — ${phone}`);

    let defaultOwner;
    if (process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL) {
      defaultOwner = await User.findOne({
        email: process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL.toLowerCase()
      });
    }
    if (!defaultOwner) {
      defaultOwner = await User.findOne({
        role: { $in: ['admin', 'manager'] },
        isActive: true
      }).sort({ createdAt: 1 });
    }
    if (!defaultOwner) {
      return res.status(500).json({ success: false, message: 'Nessun owner disponibile' });
    }

    const syntheticEmail = `acq-${funnelType?.toLowerCase() || 'unknown'}-${phone.replace(/\+/g, '')}@acquisition.menuchat.it`;
    const listName = `Inbound - WhatsApp Acquisition - ${funnelType || 'UNKNOWN'}`;

    let contact = await Contact.findOne({ email: syntheticEmail.toLowerCase() });

    const leadData = {
      name: restaurantName,
      email: syntheticEmail.toLowerCase(),
      phone,
      lists: [listName],
      status: acquisitionData?.callSlot ? 'interessato' : 'da contattare',
      source: 'inbound_acquisition',
      owner: defaultOwner._id,
      acquisitionData: {
        funnelType: funnelType || 'UNKNOWN',
        ...(acquisitionData || {})
      },
      properties: {
        contactName: name || null,
        restaurantAddress: acquisitionData?.address || '',
        googleMapsUrl: acquisitionData?.placeId ? `https://www.google.com/maps/place/?q=place_id:${acquisitionData.placeId}` : '',
        menuPreviewUrl: acquisitionData?.menuPreviewUrl || null,
        leadSource: leadSource || 'google-ads-whatsapp',
        leadType: leadType || 'INBOUND'
      }
    };

    let action;
    if (contact) {
      if (!contact.lists.includes(listName)) {
        contact.lists.push(listName);
      }
      if (contact.source === 'manual') {
        contact.source = 'inbound_acquisition';
      }
      contact.acquisitionData = leadData.acquisitionData;
      contact.properties = { ...contact.properties, ...leadData.properties };
      if (acquisitionData?.callSlot && contact.status === 'da contattare') {
        contact.status = 'interessato';
      }
      contact.lastModifiedBy = defaultOwner._id;
      await contact.save();
      action = 'updated';
      console.log(`🔄 Contatto acquisition aggiornato: ${contact.name}`);
    } else {
      const ownerForAcq = await resolveOwnerForSource('inbound_acquisition', defaultOwner);
      leadData.owner = ownerForAcq._id;
      contact = new Contact(leadData);
      contact.createdBy = ownerForAcq._id;
      await contact.save();
      action = 'created';
      console.log(`✅ Nuovo contatto acquisition creato: ${contact.name}`);
    }

    // Create activity
    try {
      const activity = new Activity({
        contact: contact._id,
        type: 'whatsapp',
        title: `📥 Lead ${funnelType}: ${restaurantName}`,
        description: `Lead WhatsApp Acquisition (${funnelType})${acquisitionData?.callSlot ? ` — Chiamata richiesta: ${acquisitionData.callSlot}` : ''}`,
        data: {
          kind: 'lead_inbound',
          origin: 'acquisition',
          meta: {
            funnelType,
            leadScore: acquisitionData?.leadScore,
            leadTemperature: acquisitionData?.leadTemperature,
            weeklyCovers: acquisitionData?.weeklyCovers,
            menuPreviewUrl: acquisitionData?.menuPreviewUrl
          }
        },
        performedBy: defaultOwner._id
      });
      await activity.save();
    } catch (actErr) {
      console.error('⚠️ Activity creation failed:', actErr.message);
    }

    return res.status(action === 'created' ? 201 : 200).json({
      success: true,
      data: { contactId: contact._id, action },
      message: `Lead acquisition ${action}`
    });
  } catch (error) {
    console.error('❌ Errore ricezione acquisition lead:', error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Contatto già esistente con questa email' });
    }
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Riceve e processa lead da Smartlead (campagne email outbound)
 * POST /api/inbound/smartlead-lead
 */
export const receiveSmartleadLead = async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      lists = [],
      status = 'da contattare',
      mrr = 0, // Default 0 per status 'interessato'
      source = 'smartlead_outbound',
      properties = {},
      activityData = null // Dati opzionali per creare attività
    } = req.body;

    // Validazione base
    if (!email || !name) {
      return res.status(400).json({
        success: false,
        message: 'Email e nome sono obbligatori'
      });
    }

    console.log(`📥 SMARTLEAD LEAD: ${name} (${email})`);

    // Trova l'owner di default per i lead inbound
    let defaultOwner;
    
    if (process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL) {
      defaultOwner = await User.findOne({ 
        email: process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL.toLowerCase() 
      });
      
      if (defaultOwner) {
        console.log(`👤 Owner trovato: ${defaultOwner.firstName} ${defaultOwner.lastName}`);
      }
    }
    
    if (!defaultOwner) {
      defaultOwner = await User.findOne({ 
        role: { $in: ['admin', 'manager'] },
        isActive: true 
      }).sort({ createdAt: 1 });
    }

    if (!defaultOwner) {
      console.error('❌ Nessun owner disponibile');
      return res.status(500).json({
        success: false,
        message: 'Configurazione CRM non completa: nessun owner disponibile'
      });
    }

    // Verifica se esiste già un contatto con questa email
    let contact = await Contact.findOne({ email: email.toLowerCase() });
    let isNew = false;
    
    if (contact) {
      // AGGIORNA contatto esistente
      console.log(`🔄 Contatto esistente trovato, aggiorno...`);
      
      // Aggiungi alle liste se non già presenti
      lists.forEach(list => {
        if (!contact.lists.includes(list)) {
          contact.lists.push(list);
        }
      });
      
      // Aggiorna source solo se era manual
      if (contact.source === 'manual') {
        contact.source = source;
      }
      
      // Aggiorna phone se non presente
      if (!contact.phone && phone) {
        contact.phone = phone;
      }
      
      // Aggiorna status se fornito (es. 'interessato' da Smartlead)
      // Ma solo se non è già in uno stato più avanzato
      const statusHierarchy = [
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
        'non_qualificato',
        'do_not_contact'
      ];
      const currentStatusIndex = statusHierarchy.indexOf(contact.status);
      const newStatusIndex = statusHierarchy.indexOf(status);
      
      if (newStatusIndex > currentStatusIndex) {
        contact.status = status;
        
        // Imposta MRR se necessario
        if (['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost before free trial', 'lost after free trial'].includes(status)) {
          if (contact.mrr === undefined || contact.mrr === null) {
            contact.mrr = mrr;
          }
        }
      }
      
      // Merge properties (conserva quelli esistenti + nuovi)
      contact.properties = {
        ...contact.properties,
        ...properties
      };
      
      contact.lastModifiedBy = defaultOwner._id;
      await contact.save();
      
      console.log(`✅ Contatto aggiornato: ${contact.name}`);
      
    } else {
      // Safety: non creare nuovi contatti se l'esito è di "non contattare / non interessato"
      // (ma se esistono già li aggiorniamo comunque, vedi branch sopra).
      const normalizedStatus = String(status || '').toLowerCase().trim();
      const categoryFromProps = String(
        properties.smartlead_category ||
        properties.smartlead_lead_category ||
        properties.lead_category ||
        properties.category ||
        ''
      ).toLowerCase().trim();

      const isHardStopCategory = ['do not contact', 'do_not_contact', 'not interested', 'not_interested'].includes(categoryFromProps);
      const isLostStatus = ['lost before free trial', 'lost after free trial'].includes(normalizedStatus);

      if (isLostStatus || isHardStopCategory) {
        console.log(`🚫 Skip creazione nuovo contatto Smartlead: status="${status}", category="${categoryFromProps || 'N/A'}" (${email})`);
        return res.status(200).json({
          success: true,
          message: 'Lead ricevuto ma non creato (esito non contattare/non interessato)',
          isNew: false,
          skippedCreate: true
        });
      }

      // CREA nuovo contatto
      console.log(`🆕 Creazione nuovo contatto...`);
      isNew = true;

      const ownerForNewContact = await resolveOwnerForSource(source, defaultOwner);

      contact = new Contact({
        name,
        email: email.toLowerCase(),
        phone: phone || undefined,
        lists,
        status,
        mrr: ['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost before free trial', 'lost after free trial'].includes(status) ? mrr : undefined,
        source,
        properties,
        owner: ownerForNewContact._id,
        createdBy: ownerForNewContact._id
      });
      
      await contact.save();
      
      // Aggiorna statistiche dell'owner
      await defaultOwner.updateStats({ newContact: true });
      await defaultOwner.save();
      
      console.log(`✅ Nuovo contatto creato: ${contact.name}`);
    }

    // Crea attività se sono stati forniti i dati
    let activity = null;
    if (activityData) {
      try {
        console.log(`📝 Creazione attività per contatto: ${contact._id}`);
        
        activity = new Activity({
          contact: contact._id,
          type: activityData.type || 'email',
          title: activityData.title || 'Attività da Smartlead',
          description: activityData.description || '',
          data: activityData.data || {},
          createdBy: defaultOwner._id
        });
        
        await activity.save();
        console.log(`✅ Attività creata: ${activity._id}`);
      } catch (activityError) {
        console.error('❌ Errore creazione attività:', activityError.message);
        // Non blocchiamo il flusso se l'attività fallisce
      }
    }

    return res.status(isNew ? 201 : 200).json({
      success: true,
      message: isNew ? 'Lead ricevuto e contatto creato' : 'Lead ricevuto e contatto aggiornato',
      isNew,
      contact: {
        _id: contact._id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        lists: contact.lists,
        status: contact.status
      },
      activity: activity ? { _id: activity._id } : null
    });

  } catch (error) {
    console.error('❌ Errore ricezione lead Smartlead:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Contatto già esistente',
        error: 'DUPLICATE_EMAIL'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export default {
  receiveRankCheckerLead,
  receiveSmartleadLead
};

