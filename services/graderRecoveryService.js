import { createHash } from 'node:crypto';

export const GRADER_RECOVERY_BATCH = 'grader-state-recovery-2026-09-11';
export const GRADER_RECOVERY_LIST = 'Inbound - Grader recuperati';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The approved production IDs live in deployment configuration, never in this public repo. */
export function parseRecoveryManifest(raw) {
  const input = JSON.parse(raw);
  if (!Array.isArray(input) || input.length !== 37) throw new Error('Expected exactly 37 approved leads');
  const entries = input.map(entry => {
    if (!UUID.test(entry?.leadId || '')) throw new Error('Invalid recovery lead ID');
    const result = { leadId: entry.leadId.toLowerCase() };
    if (entry.booking) {
      for (const key of ['requestedAt', 'scheduledAt']) {
        const value = entry.booking[key];
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
          throw new Error('Invalid recovery booking timestamp');
        }
      }
      result.booking = {
        requestedAt: new Date(entry.booking.requestedAt).toISOString(),
        scheduledAt: new Date(entry.booking.scheduledAt).toISOString(),
      };
    }
    return result;
  }).sort((a, b) => a.leadId.localeCompare(b.leadId));
  if (new Set(entries.map(entry => entry.leadId)).size !== 37) throw new Error('Duplicate recovery lead IDs');
  if (entries.filter(entry => entry.booking).length !== 9) throw new Error('Expected exactly 9 approved bookings');
  return entries;
}

const identityFilter = leadId => ({ $or: [
  { graderLeadId: leadId }, { 'properties.graderLeadId': leadId }, { 'properties.onboardingLeadId': leadId },
] });

/** Atomic, audited, once-only reset. A later deployment must never undo an AE's work. */
export async function recoverApprovedGraderLeads(db, client, manifest, { apply = false } = {}) {
  // Validate even when called outside the CLI.
  const entries = parseRecoveryManifest(JSON.stringify(manifest));
  const digest = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  const contacts = db.collection('contacts');
  const activities = db.collection('activities');
  const batches = db.collection('grader_recovery_batches');
  const run = async session => {
    const options = session ? { session } : {};
    const batch = await batches.findOne({ _id: GRADER_RECOVERY_BATCH }, options);
    if (batch && batch.manifestHash !== digest) throw new Error('Recovery batch manifest changed');
    const resolved = [];
    const issues = [];
    for (const entry of entries) {
      const matches = await contacts.find(identityFilter(entry.leadId), options).limit(2).toArray();
      if (matches.length !== 1 || (matches[0].graderLeadId && matches[0].graderLeadId !== entry.leadId)) {
        issues.push({ leadId: entry.leadId, matches: matches.length });
      } else {
        resolved.push({ entry, contact: matches[0] });
      }
    }
    if (issues.length) throw new Error(`Recovery identity preflight failed: ${JSON.stringify(issues)}`);
    if (new Set(resolved.map(row => String(row.contact._id))).size !== entries.length) {
      throw new Error('Multiple grader IDs resolve to the same CRM contact');
    }
    const report = { batch: GRADER_RECOVERY_BATCH, mode: apply ? 'apply' : 'dry-run', matched: resolved.length,
      approvedBookings: 9, changed: 0, alreadyApplied: 0, contacts: [] };
    for (const { entry, contact } of resolved) {
      const p = contact.properties || {};
      const completed = p.graderRecoveryBatch === GRADER_RECOVERY_BATCH;
      const eventId = `${GRADER_RECOVERY_BATCH}:${entry.leadId}`;
      const audit = await activities.findOne({ externalEventId: eventId }, options);
      if (completed !== Boolean(audit) || (batch && !completed)) throw new Error('Inconsistent recovery audit markers');
      if (!contact.createdBy) throw new Error(`Missing audit actor for ${entry.leadId}`);
      const owner = contact.owner ? await db.collection('users').findOne({ _id: contact.owner }, options) : null;
      report.contacts.push({ leadId: entry.leadId, contactId: String(contact._id),
        status: completed ? contact.status : (apply ? 'da contattare' : contact.status),
        previousStatus: audit?.data?.statusChange?.oldStatus || contact.status,
        ownerId: contact.owner ? String(contact.owner) : null,
        ownerActive: owner?.isActive === true, ownerRole: owner?.role || null,
        dialable: /^\s*\+[0-9]/.test(contact.phone || ''), booked: Boolean(entry.booking), alreadyApplied: completed });
      if (completed) { report.alreadyApplied += 1; continue; }
      if (!apply) continue;
      const now = new Date();
      const updates = {
        status: 'da contattare', updatedAt: now,
        'properties.graderRecoveryBatch': GRADER_RECOVERY_BATCH,
        'properties.graderRecoveryAt': now.toISOString(),
      };
      // Fill historical structured booking data, preserving any newer CRM booking.
      if (entry.booking && (!p.callRequestedAt || Date.parse(p.callRequestedAt) <= Date.parse(entry.booking.requestedAt))) {
        Object.assign(updates, {
          'properties.callRequested': true,
          'properties.callRequestedAt': entry.booking.requestedAt,
          'properties.callScheduledAt': entry.booking.scheduledAt,
          'properties.callTimeZone': 'Europe/Rome',
        });
      }
      const previousFields = Object.fromEntries(Object.keys(updates).map(key => [key,
        key.startsWith('properties.') ? (p[key.slice(11)] ?? null) : (contact[key] ?? null)]));
      await activities.insertOne({ externalEventId: eventId, contact: contact._id,
        type: 'status_change', title: 'Recupero lead grader approvato',
        description: 'Ripristino a da contattare del gruppo approvato, incluse le chiamate prenotate.',
        createdBy: contact.createdBy, status: 'completed', createdAt: now, updatedAt: now,
        data: { kind: 'grader_status_recovery', origin: 'system',
          statusChange: { oldStatus: contact.status, newStatus: 'da contattare' },
          meta: { batch: GRADER_RECOVERY_BATCH, leadId: entry.leadId, manifestHash: digest,
            previousFields, previousLists: contact.lists || [] } },
      }, options);
      const result = await contacts.updateOne({ _id: contact._id }, {
        $set: updates, $addToSet: { lists: GRADER_RECOVERY_LIST },
      }, options);
      if (result.matchedCount !== 1) throw new Error('Contact disappeared during recovery');
      report.changed += 1;
    }
    if (apply && !batch) await batches.insertOne({ _id: GRADER_RECOVERY_BATCH, manifestHash: digest,
      appliedAt: new Date(), count: entries.length, contactIds: resolved.map(row => row.contact._id) }, options);
    return report;
  };
  if (!apply) return run(null);
  const session = client.startSession();
  try {
    return await session.withTransaction(() => run(session), {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
    });
  } finally { await session.endSession(); }
}
