import express from 'express';
import { receiveRankCheckerLead, receiveAcquisitionLead, receiveSmartleadLead, pushLandingMessage, receiveOnboardingEvent } from '../controllers/inboundLeadController.js';
import { handleSmartleadWebhook } from '../controllers/smartleadWebhookController.js';
import { handleResendInbound } from '../controllers/resendWebhookController.js';
import { requireInboundLeadSecret } from '../middleware/inboundLeadSecretMiddleware.js';

const router = express.Router();

/**
 * Routes per la ricezione di lead inbound
 * PUBBLICHE - il Rank Checker usa un secret opzionale e retro-compatibile
 */

router.post('/rank-checker-lead', requireInboundLeadSecret, receiveRankCheckerLead);
router.post('/onboarding-event', receiveOnboardingEvent);
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
router.post('/landing-message', pushLandingMessage);

export default router;










