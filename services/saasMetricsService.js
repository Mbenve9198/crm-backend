import Contact from '../models/contactModel.js';
import MrrSnapshot from '../models/mrrSnapshotModel.js';
import { getStripe } from './stripeService.js';

/**
 * Build a live snapshot for a given month by querying current contact data.
 * For past months we look at stored snapshots; for the current month we compute on-the-fly.
 */
export async function computeCurrentSnapshot() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const previousMonth = getPreviousMonth(month);
  const prevSnapshot = await MrrSnapshot.findOne({ month: previousMonth }).lean();

  const activeContacts = await Contact.find({
    'stripeData.subscriptionStatus': { $in: ['active', 'trialing'] },
    'stripeData.mrrFromStripe': { $gt: 0 },
  }).select('_id name email stripeData stripeCustomerId').lean();

  const prevContactMap = buildContactMapFromSnapshot(prevSnapshot);

  return classifyMovements(month, now, activeContacts, prevContactMap, prevSnapshot);
}

/**
 * Generate and persist a snapshot for a specific month.
 * Idempotent: overwrites if same month already exists.
 */
export async function generateSnapshot(monthStr) {
  const previousMonth = getPreviousMonth(monthStr);
  const prevSnapshot = await MrrSnapshot.findOne({ month: previousMonth }).lean();

  const [year, mon] = monthStr.split('-').map(Number);
  const endOfMonth = new Date(year, mon, 0, 23, 59, 59);

  // For current/recent months: use live contact data
  const activeContacts = await Contact.find({
    'stripeData.subscriptionStatus': { $in: ['active', 'trialing'] },
    'stripeData.mrrFromStripe': { $gt: 0 },
  }).select('_id name email stripeData stripeCustomerId').lean();

  const prevContactMap = buildContactMapFromSnapshot(prevSnapshot);
  const snapshot = classifyMovements(monthStr, endOfMonth, activeContacts, prevContactMap, prevSnapshot);

  await MrrSnapshot.findOneAndUpdate(
    { month: monthStr },
    snapshot,
    { upsert: true, new: true }
  );

  return snapshot;
}

/**
 * Backfill historical snapshots from Stripe invoices.
 * Reconstructs month-by-month data by looking at paid invoices.
 */
