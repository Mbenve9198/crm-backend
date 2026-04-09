import {
  getOverview,
  getMrrOverview,
  getPlansBreakdown,
  getPlansTrend,
  getPlansFromContacts,
  getCustomersList,
  generateSnapshot,
  backfillFromStripe,
} from '../services/saasMetricsService.js';

export async function overview(req, res) {
  try {
    const data = await getOverview();
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ SaaS Metrics overview error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function mrrOverview(req, res) {
  try {
    const months = parseInt(req.query.months) || 12;
    const data = await getMrrOverview(months);
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ SaaS Metrics MRR overview error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function plans(req, res) {
  try {
    const data = await getPlansBreakdown();
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ SaaS Metrics plans error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function plansTrend(req, res) {
  try {
    const months = parseInt(req.query.months) || 12;
    const data = await getPlansTrend(months);
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ SaaS Metrics plans trend error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function customersList(req, res) {
  try {
    const { search, sort, order } = req.query;
    const data = await getCustomersList({ search, sort, order });
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ SaaS Metrics customers list error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function plansFromContacts(req, res) {
  try {
    const data = await getPlansFromContacts();
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ SaaS Metrics plans-from-contacts error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function snapshotGenerate(req, res) {
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const snapshot = await generateSnapshot(month);
    res.json({ success: true, data: snapshot });
  } catch (error) {
    console.error('❌ SaaS Metrics snapshot generate error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function snapshotBackfill(req, res) {
  try {
    const startMonth = req.body?.startMonth || null;
    res.json({ success: true, message: 'Backfill avviato. Controlla i log del server.' });

    // Run in background (don't block the response)
    backfillFromStripe(startMonth)
      .then(result => console.log('✅ Backfill completato:', result))
      .catch(err => console.error('❌ Backfill error:', err));
  } catch (error) {
    console.error('❌ SaaS Metrics backfill error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}
