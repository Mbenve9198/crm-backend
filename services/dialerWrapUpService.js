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
