import { sendInboundLeadNotification } from './emailNotificationService.js';

const FIELD = 'properties.graderRecoveryNotification';
const unavailable = () => Object.assign(new Error('Notifica recupero non disponibile'), { status: 503 });

/** Persistent receipt + provider idempotency: concurrent syncs cannot email twice. */
export function createGraderRecoveryNotifier(Contact, send = sendInboundLeadNotification, now = () => new Date()) {
  return async contactId => {
    const contact = await Contact.findById(contactId);
    if (!contact?.graderRecoveryId) throw unavailable();
    const notice = contact.properties?.graderRecoveryNotification || {};
    if (notice.sentAt) return;
    const at = now();
    // Resend retains idempotency keys for 24 hours. Never replay an old ambiguous send.
    if (notice.firstAttemptAt && at - new Date(notice.firstAttemptAt) >= 23 * 3600_000) throw unavailable();
    const claimed = await Contact.findOneAndUpdate({ _id: contact._id,
      graderRecoveryId: contact.graderRecoveryId,
      [`${FIELD}.sentAt`]: { $exists: false },
      $or: [{ [`${FIELD}.leaseUntil`]: { $exists: false } }, { [`${FIELD}.leaseUntil`]: { $lte: at } }],
    }, { $set: { [`${FIELD}.firstAttemptAt`]: notice.firstAttemptAt || at,
      [`${FIELD}.leaseUntil`]: new Date(at.getTime() + 5 * 60_000), [`${FIELD}.attemptedAt`]: at } }, { new: true });
    if (!claimed) {
      const latest = await Contact.findById(contactId);
      if (latest?.properties?.graderRecoveryNotification?.sentAt) return;
      throw unavailable();
    }
    const recovery = claimed.properties.graderRecovery;
    const result = await send({
      contact: { _id: claimed._id, name: recovery.restaurantName || claimed.name,
        phone: recovery.publicPhone, email: recovery.publicEmail },
      isNew: true, leadSource: 'grader-abandoned', reportLink: recovery.reportUrl,
      recovery: { channel: recovery.channel, sentAt: recovery.sentAt },
      notificationAt: recovery.sentAt,
      idempotencyKey: `grader-recovery-${claimed.graderRecoveryId}`,
    });
    if (!result?.success) {
      await Contact.updateOne({ _id: claimed._id, [`${FIELD}.attemptedAt`]: at }, {
        $unset: { [`${FIELD}.leaseUntil`]: 1 }, $set: { [`${FIELD}.lastError`]: 'email_not_confirmed' },
      });
      throw unavailable();
    }
    await Contact.updateOne({ _id: claimed._id, [`${FIELD}.attemptedAt`]: at }, {
      $set: { [`${FIELD}.sentAt`]: now(), [`${FIELD}.providerId`]: result.resendId },
      $unset: { [`${FIELD}.leaseUntil`]: 1, [`${FIELD}.lastError`]: 1 },
    });
  };
}
