import Contact from '../models/contactModel.js';
import MrrSnapshot from '../models/mrrSnapshotModel.js';
import { getStripe } from './stripeService.js';

/**
 * Finds all active paying customers: Stripe subscribers + bonifico bancario.
 * Normalizes bonifico contacts to have a compatible shape.
 */
async function findAllActiveCustomers(selectFields = '_id name email stripeData stripeCustomerId') {
  const [stripeContacts, bonificoContacts] = await Promise.all([
    Contact.find({
      'stripeData.subscriptionStatus': { $in: ['active', 'trialing'] },
      'stripeData.mrrFromStripe': { $gt: 0 },
    }).select(selectFields).lean(),
    Contact.find({
      'properties.paymentMethod': 'bonifico_bancario',
      status: 'won',
    }).select(`${selectFields} properties`).lean(),
  ]);

  const normalized = bonificoContacts.map(c => ({
    ...c,
    stripeCustomerId: `bonifico_${c._id}`,
    stripeData: {
      subscriptionStatus: 'active',
      mrrFromStripe: c.properties?.manualMrr || c.mrr || 0,
      planName: c.properties?.manualPlanName || 'Bonifico Bancario',
      planInterval: 'year',
      planIntervalCount: 1,
      subscriptionStartDate: c.properties?.manualSubscriptionStart
        ? new Date(c.properties.manualSubscriptionStart)
        : c.createdAt,
      syncedAt: c.updatedAt,
    },
  }));

  return [...stripeContacts, ...normalized];
}

/**
 * Build a live snapshot for a given month by querying current contact data.
 * For past months we look at stored snapshots; for the current month we compute on-the-fly.
 */
