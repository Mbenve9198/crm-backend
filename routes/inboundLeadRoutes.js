import express from 'express';
import { receiveRankCheckerLead, receiveAcquisitionLead, receiveSmartleadLead, pushLandingMessage, receiveOnboardingEvent } from '../controllers/inboundLeadController.js';
import { handleSmartleadWebhook } from '../controllers/smartleadWebhookController.js';
import { handleResendInbound } from '../controllers/resendWebhookController.js';
import { requireInboundLeadSecret, requireCrmSyncSecret } from '../middleware/inboundLeadSecretMiddleware.js';
import { receiveGraderMessages } from '../controllers/graderMessageController.js';

const router = express.Router();

/**
 * Routes per la ricezione di lead inbound
 * Eventi e messaggi CRM richiedono sempre X-Inbound-Secret.
 */

router.post('/rank-checker-lead', requireInboundLeadSecret, receiveRankCheckerLead);
router.post('/onboarding-event', requireCrmSyncSecret, receiveOnboardingEvent);
router.post('/grader-messages', requireCrmSyncSecret, receiveGraderMessages);
router.post('/acquisition-lead', receiveAcquisitionLead);
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
router.post('/landing-message', requireCrmSyncSecret, pushLandingMessage);

export default router;









