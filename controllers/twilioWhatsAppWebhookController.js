import agentLogger from '../services/agentLogger.js';
import { handleIncomingWhatsApp } from '../services/whatsappAgentService.js';

/**
 * Webhook inbound WhatsApp da Twilio.
 * POST /api/webhooks/twilio-whatsapp
 */
export const twilioWhatsAppInbound = async (req, res) => {
  try {
    const from = req.body?.From || req.body?.from;
    const body = (req.body?.Body || req.body?.body || '').toString();

    if (!from) return res.status(400).json({ success: false, error: 'Missing From' });
    if (!body.trim()) return res.status(200).json({ success: true, ignored: true });

    await handleIncomingWhatsApp(from, body);
    return res.status(200).json({ success: true });
  } catch (err) {
    agentLogger.error('twilio_whatsapp_webhook_error', { data: { error: err.message } });
    return res.status(500).json({ success: false, error: err.message });
  }
};

export default { twilioWhatsAppInbound };