export async function computeCurrentSnapshot() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const previousMonth = getPreviousMonth(month);

  const allContacts = await findCustomersForMetrics();
  const activeContacts = filterContactsActiveInMonth(allContacts, month);

  // Chain from previous month so classification stays consistent with MRR overview
  const prevContactMap = await buildChainedPrevContactMap(allContacts, previousMonth);

  return classifyMovements(month, now, activeContacts, prevContactMap, null);
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

  const prevContactMap = await buildPrevContactMap(previousMonth);
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
      const subCreatedInMonth = customerSubHistory[custId]?.some(
        s => s.created >= monthStartTs && s.created <= monthEndTs
      );

      if (subCreatedInMonth) {
        newMrr += curr.mrr;
        newCustomers++;
        movements.push({
          contactId: contact?._id,
          contactName: contact?.name,
          contactEmail: contact?.email,
          type: 'new',
          previousMrr: prev?.mrr || 0,
          currentMrr: curr.mrr,
          delta: curr.mrr,
          planName: curr.planName,
        });
      } else if (!prev) {
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
  const monthList = [];
  for (let i = 5; i >= 0; i--) {
    monthList.push(getMonthOffset(currentMonth, -i));
  }

  const allContacts = await findCustomersForMetrics();
  const snapshots = [];
  let prevContactMap = {};

  for (const monthStr of monthList) {
    const { monthEnd } = getMonthBounds(monthStr);
    const contactsForMonth = filterContactsActiveInMonth(allContacts, monthStr);
    const snapshot = classifyMovements(monthStr, monthEnd, contactsForMonth, prevContactMap, null);
    snapshots.push(snapshot);
    prevContactMap = buildPrevMapFromContacts(contactsForMonth);
  }

  const currentSnap = snapshots.find(s => s.month === currentMonth) || null;
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
  const monthList = [];
  for (let i = numMonths - 1; i >= 0; i--) {
    monthList.push(getMonthOffset(currentMonth, -i));
  }

  const allContacts = await findCustomersForMetrics();
  const snapshots = [];
  let prevContactMap = {};

  for (const monthStr of monthList) {
    const { monthEnd } = getMonthBounds(monthStr);
    const contactsForMonth = filterContactsActiveInMonth(allContacts, monthStr);
    const snapshot = classifyMovements(monthStr, monthEnd, contactsForMonth, prevContactMap, null);
    // Omit movements from API response (large payload)
    const { movements, ...rest } = snapshot;
    snapshots.push(rest);
    prevContactMap = buildPrevMapFromContacts(contactsForMonth);
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

/**
 * Get plan comparison from CRM contacts grouped by billing frequency.
 */
export async function getPlansFromContacts() {
  const activeContacts = await findAllActiveCustomers('_id name firstName lastName email stripeData stripeCustomerId mrr');

  const intervalLabels = {
    'year-1': 'Annuale',
    'month-1': 'Mensile',
    'month-2': 'Bimestrale',
    'month-3': 'Trimestrale',
    'month-4': 'Quadrimestrale',
    'month-6': 'Semestrale',
  };

  const bucketMap = {};
  let totalMrr = 0;

  for (const c of activeContacts) {
    const sd = c.stripeData || {};
    const interval = sd.planInterval || 'month';
    const count = sd.planIntervalCount || 1;
    const key = `${interval}-${count}`;
    const label = intervalLabels[key] || (interval === 'year'
      ? (count === 1 ? 'Annuale' : `Ogni ${count} anni`)
      : `Ogni ${count} ${interval === 'month' ? 'mesi' : interval}`);

    if (!bucketMap[key]) bucketMap[key] = { key, label, customers: 0, mrr: 0, arr: 0, contacts: [] };
    const mrr = sd.mrrFromStripe || 0;
    bucketMap[key].customers++;
    bucketMap[key].mrr += mrr;
    bucketMap[key].arr += mrr * 12;
    bucketMap[key].contacts.push({
      _id: c._id,
      name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email,
      email: c.email,
      mrr,
      planName: sd.planName || '–',
      status: sd.subscriptionStatus,
    });
    totalMrr += mrr;
  }

  const plans = Object.values(bucketMap)
    .map(p => ({
      ...p,
      arpu: p.customers > 0 ? Math.round(p.mrr / p.customers) : 0,
      percentage: totalMrr > 0 ? Math.round(p.mrr / totalMrr * 100) : 0,
    }))
    .sort((a, b) => b.mrr - a.mrr);

  return { plans, totalMrr, totalCustomers: activeContacts.length };
}

/**
 * Get the full customer list with current MRR and latest activity from snapshots.
 */
export async function getCustomersList({ search, sort, order } = {}) {
  const activeContacts = await findAllActiveCustomers('_id name firstName lastName email stripeData stripeCustomerId mrr');

  const currentMonth = getCurrentMonth();

  // Compute live snapshot for the current month so activity types are always accurate
  const liveSnapshot = await computeCurrentSnapshot();

  const activityMap = {};
  for (const m of (liveSnapshot.movements || [])) {
    if (!m.contactId) continue;
    const cid = m.contactId.toString();
    activityMap[cid] = m;
  }

  const intervalLabels = {
    'year-1': 'Annuale',
    'month-1': 'Mensile',
    'month-2': 'Bimestrale',
    'month-3': 'Trimestrale',
    'month-4': 'Quadrimestrale',
    'month-6': 'Semestrale',
  };

  let totalMrr = 0;
  let customers = activeContacts.map(c => {
    const sd = c.stripeData || {};
    const mrr = sd.mrrFromStripe || 0;
    totalMrr += mrr;

    const interval = sd.planInterval || 'month';
    const count = sd.planIntervalCount || 1;
    const iKey = `${interval}-${count}`;
    const billingLabel = intervalLabels[iKey] || (interval === 'year'
      ? (count === 1 ? 'Annuale' : `Ogni ${count} anni`)
      : `Ogni ${count} mesi`);

    const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '–';
    const planDesc = [sd.planName, billingLabel].filter(Boolean).join(' · ');

    const cid = c._id.toString();
    const activity = activityMap[cid];
    let activityType = 'existing';
    let activityDelta = 0;
    let activityDate = sd.subscriptionStartDate || sd.syncedAt || null;

    if (activity) {
      activityType = activity.type;
      activityDelta = activity.delta || 0;
      // Use syncedAt for the activity date (when the change was detected)
      // rather than a synthetic "15th of the month"
      if (activityType === 'new') {
        activityDate = sd.subscriptionStartDate || sd.syncedAt || null;
      } else {
        activityDate = sd.syncedAt || sd.subscriptionStartDate || null;
      }
    }

    return {
      _id: c._id,
      name,
      email: c.email,
      planDesc,
      planName: sd.planName || '–',
      billingLabel,
      mrr,
      status: sd.subscriptionStatus,
      activityType,
      activityDelta,
      activityDate,
      subscriptionStartDate: sd.subscriptionStartDate,
    };
  });

  // Search filter
  if (search) {
    const q = search.toLowerCase();
    customers = customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.planName?.toLowerCase().includes(q)
    );
  }

  // Sort
  const sortField = sort || 'activityDate';
  const sortOrder = order === 'asc' ? 1 : -1;
  customers.sort((a, b) => {
    let av = a[sortField], bv = b[sortField];
    if (sortField === 'activityDate' || sortField === 'subscriptionStartDate') {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    }
    if (av < bv) return -sortOrder;
    if (av > bv) return sortOrder;
    return 0;
  });

  return { customers, totalMrr, totalCustomers: activeContacts.length };
}

/**
 * Forecast upcoming subscription payments grouped by month.
 * Uses Stripe subscriptions (current_period_end + billing interval).
 */
export async function getUpcomingPayments(numMonths = 6) {
  const stripe = getStripe();
  const VAT_RATE = Number(process.env.STRIPE_VAT_RATE) || 0.22;
  const grossFromNet = (netEur) => Math.round(netEur * (1 + VAT_RATE));

  const contacts = await Contact.find({
    stripeCustomerId: { $exists: true, $ne: null },
  }).select('_id name firstName lastName email stripeCustomerId stripeData').lean();

  const contactByCustomer = {};
  for (const c of contacts) {
    contactByCustomer[c.stripeCustomerId] = c;
  }

  const allSubs = [];
  for (const status of ['active', 'trialing']) {
    let hasMore = true;
    let startingAfter;
    while (hasMore) {
      const batch = await stripe.subscriptions.list({
        status,
        limit: 100,
        expand: ['data.items.data.price', 'data.customer'],
        ...(startingAfter && { starting_after: startingAfter }),
      });
      allSubs.push(...batch.data);
      hasMore = batch.has_more;
      if (batch.data.length) startingAfter = batch.data[batch.data.length - 1].id;
      if (hasMore) await delay(50);
    }
  }

  const todayRome = toRomeDateString(new Date());
  const now = new Date();
  const horizon = new Date(now.getFullYear(), now.getMonth() + numMonths + 1, 0, 23, 59, 59);

  const intervalLabels = {
    'year-1': 'Annuale',
    'month-1': 'Mensile',
    'month-2': 'Bimestrale',
    'month-3': 'Trimestrale',
    'month-4': 'Quadrimestrale',
    'month-6': 'Semestrale',
  };

  const allPayments = [];

  for (const sub of allSubs) {
    const custId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const contact = contactByCustomer[custId];
    const customerObj = typeof sub.customer === 'object' ? sub.customer : null;
    const { interval, intervalCount } = detectIntervalFromSub(sub);

    const items = sub.items?.data || [];
    let periodCents = 0;
    for (const item of items) {
      periodCents += (item.price?.unit_amount || item.plan?.amount || 0) * (item.quantity || 1);
    }

    // Netto (+ lordo calcolato) da preview Stripe o stima listino
    let upcoming = null;
    try {
      upcoming = await stripe.invoices.createPreview({ subscription: sub.id });
    } catch {
      // Es. abbonamento in cancellazione — usa stima da listino
    }
    const { amountNet, amountGross } = computePaymentAmounts({ periodCents, upcoming, vatRate: VAT_RATE });

    const firstItem = items[0];
    const planName = firstItem?.price?.nickname
      || (typeof firstItem?.price?.product === 'object' ? firstItem.price.product.name : null)
      || contact?.stripeData?.planName
      || 'Unknown';

    const iKey = `${interval}-${intervalCount}`;
    const billingLabel = intervalLabels[iKey] || interval;

    const name = contact
      ? (contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || '–')
      : customerObj?.name || customerObj?.email || custId;

    const periodEnd = getSubscriptionPeriodEnd(sub);
    const nextTs = (sub.status === 'trialing' && sub.trial_end)
      ? sub.trial_end
      : periodEnd;
    if (!nextTs) continue;

    let nextDate = new Date(nextTs * 1000);
    if (Number.isNaN(nextDate.getTime())) continue;
    const stopAfterFirst = sub.cancel_at_period_end;
    const maxDate = stopAfterFirst ? nextDate : horizon;

    while (nextDate <= maxDate) {
      if (toRomeDateString(nextDate) >= todayRome) {
        allPayments.push({
          date: nextDate.toISOString(),
          amount: amountNet,
          amountGross,
          contactId: contact?._id?.toString() || null,
          contactName: name,
          planName,
          billingLabel,
          subscriptionId: sub.id,
          status: sub.status,
          source: 'stripe',
        });
      }
      if (stopAfterFirst) break;
      nextDate = addBillingInterval(nextDate, interval, intervalCount);
    }

    await delay(30);
  }

  // Bonifico bancario contacts
  const bonificoContacts = await Contact.find({
    'properties.paymentMethod': 'bonifico_bancario',
    status: 'won',
    'properties.manualMrr': { $gt: 0 },
  }).select('_id name firstName lastName email properties').lean();

  for (const c of bonificoContacts) {
    const props = c.properties || {};
    const mrr = props.manualMrr || 0;
    if (mrr <= 0) continue;

    const planName = props.manualPlanName || 'Bonifico Bancario';
    const { interval, intervalCount, periodMonths, billingLabel } = bonificoPlanToInterval(planName);
    const amountNet = Math.round(mrr * periodMonths);
    const amountGross = grossFromNet(amountNet);

    const renewalDate = props.manualRenewalDate ? new Date(props.manualRenewalDate) : null;
    const startDate = props.manualSubscriptionStart ? new Date(props.manualSubscriptionStart) : null;

    let nextDate = renewalDate || inferNextBonificoDate(startDate, interval, intervalCount, new Date());
    if (!nextDate) continue;

    const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '–';

    while (nextDate <= horizon) {
      if (toRomeDateString(nextDate) >= todayRome) {
        allPayments.push({
          date: nextDate.toISOString(),
          amount: amountNet,
          amountGross,
          contactId: c._id.toString(),
          contactName: name,
          planName,
          billingLabel,
          subscriptionId: null,
          status: 'active',
          source: 'bonifico',
        });
      }
      nextDate = addBillingInterval(nextDate, interval, intervalCount);
    }
  }

  const monthMap = {};
  for (const p of allPayments) {
    const monthKey = toMonthKey(new Date(p.date));
    if (!monthMap[monthKey]) {
      monthMap[monthKey] = { month: monthKey, totalAmount: 0, totalAmountGross: 0, paymentCount: 0, payments: [] };
    }
    monthMap[monthKey].totalAmount += p.amount;
    monthMap[monthKey].totalAmountGross += p.amountGross;
    monthMap[monthKey].paymentCount += 1;
    monthMap[monthKey].payments.push(p);
  }

  const currentMonth = getCurrentMonthRome();
  const months = getUpcomingMonthRange(numMonths, currentMonth).map(monthKey => {
    const entry = monthMap[monthKey];
    return {
      month: monthKey,
      totalAmount: entry?.totalAmount || 0,
      totalAmountGross: entry?.totalAmountGross || 0,
      paymentCount: entry?.paymentCount || 0,
      payments: (entry?.payments || []).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      ),
    };
  });

  return {
    months,
    currentMonth,
    amountsIncludeVat: false,
    grandTotal: months.reduce((s, m) => s + m.totalAmount, 0),
    grandTotalGross: months.reduce((s, m) => s + m.totalAmountGross, 0),
    subscriptionCount: allSubs.length,
    bonificoCount: bonificoContacts.length,
  };
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
    const subStart = c.stripeData?.subscriptionStartDate;

    // New customer = subscription started in this month (regardless of prev map)
    if (isSubscriptionInMonth(subStart, month)) {
      newMrr += mrr;
      newCustomers++;
      movements.push({ contactId: c._id, contactName: c.name, contactEmail: c.email,
        type: 'new', previousMrr: prev?.mrr || 0, currentMrr: mrr, delta: mrr, planName });
      continue;
    }

    if (!prev) {
      reactivationMrr += mrr;
      reactivatedCustomers++;
      movements.push({ contactId: c._id, contactName: c.name, contactEmail: c.email,
        type: 'reactivation', previousMrr: 0, currentMrr: mrr, delta: mrr, planName });
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
  for (const [custId, prev] of Object.entries(prevContactMap)) {
    if (!currentIds.has(custId)) {
      churnedCustomers++;
      voluntaryChurnMrr += prev.mrr;
      movements.push({ contactId: prev.contactId, contactName: prev.name, contactEmail: prev.email,
        type: 'voluntary_churn', previousMrr: prev.mrr, currentMrr: 0, delta: -prev.mrr, planName: prev.planName });
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
  const snap = await MrrSnapshot.findOne({ month: prevMonth }).lean();

  const map = {};

  // If a snapshot exists, reconstruct from its movements
  if (snap) {
    for (const m of (snap.movements || [])) {
      if (m.currentMrr > 0 && m.contactId) {
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

  // Fill gaps from currently active contacts whose subscription started
  // before the end of prevMonth. This handles two cases:
  // 1) No snapshot exists at all — we infer who was active from current DB state
  // 2) Snapshot exists but "existing" customers have no movement entry
  const [y, m] = prevMonth.split('-').map(Number);
  const prevMonthEnd = new Date(y, m, 0, 23, 59, 59);

  const contacts = await findAllActiveCustomers('_id name email stripeCustomerId stripeData mrr');

  for (const c of contacts) {
    const custId = c.stripeCustomerId;
    if (custId && !map[custId]) {
      const subStart = c.stripeData?.subscriptionStartDate;
      if (subStart && subStart <= prevMonthEnd) {
        map[custId] = {
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

function getMonthBounds(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return {
    monthStart: new Date(y, m - 1, 1, 0, 0, 0, 0),
    monthEnd: new Date(y, m, 0, 23, 59, 59, 999),
  };
}

function isSubscriptionInMonth(subStart, monthStr) {
  if (!subStart) return false;
  const date = subStart instanceof Date ? subStart : new Date(subStart);
  const { monthStart, monthEnd } = getMonthBounds(monthStr);
  return date >= monthStart && date <= monthEnd;
}

/** Active + churned contacts with Stripe history (for historical month reconstruction). */
async function findCustomersForMetrics() {
  const selectFields = '_id name firstName lastName email stripeData stripeCustomerId mrr';
  const [active, churned] = await Promise.all([
    findAllActiveCustomers(selectFields),
    Contact.find({
      stripeCustomerId: { $exists: true, $ne: null },
      'stripeData.subscriptionStartDate': { $exists: true },
      'stripeData.mrrFromStripe': { $gt: 0 },
      'stripeData.subscriptionStatus': { $nin: ['active', 'trialing'] },
    }).select(selectFields).lean(),
  ]);

  const seen = new Set();
  const merged = [];
  for (const c of [...active, ...churned]) {
    const id = c._id.toString();
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(c);
    }
  }
  return merged;
}

function filterContactsActiveInMonth(contacts, monthStr) {
  const { monthStart, monthEnd } = getMonthBounds(monthStr);
  return contacts.filter(c => {
    const subStart = c.stripeData?.subscriptionStartDate;
    if (!subStart) return monthStr === getCurrentMonth();
    const start = new Date(subStart);
    if (start > monthEnd) return false;
    const canceledAt = c.stripeData?.canceledAt;
    if (canceledAt && new Date(canceledAt) < monthStart) return false;
    return true;
  });
}

function buildPrevMapFromContacts(contacts) {
  const map = {};
  for (const c of contacts) {
    const custId = c.stripeCustomerId;
    if (!custId) continue;
    map[custId] = {
      mrr: c.stripeData?.mrrFromStripe || 0,
      planName: c.stripeData?.planName || 'Unknown',
      contactId: c._id,
      name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email,
      email: c.email,
    };
  }
  return map;
}

/** Rebuild prev-month map by chaining month-by-month up to targetMonth (inclusive). */
async function buildChainedPrevContactMap(allContacts, targetMonth) {
  const currentMonth = getCurrentMonth();
  if (targetMonth >= currentMonth) return {};

  let earliest = targetMonth;
  for (const c of allContacts) {
    const subStart = c.stripeData?.subscriptionStartDate;
    if (subStart) {
      const d = new Date(subStart);
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (m < earliest) earliest = m;
    }
  }

  const months = generateMonthRange(earliest, targetMonth);
  let prevContactMap = {};
  for (const monthStr of months) {
    const { monthEnd } = getMonthBounds(monthStr);
    const contactsForMonth = filterContactsActiveInMonth(allContacts, monthStr);
    classifyMovements(monthStr, monthEnd, contactsForMonth, prevContactMap, null);
    prevContactMap = buildPrevMapFromContacts(contactsForMonth);
  }
  return prevContactMap;
}

const ROME_TZ = 'Europe/Rome';

function getRomeDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(date).split('-').map(Number);
  return { y, m, d };
}

function toRomeDateString(date) {
  const { y, m, d } = getRomeDateParts(date);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toMonthKey(date) {
  const { y, m } = getRomeDateParts(date);
  return `${y}-${String(m).padStart(2, '0')}`;
}

function getCurrentMonthRome() {
  return toMonthKey(new Date());
}

function getUpcomingMonthRange(numMonths, startMonth) {
  const months = [];
  let [y, m] = startMonth.split('-').map(Number);
  for (let i = 0; i < numMonths; i++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
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
  const periodStart = getSubscriptionPeriodStart(sub);
  const periodEnd = getSubscriptionPeriodEnd(sub);
  if (periodStart && periodEnd) {
    const days = (periodEnd - periodStart) / 86400;
    if (days > 300) return { interval: 'year', intervalCount: 1 };
    if (days > 150) return { interval: 'month', intervalCount: 6 };
    if (days > 80) return { interval: 'month', intervalCount: 3 };
    if (days > 25) return { interval: 'month', intervalCount: 1 };
  }
  return { interval: 'month', intervalCount: 1 };
}

/** Stripe API 2025+: billing period lives on subscription items, not the subscription root. */
function getSubscriptionPeriodEnd(sub) {
  if (sub.current_period_end) return sub.current_period_end;
  const ends = (sub.items?.data || []).map(i => i.current_period_end).filter(Boolean);
  return ends.length ? Math.min(...ends) : null;
}

function getSubscriptionPeriodStart(sub) {
  if (sub.current_period_start) return sub.current_period_start;
  const starts = (sub.items?.data || []).map(i => i.current_period_start).filter(Boolean);
  return starts.length ? Math.min(...starts) : null;
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

function addBillingInterval(date, interval, intervalCount) {
  const d = new Date(date);
  if (interval === 'year') {
    d.setFullYear(d.getFullYear() + intervalCount);
  } else if (interval === 'month') {
    d.setMonth(d.getMonth() + intervalCount);
  } else if (interval === 'week') {
    d.setDate(d.getDate() + 7 * intervalCount);
  } else {
    d.setDate(d.getDate() + intervalCount);
  }
  return d;
}

function bonificoPlanToInterval(planName) {
  const p = (planName || '').toLowerCase();
  if (p.includes('mensile')) {
    return { interval: 'month', intervalCount: 1, periodMonths: 1, billingLabel: 'Mensile' };
  }
  if (p.includes('bimestrale')) {
    return { interval: 'month', intervalCount: 2, periodMonths: 2, billingLabel: 'Bimestrale' };
  }
  if (p.includes('trimestrale')) {
    return { interval: 'month', intervalCount: 3, periodMonths: 3, billingLabel: 'Trimestrale' };
  }
  if (p.includes('quadrimestrale')) {
    return { interval: 'month', intervalCount: 4, periodMonths: 4, billingLabel: 'Quadrimestrale' };
  }
  if (p.includes('semestrale')) {
    return { interval: 'month', intervalCount: 6, periodMonths: 6, billingLabel: 'Semestrale' };
  }
  return { interval: 'year', intervalCount: 1, periodMonths: 12, billingLabel: 'Annuale' };
}

function inferNextBonificoDate(startDate, interval, intervalCount, now) {
  if (!startDate) return null;
  let d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let guard = 0;
  while (d < today && guard < 120) {
    d = addBillingInterval(d, interval, intervalCount);
    guard++;
  }
  return d;
}

function computePaymentAmounts({ periodCents, upcoming, vatRate }) {
  const grossFromNetLocal = (net) => Math.round(net * (1 + vatRate));
  const netFromGrossLocal = (gross) => Math.round(gross / (1 + vatRate));

  let amountNet = Math.round(periodCents / 100);
  let amountGross = grossFromNetLocal(amountNet);

  if (upcoming?.total) {
    amountGross = Math.round(Math.abs(upcoming.total) / 100);
    if (typeof upcoming.tax === 'number' && upcoming.tax > 0) {
      amountNet = Math.round((Math.abs(upcoming.total) - upcoming.tax) / 100);
    } else if (typeof upcoming.subtotal_excluding_tax === 'number' && upcoming.subtotal_excluding_tax > 0) {
      amountNet = Math.round(Math.abs(upcoming.subtotal_excluding_tax) / 100);
    } else {
      amountNet = netFromGrossLocal(amountGross);
    }
  }

  return { amountNet, amountGross };
}
