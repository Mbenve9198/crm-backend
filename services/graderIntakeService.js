import { createHash } from 'node:crypto';
import Activity from '../models/activityModel.js';
import Contact from '../models/contactModel.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EARLY_STATUSES = new Set(['da contattare', 'contattato', 'da richiamare', 'ghosted/bad timing']);
const NO_CALLBACK = new Set(['won', 'do_not_contact', 'bad_data', 'lost before free trial', 'lost after free trial']);

export function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function optionalText(value, field, max = 120) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw inputError(`${field} non valido`);
  }
  return value.trim();
}

export function optionalUuid(value, field) {
  const text = optionalText(value, field, 36);
  if (text && !UUID.test(text)) throw inputError(`${field} non valido`);
  return text;
}

export function optionalInstant(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw inputError(`${field} non valido`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw inputError(`${field} non valido`);
  return date.toISOString();
}

export function graderContactFields(body) {
  const firstName = optionalText(body.firstName, 'Nome');
  const lastName = optionalText(body.lastName, 'Cognome');
  if (Boolean(firstName) !== Boolean(lastName)) throw inputError('Nome e cognome devono essere forniti insieme');
  const graderLeadId = optionalUuid(body.graderLeadId, 'graderLeadId');
  const callScheduledAt = optionalInstant(body.callScheduledAt, 'callScheduledAt');
  if (callScheduledAt && body.callRequested !== true) throw inputError('callRequested richiesto');
  const callRequestedAt = optionalInstant(body.callRequestedAt, 'callRequestedAt');
  if (callScheduledAt && !callRequestedAt) throw inputError('callRequestedAt richiesto');
  const properties = {};
  if (callRequestedAt) properties.callRequestedAt = callRequestedAt;
  if (firstName && lastName) Object.assign(properties, { firstName, lastName, contactName: `${firstName} ${lastName}` });
  if (graderLeadId) properties.graderLeadId = graderLeadId;
  if (callScheduledAt) Object.assign(properties, { callScheduledAt, callTimeZone: 'Europe/Rome' });
  for (const key of ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'variant', 'landingUrl']) {
    const value = optionalText(body[key], key, 500);
    if (value) properties[key] = value;
  }
  return properties;
}

/** Replay of the same request must not re-create a callback already completed by an AE. */
export function applyGraderCallback(contact, previousProperties = {}) {
  const p = contact.properties || {};
  if (!p.callScheduledAt || !p.callRequestedAt || NO_CALLBACK.has(contact.status)) return;
  // Legacy requests lack callScheduledAt and completion timestamps. Enrich their
  // booking details, but never guess whether an AE already completed the callback.
  if (previousProperties.callRequestedAt && new Date(previousProperties.callRequestedAt).getTime() === new Date(p.callRequestedAt).getTime()) return;
  if (previousProperties.callbackUpdatedAt && new Date(previousProperties.callbackUpdatedAt) >= new Date(p.callRequestedAt)) return;
  p.callbackAt = p.callScheduledAt;
  p.callbackNote = p.callNote || 'Chiamata prenotata dal grader';
  p.callbackOrigin = 'grader';
  p.callbackUpdatedAt = p.callRequestedAt;
  if (EARLY_STATUSES.has(contact.status)) contact.status = 'da richiamare';
  contact.markModified('properties');
}

export function withoutStaleBooking(incoming, existing) {
  const result = { ...incoming };
  if (existing?.callRequestedAt && incoming.callRequestedAt && new Date(incoming.callRequestedAt) < new Date(existing.callRequestedAt)) {
    for (const key of ['callRequested', 'callPreference', 'callRequestedAt', 'callNote', 'callScheduledAt', 'callTimeZone']) delete result[key];
  }
  return result;
}

export async function recordGraderBooking(contact, ownerId) {
  const p = contact.properties || {};
  if (!p.callRequested || !p.callRequestedAt || !ownerId) return;
  const key = createHash('sha256').update(`${contact._id}:${p.callRequestedAt}:${p.callPreference || ''}`).digest('hex');
  await Activity.updateOne({ externalEventId: `grader-call:${key}` }, { $setOnInsert: {
    contact: contact._id, type: 'note', title: 'Chiamata richiesta dal grader',
    description: [p.callPreference, p.callNote].filter(Boolean).join(' — ').slice(0, 5000),
    createdBy: ownerId, data: { kind: 'grader_call_requested', origin: 'rank_checker', meta: {
      requestedAt: p.callRequestedAt, scheduledAt: p.callScheduledAt || null,
    } },
  } }, { upsert: true, runValidators: true });
}

/** Fail/retry when a user or another integration changed the document since it was read. */
export async function saveGraderContact(contact) {
  await contact.validate();
  contact.lists = [...new Set(contact.lists)];
  const saved = await Contact.findOneAndUpdate({ _id: contact._id, updatedAt: contact.updatedAt },
    contact.getChanges(), { new: true, runValidators: true });
  if (!saved) throw Object.assign(new Error('Contatto aggiornato contemporaneamente: riprovare'), { status: 409 });
  return saved;
}
