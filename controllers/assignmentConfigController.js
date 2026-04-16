import AssignmentConfig from '../models/assignmentConfigModel.js';
import User from '../models/userModel.js';

export const getAssignmentConfig = async (req, res) => {
  try {
    const config = await AssignmentConfig.findOne({ key: 'default' })
      .populate('globalRoundRobin', 'firstName lastName email role isActive')
      .populate('sourceRules.userId', 'firstName lastName email role isActive')
      .populate('sourceRules.userIds', 'firstName lastName email role isActive');

    // Return empty defaults if not configured yet
    if (!config) {
      return res.json({
        success: true,
        data: { globalRoundRobin: [], sourceRules: [] },
      });
    }

    res.json({ success: true, data: config });
  } catch (err) {
    console.error('❌ getAssignmentConfig:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAssignmentConfig = async (req, res) => {
  try {
    const { globalRoundRobin, sourceRules } = req.body;

    // Basic validation
    if (!Array.isArray(globalRoundRobin) || !Array.isArray(sourceRules)) {
      return res.status(400).json({
        success: false,
        message: 'globalRoundRobin e sourceRules devono essere array',
      });
    }

    // Verify all referenced users exist and are active
    const allUserIds = [
      ...globalRoundRobin,
      ...sourceRules.flatMap(r => [r.userId, ...(r.userIds || [])].filter(Boolean)),
    ];

    if (allUserIds.length > 0) {
      const found = await User.countDocuments({ _id: { $in: allUserIds }, isActive: true });
      if (found !== new Set(allUserIds.map(String)).size) {
        return res.status(400).json({
          success: false,
          message: 'Uno o più utenti non trovati o non attivi',
        });
      }
    }

    const config = await AssignmentConfig.findOneAndUpdate(
      { key: 'default' },
      { globalRoundRobin, sourceRules },
      { upsert: true, new: true, runValidators: true }
    )
      .populate('globalRoundRobin', 'firstName lastName email role isActive')
      .populate('sourceRules.userId', 'firstName lastName email role isActive')
      .populate('sourceRules.userIds', 'firstName lastName email role isActive');

    console.log(`✅ AssignmentConfig aggiornata da ${req.user.email}`);
    res.json({ success: true, data: config });
  } catch (err) {
    console.error('❌ updateAssignmentConfig:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
