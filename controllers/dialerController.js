import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';
import { buildColdCallScript } from '../services/coldCallScriptService.js';
import { fetchDialerQueue } from '../services/dialerQueueService.js';

/**
 * GET /api/dialer/queue
 */
export const getDialerQueue = async (req, res) => {
  try {
    const data = await fetchDialerQueue({
      user: req.user,
      list: req.query.list,
      status: req.query.status,
      city: req.query.city,
      limit: req.query.limit,
      offset: req.query.offset,
      owner: req.query.owner,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Errore getDialerQueue:', error);
    res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
};

/**
 * GET /api/dialer/contacts/:id/script
 */
export const getColdCallScript = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID contatto non valido' });
    }
    const contact = await Contact.findById(id).populate('owner', 'firstName lastName email role');

    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    }

    if (!req.user.canAccessContact(contact)) {
      return res.status(403).json({ success: false, message: 'Non hai accesso a questo contatto' });
    }

    const agentName = req.user?.firstName || req.user?.name || null;
    const script = buildColdCallScript(contact, { agentName });

    res.json({
      success: true,
      data: {
        contactId: contact._id,
        contactName: contact.name,
        ...script,
      },
    });
  } catch (error) {
    console.error('Errore getColdCallScript:', error);
    res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * PUT /api/dialer/contacts/:id/visibility-card
 */
export const upsertVisibilityCard = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID contatto non valido' });
    }
    const { visibilityCard } = req.body;

    if (!isPlainObject(visibilityCard)) {
      return res.status(400).json({
        success: false,
        message: 'visibilityCard (object) è obbligatorio',
      });
    }

    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    }

    if (!req.user.canModifyContact(contact)) {
      return res.status(403).json({ success: false, message: 'Non hai i permessi per modificare questo contatto' });
    }

    const generatedAt = new Date().toISOString();
    contact.properties = {
      ...(contact.properties || {}),
      visibilityCard,
      visibilityCardGeneratedAt: generatedAt,
    };
    contact.markModified('properties');
    contact.lastModifiedBy = req.user._id;
    await contact.save();

    res.json({
      success: true,
      message: 'Scheda visibilità salvata',
      data: {
        contactId: contact._id,
        visibilityCard: contact.properties.visibilityCard,
        visibilityCardGeneratedAt: generatedAt,
        script: buildColdCallScript(contact, {
          agentName: req.user?.firstName || req.user?.name || null,
        }),
      },
    });
  } catch (error) {
    console.error('Errore upsertVisibilityCard:', error);
    res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
};
