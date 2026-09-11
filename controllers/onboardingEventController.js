import { createHash } from 'node:crypto';
import Contact from '../models/contactModel.js';
import Activity from '../models/activityModel.js';
import User from '../models/userModel.js';
import { resolveInboundContact } from '../services/inboundContactIdentityService.js';
import { inputError, optionalInstant, optionalText } from '../services/graderIntakeService.js';

const STATUS_MAP = Object.freeze({
  paid: 'interessato', qr_shipped: 'qr code inviato', qr_delivered: 'qr code inviato',
  trial_pending: 'qr code inviato', trial_active: 'free trial iniziato',
  trial_expired: 'free trial iniziato', trial_grace: 'free trial iniziato',
  blocked: 'free trial iniziato', nurturing: 'free trial iniziato',
  sales_handoff: 'interessato', won: 'won',
});
const EVENTS = new Set(['new', 'preview_building', 'preview_sent', 'engaged', 'autoresponder_detected',
  'menu_refining', 'qr_approved', 'address_confirmed', 'payment_pending', 'shipping_deferred',
  ...Object.keys(STATUS_MAP), 'lost']);
const RANK = { 'da contattare': 0, contattato: 1, 'da richiamare': 2, 'ghosted/bad timing': 2,
  interessato: 3, 'qr code inviato': 4, 'free trial iniziato': 5, won: 6 };
const IMMUTABLE = new Set(['won', 'do_not_contact', 'bad_data', 'lost before free trial', 'lost after free trial']);

function nextStatus(state, previous) {
  if (IMMUTABLE.has(previous)) return previous;
  if (state === 'lost') return previous === 'free trial iniziato' ? 'lost after free trial' : 'lost before free trial';
  const target = Object.hasOwn(STATUS_MAP, state) ? STATUS_MAP[state] : null;
  return target && (RANK[target] ?? -1) > (RANK[previous] ?? -1) ? target : previous;
}

export const receiveOnboardingEvent = async (req, res) => {
  try {
    const body = req.body;
    const event = optionalText(body.event, 'event', 60);
    const state = optionalText(body.status, 'status', 60) || event;
    if (!EVENTS.has(event) || !EVENTS.has(state)) throw inputError('Evento onboarding non valido');
    const occurredAt = optionalInstant(body.occurredAt, 'occurredAt');
    if (occurredAt && new Date(occurredAt).getTime() > Date.now() + 300000) throw inputError('occurredAt nel futuro');
    const suppliedId = optionalText(body.eventId, 'eventId', 200);
    let contact = await resolveInboundContact(body);
    if (!contact) return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    const eventId = `onboarding:${createHash('sha256').update(`${contact._id}:${suppliedId || `${body.leadId || ''}:${state}:${event}:${occurredAt || 'legacy'}`}`).digest('hex')}`;
    let previousStatus;
    let appliedStatus;
    for (let attempt = 0; attempt < 5; attempt++) {
      const p = contact.properties || {};
      if (p.onboardingLastEventId === eventId) {
        previousStatus = p.onboardingPreviousStatus || contact.status;
        appliedStatus = p.onboardingAppliedStatus || contact.status;
        break;
      }
      if (occurredAt && p.onboardingLastEventAt && new Date(occurredAt) < new Date(p.onboardingLastEventAt)) {
        return res.json({ success: true, data: { contactId: contact._id, status: contact.status, skipped: 'stale_event' } });
      }
      previousStatus = contact.status;
      appliedStatus = nextStatus(state, previousStatus);
      const patch = {
        status: appliedStatus,
        'properties.onboardingStatus': state,
        'properties.onboardingLastEvent': event,
        'properties.onboardingLastEventAt': occurredAt || new Date().toISOString(),
        'properties.onboardingLastEventId': eventId,
        'properties.onboardingPreviousStatus': previousStatus,
        'properties.onboardingAppliedStatus': appliedStatus,
      };
      if (body.leadId) patch['properties.onboardingLeadId'] = body.leadId;
      if (appliedStatus !== previousStatus && appliedStatus !== 'da contattare') patch.mrr = contact.mrr || 1290;
      const updated = await Contact.findOneAndUpdate({ _id: contact._id, updatedAt: contact.updatedAt, status: previousStatus },
        { $set: patch }, { new: true, runValidators: true });
      if (updated) { contact = updated; break; }
      contact = await Contact.findById(contact._id);
      if (!contact || attempt === 4) throw Object.assign(new Error('Aggiornamento concorrente: riprovare'), { status: 409 });
    }
    const activityOwner = contact.owner || (await User.findOne({ role: { $in: ['admin', 'manager'] }, isActive: true }).sort({ createdAt: 1 }))?._id;
    if (!activityOwner) throw new Error('Owner attività non disponibile');
    const changed = previousStatus !== appliedStatus;
    const type = changed ? 'status_change' : ['engaged', 'autoresponder_detected'].includes(event) ? 'whatsapp' : 'note';
    await Activity.updateOne({ externalEventId: eventId }, { $setOnInsert: {
      contact: contact._id, type, title: `Onboarding: ${event}`, createdBy: activityOwner,
      description: changed ? `Stato: ${previousStatus} → ${appliedStatus}` : `Stato onboarding: ${state}`,
      data: { kind: 'onboarding_event', origin: 'system',
        ...(changed && { statusChange: { oldStatus: previousStatus, newStatus: appliedStatus, mrr: contact.mrr } }),
        meta: { event, status: state, occurredAt: occurredAt || null } },
    } }, { upsert: true, runValidators: true });
    return res.json({ success: true, data: { contactId: contact._id, status: contact.status } });
  } catch (error) {
    if (error.code === 11000) return res.json({ success: true, duplicate: true });
    console.error('[onboarding-event] Failed', { code: error.status || 500 });
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Sincronizzazione onboarding fallita' });
  }
};
