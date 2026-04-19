import { Resend } from 'resend';

/**
 * Servizio per inviare notifiche email al team via Resend
 * Usato per notificare quando un lead Smartlead risponde positivamente
 */

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.FROM_EMAIL || 'noreply@menuchat.com';

/**
 * Invia notifica al team quando un lead Smartlead è classificato come INTERESTED
 */
export const sendSmartleadInterestedNotification = async (data) => {
  try {
    if (!resend) {
      console.warn('⚠️ Resend non configurato, skip notifica');
      return { success: false, error: 'Resend non configurato' };
    }

    const {
      email, name, phone, campaignName, replyText,
      aiClassification, subject,
      // Properties dal webhook
      website, location, customFields
    } = data;

    const confidencePercent = ((aiClassification?.confidence || 0) * 100).toFixed(0);

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
<div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

<div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px 20px; text-align: center;">
  <h1 style="margin: 0; font-size: 28px;">✨ Lead Interessato da Smartlead!</h1>
  <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">Risposta positiva alla campagna email</p>
</div>

<div style="padding: 30px 20px;">
  <div style="text-align: center; margin-bottom: 20px;">
    <span style="background-color: #10b981; color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: bold;">
      🤖 AI: INTERESTED (${confidencePercent}% confidence)
    </span>
  </div>
  <p style="text-align: center; color: #6b7280; font-size: 13px; margin-top: 5px;">${aiClassification?.reason || ''}</p>

  <div style="background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
    <h2 style="color: #059669; margin: 0 0 15px 0; font-size: 20px;">👤 Dati Contatto</h2>
    <p style="margin: 5px 0;"><strong>Nome:</strong> ${name || 'N/A'}</p>
    <p style="margin: 5px 0;"><strong>Email:</strong> <a href="mailto:${email}" style="color: #059669;">${email}</a></p>
    ${phone ? `<p style="margin: 5px 0;"><strong>Telefono:</strong> <a href="tel:${phone}" style="color: #059669; font-size: 18px; font-weight: bold;">${phone}</a></p>` : ''}
    ${location ? `<p style="margin: 5px 0;"><strong>Località:</strong> ${location}</p>` : ''}
    ${website ? `<p style="margin: 5px 0;"><strong>Sito:</strong> <a href="${website}" style="color: #059669;" target="_blank">${website}</a></p>` : ''}
  </div>

  <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
    <h2 style="color: #d97706; margin: 0 0 10px 0; font-size: 18px;">📧 Campagna</h2>
    <p style="margin: 5px 0;"><strong>Nome:</strong> ${campaignName || 'N/A'}</p>
    ${subject ? `<p style="margin: 5px 0;"><strong>Oggetto:</strong> ${subject}</p>` : ''}
  </div>

  <div style="background-color: #ede9fe; border-left: 4px solid #8b5cf6; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
    <h2 style="color: #7c3aed; margin: 0 0 10px 0; font-size: 18px;">💬 Risposta del Lead</h2>
    <div style="background-color: white; padding: 15px; border-radius: 8px; border: 1px solid #ddd6fe; font-style: italic; white-space: pre-wrap;">${(replyText || 'Nessun testo').substring(0, 1000)}</div>
  </div>

  ${customFields && Object.keys(customFields).length > 0 ? `
  <div style="background-color: #f8f9fa; border-left: 4px solid #6366f1; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
    <h2 style="color: #4f46e5; margin: 0 0 10px 0; font-size: 18px;">📋 Campi Custom Smartlead</h2>
    ${Object.entries(customFields).map(([k, v]) => `<p style="margin: 3px 0;"><strong>${k}:</strong> ${v}</p>`).join('')}
  </div>` : ''}

  <div style="text-align: center; margin-top: 30px;">
    ${phone ? `<a href="tel:${phone}" style="display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 16px 40px; text-decoration: none; border-radius: 25px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 12px rgba(16,185,129,0.4);">📞 CHIAMA ORA</a><br><br>` : ''}
    <a href="mailto:${email}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; font-size: 14px;">✉️ Rispondi via Email</a>
  </div>

  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; text-align: center;">
    <p style="margin: 5px 0;">⏰ Risposta ricevuta il ${new Date().toLocaleString('it-IT')}</p>
    <p style="margin: 5px 0;">💡 <strong>Azione:</strong> Contattare il prima possibile!</p>
  </div>
</div>
</div></body></html>`;

    const result = await resend.emails.send({
      from: fromEmail,
      to: ['marco@midachat.com'],
      bcc: ['marco.benvenuti91@gmail.com', 'federico@midachat.com'],
      subject: `✨ SMARTLEAD INTERESTED: ${name || email} ${location ? `(${location})` : ''} — risposta positiva!`,
      html
    });

    console.log(`✅ Notifica email inviata al team per ${name || email} (Resend ID: ${result.data?.id})`);
    return { success: true, resendId: result.data?.id };

  } catch (error) {
    console.error('❌ Errore invio notifica email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Invia email al team quando l'agente AI ha bisogno di review umano
 */
export const sendAgentHumanReviewEmail = async (data) => {
  try {
    if (!resend) {
      console.warn('⚠️ Resend non configurato, skip email review');
      return { success: false, error: 'Resend non configurato' };
    }

    const {
      restaurantName, city, rank, keyword, rating, reviewsCount,
      leadMessage, draftReply, reason, conversationId,
      contactEmail, msgCount, objections,
      approveLink, modifyLink, discardLink
    } = data;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
<div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

<div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 25px 20px; text-align: center;">
  <h1 style="margin: 0; font-size: 22px;">🤖 AI Agent chiede consiglio</h1>
  <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">${restaurantName}${city ? ` (${city})` : ''}</p>
</div>

<div style="padding: 25px 20px;">
  <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin-bottom: 15px; border-radius: 4px;">
    <strong>Perché chiedo:</strong> ${reason}
  </div>

  <div style="margin-bottom: 15px;">
    <strong>Contesto:</strong><br>
    ${rank ? `Posizione: ${rank}° per "${keyword || 'N/A'}"<br>` : ''}
    ${rating ? `Rating: ${rating}/5 con ${reviewsCount || '?'} recensioni<br>` : ''}
    ${msgCount ? `Messaggi nella conversazione: ${msgCount}<br>` : ''}
    ${objections?.length > 0 ? `Obiezioni: ${objections.join(', ')}<br>` : ''}
  </div>

  <div style="background-color: #ede9fe; border-left: 4px solid #8b5cf6; padding: 12px; margin-bottom: 15px; border-radius: 4px;">
    <strong>Risposta del lead:</strong><br>
    <div style="background: white; padding: 10px; border-radius: 6px; margin-top: 8px; font-style: italic; white-space: pre-wrap;">${(leadMessage || '').substring(0, 800)}</div>
  </div>

  ${draftReply ? `
  <div style="background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 12px; margin-bottom: 15px; border-radius: 4px;">
    <strong>Bozza dell'agente:</strong><br>
    <div style="background: white; padding: 10px; border-radius: 6px; margin-top: 8px; white-space: pre-wrap;">${draftReply.substring(0, 800)}</div>
  </div>` : ''}

  <div style="text-align: center; margin-top: 25px;">
    ${draftReply ? `<a href="${approveLink}" style="display: inline-block; background: #10b981; color: white; padding: 12px 25px; text-decoration: none; border-radius: 20px; font-weight: bold; margin: 5px;">✅ Approva e Invia</a>` : ''}
    <a href="${modifyLink}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 25px; text-decoration: none; border-radius: 20px; font-weight: bold; margin: 5px;">✏️ Modifica nel CRM</a>
    <a href="${discardLink}" style="display: inline-block; background: #ef4444; color: white; padding: 12px 25px; text-decoration: none; border-radius: 20px; font-weight: bold; margin: 5px;">🗑️ Scarta</a>
  </div>

  <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #dee2e6; font-size: 11px; color: #6c757d; text-align: center;">
    <p>Conversazione ID: ${conversationId} | Lead: ${contactEmail}</p>
  </div>
</div>
</div></body></html>`;

    const result = await resend.emails.send({
      from: fromEmail,
      to: ['marco@midachat.com'],
      subject: `🤖 [AI Agent] Consiglio su: ${restaurantName}${city ? ` (${city})` : ''} — ${reason}`,
      html
    });

    return { success: true, resendId: result.data?.id };
  } catch (error) {
    console.error('❌ Errore invio email review agente:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Invia email di report interna per ogni attivita dell'agente AI.
 * Per monitoraggio in tempo reale durante il periodo iniziale.
 */
export const sendAgentActivityReport = async ({ action, contactName, contactEmail, contactPhone, agentName, leadMessage, agentReply, toolsUsed, category, confidence, conversationId, source }) => {
  try {
    if (!resend) return;

    const actionLabels = {
      'auto_sent': 'RISPOSTA INVIATA',
      'awaiting_human': 'RICHIESTA REVIEW',
      'direct_handoff': 'LEAD CALDO → TEAM',
      'scheduled_followup': 'FOLLOW-UP PROGRAMMATO',
      'track_lost': 'LEAD PERSO',
      'stop': 'DO NOT CONTACT',
      'resume_sequence': 'OUT OF OFFICE',
      'error': 'ERRORE',
      'outreach_sent': 'OUTREACH INVIATO',
      'classified': 'CLASSIFICAZIONE'
    };

    const actionLabel = actionLabels[action] || action;
    const actionColors = {
      'auto_sent': '#10b981',
      'awaiting_human': '#f59e0b',
      'direct_handoff': '#3b82f6',
      'outreach_sent': '#8b5cf6',
      'track_lost': '#ef4444',
      'stop': '#dc2626',
      'classified': '#6366f1'
    };
    const color = actionColors[action] || '#6b7280';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;line-height:1.5;color:#333;margin:0;padding:0;background:#f4f4f4">
<div style="max-width:600px;margin:15px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
<div style="background:${color};color:white;padding:15px 20px">
  <h2 style="margin:0;font-size:16px">AI Agent: ${actionLabel}</h2>
  <p style="margin:4px 0 0;font-size:13px;opacity:0.9">${contactName || 'Lead'} ${source ? '(' + source + ')' : ''}</p>
</div>
<div style="padding:15px 20px;font-size:13px">
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:3px 8px 3px 0;color:#6b7280;width:120px">Ristorante</td><td style="padding:3px 0"><strong>${contactName || '-'}</strong></td></tr>
    <tr><td style="padding:3px 8px 3px 0;color:#6b7280">Email</td><td style="padding:3px 0">${contactEmail || '-'}</td></tr>
    ${contactPhone ? `<tr><td style="padding:3px 8px 3px 0;color:#6b7280">Telefono</td><td style="padding:3px 0"><strong>${contactPhone}</strong></td></tr>` : ''}
    ${category ? `<tr><td style="padding:3px 8px 3px 0;color:#6b7280">Classificazione</td><td style="padding:3px 0">${category} (${((confidence || 0) * 100).toFixed(0)}%)</td></tr>` : ''}
    <tr><td style="padding:3px 8px 3px 0;color:#6b7280">Agente</td><td style="padding:3px 0">${agentName || '-'}</td></tr>
    ${toolsUsed?.length ? `<tr><td style="padding:3px 8px 3px 0;color:#6b7280">Tool usati</td><td style="padding:3px 0">${toolsUsed.join(', ')}</td></tr>` : ''}
  </table>

  ${leadMessage ? `<div style="margin-top:12px;padding:10px;background:#f3f4f6;border-left:3px solid #6366f1;border-radius:4px">
    <div style="font-size:11px;color:#6b7280;margin-bottom:4px">Messaggio lead:</div>
    <div style="white-space:pre-wrap">${leadMessage.substring(0, 500)}</div>
  </div>` : ''}

  ${agentReply ? `<div style="margin-top:8px;padding:10px;background:#f0fdf4;border-left:3px solid #10b981;border-radius:4px">
    <div style="font-size:11px;color:#6b7280;margin-bottom:4px">Risposta agente:</div>
    <div style="white-space:pre-wrap">${agentReply.substring(0, 800)}</div>
  </div>` : ''}

  ${conversationId ? `<div style="margin-top:10px;text-align:center"><a href="${process.env.FRONTEND_URL || 'https://crm-frontend-pied-sigma.vercel.app'}/agent/review?id=${conversationId}" style="display:inline-block;background:${color};color:white;padding:8px 20px;text-decoration:none;border-radius:15px;font-size:12px;font-weight:bold">Vedi nel CRM</a></div>` : ''}

  <div style="margin-top:10px;font-size:10px;color:#9ca3af;text-align:center">${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</div>
</div></div></body></html>`;

    await resend.emails.send({
      from: fromEmail,
      to: ['marco@midachat.com'],
      subject: `[AI Agent] ${actionLabel}: ${contactName || contactEmail || 'Lead'}`,
      html
    });
  } catch {
    // Non bloccante -- il report e' solo per monitoraggio
  }
};

/**
 * Invia briefing del Sales Manager al team.
 */
export const sendSalesManagerBriefing = async (briefing, performance = {}) => {
  try {
    if (!resend) return;

    const highlights = (briefing.highlights || []).map(h => `<li style="color:#16a34a">${h}</li>`).join('');
    const concerns = (briefing.concerns || []).map(c => `<li style="color:#dc2626">${c}</li>`).join('');
    const actions = (briefing.next_actions || []).map(a => `<li>${a}</li>`).join('');

    const perfHtml = performance.conversion_rate != null
      ? `<div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px">
          <strong>Performance:</strong> Conv rate ${(performance.conversion_rate * 100).toFixed(1)}% |
          Approval ${(performance.approval_rate * 100).toFixed(1)}% |
          Costo/lead $${performance.avg_cost_per_lead_usd?.toFixed(2) || '?'}
        </div>`
      : '';

    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="margin-bottom:4px">${briefing.headline || 'Sales Manager Briefing'}</h2>
      <p style="color:#64748b;margin-top:0">${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</p>
      <p>${briefing.summary || ''}</p>
      ${highlights ? `<h3 style="color:#16a34a;margin-bottom:4px">Highlights</h3><ul>${highlights}</ul>` : ''}
      ${concerns ? `<h3 style="color:#dc2626;margin-bottom:4px">Concerns</h3><ul>${concerns}</ul>` : ''}
      ${actions ? `<h3 style="margin-bottom:4px">Next Actions</h3><ul>${actions}</ul>` : ''}
      ${perfHtml}
    </body></html>`;

    await resend.emails.send({
      from: fromEmail,
      to: ['marco@midachat.com'],
      subject: `[Sales Manager] ${briefing.headline || 'Briefing'}`,
      html
    });
  } catch {
    // non-blocking
  }
};

/**
 * Notifica interna: arrivata reply da un lead della campagna outbound.
 */
export const sendOutboundReplyNotification = async ({ leadEmail, replyBody, intent, score, interactionId }) => {
  try {
    if (!resend) return { success: false, error: 'Resend non configurato' };

    const intentEmoji = {
      INTERESTED_WITH_PHONE: '🟢', INTERESTED_NO_PHONE: '🟡',
      INFO_REQUEST: '🔵', OBJECTION_SOFT: '🟠',
      OBJECTION_FIRM: '🔴', NOT_INTERESTED: '🔴',
      UNSUBSCRIBE: '⛔', OOO: '⏸️',
    }[intent] || '⚪';

    const intentColors = {
      INTERESTED_WITH_PHONE: '#10b981', INTERESTED_NO_PHONE: '#f59e0b',
      INFO_REQUEST: '#3b82f6', OBJECTION_SOFT: '#f97316',
      OBJECTION_FIRM: '#ef4444', NOT_INTERESTED: '#ef4444',
    };
    const color = intentColors[intent] || '#6b7280';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;line-height:1.5;color:#333;margin:0;padding:0;background:#f4f4f4">
<div style="max-width:600px;margin:15px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
<div style="background:${color};color:white;padding:15px 20px">
  <h2 style="margin:0;font-size:17px">${intentEmoji} Nuova reply outbound</h2>
  <p style="margin:4px 0 0;font-size:13px;opacity:0.9">${leadEmail}</p>
</div>
<div style="padding:15px 20px;font-size:13px">
  <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
    <tr><td style="padding:3px 8px 3px 0;color:#6b7280;width:80px">Da</td><td><strong>${leadEmail}</strong></td></tr>
    <tr><td style="padding:3px 8px 3px 0;color:#6b7280">Intent</td><td><strong>${intent}</strong> — score ${score}/10</td></tr>
  </table>
  <div style="padding:12px;background:#f3f4f6;border-left:3px solid ${color};border-radius:4px">
    <div style="font-size:11px;color:#6b7280;margin-bottom:6px">Testo reply</div>
    <div style="white-space:pre-wrap">${(replyBody || '').substring(0, 2000).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>
  <div style="margin-top:10px;font-size:10px;color:#9ca3af;text-align:right">${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} · ${interactionId}</div>
</div></div></body></html>`;

    const result = await resend.emails.send({
      from: fromEmail,
      to: ['marco@midachat.com'],
      bcc: ['federico@midachat.com'],
      subject: `${intentEmoji} Reply da ${leadEmail} — ${intent} (${score}/10)`,
      html,
    });
    return { success: true, resendId: result.data?.id };
  } catch (error) {
    console.error('❌ sendOutboundReplyNotification:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Notifica interna: l'agente outbound ha inviato una risposta.
 */
export const sendOutboundAgentReplyNotification = async ({ leadEmail, agentReply, intent, interactionId }) => {
  try {
    if (!resend) return { success: false, error: 'Resend non configurato' };

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;line-height:1.5;color:#333;margin:0;padding:0;background:#f4f4f4">
<div style="max-width:600px;margin:15px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
<div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;padding:15px 20px">
  <h2 style="margin:0;font-size:17px">🤖 Agente ha risposto</h2>
  <p style="margin:4px 0 0;font-size:13px;opacity:0.9">${leadEmail} · ${intent}</p>
</div>
<div style="padding:15px 20px;font-size:13px">
  <div style="border-left:4px solid #7c3aed;padding:12px 16px;background:#f9f7ff;border-radius:0 6px 6px 0">
    <div style="font-size:11px;color:#7c3aed;margin-bottom:6px;font-weight:bold">Risposta inviata</div>
    <div style="white-space:pre-wrap">${(agentReply || '').substring(0, 2000).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>
  <div style="margin-top:10px;font-size:10px;color:#9ca3af;text-align:right">${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} · ${interactionId}</div>
</div></div></body></html>`;

    const result = await resend.emails.send({
      from: fromEmail,
      to: ['marco@midachat.com'],
      bcc: ['federico@midachat.com'],
      subject: `🤖 Agente ha risposto a ${leadEmail}`,
      html,
    });
    return { success: true, resendId: result.data?.id };
  } catch (error) {
    console.error('❌ sendOutboundAgentReplyNotification:', error.message);
    return { success: false, error: error.message };
  }
};

export default { sendSmartleadInterestedNotification, sendAgentHumanReviewEmail, sendAgentActivityReport, sendSalesManagerBriefing, sendOutboundReplyNotification, sendOutboundAgentReplyNotification };
