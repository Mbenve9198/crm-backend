import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';
import Activity from '../models/activityModel.js';
import Call from '../models/callModel.js';
import AgentTask from '../models/agentTaskModel.js';

const DAILY_LIMIT = parseInt(process.env.REACTIVATION_DAILY_LIMIT || '30');
const MIN_DAYS = parseInt(process.env.REACTIVATION_MIN_DAYS || '14');
const MAX_DAYS = parseInt(process.env.REACTIVATION_MAX_DAYS || '180');

const EXCLUDED_STATUSES = [
  'won', 'bad_data', 'non_qualificato', 'do_not_contact', 'free trial iniziato', 'qr code inviato'
];

const STATUS_SCORES = {
  'da richiamare': 40,
  'interessato': 35,
  'contattato': 20,
  'ghosted/bad timing': 15,
  'lost before free trial': 5,
  'lost after free trial': 5,
  'da contattare': 0,
};

const CALL_OUTCOME_SCORES = {
  'meeting-set': 40,
  'sale-made': 40,
  'interested': 30,
  'callback': 30,
  'voicemail': 5,
  'no-answer': 0,
  'not-interested': -20,
  'wrong-number': -50,
  'busy': 0,
};

export async function scanReactivationCandidates(maxResults = DAILY_LIMIT) {
  const now = new Date();
  const minDate = new Date(now - MAX_DAYS * 24 * 60 * 60 * 1000);
  const maxDate = new Date(now - MIN_DAYS * 24 * 60 * 60 * 1000);

  const pendingTaskContactIds = await AgentTask.distinct('contact', {
    status: { $in: ['pending', 'executing'] }
  });

  const candidates = await Contact.aggregate([
    {
      $match: {
        status: { $nin: EXCLUDED_STATUSES },
        _id: { $nin: pendingTaskContactIds.map(id => new mongoose.Types.ObjectId(id)) },
      }
    },

    // Last activity
    {
      $lookup: {
        from: 'activities',
        let: { contactId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$contact', '$$contactId'] } } },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
          { $project: { createdAt: 1, type: 1 } }
        ],
        as: '_lastActivity'
      }
    },
    {
      $addFields: {
        lastActivityAt: { $arrayElemAt: ['$_lastActivity.createdAt', 0] },
      }
    },

    // Activity count (to exclude "da contattare" with zero activity)
    {
      $lookup: {
        from: 'activities',
        let: { contactId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$contact', '$$contactId'] } } },
          { $count: 'total' }
        ],
        as: '_actCount'
      }
    },
    {
      $addFields: {
        activityCount: { $ifNull: [{ $arrayElemAt: ['$_actCount.total', 0] }, 0] }
      }
    },

    // Exclude contacts with no activity at all (never contacted = not a reactivation)
    { $match: { activityCount: { $gte: 1 } } },

    // Time window filter: last activity between MIN_DAYS and MAX_DAYS ago
    {
      $match: {
        lastActivityAt: { $gte: minDate, $lte: maxDate }
      }
    },

    // Last call with outcome
    {
      $lookup: {
        from: 'calls',
        let: { contactId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$contact', '$$contactId'] }, outcome: { $ne: null } } },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
          { $project: { outcome: 1, notes: 1, recordingSid: 1, transcript: 1, createdAt: 1, duration: 1 } }
        ],
        as: '_lastCall'
      }
    },
    {
      $addFields: {
        lastCallOutcome: { $arrayElemAt: ['$_lastCall.outcome', 0] },
        lastCallHasNotes: { $gt: [{ $strLenCP: { $ifNull: [{ $arrayElemAt: ['$_lastCall.notes', 0] }, ''] } }, 0] },
        lastCallHasRecording: { $gt: [{ $strLenCP: { $ifNull: [{ $arrayElemAt: ['$_lastCall.recordingSid', 0] }, ''] } }, 0] },
        lastCallDate: { $arrayElemAt: ['$_lastCall.createdAt', 0] },
      }
    },

    // Call count
    {
      $lookup: {
        from: 'calls',
        let: { contactId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$contact', '$$contactId'] } } },
          { $count: 'total' }
        ],
        as: '_callCount'
      }
    },
    {
      $addFields: {
        callCount: { $ifNull: [{ $arrayElemAt: ['$_callCount.total', 0] }, 0] }
      }
    },

    // Score calculation
    {
      $addFields: {
        score: {
          $sum: [
            // Status score
            { $switch: {
              branches: Object.entries(STATUS_SCORES).map(([status, score]) => ({
                case: { $eq: ['$status', status] },
                then: score
              })),
              default: 0
            }},

            // Call outcome score
            { $switch: {
              branches: Object.entries(CALL_OUTCOME_SCORES).map(([outcome, score]) => ({
                case: { $eq: ['$lastCallOutcome', outcome] },
                then: score
              })),
              default: 0
            }},

            // Has recording
            { $cond: ['$lastCallHasRecording', 10, 0] },

            // Has notes on last call
            { $cond: ['$lastCallHasNotes', 10, 0] },

            // Inbound rank checker source (showed active interest)
            { $cond: [{ $eq: ['$source', 'inbound_rank_checker'] }, 15, 0] },

            // Has expired callback (someone was supposed to call back but didn't)
            { $cond: [
              { $and: [
                { $ne: ['$properties.callbackAt', null] },
                { $lt: [{ $toDate: '$properties.callbackAt' }, now] }
              ]},
              25, 0
            ]},

            // Multiple calls = engaged lead
            { $cond: [{ $gte: ['$callCount', 3] }, 10, 0] },

            // Penalize very old leads (> 120 days)
            { $cond: [{ $lt: ['$lastActivityAt', new Date(now - 120 * 24 * 60 * 60 * 1000)] }, -10, 0] },
          ]
        }
      }
    },

    // Only keep positive scores
    { $match: { score: { $gt: 0 } } },

    { $sort: { score: -1 } },
    { $limit: maxResults * 2 }, // overfetch for safety

    {
      $project: {
        name: 1, email: 1, phone: 1, status: 1, source: 1,
        properties: 1, rankCheckerData: 1,
        lastActivityAt: 1, activityCount: 1,
        lastCallOutcome: 1, lastCallDate: 1,
        lastCallHasNotes: 1, lastCallHasRecording: 1,
        callCount: 1, score: 1,
      }
    }
  ]);

  return candidates.slice(0, maxResults);
}


