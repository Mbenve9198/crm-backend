import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Contact from '../../models/contactModel.js';
import { recoveryData } from '../fixtures/graderRecoveryData.js';
import { createGraderRecoveryService } from '../../services/graderAbandonmentRecoveryService.js';
import { createGraderRecoveryNotifier } from '../../services/graderRecoveryNotificationService.js';

let mongo, service, send, now;
const ownerId = new mongoose.Types.ObjectId();
const input = { recoveryId: '11111111-1111-4111-8111-111111111111', placeId: 'maps-test', restaurantName: 'Locale Test',
  phone: '+393331112222', email: 'info@locale.test', channel: 'whatsapp',
  reportUrl: 'https://menuchat.it/posizione/r/abcdefghijklmnop', sentAt: '2026-09-20T09:30:00Z', providerMessageId: 'message-test' };
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Contact.init();
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Contact.deleteMany({});
  now = new Date('2026-09-20T09:31:00Z');
  send = vi.fn().mockResolvedValue({ success: true, resendId: 'email-test' });
  const User = { findOne: () => ({ sort: async () => ({ _id: ownerId }) }) };
  service = createGraderRecoveryService(Contact, User, {}, createGraderRecoveryNotifier(Contact, send, () => now));
});
it('notifies the same team once for simultaneous syncs and subsequent retries', async () => {
  const results = await Promise.allSettled([service.sync(input), service.sync(input)]);
  expect(results.some(r => r.status === 'fulfilled')).toBe(true);
  await service.sync(input);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ leadSource: 'grader-abandoned',
    reportLink: input.reportUrl, idempotencyKey: `grader-recovery-${input.recoveryId}`,
    recovery: { channel: 'whatsapp', sentAt: input.sentAt } }));
  const contact = await Contact.findOne({ graderRecoveryId: input.recoveryId });
  expect(contact.status).toBe('da contattare');
  expect(contact.properties.graderRecoveryNotification.providerId).toBe('email-test');
});
it('retries a failed email without duplicating or resetting the CRM contact', async () => {
  send.mockResolvedValueOnce({ success: false, error: 'unavailable' });
  await expect(service.sync(input)).rejects.toMatchObject({ status: 503 });
  await Contact.updateOne({ graderRecoveryId: input.recoveryId }, { $set: { status: 'interessato' } });
  now = new Date(now.getTime() + 60_000);
  await service.sync(input);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
  expect(await Contact.countDocuments()).toBe(1);
  expect((await Contact.findOne({})).status).toBe('interessato');
});
it('recovers an interrupted notification with the same provider idempotency key', async () => {
  send.mockRejectedValueOnce(new Error('connection lost after acceptance'));
  await expect(service.sync(input)).rejects.toThrow();
  await expect(service.sync(input)).rejects.toMatchObject({ status: 503 });
  expect(send).toHaveBeenCalledTimes(1);
  now = new Date(now.getTime() + 6 * 60_000);
  await service.sync(input);
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
});
it('does not replay an ambiguous email outside the provider idempotency retention', async () => {
  send.mockRejectedValueOnce(new Error('connection lost'));
  await expect(service.sync(input)).rejects.toThrow();
  now = new Date(now.getTime() + 24 * 3600_000);
  await expect(service.sync(input)).rejects.toMatchObject({ status: 503 });
  expect(send).toHaveBeenCalledTimes(1);
});
it('notifies for confirmed email recoveries too', async () => {
  await service.sync({ ...input, channel: 'email', provider: 'smartlead', deliveryStatus: 'sent',
    providerCampaignId: 123, providerLeadId: 456 });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ recovery: { channel: 'email', sentAt: input.sentAt } }));
});
it('includes available grader analysis in new team notifications and freezes it across retries', async () => {
  const rich = { ...input, graderData: recoveryData };
  send.mockRejectedValueOnce(new Error('ambiguous response'));
  await expect(service.sync(rich)).rejects.toThrow();
  expect(send.mock.calls[0][0]).toMatchObject({ rankCheckerData: { keyword: 'trattoria',
    ranking: { mainRank: 2 }, restaurantData: { address: 'Via Roma 1', rating: 4.8 } },
    contact: { properties: { restaurantCity: 'Roma' } } });
  now = new Date(now.getTime() + 6 * 60_000);
  await service.sync({ ...rich, graderData: { ...recoveryData, keyword: 'pizzeria' } });
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
  await service.sync(rich);
  expect(send).toHaveBeenCalledTimes(2);
});
it('backfills a previously notified recovery without repeating its internal email', async () => {
  await service.sync(input);
  await service.sync({ ...input, graderData: recoveryData });
  expect(send).toHaveBeenCalledTimes(1);
  expect((await Contact.findOne({})).rankCheckerData.keyword).toBe('trattoria');
});
