import { describe, expect, it, vi, afterEach } from 'vitest';
import Contact from '../../models/contactModel.js';
import Activity from '../../models/activityModel.js';
import { graderContactFields, applyGraderCallback, withoutStaleBooking, recordGraderBooking } from '../../services/graderIntakeService.js';
import { resolveInboundContact } from '../../services/inboundContactIdentityService.js';
import { receiveOnboardingEvent } from '../../controllers/onboardingEventController.js';
import { requireCrmSyncSecret } from '../../middleware/inboundLeadSecretMiddleware.js';

const leadId = '11111111-1111-4111-8111-111111111111';
const booking = { callRequested: true, callRequestedAt: '2026-01-01T10:00:00.000Z',
  callScheduledAt: '2026-01-02T09:00:00.000Z', callPreference: '2 gennaio, ore 10:00' };
const response = () => { const res = { code: 200 }; res.status = code => { res.code = code; return res; }; res.json = body => { res.body = body; return res; }; return res; };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('grader CRM regression', () => {
  it('stores first/last names, attribution and the canonical scheduled instant', () => {
    expect(graderContactFields({ ...booking, graderLeadId: leadId, firstName: '  Élisa ', lastName: "D'Amico", utmSource: 'google' }))
      .toMatchObject({ graderLeadId: leadId, firstName: 'Élisa', lastName: "D'Amico", contactName: "Élisa D'Amico", utmSource: 'google', callTimeZone: 'Europe/Rome' });
    expect(() => graderContactFields({ firstName: 'Elisa' })).toThrow();
    expect(() => graderContactFields({ firstName: { $ne: null }, lastName: 'X' })).toThrow();
    expect(() => graderContactFields({ callScheduledAt: 'not-a-date' })).toThrow();
  });
  it('puts a booking in callbacks without reopening a completed callback on replay', () => {
    const contact = new Contact({ name: 'Test', status: 'da contattare', properties: { ...booking } });
    applyGraderCallback(contact);
    expect(contact.status).toBe('da richiamare');
    expect(contact.properties.callbackAt).toBe(booking.callScheduledAt);
    const previous = { ...contact.properties };
    delete contact.properties.callbackAt;
    applyGraderCallback(contact, previous);
    expect(contact.properties.callbackAt).toBeUndefined();
  });
  it.each(['won', 'do_not_contact', 'lost before free trial', 'lost after free trial', 'bad_data'])('preserves terminal %s', status => {
    const contact = new Contact({ name: 'Test', status, properties: { ...booking } });
    applyGraderCallback(contact);
    expect(contact.status).toBe(status);
    expect(contact.properties.callbackAt).toBeUndefined();
  });
  it('ignores stale bookings and preserves a more recent manual callback', () => {
    expect(withoutStaleBooking({ ...booking, firstName: 'Elisa' }, { callRequestedAt: '2026-02-01T00:00:00Z' })).toEqual({ firstName: 'Elisa' });
    const contact = new Contact({ name: 'Test', status: 'contattato', properties: { ...booking } });
    applyGraderCallback(contact, { callbackUpdatedAt: '2026-02-01T00:00:00Z' });
    expect(contact.properties.callbackAt).toBeUndefined();
  });
  it('does not match an event by restaurant name', async () => {
    const spy = vi.spyOn(Contact, 'find');
    expect(await resolveInboundContact({ restaurantName: 'Omonimo' })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
  it('refuses ambiguous sender identities', async () => {
    vi.spyOn(Contact, 'find').mockReturnValue({ limit: async () => [{ _id: 'one' }, { _id: 'two' }] });
    await expect(resolveInboundContact({ leadId })).rejects.toMatchObject({ status: 409 });
  });
  it('does not move an automatic preview to contattato and deduplicates its activity', async () => {
    const contact = new Contact({ name: 'Test', status: 'da contattare', owner: '111111111111111111111111', properties: {} });
    vi.spyOn(Contact, 'find').mockReturnValue({ limit: async () => [contact] });
    const update = vi.spyOn(Contact, 'findOneAndUpdate').mockImplementation(async (_filter, op) => {
      contact.status = op.$set.status;
      for (const [key, value] of Object.entries(op.$set)) if (key.startsWith('properties.')) contact.properties[key.slice(11)] = value;
      return contact;
    });
    const activity = vi.spyOn(Activity, 'updateOne').mockResolvedValue({ acknowledged: true });
    const body = { leadId, event: 'preview_sent', status: 'preview_sent', eventId: 'event-1', occurredAt: '2026-01-01T00:00:00Z' };
    for (let i = 0; i < 2; i++) { const res = response(); await receiveOnboardingEvent({ body }, res); expect(res.code).toBe(200); }
    expect(contact.status).toBe('da contattare');
    expect(update).toHaveBeenCalledTimes(1);
    expect(activity.mock.calls[0][0]).toEqual(activity.mock.calls[1][0]);
    expect(activity.mock.calls[0][1].$setOnInsert.type).toBe('note');
  });
  it('uses one idempotency key for repeated call notifications', async () => {
    const spy = vi.spyOn(Activity, 'updateOne').mockResolvedValue({ acknowledged: true });
    const contact = new Contact({ name: 'Test', properties: booking });
    await recordGraderBooking(contact, '111111111111111111111111');
    await recordGraderBooking(contact, '111111111111111111111111');
    expect(spy.mock.calls[0][0]).toEqual(spy.mock.calls[1][0]);
  });
  it('closes CRM writes even when the legacy public bypass is enabled', () => {
    vi.stubEnv('INBOUND_LEAD_SECRET', ''); vi.stubEnv('INBOUND_LEAD_ALLOW_PUBLIC', 'true');
    const next = vi.fn(); const res = response();
    requireCrmSyncSecret({ headers: {} }, res, next);
    expect(res.code).toBe(503); expect(next).not.toHaveBeenCalled();
  });
});