export async function backfillFromStripe(startMonth = null) {
  const stripe = getStripe();
  const VAT_RATE = Number(process.env.STRIPE_VAT_RATE) || 0.22;

  // Determine start: either provided or the earliest subscription
  let earliest = startMonth;
  if (!earliest) {
    const subs = await stripe.subscriptions.list({ limit: 1, status: 'all',
      expand: ['data.items.data.price'] });
    if (subs.data.length > 0) {
      const oldestCreated = Math.min(...subs.data.map(s => s.created));
      const d = new Date(oldestCreated * 1000);
      earliest = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else {
      return { message: 'No subscriptions found on Stripe' };
    }
  }

  // Get ALL subscriptions from Stripe with their full history
  const allSubs = [];
  let hasMore = true;
  let startingAfter = undefined;
  while (hasMore) {
    const params = { limit: 100, status: 'all', expand: ['data.items.data.price'] };
    if (startingAfter) params.starting_after = startingAfter;
    const batch = await stripe.subscriptions.list(params);
    allSubs.push(...batch.data);
    hasMore = batch.has_more;
    if (batch.data.length > 0) startingAfter = batch.data[batch.data.length - 1].id;
    await delay(100);
  }

  // Get all paid invoices
  const allInvoices = [];
  hasMore = true;
  startingAfter = undefined;
  while (hasMore) {
    const params = { limit: 100, status: 'paid', expand: ['data.lines'] };
    if (startingAfter) params.starting_after = startingAfter;
    const batch = await stripe.invoices.list(params);
    allInvoices.push(...batch.data);
    hasMore = batch.has_more;
    if (batch.data.length > 0) startingAfter = batch.data[batch.data.length - 1].id;
    await delay(100);
  }

  // Build a map: customerId → subscription history (per month)
  const customerSubHistory = {};
  for (const sub of allSubs) {
    const custId = sub.customer;
    if (!customerSubHistory[custId]) customerSubHistory[custId] = [];
    customerSubHistory[custId].push(sub);
  }

  // Build contact lookup: stripeCustomerId → contact
  const contacts = await Contact.find({
    stripeCustomerId: { $exists: true, $ne: null },
  }).select('_id name email stripeCustomerId').lean();
  const contactByCustomer = {};
  for (const c of contacts) {
    contactByCustomer[c.stripeCustomerId] = c;
  }

  // Generate month list
  const months = generateMonthRange(earliest, getCurrentMonth());
  const results = [];

  let prevCustomerMrr = {}; // customerId → { mrr, planName, status }

  for (const month of months) {
    const [y, m] = month.split('-').map(Number);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0, 23, 59, 59);
    const monthStartTs = Math.floor(monthStart.getTime() / 1000);
    const monthEndTs = Math.floor(monthEnd.getTime() / 1000);

    // Determine active subs at end of month
    const currentCustomerMrr = {};

    for (const [custId, subs] of Object.entries(customerSubHistory)) {
      for (const sub of subs) {
        const subCreated = sub.created;
        const subCanceled = sub.canceled_at;
        const subEnded = sub.ended_at;

        // Was this sub active at end of month?
        const wasCreatedBefore = subCreated <= monthEndTs;
        const wasNotCanceled = !subCanceled || subCanceled > monthEndTs;
        const wasNotEnded = !subEnded || subEnded > monthEndTs;

        if (wasCreatedBefore && wasNotCanceled && wasNotEnded) {
          // Calculate MRR from subscription items
          const items = sub.items?.data || [];
          const detected = detectIntervalFromSub(sub);
          let mrr = 0;

          // Try to find a relevant invoice for this month for more accurate MRR
          const relevantInvoice = allInvoices.find(inv =>
            inv.subscription === sub.id &&
            inv.created >= monthStartTs &&
            inv.created <= monthEndTs &&
            Math.abs(inv.total || 0) >= 100
          );

          if (relevantInvoice) {
            const grossCents = Math.abs(relevantInvoice.total || 0);
            const hasTax = typeof relevantInvoice.tax === 'number' && relevantInvoice.tax > 0;
            const netCents = hasTax
              ? grossCents - relevantInvoice.tax
              : Math.round(grossCents / (1 + VAT_RATE));
            mrr = Math.round(centsToMonthly(netCents, detected.interval, detected.intervalCount) / 100);
          } else {
            // Fallback: calculate from subscription items
            for (const item of items) {
              const unitAmount = item.price?.unit_amount || item.plan?.amount || 0;
              const qty = item.quantity || 1;
              mrr += Math.round(centsToMonthly(unitAmount * qty, detected.interval, detected.intervalCount) / 100);
            }
            // Strip VAT from items-based calculation too
            mrr = Math.round(mrr / (1 + VAT_RATE));
          }

          if (mrr > 0) {
            const planName = items[0]?.price?.nickname ||
              (typeof items[0]?.price?.product === 'object' ? items[0].price.product.name : null) ||
              'Unknown Plan';

            // Take highest MRR if customer has multiple active subs
            if (!currentCustomerMrr[custId] || mrr > currentCustomerMrr[custId].mrr) {
              currentCustomerMrr[custId] = {
                mrr,
                planName,
                status: sub.status,
                subId: sub.id,
              };
            }
          }
        }
      }
    }

    // Classify movements by comparing with previous month
    const movements = [];
    let newMrr = 0, reactivationMrr = 0, expansionMrr = 0;
    let contractionMrr = 0, voluntaryChurnMrr = 0, delinquentChurnMrr = 0;
    let existingMrr = 0;
    let newCustomers = 0, reactivatedCustomers = 0, churnedCustomers = 0;

    // Check current customers
    for (const [custId, curr] of Object.entries(currentCustomerMrr)) {
      const prev = prevCustomerMrr[custId];
      const contact = contactByCustomer[custId];

      if (!prev) {
        // Check if this customer existed in any earlier month (reactivation vs new)
        const sub = customerSubHistory[custId]?.find(s => s.created <= monthEndTs);
        const wasEverActive = sub && sub.created < monthStartTs;

        if (wasEverActive) {
          reactivationMrr += curr.mrr;
          reactivatedCustomers++;
          movements.push({
            contactId: contact?._id,
            contactName: contact?.name,
            contactEmail: contact?.email,
            type: 'reactivation',
            previousMrr: 0,
            currentMrr: curr.mrr,
            delta: curr.mrr,
            planName: curr.planName,
          });
        } else {
          newMrr += curr.mrr;
          newCustomers++;
          movements.push({
            contactId: contact?._id,
            contactName: contact?.name,
            contactEmail: contact?.email,
            type: 'new',
            previousMrr: 0,
            currentMrr: curr.mrr,
            delta: curr.mrr,
            planName: curr.planName,
          });
        }
      } else if (curr.mrr > prev.mrr) {
        expansionMrr += (curr.mrr - prev.mrr);
        existingMrr += prev.mrr;
        movements.push({
          contactId: contact?._id,
          contactName: contact?.name,
          contactEmail: contact?.email,
          type: 'expansion',
          previousMrr: prev.mrr,
          currentMrr: curr.mrr,
          delta: curr.mrr - prev.mrr,
          planName: curr.planName,
        });
      } else if (curr.mrr < prev.mrr) {
        contractionMrr += (prev.mrr - curr.mrr);
        existingMrr += curr.mrr;
        movements.push({
          contactId: contact?._id,
          contactName: contact?.name,
          contactEmail: contact?.email,
          type: 'contraction',
          previousMrr: prev.mrr,
          currentMrr: curr.mrr,
          delta: curr.mrr - prev.mrr,
          planName: curr.planName,
        });
      } else {
        existingMrr += curr.mrr;
      }
    }

    // Check churned customers (were in prev but not in current)
    for (const [custId, prev] of Object.entries(prevCustomerMrr)) {
      if (!currentCustomerMrr[custId]) {
        const contact = contactByCustomer[custId];
        const sub = customerSubHistory[custId]?.find(s =>
          s.canceled_at && s.canceled_at >= monthStartTs && s.canceled_at <= monthEndTs
        );
        const isDelinquent = sub?.cancellation_details?.reason === 'payment_failed' ||
          sub?.status === 'past_due';

        const churnType = isDelinquent ? 'delinquent_churn' : 'voluntary_churn';
        if (isDelinquent) {
          delinquentChurnMrr += prev.mrr;
        } else {
          voluntaryChurnMrr += prev.mrr;
        }
        churnedCustomers++;

        movements.push({
          contactId: contact?._id,
          contactName: contact?.name,
          contactEmail: contact?.email,
          type: churnType,
          previousMrr: prev.mrr,
          currentMrr: 0,
          delta: -prev.mrr,
          planName: prev.planName,
        });
      }
    }

    const totalMrr = newMrr + reactivationMrr + expansionMrr + existingMrr;
    const totalCustomers = Object.keys(currentCustomerMrr).length;

    // Plan breakdown
    const planMap = {};
    for (const curr of Object.values(currentCustomerMrr)) {
      const pn = curr.planName || 'Unknown';
      if (!planMap[pn]) planMap[pn] = { planName: pn, customers: 0, mrr: 0 };
      planMap[pn].customers++;
      planMap[pn].mrr += curr.mrr;
    }

    const snapshot = {
      month,
      snapshotDate: monthEnd,
      newMrr, reactivationMrr, expansionMrr,
      contractionMrr, voluntaryChurnMrr, delinquentChurnMrr,
      existingMrr, totalMrr,
      totalCustomers, newCustomers, reactivatedCustomers, churnedCustomers,
      planBreakdown: Object.values(planMap),
      movements,
    };

    await MrrSnapshot.findOneAndUpdate({ month }, snapshot, { upsert: true });
    results.push({ month, totalMrr, totalCustomers });

    // Advance: current becomes previous
    prevCustomerMrr = { ...currentCustomerMrr };
  }

  return { months: results.length, snapshots: results };
}

