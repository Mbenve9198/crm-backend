import crypto from 'crypto';

const getSecret = () => process.env.JWT_SECRET;

export const generateSignedActionUrl = (conversationId, action, expiresInHours = 48) => {
  const exp = Date.now() + expiresInHours * 60 * 60 * 1000;
  const payload = `${conversationId}:${action}:${exp}`;
  const token = crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');

  const backendUrl = process.env.BACKEND_URL;
  return `${backendUrl}/api/agent/email-action?id=${conversationId}&action=${action}&exp=${exp}&token=${token}`;
};

export const verifySignedUrl = (conversationId, action, exp, token) => {
  if (Date.now() > parseInt(exp)) return false;
  const payload = `${conversationId}:${action}:${exp}`;
  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
};

export const getISOWeek = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
};

export const buildFeedbackContext = (conversation) => ({
  stage: conversation.stage,
  source: conversation.context?.leadSource,
  objections: conversation.context?.objections || [],
  painPoints: conversation.context?.painPoints || [],
  messageCount: conversation.messages?.length || 0,
  leadLastMessage: conversation.messages?.filter(m => m.role === 'lead').pop()?.content?.substring(0, 500)
});

export const renderHtmlPage = (title, message, color) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f4f4f4;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:400px;margin:20px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center">
<div style="background:${color};color:white;padding:30px 20px">
<h1 style="margin:0;font-size:24px">${title}</h1>
</div>
<div style="padding:30px 20px">
<p style="color:#333;font-size:16px;line-height:1.6">${message}</p>
<p style="color:#9ca3af;font-size:12px;margin-top:20px">Puoi chiudere questa pagina.</p>
</div>
</div></body></html>`;

export default { generateSignedActionUrl, verifySignedUrl, getISOWeek, buildFeedbackContext, renderHtmlPage };
