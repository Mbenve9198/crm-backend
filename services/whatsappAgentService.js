import twilio from 'twilio';
import Conversation from '../models/conversationModel.js';
import Contact from '../models/contactModel.js';
import agentLogger from './agentLogger.js';

const getTwilioClient = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
};

const getWhatsAppFrom = () => {
  const number = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!number) return null;
  return number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;
};

export const sendWhatsAppTemplate = async (toPhone, contentSid, contentVariables = {}) => {
  try {
    const client = getTwilioClient();
    if (!client) return { success: false, reason: 'Twilio non configurato' };
    const from = getWhatsAppFrom();
    if (!from) return { success: false, reason: 'TWILIO_WHATSAPP_NUMBER non configurato' };

    const toFormatted = toPhone.startsWith('whatsapp:') ? toPhone : `whatsapp:${toPhone}`;
    const msgParams = { from, to: toFormatted, contentSid };

    if (Object.keys(contentVariables).length > 0) {
      msgParams.contentVariables = JSON.stringify(contentVariables);
    }

    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    if (messagingServiceSid) {
      msgParams.messagingServiceSid = messagingServiceSid;
      delete msgParams.from;
    }

    const message = await client.messages.create(msgParams);
    agentLogger.info('whatsapp_template_sent', { data: { to: toPhone, sid: message.sid } });
    return { success: true, messageSid: message.sid };
  } catch (error) {
    agentLogger.error('whatsapp_template_error', { data: { to: toPhone, error: error.message } });
    return { success: false, error: error.message };
  }
};

export const sendWhatsAppMessage = async (toPhone, body) => {
  try {
    const client = getTwilioClient();
    if (!client) return { success: false, reason: 'Twilio non configurato' };
    const from = getWhatsAppFrom();
    if (!from) return { success: false, reason: 'TWILIO_WHATSAPP_NUMBER non configurato' };

    const toFormatted = toPhone.startsWith('whatsapp:') ? toPhone : `whatsapp:${toPhone}`;
    const message = await client.messages.create({ from, to: toFormatted, body });
    agentLogger.info('whatsapp_message_sent', { data: { to: toPhone, sid: message.sid } });
    return { success: true, messageSid: message.sid };
  } catch (error) {
    agentLogger.error('whatsapp_message_error', { data: { to: toPhone, error: error.message } });
    return { success: false, error: error.message };
  }
};

/**
 * Gestisce messaggio WhatsApp in arrivo. Cerca contatto per TELEFONO,
 * poi cerca/crea conversazione, e invoca l'agente.
 */
export const handleIncomingWhatsApp = async (from, body) => {
  const phone = from.replace('whatsapp:', '');
  agentLogger.info('whatsapp_incoming', { data: { phone, bodyPreview: body.substring(0, 100) } });

  const normalizedVariants = [
    phone,
    phone.replace('+39', ''),
    `+39${phone.replace('+39', '')}`,
    phone.replace(/^0/, '+390')
  ];

  const contact = await Contact.findOne({
    $or: normalizedVariants.map(p => ({ phone: p }))
  });

  if (!contact) {
    agentLogger.info('whatsapp_unknown_number', { data: phone });
    return null;
  }

  let conversation = await Conversation.findActiveByContact(contact._id);

  if (conversation) {
    conversation.addMessage('lead', body, 'whatsapp');
    await conversation.save();
  }

  const { handleAgentConversation } = await import('./salesAgentService.js');
  const { classifyReply } = await import('./replyClassifierService.js');

  const aiResult = await classifyReply(body, { restaurantName: contact.name });

  const result = await handleAgentConversation({
    contact,
    replyText: body,
    category: aiResult.category,
    confidence: aiResult.confidence,
    extracted: aiResult.extracted || {},
    fromEmail: null,
    webhookBasic: {}
  });

  agentLogger.info('whatsapp_agent_result', { contactEmail: contact.email, data: result.action });
  return result;
};

export const canSendWhatsApp = (contact) => {
  if (!contact?.phone) return false;
  const phone = contact.phone.replace(/[\s\-\(\)]/g, '');
  return phone.length >= 10;
};

export default { sendWhatsAppTemplate, sendWhatsAppMessage, handleIncomingWhatsApp, canSendWhatsApp };