/**
 * Get overview KPIs for the dashboard cards.
 */
export async function getOverview() {
  const currentMonth = getCurrentMonth();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    months.push(getMonthOffset(currentMonth, -i));
  }

  const snapshots = await MrrSnapshot.find({ month: { $in: months } })
    .sort({ month: 1 }).lean();

  // Current month: use live data if no snapshot yet
  let currentSnap = snapshots.find(s => s.month === currentMonth);
  if (!currentSnap) {
    currentSnap = await computeCurrentSnapshot();
  }

  const prevMonth = getPreviousMonth(currentMonth);
  const prevSnap = snapshots.find(s => s.month === prevMonth) || null;

  const sparkline = snapshots.map(s => ({ month: s.month, mrr: s.totalMrr, customers: s.totalCustomers }));

  // Active trials (live query)
  const trialCount = await Contact.countDocuments({
    'stripeData.subscriptionStatus': 'trialing',
  });

  const prevTrials = prevSnap
    ? (await Contact.countDocuments({ 'stripeData.subscriptionStatus': 'trialing' }))
    : 0;

  const growth = currentSnap
    ? currentSnap.newMrr + currentSnap.reactivationMrr + currentSnap.expansionMrr
      - currentSnap.contractionMrr - currentSnap.voluntaryChurnMrr - currentSnap.delinquentChurnMrr
    : 0;
  const prevGrowth = prevSnap
    ? prevSnap.newMrr + prevSnap.reactivationMrr + prevSnap.expansionMrr
      - prevSnap.contractionMrr - prevSnap.voluntaryChurnMrr - prevSnap.delinquentChurnMrr
    : 0;

  const totalChurn = currentSnap ? currentSnap.voluntaryChurnMrr + currentSnap.delinquentChurnMrr : 0;
  const prevTotalChurn = prevSnap ? prevSnap.voluntaryChurnMrr + prevSnap.delinquentChurnMrr : 0;

  return {
    currentMrr: currentSnap?.totalMrr || 0,
    prevMrr: prevSnap?.totalMrr || 0,
    currentCustomers: currentSnap?.totalCustomers || 0,
    prevCustomers: prevSnap?.totalCustomers || 0,
    trials: trialCount,
    prevTrials,
    growth,
    prevGrowth,
    newMrr: currentSnap?.newMrr || 0,
    prevNewMrr: prevSnap?.newMrr || 0,
    churnMrr: totalChurn,
    prevChurnMrr: prevTotalChurn,
    sparkline,
  };
}

