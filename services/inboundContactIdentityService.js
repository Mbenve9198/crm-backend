import Contact from '../models/contactModel.js';
import { legacyPhoneLookupPattern, normalizePhoneToE164 } from './phoneIdentityService.js';
import { inputError, optionalText } from './graderIntakeService.js';

/** Never attach an integration event by restaurant name alone. */
export async function resolveInboundContact(body) {
  const leadId = optionalText(body.graderLeadId ?? body.leadId, 'leadId', 120);
  const placeId = optionalText(body.placeId ?? body.meta?.placeId, 'placeId', 300);
  if (leadId) {
    const linked = await Contact.find({ $or: [{ graderLeadId: leadId }, { 'properties.graderLeadId': leadId }, { 'properties.onboardingLeadId': leadId }] }).limit(2);
    if (linked.length > 1) throw Object.assign(new Error('Identità lead ambigua'), { status: 409 });
    if (linked.length === 1) return linked[0];
  }
  const candidates = [];
  if (body.phone != null) {
    if (typeof body.phone !== 'string') throw inputError('Telefono non valido');
    const phone = normalizePhoneToE164(body.phone);
    if (!phone) throw inputError('Telefono non valido');
    candidates.push({ phone: legacyPhoneLookupPattern(phone.e164) });
  }
  const email = optionalText(body.email, 'email', 254);
  if (email) candidates.push({ email: email.toLowerCase() });
  if (!candidates.length) return null;
  const filter = { $or: candidates, ...(placeId && { 'rankCheckerData.placeId': placeId }) };
  const contacts = await Contact.find(filter).limit(2);
  if (contacts.length > 1) throw Object.assign(new Error('Identità lead ambigua'), { status: 409 });
  const contact = contacts[0] || null;
  if (contact?.graderLeadId && leadId && contact.graderLeadId !== leadId) {
    throw Object.assign(new Error('Il contatto è collegato a un altro lead'), { status: 409 });
  }
  return contact;
}
