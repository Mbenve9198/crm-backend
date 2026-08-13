import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';
import Call from '../models/callModel.js';
import Activity from '../models/activityModel.js';
import { buildColdCallScript } from '../services/coldCallScriptService.js';
import { fetchDialerQueue, isContactOwnedByUser } from '../services/dialerQueueService.js';
import { syncCallActivity } from '../services/callActivitySyncService.js';

const CONTACT_STATUSES = [
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
  'do_not_contact',
];

const PIPELINE_STATUSES = [
  'interessato',
  'qr code inviato',
  'free trial iniziato',
  'won',
  'lost before free trial',
  'lost after free trial',
];

const CALL_OUTCOMES = [
  'interested',
  'not-interested',
  'callback',
  'voicemail',
  'wrong-number',
  'meeting-set',
  'sale-made',
  'no-answer',
  'not-logged',
  'first-call',
  'follow-up',
  'free-trial-sold',
  'deal-closed',
];

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
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 401) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
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

    if (!isContactOwnedByUser(contact, req.user)) {
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

    if (!isContactOwnedByUser(contact, req.user)) {
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

/**
 * POST /api/dialer/wrap-up
 * Un colpo: note/outcome chiamata + status contatto + richiamo.
 */
export const wrapUpDialer = async (req, res) => {
  try {
    const {
      contactId,
      callId,
      outcome,
      status,
      notes,
      callbackAt,
      callbackNote,
      mrr,
    } = req.body || {};

    if (!contactId || !mongoose.Types.ObjectId.isValid(contactId)) {
      return res.status(400).json({ success: false, message: 'contactId non valido' });
    }
    if (!outcome || !CALL_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ success: false, message: 'Esito chiamata non valido' });
    }
    if (status && !CONTACT_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Status non valido' });
    }
    if (callId && !mongoose.Types.ObjectId.isValid(callId)) {
      return res.status(400).json({ success: false, message: 'callId non valido' });
    }
    if (callbackAt !== null && callbackAt !== undefined) {
      const d = new Date(callbackAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'callbackAt deve essere una data ISO valida oppure null',
        });
      }
    }
    if (callbackNote !== null && callbackNote !== undefined) {
      if (typeof callbackNote !== 'string' || callbackNote.length > 300) {
        return res.status(400).json({
          success: false,
          message: 'callbackNote deve essere una stringa di massimo 300 caratteri oppure null',
        });
      }
    }

    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    }
    if (!isContactOwnedByUser(contact, req.user)) {
      return res.status(403).json({ success: false, message: 'Non hai i permessi per modificare questo contatto' });
    }

    let call = null;
    const notesText = notes != null ? String(notes).trim() : '';

    if (callId) {
      call = await Call.findById(callId);
      if (!call) {
        return res.status(404).json({ success: false, message: 'Chiamata non trovata' });
      }
      if (call.contact.toString() !== contact._id.toString()) {
        return res.status(400).json({ success: false, message: 'La chiamata non appartiene a questo contatto' });
      }
      const canEditCall =
        call.initiatedBy.toString() === req.user._id.toString() ||
        req.user.role === 'admin' ||
        req.user.role === 'manager';
      if (!canEditCall) {
        return res.status(403).json({ success: false, message: 'Non hai i permessi per modificare questa chiamata' });
      }
      call.outcome = outcome;
      if (notes !== undefined) call.notes = notesText;
      await syncCallActivity(call, {
        callOutcome: outcome,
        callDuration: call.duration,
        recordingUrl: call.recordingUrl,
        recordingSid: call.recordingSid,
        recordingDuration: call.recordingDuration,
        notes: notes !== undefined ? notesText : call.notes,
      });
      await call.save();
    } else if (notesText) {
      await Activity.create({
        type: 'note',
        contact: contact._id,
        createdBy: req.user._id,
        title: 'Note chiamata',
        description: notesText.slice(0, 5000),
      });
    }

    const oldStatus = contact.status;
    const statusChanged = Boolean(status && status !== contact.status);

    if (statusChanged) {
      if (PIPELINE_STATUSES.includes(status)) {
        const nextMrr = mrr !== undefined && mrr !== null ? mrr : contact.mrr;
        contact.mrr = nextMrr !== undefined && nextMrr !== null ? nextMrr : 0;
      }
      contact.status = status;
      const closeDateStatuses = ['qr code inviato', 'free trial iniziato'];
      if (closeDateStatuses.includes(status) && !closeDateStatuses.includes(oldStatus)) {
        if (!contact.properties) contact.properties = {};
        if (!contact.properties.closeDate) {
          const auto = new Date();
          auto.setDate(auto.getDate() + 25);
          contact.properties.closeDate = auto.toISOString();
          contact.markModified('properties');
        }
      }
    }

    if (!contact.properties) contact.properties = {};
    if (callbackAt === null) {
      delete contact.properties.callbackAt;
    } else if (callbackAt !== undefined) {
      contact.properties.callbackAt = callbackAt;
    }
    if (callbackNote === null) {
      delete contact.properties.callbackNote;
    } else if (callbackNote !== undefined) {
      contact.properties.callbackNote = callbackNote;
    }
    contact.markModified('properties');
    contact.lastModifiedBy = req.user._id;
    await contact.save();

    if (statusChanged) {
      await Activity.create({
        contact: contact._id,
        type: 'status_change',
        title: `Stato cambiato: ${oldStatus} → ${status}`,
        description: contact.mrr ? `MRR impostato: €${contact.mrr}` : undefined,
        data: {
          statusChange: {
            oldStatus,
            newStatus: status,
            mrr: contact.mrr,
          },
        },
        createdBy: req.user._id,
      });
    }

    await contact.populate('owner', 'firstName lastName email role');

    if (call) {
      await call.populate([
        { path: 'contact', select: 'name phone' },
        { path: 'initiatedBy', select: 'firstName lastName' },
      ]);
    }

    res.json({
      success: true,
      message: 'Esito salvato',
      data: { contact, call },
    });
  } catch (error) {
    console.error('Errore wrapUpDialer:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Errore interno del server' });
  }
};