/**
 * Get MRR movements for the breakdown chart/table.
 */
export async function getMrrOverview(numMonths = 12) {
  const currentMonth = getCurrentMonth();
  const months = [];
  for (let i = numMonths - 1; i >= 0; i--) {
    months.push(getMonthOffset(currentMonth, -i));
  }

  const snapshots = await MrrSnapshot.find({ month: { $in: months } })
    .sort({ month: 1 })
    .select('-movements')
    .lean();

  // If current month is missing, compute live
  if (!snapshots.find(s => s.month === currentMonth)) {
    const live = await computeCurrentSnapshot();
    snapshots.push(live);
  }

  return { months: snapshots };
}

/**
 * Get plan breakdown (current).
 */
export async function getPlansBreakdown() {
  const activeContacts = await Contact.find({
    'stripeData.subscriptionStatus': { $in: ['active', 'trialing'] },
    'stripeData.mrrFromStripe': { $gt: 0 },
  }).select('stripeData.planName stripeData.mrrFromStripe').lean();

  const planMap = {};
  let totalMrr = 0;

  for (const c of activeContacts) {
    const pn = c.stripeData?.planName || 'Unknown';
    const mrr = c.stripeData?.mrrFromStripe || 0;
    if (!planMap[pn]) planMap[pn] = { planName: pn, customers: 0, mrr: 0 };
    planMap[pn].customers++;
    planMap[pn].mrr += mrr;
    totalMrr += mrr;
  }

  const plans = Object.values(planMap)
    .map(p => ({ ...p, percentage: totalMrr > 0 ? Math.round(p.mrr / totalMrr * 100) : 0 }))
    .sort((a, b) => b.mrr - a.mrr);

  return { plans, totalMrr, totalCustomers: activeContacts.length };
}

/**
 * Get plan trend over time.
 */
