import 'dotenv/config';
import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';
import Activity from '../models/activityModel.js';
import Conversation from '../models/conversationModel.js';

// No status guessing: the legacy preview activity did not record the previous status.
const apply = process.argv.includes('--apply-indexes');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI required');
await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
try {
  const callbacks = await Contact.find({ 'properties.callRequested': true,
    $or: [{ 'properties.callbackAt': { $exists: false } }, { 'properties.callbackAt': null }],
    'properties.callbackUpdatedAt': { $exists: false },
    status: { $nin: ['won', 'do_not_contact', 'bad_data', 'lost before free trial', 'lost after free trial'] },
  }).select('_id properties.callRequestedAt properties.callScheduledAt').lean();
  const previews = await Contact.find({ status: 'contattato', 'properties.onboardingLastEvent': 'preview_sent' })
    .select('_id properties.onboardingLastEventAt').lean();
  const ambiguous = await Contact.aggregate([
    { $match: { graderLeadId: { $type: 'string' } } },
    { $group: { _id: '$graderLeadId', contacts: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  console.info(JSON.stringify({ mode: apply ? 'apply-indexes' : 'dry-run',
    callbackCandidates: callbacks.map(contact => String(contact._id)),
    previewStatusNeedsReview: previews.map(contact => String(contact._id)),
    duplicateLeadIds: ambiguous.map(group => ({ leadId: group._id, contactIds: group.contacts })),
  }, null, 2));
  if (apply) {
    if (ambiguous.length) throw new Error('Resolve duplicate lead identities before creating unique indexes');
    await Contact.collection.createIndex({ graderLeadId: 1 }, { unique: true, sparse: true });
    await Activity.collection.createIndex({ externalEventId: 1 }, { unique: true, sparse: true });
    await Conversation.collection.createIndex({ externalThreadId: 1 }, { unique: true, sparse: true });
  }
} finally {
  await mongoose.disconnect();
}
