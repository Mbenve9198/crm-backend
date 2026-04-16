import User from '../models/userModel.js';
import AssignmentState from '../models/assignmentStateModel.js';
import AssignmentConfig from '../models/assignmentConfigModel.js';

/**
 * Runs round-robin over an ordered array of userIds.
 * State is persisted in AssignmentState using the given key.
 * Returns the selected User document, or null if no active users found.
 */
const runRoundRobin = async (userIds, stateKey) => {
  if (!userIds || userIds.length === 0) return null;

  const users = await User.find({ _id: { $in: userIds }, isActive: true });
  if (users.length === 0) return null;

  // Preserve the configured order
  const ordered = userIds
    .map(id => users.find(u => u._id.toString() === id.toString()))
    .filter(Boolean);

  if (ordered.length === 0) return null;

  let state = await AssignmentState.findOne({ key: stateKey });
  if (!state) {
    state = await AssignmentState.create({ key: stateKey, lastIndex: -1 });
  }

  const nextIndex = (state.lastIndex + 1) % ordered.length;
  state.lastIndex = nextIndex;
  await state.save();

  return ordered[nextIndex];
};

/**
 * Resolves the owner for a new lead based on AssignmentConfig.
 *
 * Resolution order:
 *   1. If a sourceRule exists for `source`:
 *      - strategy 'specific'    → assign to rule.userId
 *      - strategy 'round_robin' → round-robin among rule.userIds
 *   2. Fallback: global round-robin pool
 *   3. Final fallback: defaultOwner (passed in)
 *
 * Returns a User document.
 */
export const resolveOwnerForSource = async (source, defaultOwner) => {
  try {
    const config = await AssignmentConfig.findOne({ key: 'default' });

    if (!config) {
      // No config yet — use legacy global round-robin key so existing state is preserved
      return await runRoundRobin([], 'smartlead_round_robin') || defaultOwner;
    }

    // Check for a source-specific rule
    const rule = config.sourceRules?.find(r => r.source === source);

    if (rule) {
      if (rule.strategy === 'specific' && rule.userId) {
        const user = await User.findOne({ _id: rule.userId, isActive: true });
        if (user) {
          console.log(`🎯 Assignment [${source}] specific → ${user.email}`);
          return user;
        }
      }

      if (rule.strategy === 'round_robin' && rule.userIds?.length > 0) {
        const stateKey = `source_rr_${source}`;
        const user = await runRoundRobin(rule.userIds, stateKey);
        if (user) {
          console.log(`🎯 Assignment [${source}] round-robin → ${user.email}`);
          return user;
        }
      }
    }

    // Fallback: global round-robin pool
    if (config.globalRoundRobin?.length > 0) {
      const user = await runRoundRobin(config.globalRoundRobin, 'global_round_robin');
      if (user) {
        console.log(`🎯 Assignment [${source}] global round-robin → ${user.email}`);
        return user;
      }
    }
  } catch (err) {
    console.error('⚠️ assignmentService error, falling back to defaultOwner:', err.message);
  }

  return defaultOwner;
};
