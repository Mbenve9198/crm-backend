import Contact from '../models/contactModel.js';
import { buildContactsWithActivityStatsPipeline, addOperationalFlagsPipeline, normalizeOwnerId } from '../services/leadWorkRulesService.js';

/**
 * GET /api/dashboard?ownerId=all|<mongoId>&limit=20
 *
 * Dashboard unica (Cruscotto):
 * - KPI per status + not touched + da toccare oggi + potential €
 * - Liste operative (limit)
 */
export const getDashboard = async (req, res) => {
  try {
    const { ownerId = 'all', limit = 20 } = req.query;
    const ownerObjectId = normalizeOwnerId(ownerId);
    const parsedLimit = Math.max(5, Math.min(100, parseInt(limit, 10) || 20));

    const baseMatch = ownerObjectId ? { owner: ownerObjectId } : {};

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
          // Placeholder: somma MRR degli stati "in corso"
          pipelinePotentialEur: {
            $sum: {
              $cond: [
                { $in: ['$status', ['interessato', 'qr code inviato', 'free trial iniziato']] },
                { $ifNull: ['$mrr', 0] },
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
          notTouched: { $sum: { $cond: ['$isNotTouched', 1, 0] } }
        }
      },
      { $project: { _id: 0, notTouched: 1 } }
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
      activitiesCount: 1
    };

    const listsAgg = Contact.aggregate([
      ...buildContactsWithActivityStatsPipeline({ ownerObjectId }),
      ...addOperationalFlagsPipeline(),
      { $sort: { lastActivityAt: 1, createdAt: -1 } },
      {
        $facet: {
          notTouched: [
            { $match: { isNotTouched: true } },
            { $limit: parsedLimit },
            { $project: projectListFields }
          ],
          callback: [
            { $match: { status: 'da richiamare' } },
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
          ]
        }
      }
    ]);

    const [kpiRes, opKpiRes, listsRes] = await Promise.all([kpiAgg, operationalKpiAgg, listsAgg]);
    const kpis = kpiRes?.[0] || {
      total: 0,
      freeTrialStarted: 0,
      qrCodeSent: 0,
      interested: 0,
      won: 0,
      lost: 0,
      pipelinePotentialEur: 0
    };
    const operational = opKpiRes?.[0] || { notTouched: 0 };
    const lists = listsRes?.[0] || {
      notTouched: [],
      callback: [],
      freeTrial: [],
      qrFollowUp: []
    };

    return res.json({
      success: true,
      data: {
        ownerId: ownerObjectId ? String(ownerObjectId) : 'all',
        kpis: {
          ...kpis,
          notTouched: operational.notTouched
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

