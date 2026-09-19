import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Contact from '../../models/contactModel.js';
import { createGraderRecoveryService, parseRecoveryInput, RECOVERY_LIST } from '../../services/graderAbandonmentRecoveryService.js';

let mongo, service;
const ownerId = new mongoose.Types.ObjectId();
const input = { recoveryId: '11111111-1111-4111-8111-111111111111', placeId: 'maps-test', restaurantName: 'Locale Test',
  phone: '+393331112222', email: 'info@locale.test', channel: 'whatsapp',
  reportUrl: 'https://menuchat.it/posizione/r/abcdefghijklmnop', sentAt: '2026-09-19T09:30:00Z', providerMessageId: 'message-test' };
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Contact.init();
  const User = { findOne: () => ({ sort: async () => ({ _id: ownerId }) }) };
  service = createGraderRecoveryService(Contact, User, {});
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Contact.deleteMany({}); });
it('creates a tagged contact and deduplicates simultaneous sync retries', async () => {
  expect(await service.check(input)).toEqual({ eligible: true, reason: 'new_restaurant' });
  const result = await Promise.all([service.sync(parseRecoveryInput(input, true)), service.sync(parseRecoveryInput(input, true))]);
  expect(result[0].contactId).toBe(result[1].contactId);
  const [contact] = await Contact.find({});
  expect(await Contact.countDocuments()).toBe(1);
  expect(contact.lists).toContain(RECOVERY_LIST);
  expect(contact.source).toBe('grader_abandoned');
  expect(contact.status).toBe('contattato');
  expect(contact.properties.graderRecovery.reportUrl).toBe(input.reportUrl);
});
it('excludes existing clients and opt-outs by restaurant, email or decorated phone', async () => {
  for (const status of ['won', 'do_not_contact', 'da contattare']) {
    await Contact.deleteMany({});
    await Contact.create({ name: 'Esistente', phone: '333 111 2222', status, mrr: 99, createdBy: ownerId });
    expect((await service.check(input)).eligible).toBe(false);
  }
});
it('preserves owner, sales status, lists and phone if a contact appears after preflight', async () => {
  const otherOwner = new mongoose.Types.ObjectId();
  const original = await Contact.create({ name: 'Confermato', email: input.email, phone: '+393339998888',
    status: 'won', mrr: 79, owner: otherOwner, createdBy: ownerId, lists: ['Clienti'] });
  await service.sync(input);
  const updated = await Contact.findById(original._id);
  expect(updated.phone).toBe(original.phone);
  expect(updated.status).toBe('won');
  expect(String(updated.owner)).toBe(String(otherOwner));
  expect(updated.lists).toEqual(expect.arrayContaining(['Clienti', RECOVERY_LIST]));
});
it('rejects ambiguous identities and malformed payloads', async () => {
  await Contact.create({ name: 'A', email: input.email, createdBy: ownerId });
  await Contact.create({ name: 'B', phone: input.phone, createdBy: ownerId });
  await expect(service.sync(input)).rejects.toMatchObject({ status: 409 });
  expect(() => parseRecoveryInput({ ...input, placeId: { $ne: null } })).toThrow();
  expect(() => parseRecoveryInput({ ...input, reportUrl: 'javascript:alert(1)' }, true)).toThrow();
});
