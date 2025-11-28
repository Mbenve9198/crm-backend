import Contact from '../models/contactModel.js';
import User from '../models/userModel.js';
import Activity from '../models/activityModel.js';

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
      restaurantName, 
      placeId, 
      keyword, 
      rankingResults,
      qualificationData,
      reportLinks  // 🆕 Link ai report
    } = req.body;

    // Validazione base
    if (!email || !phone || !restaurantName) {
      return res.status(400).json({
        success: false,
        message: 'Email, telefono e nome ristorante sono obbligatori'
      });
    }

    console.log(`📥 INBOUND LEAD: ${restaurantName} (${email})`);
    
    // ⚠️ Log warning se numero invalido
    if (phoneWarning) {
      console.warn(`⚠️ PHONE WARNING: ${phoneWarning}`);
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
    
    const leadData = {
      name: restaurantName,
      email: email.toLowerCase(),
      phone: phone,
      lists: ['Inbound - Rank Checker'], // Lista dedicata per questi lead
      status: 'da contattare',
      source: 'inbound_rank_checker',
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
        hasDigitalMenu: qualificationData?.hasDigitalMenu,
        willingToAdoptMenu: qualificationData?.willingToAdoptMenu,
        dailyCovers: qualificationData?.dailyCovers,
        estimatedMonthlyReviews: qualificationData?.estimatedMonthlyReviews,
        qualifiedAt: qualificationData?.qualifiedAt,
        leadCapturedAt: new Date()
      },
      properties: {
        restaurantAddress: rankingResults?.userRestaurant?.address || '',
        googleMapsUrl: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : '',
        // 🆕 Link diretti ai report (per accesso rapido dal CRM)
        rankCheckerBaseReport: reportLinks?.baseReport || '',
        rankCheckerCompleteReport: reportLinks?.completeReport || '',
        // ⚠️ Warning se numero telefono invalido
        phoneWarning: phoneWarning || null
      }
    };

    if (contact) {
      // Contatto esiste → AGGIORNA i dati
      console.log(`🔄 Contatto esistente trovato, aggiorno i dati...`);
      
      // Aggiungi alla lista se non già presente
      if (!contact.lists.includes('Inbound - Rank Checker')) {
        contact.lists.push('Inbound - Rank Checker');
      }
      
      // Aggiorna source solo se era manual
      if (contact.source === 'manual') {
        contact.source = 'inbound_rank_checker';
      }
      
      // Aggiorna sempre i dati rank checker (più recenti)
      contact.rankCheckerData = leadData.rankCheckerData;
      
      // Merge properties
      contact.properties = {
        ...contact.properties,
        ...leadData.properties
      };
      
      contact.lastModifiedBy = defaultOwner._id;
      
      await contact.save();
      
      console.log(`✅ Contatto aggiornato: ${contact.name} (${contact.email})`);
      
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
      
      leadData.createdBy = defaultOwner._id;
      
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
      const statusHierarchy = ['da contattare', 'contattato', 'da richiamare', 'interessato', 'non interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'];
      const currentStatusIndex = statusHierarchy.indexOf(contact.status);
      const newStatusIndex = statusHierarchy.indexOf(status);
      
      if (newStatusIndex > currentStatusIndex || status === 'interessato') {
        contact.status = status;
        
        // Imposta MRR se necessario
        if (['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'].includes(status)) {
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
      // CREA nuovo contatto
      console.log(`🆕 Creazione nuovo contatto...`);
      isNew = true;
      
      contact = new Contact({
        name,
        email: email.toLowerCase(),
        phone: phone || undefined,
        lists,
        status,
        mrr: ['interessato', 'qr code inviato', 'free trial iniziato', 'won', 'lost'].includes(status) ? mrr : undefined,
        source,
        properties,
        owner: defaultOwner._id,
        createdBy: defaultOwner._id
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

