import Activity from '../models/activityModel.js';
import Contact from '../models/contactModel.js';

/**
 * Controller per la gestione delle Activities
 */

/**
 * Ottieni tutte le activities di un contatto
 * GET /contacts/:contactId/activities
 */
export const getContactActivities = async (req, res) => {
  try {
    const { contactId } = req.params;
    const { page = 1, limit = 20, type } = req.query;

    // Verifica che il contatto esista e che l'utente abbia i permessi
    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica permessi
    if (req.user.role === 'agent' && contact.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per visualizzare le activities di questo contatto'
      });
    }

    // Recupera le activities
    const activities = await Activity.getContactActivities(contactId, { page, limit, type });
    const total = await Activity.countDocuments({ 
      contact: contactId,
      ...(type && { type })
    });

    res.json({
      success: true,
      data: {
        activities,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Errore nel recupero activities:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Crea una nuova activity
 * POST /contacts/:contactId/activities
 */
export const createActivity = async (req, res) => {
  try {
    const { contactId } = req.params;
    const { type, title, description, data } = req.body;

    // Validazioni di base
    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Il tipo di activity è obbligatorio'
      });
    }

    // Verifica che il contatto esista
    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica permessi
    if (req.user.role === 'agent' && contact.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per creare activities per questo contatto'
      });
    }

    // Crea l'activity
    const activity = new Activity({
      contact: contactId,
      type,
      title,
      description,
      data,
      createdBy: req.user._id
    });

    await activity.save();

    // Popola i dati per la risposta
    await activity.populate('createdBy', 'firstName lastName email role');

    res.status(201).json({
      success: true,
      message: 'Activity creata con successo',
      data: activity
    });

  } catch (error) {
    console.error('Errore nella creazione activity:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Aggiorna un'activity esistente
 * PUT /activities/:id
 */
export const updateActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, data, status, priority } = req.body;

    const activity = await Activity.findById(id);
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity non trovata'
      });
    }

    // Verifica permessi (solo creatore o manager/admin)
    if (req.user.role === 'agent' && activity.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per modificare questa activity'
      });
    }

    // Aggiorna i campi
    if (title) activity.title = title;
    if (description) activity.description = description;
    if (data) activity.data = { ...activity.data, ...data };
    if (status) activity.status = status;
    if (priority) activity.priority = priority;

    await activity.save();
    await activity.populate('createdBy', 'firstName lastName email role');

    res.json({
      success: true,
      message: 'Activity aggiornata con successo',
      data: activity
    });

  } catch (error) {
    console.error('Errore nell\'aggiornamento activity:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Elimina un'activity
 * DELETE /activities/:id
 */
export const deleteActivity = async (req, res) => {
  try {
    const { id } = req.params;

    const activity = await Activity.findById(id);
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity non trovata'
      });
    }

    // Verifica permessi (solo creatore o admin)
    if (req.user.role !== 'admin' && activity.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per eliminare questa activity'
      });
    }

    await Activity.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Activity eliminata con successo'
    });

  } catch (error) {
    console.error('Errore nell\'eliminazione activity:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
};

/**
 * Ottieni statistiche activities per un contatto
 * GET /contacts/:contactId/activities/stats
 */
export const getContactActivityStats = async (req, res) => {
  try {
    const { contactId } = req.params;

    // Verifica che il contatto esista
    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contatto non trovato'
      });
    }

    // Verifica permessi
    if (req.user.role === 'agent' && contact.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Non hai i permessi per visualizzare le statistiche di questo contatto'
      });
    }

    // Calcola le statistiche
    const stats = await Activity.aggregate([
      { $match: { contact: contact._id } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          lastActivity: { $max: '$createdAt' }
        }
      }
    ]);

    const totalActivities = await Activity.countDocuments({ contact: contactId });
    const lastActivity = await Activity.findOne({ contact: contactId })
      .sort({ createdAt: -1 })
      .populate('createdBy', 'firstName lastName');

    res.json({
      success: true,
      data: {
        totalActivities,
        lastActivity,
        byType: stats,
        contact: {
          _id: contact._id,
          name: contact.name,
          email: contact.email
        }
      }
    });

  } catch (error) {
    console.error('Errore nel recupero statistiche activities:', error);
    res.status(500).json({
      success: false,
      message: 'Errore interno del server'
    });
  }
}; 