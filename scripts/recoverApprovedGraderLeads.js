import 'dotenv/config';
import mongoose from 'mongoose';
import { parseRecoveryManifest, recoverApprovedGraderLeads } from '../services/graderRecoveryService.js';

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI required');
const manifest = parseRecoveryManifest(process.env.GRADER_CRM_RECOVERY_MANIFEST || 'null');
await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
try {
  const report = await recoverApprovedGraderLeads(mongoose.connection.db, mongoose.connection.getClient(), manifest,
    { apply: process.argv.includes('--apply') });
  console.info(`GRADER_RECOVERY_RESULT ${JSON.stringify(report)}`);
} finally { await mongoose.disconnect(); }
