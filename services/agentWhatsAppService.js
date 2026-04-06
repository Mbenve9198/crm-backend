/**
 * Agent WhatsApp Service — dynamic template creation for proactive outreach.
 * Creates a unique Twilio Content template for each message, requests approval,
 * polls for status, and sends when approved.
 *
 * Pattern from soapOperaWhatsAppService.js in menuchat-backend-master.
 */

import twilio from 'twilio';
import axios from 'axios';
import agentLogger from './agentLogger.js';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

const TWILIO_CONTENT_API = 'https://content.twilio.com/v1/Content';
const MAX_POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 15_000;

let twilioClient = null;

function getClient() {
  if (!twilioClient && ACCOUNT_SID && AUTH_TOKEN) {
    twilioClient = twilio(ACCOUNT_SID, AUTH_TOKEN);
  }
  return twilioClient;
}

function twilioAuth() {
  return { username: ACCOUNT_SID, password: AUTH_TOKEN };
}

/**
 * Full flow: create template → request approval → poll → send.
 * Returns immediately with a job object; actual send happens async.
 */
export async function sendProactiveWhatsApp({ phone, message, contactName, conversationId }) {
  if (!getClient()) {
    return { success: false, error: 'Twilio not configured' };
  }

  if (!phone) {
    return { success: false, error: 'No phone number' };
  }

  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  const waPhone = cleanPhone.startsWith('whatsapp:') ? cleanPhone : `whatsapp:${cleanPhone}`;

  try {
    const templateResult = await createDynamicTemplate(message, contactName);
    if (!templateResult.success) {
      return { success: false, error: `Template creation failed: ${templateResult.error}` };
    }

    agentLogger.info('whatsapp_template_created', {
      conversationId,
      data: { templateId: templateResult.templateId, name: templateResult.templateName }
    });

    const approved = await pollForApproval(templateResult.templateId);
    if (!approved.success) {
      agentLogger.warn('whatsapp_template_not_approved', {
        conversationId,
        data: { templateId: templateResult.templateId, status: approved.status, reason: approved.rejectionReason }
      });
      return { success: false, error: `Template ${approved.status}: ${approved.rejectionReason || 'not approved'}` };
    }

    agentLogger.info('whatsapp_template_approved', {
      conversationId,
      data: { templateId: templateResult.templateId }
    });

    const sendResult = await sendWithTemplate(waPhone, templateResult.templateId);

    agentLogger.info('whatsapp_sent', {
      conversationId,
      data: { messageSid: sendResult.messageSid, status: sendResult.status }
    });

    return sendResult;

  } catch (error) {
    agentLogger.error('whatsapp_send_error', {
      conversationId,
      data: { error: error.message, phone: cleanPhone }
    });
    return { success: false, error: error.message };
  }
}

async function createDynamicTemplate(message, contactName) {
  const timestamp = Date.now();
  const sanitizedName = (contactName || 'lead')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .substring(0, 20);

  const templateName = `agent_outreach_${sanitizedName}_${timestamp}`.substring(0, 64);

  let text = message;
  if (text.length > 1000) {
    text = text.substring(0, 997) + '...';
  }

  try {
    const response = await axios({
      method: 'post',
      url: TWILIO_CONTENT_API,
      auth: twilioAuth(),
      data: {
        friendly_name: templateName,
        language: 'it',
        variables: {},
        types: {
          'twilio/text': {
            body: text
          }
        }
      }
    });

    const templateId = response.data.sid;

    await axios({
      method: 'post',
      url: `${TWILIO_CONTENT_API}/${templateId}/ApprovalRequests/whatsapp`,
      auth: twilioAuth(),
      data: {
        name: templateName,
        category: 'MARKETING'
      }
    });

    return {
      success: true,
      templateId,
      templateName,
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

async function pollForApproval(templateId) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const response = await axios({
        method: 'get',
        url: `${TWILIO_CONTENT_API}/${templateId}/ApprovalRequests`,
        auth: twilioAuth(),
      });

      const status = response.data.whatsapp?.status || 'unknown';
      const rejectionReason = response.data.whatsapp?.rejection_reason || '';

      if (status === 'approved') {
        return { success: true, status };
      }
      if (status === 'rejected') {
        return { success: false, status, rejectionReason };
      }
    } catch (error) {
      agentLogger.warn('whatsapp_poll_error', { data: { templateId, attempt: i + 1, error: error.message } });
    }
  }

  return { success: false, status: 'timeout', rejectionReason: 'Approval polling timed out' };
}

async function sendWithTemplate(waPhone, templateId) {
  const client = getClient();

  const msg = await client.messages.create({
    contentSid: templateId,
    from: `whatsapp:${WHATSAPP_NUMBER}`,
    to: waPhone,
  });

  return {
    success: true,
    messageSid: msg.sid,
    status: msg.status,
    channel: 'whatsapp_dynamic_template',
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default { sendProactiveWhatsApp };
