import Contact from '../models/contactModel.js';
import { buildContactsWithActivityStatsPipeline, addOperationalFlagsPipeline, normalizeOwnerId } from '../services/leadWorkRulesService.js';

/**
 * GET /api/dashboard?ownerId=all|<mongoId>&limit=20
 *
 * Dashboard unica (Cruscotto):
 * - KPI per status + not touched + potential € + callback
 * - Liste operative (limit)
 */
export const getDashboard = async (req, res) => {
  try {
    const { ownerId = 'all', limit = 20 } = req.query;
    const ownerObjectId = normalizeOwnerId(ownerId);
    const parsedLimit = Math.max(5, Math.min(100, parseInt(limit, 10) || 20));

    const baseMatch = ownerObjectId ? { owner: ownerObjectId } : {};

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const next7End = new Date(todayStart);
    next7End.setDate(next7End.getDate() + 8);

    const todayStartIso = todayStart.toISOString();
    const todayEndIso = todayEnd.toISOString();
    const next7EndIso = next7End.toISOString();

    // KPI (veloci, senza lookup)
    const kpiAgg = Contact.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          freeTrialStarted: { $sum: { $cond: [{ $eq: ['$status', 'free trial iniziato'] }, 1, 0] } },
          qrCodeSent: { $sum: { $cond: [{ $eq: ['$status', 'qr code inviato'] }, 1, 0] } },
          interested: { $sum: { $cond: [{ $eq: ['$status', 'interessato'] }, 1, 0] } },
          won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
          lost: {
            $sum: {
              $cond: [
                { $in: ['$status', ['lost before free trial', 'lost after free trial']] },
                1,
                0
              ]
            }
          },
          pipelinePotentialEur: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$status', ['qr code inviato', 'free trial iniziato']] },
                    { $ne: ['$mrr', null] }
                  ]
                },
                {
                  $add: [
                    { $multiply: [0.2, { $multiply: ['$mrr', 12] }] },
                    50
                  ]
                },
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          total: 1,
          freeTrialStarted: 1,
          qrCodeSent: 1,
          interested: 1,
          won: 1,
          lost: 1,
          pipelinePotentialEur: 1
        }
      }
    ]);

    const operationalKpiAgg = Contact.aggregate([
      ...buildContactsWithActivityStatsPipeline({ ownerObjectId }),
      ...addOperationalFlagsPipeline(),
      {
        $group: {
          _id: null,
          notTouched: { $sum: { $cond: [{ $and: ['$isNotTouched', '$isActiveStatus'] }, 1, 0] } },
          stalled: { $sum: { $cond: ['$isStalled', 1, 0] } }
        }
      },
      { $project: { _id: 0, notTouched: 1, stalled: 1 } }
    ]);

    // Callback KPIs
    const callbackKpiAgg = Contact.aggregate([
      { $match: { ...baseMatch, 'properties.callbackAt': { $exists: true, $ne: null } } },
      {
        $addFields: {
          _cbAt: '$properties.callbackAt'
        }
      },
      {
        $group: {
          _id: null,
          callbackOverdue: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$_cbAt', null] }, { $lt: ['$_cbAt', todayStartIso] }] },
                1, 0
              ]
            }
          },
          callbackToday: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$_cbAt', todayStartIso] }, { $lt: ['$_cbAt', todayEndIso] }] },
                1, 0
              ]
            }
          },
          callbackNext7Days: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$_cbAt', todayEndIso] }, { $lt: ['$_cbAt', next7EndIso] }] },
                1, 0
              ]
            }
          },
          callbackNoDate: {
            $sum: {
              $cond: [
                { $or: [{ $eq: ['$_cbAt', null] }, { $eq: [{ $type: '$_cbAt' }, 'missing'] }] },
                1, 0
              ]
            }
          }
        }
      },
      { $project: { _id: 0 } }
    ]);

    const projectListFields = {
      _id: 1,
      name: 1,
      email: 1,
      phone: 1,
      status: 1,
      source: 1,
      mrr: 1,
      owner: 1,
      createdAt: 1,
      updatedAt: 1,
      lastActivityAt: 1,
      activitiesCount: 1,
      'properties.closeDate': 1
    };

    const projectCallbackListFields = {
      ...projectListFields,
      'properties.callbackAt': 1,
      'properties.callbackNote': 1
    };

    const listsAgg = Contact.aggregate([
      ...buildContactsWithActivityStatsPipeline({ ownerObjectId }),
      ...addOperationalFlagsPipeline(),
      { $sort: { lastActivityAt: 1, createdAt: -1 } },
      {
        $facet: {
          notTouched: [
            { $match: { isNotTouched: true, isActiveStatus: true } },
            { $sort: { createdAt: -1 } },
            { $limit: parsedLimit },
            { $project: projectListFields }
          ],
          callback: [
            {
              $match: {
                $or: [
                  { 'properties.callbackAt': { $exists: true, $ne: null, $lt: todayEndIso } },
                  { status: 'da richiamare', $or: [{ 'properties.callbackAt': { $exists: false } }, { 'properties.callbackAt': null }] }
                ]
              }
            },
            {
              $addFields: {
                _sortableCbAt: {
                  $ifNull: ['$properties.callbackAt', '9999-12-31T23:59:59.999Z']
                }
              }
            },
            { $sort: { _sortableCbAt: 1, lastActivityAt: -1 } },
            { $limit: parsedLimit },
            { $project: projectCallbackListFields }
          ],
          daContattare: [
            { $match: { status: 'da contattare' } },
            { $sort: { createdAt: -1 } },
            { $limit: parsedLimit },
            { $project: projectListFields }
          ],
          interessato: [
            { $match: { status: 'interessato' } },
            { $sort: { lastActivityAt: 1, createdAt: -1 } },
            { $limit: parsedLimit },
            { $project: projectListFields }
          ],
          freeTrial: [
            { $match: { status: 'free trial iniziato' } },
            { $limit: parsedLimit },
            { $project: projectListFields }
          ],
          qrFollowUp: [
            { $match: { status: 'qr code inviato' } },
            { $limit: parsedLimit },
            { $project: projectListFields }
          ],
          won: [
            { $match: { status: 'won' } },
            { $sort: { updatedAt: -1 } },
            { $limit: parsedLimit },
            { $project: projectListFields }
          ]
        }
      }
    ]);

    const [kpiRes, opKpiRes, cbKpiRes, listsRes] = await Promise.all([kpiAgg, operationalKpiAgg, callbackKpiAgg, listsAgg]);
    const kpis = kpiRes?.[0] || {
      total: 0,
      freeTrialStarted: 0,
      qrCodeSent: 0,
      interested: 0,
      won: 0,
      lost: 0,
      pipelinePotentialEur: 0
    };
    const operational = opKpiRes?.[0] || { notTouched: 0, stalled: 0 };
    const cbKpis = cbKpiRes?.[0] || { callbackOverdue: 0, callbackToday: 0, callbackNext7Days: 0, callbackNoDate: 0 };
    const lists = listsRes?.[0] || {
      callback: [],
      daContattare: [],
      interessato: [],
      freeTrial: [],
      qrFollowUp: [],
      won: []
    };

    return res.json({
      success: true,
      data: {
        ownerId: ownerObjectId ? String(ownerObjectId) : 'all',
        kpis: {
          ...kpis,
          notTouched: operational.notTouched,
          stalled: operational.stalled,
          ...cbKpis
        },
        lists
      }
    });
  } catch (error) {
    console.error('Errore getDashboard:', error);
    return res.status(500).json({
      success: false,
      message: 'Errore interno del server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export default { getDashboard };

