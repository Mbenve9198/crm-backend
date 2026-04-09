import mongoose from 'mongoose';
import AgentTask from '../models/agentTaskModel.js';

/**
 * One-time cleanup script:
 * 1. Cancel all zombie seasonal_reactivation tasks for caminovecchio@gmail.com
 * 2. Cancel duplicate pending tasks (same contact + same type)
 * 3. Fail tasks stuck in 'executing' for > 30 min
 * 4. Fail tasks with attempts > maxAttempts
 */

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://marco:GDFKsRoislGkxAf8@crm-menuchat.pirhts7.mongodb.net/?retryWrites=true&w=majority&appName=crm-menuchat';

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.\n');

  // 1. Cancel zombie seasonal_reactivation for the looping contact
  const zombieResult = await AgentTask.updateMany(
    {
      type: 'seasonal_reactivation',
      status: { $in: ['pending', 'executing'] },
    },
    {
      $set: { status: 'cancelled', cancelledReason: 'cleanup: zombie seasonal_reactivation loop' },
    }
  );
  console.log(`[1] Cancelled ${zombieResult.modifiedCount} zombie seasonal_reactivation tasks`);

  // 2. Find and cancel duplicate pending tasks (same contact + type, keep oldest)
  const duplicates = await AgentTask.aggregate([
    { $match: { status: 'pending' } },
    {
      $group: {
        _id: { contact: '$contact', type: '$type' },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
        oldest: { $min: '$createdAt' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  let dupsCancelled = 0;
  for (const dup of duplicates) {
    const toCancel = await AgentTask.find({
      _id: { $in: dup.ids },
      status: 'pending',
      createdAt: { $gt: new Date(dup.oldest) },
    });
    for (const task of toCancel) {
      task.status = 'cancelled';
      task.cancelledReason = 'cleanup: duplicate pending task';
      await task.save();
      dupsCancelled++;
    }
  }
  console.log(`[2] Cancelled ${dupsCancelled} duplicate pending tasks`);

  // 3. Fail tasks stuck in executing for > 30 min
  const stuckCutoff = new Date(Date.now() - 30 * 60 * 1000);
  const stuckResult = await AgentTask.updateMany(
    { status: 'executing', updatedAt: { $lte: stuckCutoff } },
    { $set: { status: 'failed', result: { error: 'cleanup: stuck in executing' } } }
  );
  console.log(`[3] Failed ${stuckResult.modifiedCount} stuck executing tasks`);

  // 4. Fail tasks with attempts >= maxAttempts
  const overAttempted = await AgentTask.find({
    status: 'pending',
    $expr: { $gte: ['$attempts', '$maxAttempts'] },
  });
  let overFailed = 0;
  for (const task of overAttempted) {
    task.status = 'failed';
    task.result = { error: `cleanup: attempts ${task.attempts} >= maxAttempts ${task.maxAttempts}` };
    await task.save();
    overFailed++;
  }
  console.log(`[4] Failed ${overFailed} tasks with attempts >= maxAttempts`);

  // Summary
  const remaining = await AgentTask.countDocuments({ status: 'pending' });
  const executing = await AgentTask.countDocuments({ status: 'executing' });
  console.log(`\nDone. Remaining: ${remaining} pending, ${executing} executing`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