export function createReactivationTasks(candidates, dailyLimit = DAILY_LIMIT) {
  const tasks = [];
  const today = new Date().toISOString().slice(0, 10);

  const limited = candidates.slice(0, dailyLimit);

  const HUMAN_STATUSES = new Set(['da richiamare']);

  for (let i = 0; i < limited.length; i++) {
    const c = limited[i];
    const needsHuman = HUMAN_STATUSES.has(c.status) || c.properties?.callRequested === true;
    const isWarm = c.score >= 50;

    const slotMinutes = Math.floor((9 * 60) + (i * (9 * 60 / Math.max(limited.length, 1))));
    const hour = Math.floor(slotMinutes / 60);
    const minute = slotMinutes % 60;
    const scheduledAt = _buildRomeDate(hour, minute);

    if (needsHuman) {
      tasks.push({
        type: 'human_task',
        contact: c._id,
        scheduledAt,
        context: {
          reason: `Lead ${c.status} (score ${c.score}). Telefono: ${c.phone || 'N/A'}. Last call: ${c.lastCallOutcome || 'N/A'}, ${c.callCount} calls.`,
          score: c.score,
        },
        score: c.score,
        scanBatch: today,
        priority: 'high',
        createdBy: 'system'
      });
    } else {
      tasks.push({
        type: isWarm ? 'reactivation_warm' : 'reactivation_cold',
        contact: c._id,
        scheduledAt,
        context: {
          reason: isWarm
            ? `Warm lead: ${c.status}, last call ${c.lastCallOutcome || 'N/A'}, ${c.callCount} calls`
            : `Cold reactivation: ${c.status}, ${c.activityCount} activities, last ${_daysAgo(c.lastActivityAt)}d ago`,
          score: c.score,
        },
        score: c.score,
        scanBatch: today,
        priority: isWarm ? 'high' : 'medium',
        createdBy: 'system'
      });
    }
  }

  return tasks;
}


export async function runDailyReactivationScan() {
  const candidates = await scanReactivationCandidates(DAILY_LIMIT);
  if (candidates.length === 0) return 0;

  const tasks = createReactivationTasks(candidates, DAILY_LIMIT);
  let created = 0;

  for (const taskData of tasks) {
    await AgentTask.create(taskData);
    created++;
  }

  if (created > 0) {
    console.log(`📋 Contact Scanner: ${created} reactivation tasks creati (${tasks.filter(t => t.type === 'reactivation_warm').length} warm, ${tasks.filter(t => t.type === 'reactivation_cold').length} cold)`);
  }

  return created;
}


function _buildRomeDate(hour, minute) {
  const now = new Date();
  const month = now.getMonth();
  const romeOffset = (month >= 2 && month <= 9) ? 2 : 1;
  const target = new Date(now);
  target.setUTCHours(hour - romeOffset, minute, 0, 0);
  if (target < now) target.setDate(target.getDate() + 1);
  return target;
}

function _daysAgo(date) {
  if (!date) return '?';
  return Math.floor((Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000));
}

export default { scanReactivationCandidates, createReactivationTasks, runDailyReactivationScan };
