import express from 'express';
import { receiveRankCheckerLead, receiveSmartleadLead } from '../controllers/inboundLeadController.js';
import { handleSmartleadWebhook } from '../controllers/smartleadWebhookController.js';
import { handleResendInbound } from '../controllers/resendWebhookController.js';

const router = express.Router();

/**
 * Routes per la ricezione di lead inbound
 * PUBBLICHE - non richiedono autenticazione (webhook da sistemi esterni)
 */

router.post('/rank-checker-lead', receiveRankCheckerLead);
router.post('/smartlead-lead', receiveSmartleadLead);
router.post('/smartlead-webhook', handleSmartleadWebhook);

/**
 * Resend Inbound Webhook — intercetta reply dei rank checker leads
 * POST /api/inbound/resend-webhook
 *
 * Prerequisiti:
 * - Dominio reply.menuchat.it con MX → inbound-smtp.resend.com
 * - Resend Dashboard: Inbound endpoint → questo URL
 * - SOAP Opera reply-to: agent+{leadId}@reply.menuchat.it
 */
router.post('/resend-webhook', handleResendInbound);

export default router;










