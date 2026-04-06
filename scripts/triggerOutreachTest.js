#!/usr/bin/env node
/**
 * Crea un AgentTask immediato per test E2E outreach.
 *
 * Uso:
 *   node scripts/triggerOutreachTest.js [email]           → follow-up (aggancia conversation se c’è)
 *   node scripts/triggerOutreachTest.js [email] --first   → primo outreach rank_checker (no conversation)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Contact from '../models/contactModel.js';
import Conversation from '../models/conversationModel.js';
import AgentTask from '../models/agentTaskModel.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const argv = process.argv.slice(2).filter((a) => a !== '--first');
const firstOutreach = process.argv.includes('--first');
const email = (argv[0] || 'marco@midachat.com').toLowerCase().trim();

async function main() {
  if (!MONGODB_URI) {
    console.error('Imposta MONGODB_URI nel .env');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);

  const contact = await Contact.findOne({ email }).lean();
  if (!contact) {
    console.error('Contatto non trovato:', email);
    process.exit(1);
  }

  let conversation = null;
  if (!firstOutreach) {
    conversation = await Conversation.findOne({
      contact: contact._id,
      status: { $in: ['active', 'awaiting_human', 'paused'] }
    })
      .sort({ updatedAt: -1 })
      .select('_id')
      .lean();
  }

  const taskType = firstOutreach ? 'rank_checker_outreach' : 'follow_up_no_reply';
  const task = await AgentTask.create({
    type: taskType,
    contact: contact._id,
    conversation: firstOutreach ? undefined : conversation?._id || undefined,
    scheduledAt: new Date(),
    context: {
      source: 'manual_outreach_e2e_test',
      reason: firstOutreach
        ? 'Test primo outreach (rank_checker) — email + WA se configurato'
        : 'Test E2E email + job WhatsApp (template/approval)'
    },
    createdBy: 'human',
    priority: 'high'
  });

  console.log('Task creato:', task._id.toString());
  console.log('Tipo:', taskType, firstOutreach ? '(nessuna conversation — simula primo contatto)' : '');
  console.log('Contatto:', email, '| tel:', contact.phone || '(manca — WA non partirà)');
  console.log('Conversation:', firstOutreach ? '(omessa di proposito)' : (conversation?._id?.toString() || '(nessuna — il processor ne crea una se serve)'));
  console.log('');
  console.log('Condizioni runtime:');
  console.log('  - Task processor: solo 9:00–20:00 Europe/Rome, ogni ~10 min');
  console.log('  - Invio email automatico su draft_ready: AGENT_APPROVAL_MODE non impostato a true');
  console.log('  - WhatsApp in parallelo (non reactivation): PROACTIVE_DUAL_CHANNEL_WHATSAPP=true sul CRM');
  console.log('  - Worker approvazione/invio WA: ENABLE_AGENT_OUTREACH=true + Twilio');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
