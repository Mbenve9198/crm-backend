import mongoose from 'mongoose';

/**
 * Regole operative per "lead da lavorare" (Cruscotto).
 *
 * Nota importante:
 * - Riusa la definizione "Not touched" già presente in analytics lead-cohort:
 *   - Smartlead: <= 1 activity totale
 *   - Rank checker: 0 activity totali
 *
 * Altre regole (es. "da toccare oggi") sono derivate operative e parametrizzabili.
 */

export const DASHBOARD_DEFAULTS = {
  activeStatuses: [
    'da contattare',
    'contattato',
    'da richiamare',
    'interessato',
    'ghosted/bad timing',
    'qr code inviato',
    'free trial iniziato'
  ]
};

export function normalizeOwnerId(ownerId) {
  if (!ownerId || ownerId === 'all') return null;
  if (!mongoose.Types.ObjectId.isValid(ownerId)) return null;
  return new mongoose.Types.ObjectId(ownerId);
}

/**
 * Pipeline base che arricchisce i contatti con:
 * - lastActivityAt: timestamp ultima activity
 * - activitiesCount: numero totale activity
 */
export function buildContactsWithActivityStatsPipeline({ ownerObjectId } = {}) {
  const match = {};
  if (ownerObjectId) match.owner = ownerObjectId;

  return [
    { $match: match },
    {
      $lookup: {
        from: 'activities',
        let: { contactId: '$_id', reactivatedAt: '$reactivatedAt' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$contact', '$$contactId'] },
                  { $ne: ['$data.kind', 'reactivation'] },
                  // Se reactivatedAt è impostato, conta solo le activity successive
                  {
                    $or: [
                      { $eq: ['$$reactivatedAt', null] },
                      { $gte: ['$createdAt', '$$reactivatedAt'] }
                    ]
                  }
                ]
              }
            }
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$contact',
              lastActivityAt: { $first: '$createdAt' },
              activitiesCount: { $sum: 1 }
            }
          }
        ],
        as: 'activityStats'
      }
    },
    { $addFields: { activityStats: { $arrayElemAt: ['$activityStats', 0] } } },
    {
      $addFields: {
        lastActivityAt: '$activityStats.lastActivityAt',
        activitiesCount: { $ifNull: ['$activityStats.activitiesCount', 0] }
      }
    },
    { $project: { activityStats: 0 } }
  ];
}

const STALLED_SOURCES = ['smartlead_outbound', 'inbound_rank_checker', 'inbound_menu_landing'];
const STALLED_STATUSES = ['da contattare', 'interessato'];

export function addOperationalFlagsPipeline() {
  return [
    {
      $addFields: {
        isActiveStatus: { $in: ['$status', DASHBOARD_DEFAULTS.activeStatuses] },
        isNotTouched: {
          $cond: [
            { $in: ['$source', STALLED_SOURCES] },
            {
              $cond: [
                { $eq: ['$source', 'smartlead_outbound'] },
                { $lte: ['$activitiesCount', 1] },
                { $eq: ['$activitiesCount', 0] }
              ]
            },
            false
          ]
        },
        // "In stallo": stessa sorgente di untouched, status non esitato,
        // ma già toccato (smartlead >= 2 activity, altri >= 1)
        isStalled: {
          $cond: [
            {
              $and: [
                { $in: ['$status', STALLED_STATUSES] },
                { $in: ['$source', STALLED_SOURCES] }
              ]
            },
            {
              $cond: [
                { $eq: ['$source', 'smartlead_outbound'] },
                { $gte: ['$activitiesCount', 2] },
                { $gte: ['$activitiesCount', 1] }
              ]
            },
            false
          ]
        }
      }
    }
  ];
}

