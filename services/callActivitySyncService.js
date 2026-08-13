import Activity from '../models/activityModel.js';

export function formatCallDuration(seconds) {
  const s = parseInt(seconds, 10) || 0;
  if (!s) return '';
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export function mapTwilioStatusToOutcome(status) {
  const map = {
    completed: 'not-logged',
    'no-answer': 'no-answer',
    busy: 'busy',
    failed: 'not-logged',
    canceled: 'not-logged',
  };
  return map[status] || 'not-logged';
}

/**
 * Se `incomingNotes` è omesso (webhook Twilio), riusa le note già salvate.
 * Solo un valore esplicito (anche stringa vuota) le sostituisce.
 */
export function resolveActivityNotes(incomingNotes, existingNotes) {
  if (incomingNotes !== undefined && incomingNotes !== null) {
    return String(incomingNotes).trim();
  }
  return existingNotes != null ? String(existingNotes).trim() : '';
}

export function buildCallActivityDescription(outcomeLabel, duration, notesText) {
  const base = `Chiamata completata - ${outcomeLabel}${duration ? ` (${formatCallDuration(duration)})` : ''}`;
  return notesText ? `${base}\n\n${notesText}`.slice(0, 5000) : base;
}

/**
 * Crea o aggiorna l'activity timeline del contatto per una chiamata Twilio.
 */
export async function syncCallActivity(call, {
  callOutcome,
  callDuration,
  recordingUrl,
  recordingSid,
  recordingDuration,
  notes,
  finalStatus,
} = {}) {
  const twilioCallSid = call.twilioCallSid;
  let activity = await Activity.findOne({ type: 'call', 'data.twilioCallSid': twilioCallSid });

  const duration = callDuration ?? call.duration ?? 0;
  const resolvedOutcome = callOutcome || mapTwilioStatusToOutcome(finalStatus || call.status);
  const existing = activity
    ? (activity.data?.toObject?.() || activity.data || {})
    : {};

  const notesText = resolveActivityNotes(notes, existing.notes);

  const next = {
    ...existing,
    twilioCallSid,
    direction: 'outbound',
    callDuration: duration,
  };

  if (callOutcome) {
    if (callOutcome !== 'not-logged' || !existing.callOutcome || existing.callOutcome === 'not-logged') {
      next.callOutcome = callOutcome;
    } else {
      next.callOutcome = existing.callOutcome;
    }
  } else if (existing.callOutcome) {
    next.callOutcome = existing.callOutcome;
  } else {
    next.callOutcome = resolvedOutcome;
  }

  if (recordingUrl) next.recordingUrl = recordingUrl;
  if (recordingSid) next.recordingSid = recordingSid;
  if (recordingDuration !== undefined && recordingDuration !== null) {
    next.recordingDuration = parseInt(recordingDuration, 10) || 0;
  }
  if (finalStatus) next.finalStatus = finalStatus;
  if (notesText) {
    next.notes = notesText;
  } else if (notes !== undefined && notes !== null) {
    delete next.notes;
  }

  const outcomeLabel = next.callOutcome || resolvedOutcome;
  const description = buildCallActivityDescription(outcomeLabel, duration, notesText);

  if (activity) {
    activity.data = next;
    activity.status = 'completed';
    activity.description = description;
    activity.markModified('data');
    await activity.save();
    console.log(`📝 Activity chiamata aggiornata: ${activity._id}`);
    return activity;
  }

  activity = new Activity({
    type: 'call',
    contact: call.contact,
    createdBy: call.initiatedBy,
    status: 'completed',
    title: 'Chiamata effettuata',
    description,
    data: next,
  });
  await activity.save();
  console.log(`📝 Activity chiamata creata automaticamente: ${activity._id} (${twilioCallSid})`);
  return activity;
}
