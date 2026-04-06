import axios from 'axios';

const CONTENT_API_BASE = 'https://content.twilio.com/v1/Content';

function getAuthHeader() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return null;
  }
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

export async function createWhatsAppTextContent({ friendlyName, language = 'it', bodyText, variables = { '1': 'Esempio' } }) {
  const auth = getAuthHeader();
  if (!auth) throw new Error('Twilio non configurato (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)');

  const payload = {
    friendly_name: friendlyName,
    language,
    variables,
    types: {
      // WhatsApp body via twilio/text. Variabili: {{1}}, {{2}}, ...
      'twilio/text': { body: bodyText }
    }
  };

  const resp = await axios.post(CONTENT_API_BASE, payload, {
    headers: { 'Content-Type': 'application/json', 'Authorization': auth },
    timeout: 15000
  });

  return { sid: resp.data?.sid, raw: resp.data };
}

export async function requestWhatsAppApproval({ contentSid, templateName, category = 'MARKETING' }) {
  const auth = getAuthHeader();
  if (!auth) throw new Error('Twilio non configurato (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)');
  if (!contentSid) throw new Error('contentSid mancante');

  const url = `${CONTENT_API_BASE}/${contentSid}/ApprovalRequests/whatsapp`;
  const resp = await axios.post(url, { name: templateName, category }, {
    headers: { 'Content-Type': 'application/json', 'Authorization': auth },
    timeout: 15000
  });
  return { raw: resp.data };
}

export async function getApprovalStatus({ contentSid }) {
  const auth = getAuthHeader();
  if (!auth) throw new Error('Twilio non configurato (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)');
  if (!contentSid) throw new Error('contentSid mancante');

  const url = `${CONTENT_API_BASE}/${contentSid}/ApprovalRequests`;
  const resp = await axios.get(url, {
    headers: { 'Authorization': auth },
    timeout: 15000
  });

  const status = resp.data?.whatsapp?.status || null;
  const rejectionReason = resp.data?.whatsapp?.rejection_reason || null;
  return { status, rejectionReason, raw: resp.data };
}

