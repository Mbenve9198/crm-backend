import { beforeEach, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import ContactModel from '../../models/contactModel.js';
import { createGraderRecoveryService, parseRecoveryInput, RECOVERY_LIST } from '../../services/graderAbandonmentRecoveryService.js';

const owner = new mongoose.Types.ObjectId();
const input = { recoveryId: '11111111-1111-4111-8111-111111111111', placeId: 'maps-test', restaurantName: 'Locale Test',
  phone: '+393331112222', email: 'info@locale.test', channel: 'whatsapp',
  reportUrl: 'https://menuchat.it/posizione/r/abcdefghijklmnop', sentAt: '2026-09-19T09:30:00Z', providerMessageId: 'message-test' };
let Contact, service;
beforeEach(() => {
  Contact = { findOne: vi.fn().mockResolvedValue(null), find: vi.fn(() => ({ limit: async () => [] })),
    create: vi.fn(async values => { const doc = new ContactModel(values); await doc.validate(); return doc; }),
    findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'existing' }) };
  const User = { findOne: () => ({ sort: async () => ({ _id: owner }) }) };
  service = createGraderRecoveryService(Contact, User, {});
});
it('creates a model-valid dedicated contact with the new list and delivery metadata', async () => {
  expect(await service.check(input)).toEqual({ eligible: true, reason: 'new_restaurant' });
  expect((await service.sync(parseRecoveryInput(input, true))).success).toBe(true);
  expect(Contact.create).toHaveBeenCalledWith(expect.objectContaining({ source: 'grader_abandoned',
    status: 'contattato', lists: [RECOVERY_LIST], graderRecoveryId: input.recoveryId, createdBy: owner }));
  expect(Contact.create.mock.calls[0][0].properties.graderRecovery.reportUrl).toBe(input.reportUrl);
});
it('does not change verified phone, owner, status or existing lists on a late matching contact', async () => {
  Contact.find.mockReturnValue({ limit: async () => [{ _id: 'existing', phone: '+393339998888', status: 'won' }] });
  await service.sync(input);
  const [filter, update] = Contact.findOneAndUpdate.mock.calls[0];
  expect(filter).toEqual({ _id: 'existing', graderRecoveryId: { $exists: false } });
  expect(Object.keys(update.$set).sort()).toEqual(['graderRecoveryId', 'properties.graderRecovery']);
  expect(update.$addToSet).toEqual({ lists: RECOVERY_LIST });
  expect(Contact.create).not.toHaveBeenCalled();
});
it('returns the prior contact on retries and reconciles unique-index races', async () => {
  Contact.find.mockReturnValueOnce({ limit: async () => [{ _id: 'already', graderRecoveryId: input.recoveryId }] });
  expect((await service.sync(input)).contactId).toBe('already');
  expect(Contact.create).not.toHaveBeenCalled();
  Contact.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));
  Contact.findOne.mockResolvedValueOnce({ _id: 'winner' });
  expect((await service.sync(input)).contactId).toBe('winner');
});
it('excludes every existing CRM contact and queries place, email and normalized phone', async () => {
  Contact.findOne.mockResolvedValue({ status: 'do_not_contact' });
  expect((await service.check(input)).eligible).toBe(false);
  const clauses = Contact.findOne.mock.calls[0][0].$or;
  expect(clauses).toContainEqual({ 'rankCheckerData.placeId': input.placeId });
  expect(clauses).toContainEqual({ email: input.email });
  const phone = clauses.find(item => item.phone)?.phone;
  expect(phone.test('333 111 2222')).toBe(true);
  expect(phone.test('+39 3331112222')).toBe(true);
});
it('stops ambiguous matches, stale updates, missing owners and malformed input', async () => {
  Contact.find.mockReturnValueOnce({ limit: async () => [{ _id: 'a' }, { _id: 'b' }] });
  await expect(service.sync(input)).rejects.toMatchObject({ status: 409 });
  Contact.find.mockReturnValueOnce({ limit: async () => [{ _id: 'a' }] });
  Contact.findOneAndUpdate.mockResolvedValueOnce(null);
  await expect(service.sync(input)).rejects.toMatchObject({ status: 409 });
  const noOwner = createGraderRecoveryService(Contact, { findOne: () => ({ sort: async () => null }) }, {});
  await expect(noOwner.sync(input)).rejects.toMatchObject({ status: 503 });
  expect(() => parseRecoveryInput({ ...input, placeId: { $ne: null } })).toThrow();
  expect(() => parseRecoveryInput({ ...input, reportUrl: 'javascript:alert(1)' }, true)).toThrow();
});
