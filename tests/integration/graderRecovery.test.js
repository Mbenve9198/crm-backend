import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { recoverApprovedGraderLeads, parseRecoveryManifest, GRADER_RECOVERY_LIST } from '../../services/graderRecoveryService.js';
import { fetchDialerQueue } from '../../services/dialerQueueService.js';
import '../../models/userModel.js';

let replica;
let db;
const owner = new mongoose.Types.ObjectId();
const manifest = Array.from({ length: 37 }, (_, i) => ({
  leadId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
  ...(i < 9 && { booking: { requestedAt: '2026-09-01T08:00:00.000Z', scheduledAt: '2026-09-14T09:00:00.000Z' } }),
}));
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri());
  db = mongoose.connection.db;
  await db.collection('activities').createIndex({ externalEventId: 1 }, { unique: true, sparse: true });
}, 60000);
afterAll(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });
afterEach(async () => {
  for (const name of ['contacts', 'activities', 'users', 'grader_recovery_batches']) await db.collection(name).deleteMany({});
});
async function seed() {
  await db.collection('users').insertOne({ _id: owner, isActive: true, role: 'agent', firstName: 'AE' });
  await db.collection('contacts').insertMany(manifest.map((entry, i) => ({
    name: `Lead ${i}`, phone: '+390212345678', status: 'contattato', owner, createdBy: owner,
    properties: { onboardingLeadId: entry.leadId, nearbyVerified: false, callbackNote: 'Preservare' }, lists: ['Inbound - Rank Checker'],
  })));
}
const recover = apply => recoverApprovedGraderLeads(db, mongoose.connection.getClient(), manifest, { apply });
describe('approved grader recovery', () => {
  it('validates the fixed batch size and booking count', () => {
    expect(() => parseRecoveryManifest(JSON.stringify(manifest.slice(1)))).toThrow();
    expect(() => parseRecoveryManifest(JSON.stringify(manifest.map(entry => ({ leadId: entry.leadId }))))).toThrow();
  });
  it('dry-run writes nothing; apply recovers exactly 37, keeps bookings and personal queue visibility, and never reopens AE work', async () => {
    await seed();
    expect((await recover(false)).matched).toBe(37);
    expect(await db.collection('activities').countDocuments()).toBe(0);
    expect(await db.collection('contacts').countDocuments({ status: 'contattato' })).toBe(37);
    expect((await recover(true)).changed).toBe(37);
    expect(await db.collection('contacts').countDocuments({ status: 'da contattare' })).toBe(37);
    expect(await db.collection('contacts').countDocuments({ 'properties.callRequested': true })).toBe(9);
    const queue = await fetchDialerQueue({ user: { _id: owner }, list: GRADER_RECOVERY_LIST });
    expect(queue.contacts).toHaveLength(37);
    expect(queue.contacts.filter(contact => contact.callRequested)).toHaveLength(9);
    expect(queue.contacts.find(contact => contact.callRequested).callScheduledAt).toBe('2026-09-14T09:00:00.000Z');
    expect((await fetchDialerQueue({ user: { _id: new mongoose.Types.ObjectId() }, list: GRADER_RECOVERY_LIST })).contacts).toHaveLength(0);
    await db.collection('contacts').updateOne({}, { $set: { status: 'won' } });
    expect((await recover(true)).alreadyApplied).toBe(37);
    expect(await db.collection('contacts').countDocuments({ status: 'won' })).toBe(1);
    expect(await db.collection('activities').countDocuments()).toBe(37);
  });
  it('rejects missing and ambiguous identities without partial writes', async () => {
    await seed();
    await db.collection('contacts').deleteOne({ 'properties.onboardingLeadId': manifest[0].leadId });
    await expect(recover(true)).rejects.toThrow('identity preflight');
    expect(await db.collection('activities').countDocuments()).toBe(0);
    expect(await db.collection('contacts').countDocuments({ status: 'da contattare' })).toBe(0);
  });
  it('rejects changed manifests after completion', async () => {
    await seed();
    await recover(true);
    const changed = structuredClone(manifest);
    changed[0].booking.scheduledAt = '2026-09-15T09:00:00.000Z';
    await expect(recoverApprovedGraderLeads(db, mongoose.connection.getClient(), changed, { apply: true })).rejects.toThrow('manifest changed');
  });
});