export async function getPlansTrend(numMonths = 12) {
  const currentMonth = getCurrentMonth();
  const months = [];
  for (let i = numMonths - 1; i >= 0; i--) {
    months.push(getMonthOffset(currentMonth, -i));
  }

  const snapshots = await MrrSnapshot.find({ month: { $in: months } })
    .sort({ month: 1 })
    .select('month planBreakdown')
    .lean();

  // Collect all plan names
  const allPlans = new Set();
  for (const s of snapshots) {
    for (const p of (s.planBreakdown || [])) {
      allPlans.add(p.planName);
    }
  }

  // Build series: { planName, data: [{ month, mrr, customers }] }
  const series = [];
  for (const planName of allPlans) {
    const data = months.map(month => {
      const snap = snapshots.find(s => s.month === month);
      const pb = snap?.planBreakdown?.find(p => p.planName === planName);
      return { month, mrr: pb?.mrr || 0, customers: pb?.customers || 0 };
    });
    series.push({ planName, data });
  }

  return { months, series };
}

// ─── Helpers ────────────────────────────────────────────────

function classifyMovements(month, snapshotDate, activeContacts, prevContactMap, prevSnapshot) {
  const movements = [];
  let newMrr = 0, reactivationMrr = 0, expansionMrr = 0;
  let contractionMrr = 0, voluntaryChurnMrr = 0, delinquentChurnMrr = 0;
  let existingMrr = 0;
  let newCustomers = 0, reactivatedCustomers = 0, churnedCustomers = 0;

  const currentIds = new Set();

  for (const c of activeContacts) {
    const custId = c.stripeCustomerId;
    const mrr = c.stripeData?.mrrFromStripe || 0;
    const planName = c.stripeData?.planName || 'Unknown';
    currentIds.add(custId);

    const prev = prevContactMap[custId];

    if (!prev) {
      // Could be new or reactivation
      const subStart = c.stripeData?.subscriptionStartDate;
      const [y, m] = month.split('-').map(Number);
      const monthStart = new Date(y, m - 1, 1);
      const isNew = !subStart || subStart >= monthStart;

      if (isNew) {
        newMrr += mrr;
        newCustomers++;
        movements.push({ contactId: c._id, contactName: c.name, contactEmail: c.email,
          type: 'new', previousMrr: 0, currentMrr: mrr, delta: mrr, planName });
      } else {
        reactivationMrr += mrr;
        reactivatedCustomers++;
        movements.push({ contactId: c._id, contactName: c.name, contactEmail: c.email,
          type: 'reactivation', previousMrr: 0, currentMrr: mrr, delta: mrr, planName });
      }
    } else if (mrr > prev.mrr) {
      expansionMrr += (mrr - prev.mrr);
      existingMrr += prev.mrr;
      movements.push({ contactId: c._id, contactName: c.name, contactEmail: c.email,
        type: 'expansion', previousMrr: prev.mrr, currentMrr: mrr, delta: mrr - prev.mrr, planName });
    } else if (mrr < prev.mrr) {
      contractionMrr += (prev.mrr - mrr);
      existingMrr += mrr;
      movements.push({ contactId: c._id, contactName: c.name, contactEmail: c.email,
        type: 'contraction', previousMrr: prev.mrr, currentMrr: mrr, delta: mrr - prev.mrr, planName });
    } else {
      existingMrr += mrr;
    }
  }

  // Churned: in prev but not current
  if (prevSnapshot) {
    for (const [custId, prev] of Object.entries(prevContactMap)) {
      if (!currentIds.has(custId)) {
        churnedCustomers++;
        voluntaryChurnMrr += prev.mrr;
        movements.push({ contactId: prev.contactId, contactName: prev.name, contactEmail: prev.email,
          type: 'voluntary_churn', previousMrr: prev.mrr, currentMrr: 0, delta: -prev.mrr, planName: prev.planName });
      }
    }
  }

  const totalMrr = newMrr + reactivationMrr + expansionMrr + existingMrr;
  const totalCustomers = activeContacts.length;

  const planMap = {};
  for (const c of activeContacts) {
    const pn = c.stripeData?.planName || 'Unknown';
    const mrr = c.stripeData?.mrrFromStripe || 0;
    if (!planMap[pn]) planMap[pn] = { planName: pn, customers: 0, mrr: 0 };
    planMap[pn].customers++;
    planMap[pn].mrr += mrr;
  }

  return {
    month, snapshotDate,
    newMrr, reactivationMrr, expansionMrr,
    contractionMrr, voluntaryChurnMrr, delinquentChurnMrr,
    existingMrr, totalMrr,
    totalCustomers, newCustomers, reactivatedCustomers, churnedCustomers,
    planBreakdown: Object.values(planMap),
    movements,
  };
}

