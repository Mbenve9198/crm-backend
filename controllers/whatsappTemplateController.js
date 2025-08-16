import User from '../models/userModel.js';

/**
 * Controller per la gestione dei template WhatsApp dell'utente
 */

/**
 * Funzione helper per estrarre le variabili dal template
 * Cerca pattern {variabile} nel testo
 */
function extractVariables(message) {
  const variablePattern = /\{([^}]+)\}/g;
  const variables = [];
  let match;
  
  while ((match = variablePattern.exec(message)) !== null) {
    const variable = match[1].trim();
    if (variable && !variables.includes(variable)) {
      variables.push(variable);
    }
  }
  
  return variables;
}

/**
 * Ottieni template WhatsApp dell'utente corrente
 * GET /api/settings/whatsapp-template
 */
export const getWhatsAppTemplate = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    const template = user.settings?.whatsappTemplate || {
      message: 'Ciao {nome}, sono {utente} di MenuChatCRM. Come posso aiutarti?',
      variables: ['nome', 'utente'],
      updatedAt: new Date()
    };

    res.json({
      success: true,
      data: template
    });

  } catch (error) {
    console.error('Errore nel recuperare template WhatsApp:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna template WhatsApp dell'utente corrente
 * PUT /api/settings/whatsapp-template
 */
export const updateWhatsAppTemplate = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Il messaggio del template è obbligatorio'
      });
    }

    if (message.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Il template non può superare 1000 caratteri'
      });
    }

    // Estrai le variabili dal template
    const variables = extractVariables(message);

    // Aggiorna l'utente
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $set: {
          'settings.whatsappTemplate.message': message.trim(),
          'settings.whatsappTemplate.variables': variables,
          'settings.whatsappTemplate.updatedAt': new Date()
        }
      },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    res.json({
      success: true,
      message: 'Template WhatsApp aggiornato con successo',
      data: {
        message: user.settings.whatsappTemplate.message,
        variables: user.settings.whatsappTemplate.variables,
        updatedAt: user.settings.whatsappTemplate.updatedAt
      }
    });

  } catch (error) {
    console.error('Errore nell\'aggiornamento del template WhatsApp:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Compila il template con i dati del contatto
 * POST /api/settings/whatsapp-template/compile
 */
export const compileWhatsAppTemplate = async (req, res) => {
  try {
    const { contactId } = req.body;

    if (!contactId) {
      return res.status(400).json({
        success: false,
        message: 'ID contatto obbligatorio'
      });
    }

    // Recupera l'utente e il template
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    const template = user.settings?.whatsappTemplate;
    if (!template || !template.message) {
      return res.status(404).json({
        success: false,
        message: 'Template WhatsApp non configurato'
      });
    }

    // Recupera il contatto
    const Contact = (await import('../models/contactModel.js')).default;
    const contact = await Contact.findById(contactId);
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Prepara i dati per la sostituzione
    const replacementData = {
      nome: contact.name,
      email: contact.email || '',
      telefono: contact.phone || '',
      utente: `${user.firstName} ${user.lastName}`,
      azienda: user.department || 'MenuChatCRM',
      ...contact.properties // Aggiungi tutte le proprietà dinamiche
    };

    // Compila il template sostituendo le variabili
    let compiledMessage = template.message;
    
    template.variables.forEach(variable => {
      const placeholder = `{${variable}}`;
      const value = replacementData[variable] || `{${variable}}`; // Mantieni placeholder se valore non trovato
      compiledMessage = compiledMessage.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    });

    res.json({
      success: true,
      data: {
        originalMessage: template.message,
        compiledMessage,
        variables: template.variables,
        replacementData,
        missingVariables: template.variables.filter(v => !replacementData.hasOwnProperty(v))
      }
    });

  } catch (error) {
    console.error('Errore nella compilazione del template WhatsApp:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni variabili disponibili per i template
 * GET /api/settings/whatsapp-template/variables
 */
export const getAvailableVariables = async (req, res) => {
  try {
    // Recupera l'utente corrente
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utente non trovato'
      });
    }

    // Recupera le proprietà dinamiche dal database dei contatti
    const Contact = (await import('../models/contactModel.js')).default;
    const dynamicProperties = await Contact.aggregate([
      { $match: { properties: { $exists: true, $ne: null } } },
      { $project: { properties: { $objectToArray: '$properties' } } },
      { $unwind: '$properties' },
      { $group: { _id: '$properties.k' } },
      { $sort: { _id: 1 } }
    ]);

    const dynamicPropertyNames = dynamicProperties.map(item => item._id).filter(Boolean);

    const availableVariables = {
      fixed: [
        { key: 'nome', description: 'Nome del contatto' },
        { key: 'email', description: 'Email del contatto' },
        { key: 'telefono', description: 'Numero di telefono del contatto' },
        { key: 'utente', description: 'Nome completo dell\'utente corrente' },
        { key: 'azienda', description: 'Dipartimento o azienda dell\'utente' }
      ],
      dynamic: dynamicPropertyNames.map(prop => ({
        key: prop,
        description: `Proprietà dinamica: ${prop}`
      }))
    };

    res.json({
      success: true,
      data: availableVariables
    });

  } catch (error) {
    console.error('Errore nel recupero delle variabili disponibili:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};
