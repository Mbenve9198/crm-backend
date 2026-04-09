import express from 'express';
import ResearchCache from '../models/researchCacheModel.js';
import SalesManagerDirective from '../models/salesManagerDirectiveModel.js';

const router = express.Router();

/**
 * GET /api/internal/research-cache/:email
 * Returns valid (non-expired) cache for a contact, or 404.
 */
router.get('/research-cache/:email', async (req, res) => {
  try {
    const cache = await ResearchCache.findOne({
      contactEmail: req.params.email,
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!cache) return res.status(404).json({ found: false });
    res.json({ found: true, data: cache });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/internal/research-cache
 * Upsert research cache for a contact.
 */
router.post('/research-cache', async (req, res) => {
  try {
    const { contactEmail, contactId, businessData, rankingData, reviewsData, similarClients, ttlHours } = req.body;
    if (!contactEmail) return res.status(400).json({ error: 'contactEmail required' });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ttlHours || 24) * 60 * 60 * 1000);

    const cache = await ResearchCache.findOneAndUpdate(
      { contactEmail },
      {
        contactEmail,
        contactId: contactId || undefined,
        businessData: businessData || undefined,
        rankingData: rankingData || undefined,
        reviewsData: reviewsData || undefined,
        similarClients: similarClients || undefined,
        fetchedAt: now,
        expiresAt,
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, id: cache._id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/internal/directives
 * Returns active (non-expired) Sales Manager directives.
 */
router.get('/directives', async (req, res) => {
  try {
    const scope = req.query.scope;
    const filter = {
      isActive: true,
      $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }],
    };
    if (scope) filter.scope = { $in: [scope, 'all'] };

    const directives = await SalesManagerDirective.find(filter)
      .sort({ priority: 1, createdAt: -1 })
      .limit(10)
      .lean();

    res.json({ directives });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
