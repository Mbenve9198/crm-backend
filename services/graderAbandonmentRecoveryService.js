import validator from 'validator';
import { normalizePhoneToE164, legacyPhoneLookupPattern } from './phoneIdentityService.js';

export const RECOVERY_LIST = 'Posizione — recupero abbandoni';
export function parseRecoveryInput(body, sync = false) {
  if (!body || typeof body !== 'object' || !validator.isUUID(String(body.recoveryId || ''))
    || typeof body.placeId !== 'string' || !body.placeId.trim() || body.placeId.length > 300
    || typeof body.restaurantName !== 'string' || !body.restaurantName.trim() || body.restaurantName.length > 500) {
    throw Object.assign(new Error('Identità recupero non valida'), { status: 400 });
  }
  const phone = body.phone ? normalizePhoneToE164(body.phone)?.e164 : null;
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  if (body.phone && !phone || email && !validator.isEmail(email) || !phone && !email) {
    throw Object.assign(new Error('Recapito non valido'), { status: 400 });
  }
  if (sync && (body.deliveryStatus !== undefined && body.deliveryStatus !== 'sent'
    || body.provider !== undefined && !['unipile', 'smartlead'].includes(body.provider)
    || body.provider === 'smartlead' && (body.channel !== 'email' || body.deliveryStatus !== 'sent'
      || !Number.isSafeInteger(body.providerCampaignId) || body.providerCampaignId < 1
      || !Number.isSafeInteger(body.providerLeadId) || body.providerLeadId < 1))) {
    throw Object.assign(new Error('Invio provider non confermato'), { status: 400 });
  }
  if (sync && (!['whatsapp', 'email'].includes(body.channel) || !validator.isISO8601(String(body.sentAt || ''))
    || typeof body.reportUrl !== 'string' || !validator.isURL(body.reportUrl, { protocols: ['https'], require_protocol: true })
    || typeof body.providerMessageId !== 'string' || !body.providerMessageId)) {
    throw Object.assign(new Error('Esito invio incompleto'), { status: 400 });
  }
  return { recoveryId: body.recoveryId, placeId: body.placeId.trim(), restaurantName: body.restaurantName.trim(),
    phone: phone || null, email, channel: body.channel, reportUrl: body.reportUrl,
    sentAt: body.sentAt, providerMessageId: body.providerMessageId, deliveryStatus: body.deliveryStatus,
    provider: body.provider, providerCampaignId: body.providerCampaignId, providerLeadId: body.providerLeadId };
}
export function recoveryIdentityQuery(input) {
  const alternatives = [{ graderRecoveryId: input.recoveryId }, { 'rankCheckerData.placeId': input.placeId },
    { 'properties.graderRecovery.placeId': input.placeId }];
  if (input.email) alternatives.push({ email: input.email });
  if (input.phone) alternatives.push({ phone: legacyPhoneLookupPattern(input.phone) });
  return { $or: alternatives };
}
export function createGraderRecoveryService(Contact, User, env = process.env) {
  return {
    async check(input) {
      const contact = await Contact.findOne(recoveryIdentityQuery(input));
      // Existing contacts are excluded conservatively, including clients and opt-outs.
      return { eligible: !contact, reason: contact ? 'existing_crm_contact' : 'new_restaurant' };
    },
    async sync(input) {
      const matches = await Contact.find(recoveryIdentityQuery(input)).limit(2);
      if (matches.length > 1) throw Object.assign(new Error('Identità CRM ambigua'), { status: 409 });
      const previous = matches[0];
      if (previous?.graderRecoveryId === input.recoveryId) return { success: true, contactId: String(previous._id) };
      if (previous?.graderRecoveryId) throw Object.assign(new Error('Recupero già collegato'), { status: 409 });
      const properties = { id: input.recoveryId, placeId: input.placeId, channel: input.channel,
        reportUrl: input.reportUrl, sentAt: input.sentAt, providerMessageId: input.providerMessageId,
        deliveryStatus: 'sent', provider: input.provider, providerCampaignId: input.providerCampaignId,
        providerLeadId: input.providerLeadId, publicPhone: input.phone, publicEmail: input.email, leadSource: 'grader-abandoned' };
      if (previous) {
        // A contact created between preflight and sync keeps its owner/status/verified phone.
        const updated = await Contact.findOneAndUpdate({ _id: previous._id, graderRecoveryId: { $exists: false } }, {
          $set: { graderRecoveryId: input.recoveryId, 'properties.graderRecovery': properties },
          $addToSet: { lists: RECOVERY_LIST },
        }, { new: true, runValidators: true });
        if (!updated) throw Object.assign(new Error('Contatto aggiornato nel frattempo'), { status: 409 });
        return { success: true, contactId: String(updated._id) };
      }
      let owner = env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL
        ? await User.findOne({ email: env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL.toLowerCase(), isActive: true }) : null;
      owner ??= await User.findOne({ role: { $in: ['admin', 'manager'] }, isActive: true }).sort({ createdAt: 1 });
      if (!owner) throw Object.assign(new Error('Owner CRM non configurato'), { status: 503 });
      try {
        const created = await Contact.create({ graderRecoveryId: input.recoveryId, name: input.restaurantName,
          ...(input.email ? { email: input.email } : {}), ...(input.phone ? { phone: input.phone } : {}),
          source: 'grader_abandoned', lists: [RECOVERY_LIST], status: 'contattato',
          properties: { graderRecovery: properties }, owner: owner._id, createdBy: owner._id });
        return { success: true, contactId: String(created._id) };
      } catch (error) {
        if (error.code !== 11000) throw error;
        const duplicate = await Contact.findOne({ graderRecoveryId: input.recoveryId });
        if (!duplicate) throw Object.assign(new Error('Recapito già presente nel CRM'), { status: 409 });
        return { success: true, contactId: String(duplicate._id) };
      }
    },
  };
}
