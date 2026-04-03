import axios from 'axios';
import Contact from '../models/contactModel.js';
import Activity from '../models/activityModel.js';
import { classifyReply } from '../services/replyClassifierService.js';
import { handleAgentConversation, routeLeadReply } from '../services/salesAgentService.js';
import { sendSmartleadInterestedNotification } from '../services/emailNotificationService.js';
import agentLogger from '../services/agentLogger.js';

/**
 * POST /api/inbound/resend-webhook
 * Riceve email in arrivo da Resend Inbound.
 * Il webhook contiene solo metadati — il body va fetchato via GET /emails/{email_id}.
 */
export const handleResendInbound = async (req, res) => {
  try {
    const payload = req.body;

    if (payload.type && payload.type !== 'email.received') {
      return res.status(200).json({ success: true, message: 'Event type ignored' });
    }

    const eventData = payload.data || payload;
    const emailId = eventData.email_id;
    const from = eventData.from || '';
    const toRaw = eventData.to || [];
    const toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw;
    const subject = eventData.subject || '';

    agentLogger.info('resend_inbound', { data: { from, to: toAddress, subject, emailId } });

    const fromEmail = extractEmail(from);
    if (!fromEmail) {
      return res.status(200).json({ success: true, message: 'No sender' });
    }

    const leadId = extractLeadIdFromTo(toAddress);

    // Fetch body via Resend API (il webhook NON lo include)
    let replyText = '';
    if (emailId && process.env.RESEND_API_KEY) {
      try {
        const resp = await axios.get(`https://api.resend.com/emails/${emailId}`, {
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
          timeout: 10000
        });
        replyText = resp.data?.text || stripHtml(resp.data?.html) || '';
      } catch (err) {
        agentLogger.warn('resend_body_fetch_failed', { data: err.message });
      }
    }

    // Fallback se il payload contiene il body direttamente
    if (!replyText) {
      replyText = eventData.text || eventData.body || '';
      if (!replyText && eventData.html) replyText = stripHtml(eventData.html);
    }

    if (!replyText || replyText.trim().length < 2) {
      return res.status(200).json({ success: true, message: 'Empty body' });
    }

    // Trova contatto: prima per leadId (dal reply-to), poi per email
    let contact = null;
    if (leadId) {
      const { default: mongoose } = await import('mongoose');
      if (mongoose.Types.ObjectId.isValid(leadId)) {
        contact = await Contact.findById(leadId);
      }
    }
    if (!contact) {
      contact = await Contact.findOne({ email: fromEmail.toLowerCase() });
    }
    if (!contact) {
      return res.status(200).json({ success: true, message: 'Contact not found' });
    }

    const ownerId = contact.owner || contact.createdBy;

    // Classifica
    const aiResult = await classifyReply(replyText, { restaurantName: contact.name, subject });
    const { category, confidence, reason, extracted } = aiResult;

    // Hydrate telefono se estratto
    if (extracted?.phone && !contact.phone) {
      contact.phone = extracted.phone;
      await contact.save();
    }

    const routing = routeLeadReply(category, confidence, extracted, replyText);

    // --- DIRECT HANDOFF ---
    if (routing.action === 'direct_handoff') {
      await persistActivity(contact, 'Lead INTERESSATO (Resend)', replyText, { category, confidence, reason }, ownerId);
      await sendSmartleadInterestedNotification({
        email: contact.email, name: contact.name,
        phone: contact.phone || extracted?.phone,
        campaignName: 'Rank Checker (Resend Inbound)',
        replyText, aiClassification: { category, confidence, reason }, subject
      });
      return res.status(200).json({ success: true, action: 'direct_handoff' });
    }

    // --- DNC / LOST: persisti su DB ---
    if (routing.action === 'stop' || routing.action === 'track_lost') {
      contact.status = 'lost before free trial';
      if (contact.mrr == null) contact.mrr = 0;
      await contact.save();
      const title = routing.action === 'stop' ? 'DO NOT CONTACT (Resend)' : 'NON INTERESSATO (Resend)';
      await persistActivity(contact, title, replyText, { category, confidence, reason }, ownerId);
      return res.status(200).json({ success: true, action: routing.action });
    }

    // --- OOO: activity per tracking ---
    if (routing.action === 'resume_sequence') {
      await persistActivity(contact, 'OUT OF OFFICE (Resend)', replyText, { category, confidence, reason }, ownerId);
      return res.status(200).json({ success: true, action: 'resume_sequence' });
    }

    // --- AGENT ---
    await persistActivity(contact, `Risposta lead — ${category}`, replyText, { category, confidence, reason }, ownerId);

    try {
      const agentResult = await handleAgentConversation({
        contact, replyText, category, confidence, extracted,
        fromEmail: null, webhookBasic: {}
      });
      return res.status(200).json({ success: true, action: agentResult.action });
    } catch (agentErr) {
      agentLogger.error('resend_agent_error', { contactEmail: contact.email, data: agentErr.message });
      return res.status(200).json({ success: true, action: 'agent_error' });
    }

  } catch (error) {
    agentLogger.error('resend_webhook_error', { data: error.message });
    return res.status(200).json({ success: false, error: error.message });
  }
};

async function persistActivity(contact, title, replyText, aiClassification, ownerId) {
  try {
    await Activity.create({
      contact: contact._id,
      type: 'email',
      title,
      description: `Risposta:\n${replyText.substring(0, 1500)}`,
      data: {
        origin: 'smartlead',
        replyText: replyText.substring(0, 2000),
        aiClassification
      },
      createdBy: ownerId
    });
  } catch { /* non bloccante */ }
}

const extractLeadIdFromTo = (to) => {
  const match = (to || '').match(/agent\+([a-zA-Z0-9]+)@/);
  return match ? match[1] : null;
};

const extractEmail = (from) => {
  const match = (from || '').match(/<([^>]+)>/) || (from || '').match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1].toLowerCase() : (from || '').toLowerCase().trim();
};

const stripHtml = (html) => {
  if (!html) return '';
  return html.replace(/<style[^>]*>.*<\/style>/gmi, '').replace(/<script[^>]*>.*<\/script>/gmi, '').replace(/<[^>]+>/gm, ' ').replace(/\s\s+/g, ' ').trim();
};

export default { handleResendInbound };
