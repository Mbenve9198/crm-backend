import express from 'express';
import { receiveRankCheckerLead, receiveSmartleadLead } from '../controllers/inboundLeadController.js';
import { handleSmartleadWebhook } from '../controllers/smartleadWebhookController.js';

const router = express.Router();

/**
 * Routes per la ricezione di lead inbound
 * PUBBLICHE - non richiedono autenticazione (webhook da sistemi esterni)
 */

/**
 * Riceve lead dal Rank Checker di MenuChat
 * POST /api/inbound/rank-checker-lead
 */
router.post('/rank-checker-lead', receiveRankCheckerLead);

/**
 * Riceve lead da Smartlead (formato legacy - chiamata diretta)
 * POST /api/inbound/smartlead-lead
 */
router.post('/smartlead-lead', receiveSmartleadLead);

/**
 * Webhook Smartlead con classificazione AI
 * POST /api/inbound/smartlead-webhook
 * 
 * Flusso: Webhook → AI classifica risposta → mappa campi → crea/aggiorna contatto CRM
 * 
 * Gestisce:
 * - EMAIL_REPLY → AI classifica → INTERESTED (CRM + notifica) / NOT_INTERESTED (CRM) / OUT_OF_OFFICE (skip)
 * - LEAD_CATEGORY_UPDATED → sincronizza categoria al CRM
 * - EMAIL_SENT → solo log
 */
router.post('/smartlead-webhook', handleSmartleadWebhook);

export default router;










