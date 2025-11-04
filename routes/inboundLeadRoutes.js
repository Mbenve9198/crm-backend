import express from 'express';
import { receiveRankCheckerLead } from '../controllers/inboundLeadController.js';

const router = express.Router();

/**
 * Routes per la ricezione di lead inbound
 * PUBBLICHE - non richiedono autenticazione (webhook da sistemi esterni)
 */

/**
 * Riceve lead dal Rank Checker di MenuChat
 * POST /api/inbound/rank-checker-lead
 * 
 * Body:
 * {
 *   email: string,
 *   phone: string,
 *   restaurantName: string,
 *   placeId: string,
 *   keyword: string,
 *   rankingResults: object,
 *   qualificationData: object (opzionale)
 * }
 */
router.post('/rank-checker-lead', receiveRankCheckerLead);

export default router;






