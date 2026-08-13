export const PIPELINE_STATUSES = [
  'interessato',
  'qr code inviato',
  'free trial iniziato',
  'won',
  'lost before free trial',
  'lost after free trial',
];

/** Esito chiamata → status contatto se il client non lo manda (tab vecchie / PUT /calls). */
export const DIALER_OUTCOME_STATUS = {
  'not-interested': 'do_not_contact',
  'free-trial-sold': 'free trial iniziato',
  'first-call': 'contattato',
  'callback': 'da richiamare',
  'follow-up': 'da richiamare',
  'no-answer': 'da richiamare',
  'voicemail': 'da richiamare',
};

export function resolveDialerContactStatus(outcome, explicitStatus) {
  if (explicitStatus) return explicitStatus;
  return DIALER_OUTCOME_STATUS[outcome] || null;
}

/**
 * Applica lo status dialer sul contatto. Per stati pipeline usa mrr esplicito,
 * altrimenti quello già sul contatto, altrimenti 0 — così "Non interessato"
 * delle tab vecchie non resta bloccato su "MRR obbligatorio".
 */
export function applyDialerContactStatus(contact, status, mrr) {
  if (!status || status === contact.status) {
    return { changed: false, oldStatus: contact.status };
  }
  const oldStatus = contact.status;
  if (PIPELINE_STATUSES.includes(status)) {
    const nextMrr = mrr !== undefined && mrr !== null ? mrr : contact.mrr;
    contact.mrr = nextMrr !== undefined && nextMrr !== null ? nextMrr : 0;
  }
  contact.status = status;
  const closeDateStatuses = ['qr code inviato', 'free trial iniziato'];
  if (closeDateStatuses.includes(status) && !closeDateStatuses.includes(oldStatus)) {
    if (!contact.properties) contact.properties = {};
    if (!contact.properties.closeDate) {
      const auto = new Date();
      auto.setDate(auto.getDate() + 25);
      contact.properties.closeDate = auto.toISOString();
      contact.markModified?.('properties');
    }
  }
  return { changed: true, oldStatus };
}

/**
 * Se wrap-up arriva con un callId assente dal DB, non bloccare lo status del contatto.
 * L'esito (es. Non interessato → do_not_contact) deve comunque uscire dalla coda.
 *
 * @param {{ call: { contact?: unknown, initiatedBy?: unknown } | null, callId?: string, contactId: string, userId: string, userRole?: string }} args
 * @returns {{ ok: true, call: object | null, missingCall?: boolean } | { ok: false, status: number, message: string }}
 */
export function evaluateWrapUpCall({ call, callId, contactId, userId, userRole }) {
  if (!callId) {
    return { ok: true, call: null };
  }
  if (!call) {
    return { ok: true, call: null, missingCall: true };
  }

  const callContactId = call.contact && (call.contact._id || call.contact);
  if (String(callContactId) !== String(contactId)) {
    return {
      ok: false,
      status: 400,
      message: 'La chiamata non appartiene a questo contatto',
    };
  }

  const initiatedById = call.initiatedBy && (call.initiatedBy._id || call.initiatedBy);
  const canEditCall =
    String(initiatedById) === String(userId) ||
    userRole === 'admin' ||
    userRole === 'manager';
  if (!canEditCall) {
    return {
      ok: false,
      status: 403,
      message: 'Non hai i permessi per modificare questa chiamata',
    };
  }

  return { ok: true, call };
}