function buildContactMapFromSnapshot(snapshot) {
  if (!snapshot) return {};
  const map = {};
  for (const m of (snapshot.movements || [])) {
    if (m.currentMrr > 0 && m.contactId) {
      // This contact was active at end of previous month
    }
  }
  // Better approach: rebuild from planBreakdown + movements
  // Use movements to know who was active
  // For simplicity, we rebuild from contacts DB for the previous month state
  // This is called with the prev snapshot just for reference;
  // we actually need the prev month's active contacts
  return {};
}

export async function buildPrevContactMap(prevMonth) {
  // Get all contacts that were active subscribers
  // We approximate by using current stripeData (works well for recent months)
  // For historical accuracy, the backfill stores movements
  const snap = await MrrSnapshot.findOne({ month: prevMonth }).lean();
  if (!snap) return {};

  const map = {};
  // Reconstruct from movements: customers active at end of month =
  // those with positive currentMrr (non-churn movements)
  for (const m of (snap.movements || [])) {
    if (m.currentMrr > 0) {
      // Find the corresponding contact's stripeCustomerId
      if (m.contactId) {
        const contact = await Contact.findById(m.contactId)
          .select('stripeCustomerId').lean();
        if (contact?.stripeCustomerId) {
          map[contact.stripeCustomerId] = {
            mrr: m.currentMrr,
            planName: m.planName,
            contactId: m.contactId,
            name: m.contactName,
            email: m.contactEmail,
          };
        }
      }
    }
  }

  // Also include "existing" contacts (no movement recorded but still active)
  // These are contacts whose MRR stayed the same — they won't appear in movements
  // So we add all contacts that have active subs and were presumably active last month
  const totalFromMovements = Object.values(map).reduce((s, v) => s + v.mrr, 0);
  if (totalFromMovements < snap.totalMrr) {
    // Some existing contacts are missing — fill from DB
    const contacts = await Contact.find({
      'stripeData.subscriptionStatus': { $in: ['active', 'trialing'] },
      'stripeData.mrrFromStripe': { $gt: 0 },
      stripeCustomerId: { $exists: true },
    }).select('_id name email stripeCustomerId stripeData').lean();

    for (const c of contacts) {
      if (c.stripeCustomerId && !map[c.stripeCustomerId]) {
        map[c.stripeCustomerId] = {
          mrr: c.stripeData?.mrrFromStripe || 0,
          planName: c.stripeData?.planName || 'Unknown',
          contactId: c._id,
          name: c.name,
          email: c.email,
        };
      }
    }
  }

  return map;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPreviousMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthOffset(monthStr, offset) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function generateMonthRange(start, end) {
  const months = [];
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function detectIntervalFromSub(sub) {
  const items = sub.items?.data || [];
  for (const item of items) {
    const ri = item.price?.recurring?.interval;
    if (ri) return { interval: ri, intervalCount: item.price.recurring.interval_count || 1 };
    if (item.plan?.interval) return { interval: item.plan.interval, intervalCount: item.plan.interval_count || 1 };
  }
  if (sub.plan?.interval) return { interval: sub.plan.interval, intervalCount: sub.plan.interval_count || 1 };
  if (sub.current_period_start && sub.current_period_end) {
    const days = (sub.current_period_end - sub.current_period_start) / 86400;
    if (days > 300) return { interval: 'year', intervalCount: 1 };
    if (days > 150) return { interval: 'month', intervalCount: 6 };
    if (days > 80) return { interval: 'month', intervalCount: 3 };
    if (days > 25) return { interval: 'month', intervalCount: 1 };
  }
  return { interval: 'month', intervalCount: 1 };
}

function centsToMonthly(cents, interval, intervalCount) {
  if (interval === 'year') return Math.round(cents / (12 * intervalCount));
  if (interval === 'week') return Math.round(cents * 52 / (12 * intervalCount));
  if (interval === 'day') return Math.round(cents * 365 / (12 * intervalCount));
  return Math.round(cents / intervalCount);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
