import OutboundMessageJob from '../models/outboundMessageJobModel.js';
import agentLogger from './agentLogger.js';
import { createWhatsAppTextContent, requestWhatsAppApproval, getApprovalStatus } from './twilioContentApiService.js';
import { sendWhatsAppMessage, sendWhatsAppTemplate } from './whatsappAgentService.js';

const WORKER_INTERVAL_MS = 60 * 1000;

function computeBackoffMs(attempts) {
  if (attempts <= 1) return 30 * 1000;
  if (attempts === 2) return 60 * 1000;
  if (attempts === 3) return 2 * 60 * 1000;
  return 5 * 60 * 1000;
}

function hasInboundAfter(conversation, afterDate) {
  if (!conversation || !afterDate) return false;
  const cutoff = new Date(afterDate).getTime();
  return (conversation.messages || []).some(m =>
    m.role === 'lead' && m.createdAt && new Date(m.createdAt).getTime() > cutoff
  );
}

function isWhatsAppWindowOpen(conversation) {
  const until = conversation?.channelState?.whatsappWindowOpenUntil;
  if (!until) return false;
  return Date.now() <= new Date(until).getTime();
}

async function processJob(job) {
  const conversation = job.conversation && typeof job.conversation === 'object'
    ? job.conversation
    : null;
  const contact = job.contact && typeof job.contact === 'object'
    ? job.contact
    : null;

  if (!conversation || !contact) {
    job.sendStatus = 'failed';
    job.lastError = 'Job senza conversation/contact popolati';
    return;
  }

  // Anti-duplicazione: se è arrivata una risposta, non inviare.
  if (job.cancelIfInboundAfter && hasInboundAfter(conversation, job.cancelIfInboundAfter)) {
    job.sendStatus = 'skipped';
    job.lastError = 'Skipped: inbound ricevuto prima dell’invio';
    return;
  }

  // Ricalcola sendMode in base alla finestra 24h corrente
  job.sendMode = isWhatsAppWindowOpen(conversation) ? 'freeform' : 'template';

  const toPhone = contact.phone;
  if (!toPhone) {
    job.sendStatus = 'failed';
    job.lastError = 'Contatto senza numero di telefono';
    return;
  }

  if (job.sendMode === 'freeform') {
    const r = await sendWhatsAppMessage(toPhone, job.messageText);
    if (r.success) {
      job.sendStatus = 'sent';
      job.twilioMessageSid = r.messageSid;
      job.sentAt = new Date();
      return;
    }
    job.sendStatus = 'failed';
    job.lastError = r.error || r.reason || 'Errore invio WhatsApp freeform';
    return;
  }

  // Template path (Content API + approval)
  if (!job.twilioContentSid) {
    const safeName = `agent_${contact._id.toString().slice(-6)}_${Date.now()}`.substring(0, 64);
    const created = await createWhatsAppTextContent({
      friendlyName: safeName,
      language: 'it',
      bodyText: job.messageText,
      variables: { '1': 'Esempio' }
    });
    job.twilioContentSid = created.sid;
    job.twilioTemplateName = safeName;
    job.approvalStatus = 'not_requested';
  }

  if (job.approvalStatus === 'not_requested') {
    await requestWhatsAppApproval({
      contentSid: job.twilioContentSid,
      templateName: job.twilioTemplateName,
      category: 'MARKETING'
    });
    job.approvalStatus = 'pending';
    job.approvalRequestedAt = new Date();
  }

  const statusResp = await getApprovalStatus({ contentSid: job.twilioContentSid });
  const status = (statusResp.status || '').toLowerCase();

  if (status === 'approved') {
    job.approvalStatus = 'approved';
    const r = await sendWhatsAppTemplate(toPhone, job.twilioContentSid, {});
    if (r.success) {
      job.sendStatus = 'sent';
      job.twilioMessageSid = r.messageSid;
      job.sentAt = new Date();
      return;
    }
    job.sendStatus = 'failed';
    job.lastError = r.error || r.reason || 'Errore invio WhatsApp template';
    return;
  }

  if (status === 'rejected') {
    job.approvalStatus = 'rejected';
    job.sendStatus = 'failed';
    job.lastError = `Template rifiutato: ${statusResp.rejectionReason || 'unknown'}`;
    return;
  }

  // pending/unknown: resta in coda
  job.approvalStatus = 'pending';
  job.sendStatus = 'queued';
}

export function startOutboundMessageWorker() {
  agentLogger.info('outbound_worker_start', { data: { intervalMs: WORKER_INTERVAL_MS } });

  const tick = async () => {
    try {
      const due = await OutboundMessageJob.findDueJobs(10);
      if (!due.length) return;

      for (const job of due) {
        job.sendStatus = 'sending';
        job.attempts += 1;
        job.lastError = null;
        await job.save();

        try {
          await processJob(job);
        } catch (err) {
          job.sendStatus = 'failed';
          job.lastError = err.message;
        }

        if (job.sendStatus === 'failed' || job.sendStatus === 'queued') {
          job.nextRetryAt = new Date(Date.now() + computeBackoffMs(job.attempts));
        } else {
          job.nextRetryAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        }

        await job.save();
      }
    } catch (err) {
      agentLogger.error('outbound_worker_error', { data: { error: err.message } });
    }
  };

  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), WORKER_INTERVAL_MS);
}

export default { startOutboundMessageWorker };

