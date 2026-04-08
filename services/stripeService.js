import Stripe from 'stripe';
import Contact from '../models/contactModel.js';

let stripeClient = null;

function getStripe() {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY non configurata');
    }
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

async function findCustomerByEmail(email) {
  if (!email) return null;
  const stripe = getStripe();
  const customers = await stripe.customers.list({ email: email.toLowerCase(), limit: 1 });
  return customers.data.length > 0 ? customers.data[0] : null;
}

async function getActiveSubscription(customerId) {
  const stripe = getStripe();
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
    expand: ['data.default_payment_method', 'data.items.data.price'],
  });

  const priority = ['active', 'trialing', 'past_due', 'paused', 'incomplete', 'unpaid', 'canceled'];
  const sorted = subs.data.sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status));
  return sorted.length > 0 ? sorted[0] : null;
}

async function getLatestInvoice(customerId) {
  const stripe = getStripe();
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: 1,
    status: 'paid',
    expand: ['data.lines'],
  });
  return invoices.data.length > 0 ? invoices.data[0] : null;
}

function detectInterval(subscription, invoice) {
  // 1. From subscription items
  const items = subscription?.items?.data || [];
  for (const item of items) {
    const ri = item.price?.recurring?.interval;
    if (ri) return { interval: ri, intervalCount: item.price.recurring.interval_count || 1 };
    const pi = item.plan?.interval;
    if (pi) return { interval: pi, intervalCount: item.plan.interval_count || 1 };
  }

  // 2. From deprecated subscription.plan field
  if (subscription?.plan?.interval) {
    return { interval: subscription.plan.interval, intervalCount: subscription.plan.interval_count || 1 };
  }

  // 3. From invoice line items
  if (invoice?.lines?.data?.length > 0) {
    for (const line of invoice.lines.data) {
      const ri = line.price?.recurring?.interval;
      if (ri) return { interval: ri, intervalCount: line.price.recurring.interval_count || 1 };
      if (line.plan?.interval) return { interval: line.plan.interval, intervalCount: line.plan.interval_count || 1 };
    }
  }

  // 4. Heuristic: compare subscription period length
  if (subscription?.current_period_start && subscription?.current_period_end) {
    const days = (subscription.current_period_end - subscription.current_period_start) / 86400;
    if (days > 300) return { interval: 'year', intervalCount: 1 };
    if (days > 25) return { interval: 'month', intervalCount: 1 };
    if (days > 5) return { interval: 'week', intervalCount: 1 };
    return { interval: 'day', intervalCount: 1 };
  }

  return { interval: 'month', intervalCount: 1 };
}

function centsToMonthly(cents, interval, intervalCount) {
  if (interval === 'year') return Math.round(cents / (12 * intervalCount));
  if (interval === 'week') return Math.round(cents * 52 / (12 * intervalCount));
  if (interval === 'day') return Math.round(cents * 365 / (12 * intervalCount));
  return Math.round(cents / intervalCount); // month
}

function extractStripeData(subscription, invoice, customer) {
  const data = { syncedAt: new Date() };

  if (subscription) {
    const safeDate = (ts) => (ts && typeof ts === 'number') ? new Date(ts * 1000) : null;
    const items = subscription.items?.data || [];
    const { interval, intervalCount } = detectInterval(subscription, invoice);

    console.log(`[Stripe] Sub ${subscription.id}: ${items.length} items, detected interval=${interval}/${intervalCount}`);
    for (const item of items) {
      console.log(`[Stripe]   Item: unit_amount=${item.price?.unit_amount}, qty=${item.quantity}, price_interval=${item.price?.recurring?.interval}, plan_interval=${item.plan?.interval}`);
    }

    // Items-based MRR
    let itemsMonthlyCents = 0;
    for (const item of items) {
      const unitAmount = item.price?.unit_amount || item.plan?.amount || 0;
      const quantity = item.quantity || 1;
      itemsMonthlyCents += centsToMonthly(unitAmount * quantity, interval, intervalCount);
    }

    // Invoice-based MRR — use total (actual payment after discounts),
    // then strip VAT. If Stripe Tax is configured, use its tax field;
    // otherwise apply configured VAT rate (default 22% Italy).
    const VAT_RATE = Number(process.env.STRIPE_VAT_RATE) || 0.22;
    let invoiceMonthlyCents = 0;
    if (invoice) {
      const grossCents = Math.abs(invoice.total || 0);
      const hasTax = typeof invoice.tax === 'number' && invoice.tax > 0;
      const netCents = hasTax
        ? grossCents - invoice.tax
        : Math.round(grossCents / (1 + VAT_RATE));
      invoiceMonthlyCents = centsToMonthly(netCents, interval, intervalCount);

      console.log(`[Stripe]   Invoice: subtotal=${invoice.subtotal}, tax=${invoice.tax}, total=${invoice.total}, amount_paid=${invoice.amount_paid}`);
      console.log(`[Stripe]   Gross=${grossCents}, VAT ${hasTax ? 'from Stripe' : `${VAT_RATE*100}%`} → net=${netCents} → MRR €${Math.round(invoiceMonthlyCents / 100)}`);
    }

    const finalMonthlyCents = invoiceMonthlyCents > 0 ? invoiceMonthlyCents : itemsMonthlyCents;

    const firstItem = items[0];
    const firstPrice = firstItem?.price;
    const productName = product(firstPrice);
    const planLabel = firstPrice?.nickname || firstItem?.plan?.nickname || productName || null;

    const intervalLabel = { year: 'anno', month: 'mese', week: 'settimana', day: 'giorno' }[interval] || interval;

    data.subscriptionId = subscription.id;
    data.subscriptionStatus = subscription.status;
    data.planName = planLabel || `€${Math.round(finalMonthlyCents / 100)}/mese (${intervalLabel})`;
    data.planInterval = interval;
    data.mrrFromStripe = Math.round(finalMonthlyCents / 100);
    data.subscriptionStartDate = safeDate(subscription.start_date);
    data.currentPeriodEnd = safeDate(subscription.current_period_end);
    data.canceledAt = safeDate(subscription.canceled_at);

    const pm = subscription.default_payment_method;
    if (pm && typeof pm === 'object' && pm.card) {
      data.paymentMethodBrand = pm.card.brand;
      data.paymentMethodLast4 = pm.card.last4;
    }

    console.log(`[Stripe]   FINAL → MRR: €${data.mrrFromStripe}, interval: ${interval}, plan: ${data.planName}`);
  }

  if (invoice) {
    const paidTs = invoice.status_transitions?.paid_at || invoice.created;
    data.lastPaymentDate = paidTs ? new Date(paidTs * 1000) : null;
    data.lastPaymentAmount = Math.round((invoice.amount_paid || 0) / 100);
  }

  return data;
}

function product(price) {
  if (!price?.product) return null;
  if (typeof price.product === 'object' && price.product.name) return price.product.name;
  return null;
}

async function syncContactWithStripe(contact) {
  const customer = contact.stripeCustomerId
    ? await getStripe().customers.retrieve(contact.stripeCustomerId)
    : await findCustomerByEmail(contact.email);

  if (!customer || customer.deleted) {
    return { synced: false, reason: 'Customer Stripe non trovato' };
  }

  const subscription = await getActiveSubscription(customer.id);
  const invoice = await getLatestInvoice(customer.id);
  const stripeData = extractStripeData(subscription, invoice, customer);

  await Contact.findByIdAndUpdate(contact._id, {
    stripeCustomerId: customer.id,
    stripeData,
  });

  return { synced: true, stripeCustomerId: customer.id, stripeData };
}

async function diagnoseContact(contact) {
  const customer = contact.stripeCustomerId
    ? await getStripe().customers.retrieve(contact.stripeCustomerId)
    : await findCustomerByEmail(contact.email);

  if (!customer || customer.deleted) {
    return { found: false, reason: 'Customer non trovato' };
  }

  const subscription = await getActiveSubscription(customer.id);
  const invoice = await getLatestInvoice(customer.id);

  const items = subscription?.items?.data || [];
  const detected = subscription ? detectInterval(subscription, invoice) : null;

  return {
    found: true,
    customerId: customer.id,
    customerEmail: customer.email,
    customerName: customer.name,
    subscription: subscription ? {
      id: subscription.id,
      status: subscription.status,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      periodDays: subscription.current_period_end && subscription.current_period_start
        ? Math.round((subscription.current_period_end - subscription.current_period_start) / 86400)
        : null,
      planInterval: subscription.plan?.interval,
      planIntervalCount: subscription.plan?.interval_count,
      items: items.map(it => ({
        priceId: it.price?.id,
        unitAmount: it.price?.unit_amount,
        currency: it.price?.currency,
        recurringInterval: it.price?.recurring?.interval,
        recurringIntervalCount: it.price?.recurring?.interval_count,
        quantity: it.quantity,
        planInterval: it.plan?.interval,
        planIntervalCount: it.plan?.interval_count,
        planAmount: it.plan?.amount,
        nickname: it.price?.nickname || it.plan?.nickname,
      })),
    } : null,
    detectedInterval: detected,
    invoice: invoice ? {
      id: invoice.id,
      number: invoice.number,
      subtotal: invoice.subtotal,
      subtotal_excluding_tax: invoice.subtotal_excluding_tax,
      tax: invoice.tax,
      total: invoice.total,
      amount_paid: invoice.amount_paid,
      currency: invoice.currency,
      lines: (invoice.lines?.data || []).map(l => ({
        type: l.type,
        amount: l.amount,
        description: l.description,
        priceInterval: l.price?.recurring?.interval,
        priceIntervalCount: l.price?.recurring?.interval_count,
        planInterval: l.plan?.interval,
      })),
    } : null,
  };
}

async function syncAllWonContacts() {
  const contacts = await Contact.find({
    status: 'won',
    email: { $exists: true, $ne: '' },
  }).select('_id email stripeCustomerId').lean();

  const results = { total: contacts.length, synced: 0, notFound: 0, errors: 0 };

  for (const contact of contacts) {
    try {
      // Rate limiting: 25 req/s per Stripe
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = await syncContactWithStripe(contact);
      if (result.synced) results.synced++;
      else results.notFound++;
    } catch (err) {
      console.error(`Stripe sync error for contact ${contact._id}:`, err.message);
      results.errors++;
    }
  }

  return results;
}

async function handleWebhookEvent(event) {
  const handlers = {
    'customer.subscription.created': handleSubscriptionChange,
    'customer.subscription.updated': handleSubscriptionChange,
    'customer.subscription.deleted': handleSubscriptionChange,
    'invoice.paid': handleInvoicePaid,
    'invoice.payment_failed': handlePaymentFailed,
  };

  const handler = handlers[event.type];
  if (!handler) return { handled: false };

  return handler(event);
}

async function handleSubscriptionChange(event) {
  const subscription = event.data.object;
  const customerId = subscription.customer;

  const contact = await Contact.findOne({
    $or: [
      { stripeCustomerId: customerId },
      ...(await getCustomerEmail(customerId) ? [{ email: await getCustomerEmail(customerId) }] : []),
    ],
  });

  if (!contact) {
    console.log(`[Stripe Webhook] No CRM contact for customer ${customerId}`);
    return { handled: false, reason: 'contact_not_found' };
  }

  const invoice = await getLatestInvoice(customerId);
  const stripe = getStripe();
  let fullSub = subscription;
  if (!subscription.default_payment_method || typeof subscription.default_payment_method === 'string') {
    fullSub = await stripe.subscriptions.retrieve(subscription.id, {
      expand: ['default_payment_method'],
    });
  }

  const stripeData = extractStripeData(fullSub, invoice, null);

  await Contact.findByIdAndUpdate(contact._id, {
    stripeCustomerId: customerId,
    stripeData,
  });

  console.log(`[Stripe Webhook] Updated contact ${contact._id} (${contact.name}) — status: ${stripeData.subscriptionStatus}`);
  return { handled: true, contactId: contact._id, status: stripeData.subscriptionStatus };
}

async function handleInvoicePaid(event) {
  const invoice = event.data.object;
  const customerId = invoice.customer;

  const contact = await Contact.findOne({ stripeCustomerId: customerId });
  if (!contact) return { handled: false, reason: 'contact_not_found' };

  await Contact.findByIdAndUpdate(contact._id, {
    'stripeData.lastPaymentDate': new Date(invoice.status_transitions?.paid_at * 1000 || invoice.created * 1000),
    'stripeData.lastPaymentAmount': Math.round((invoice.amount_paid || 0) / 100),
    'stripeData.syncedAt': new Date(),
  });

  return { handled: true, contactId: contact._id };
}

async function handlePaymentFailed(event) {
  const invoice = event.data.object;
  const customerId = invoice.customer;

  const contact = await Contact.findOne({ stripeCustomerId: customerId });
  if (!contact) return { handled: false, reason: 'contact_not_found' };

  await Contact.findByIdAndUpdate(contact._id, {
    'stripeData.subscriptionStatus': 'past_due',
    'stripeData.syncedAt': new Date(),
  });

  return { handled: true, contactId: contact._id };
}

async function getCustomerEmail(customerId) {
  try {
    const customer = await getStripe().customers.retrieve(customerId);
    return customer.deleted ? null : customer.email?.toLowerCase();
  } catch {
    return null;
  }
}

async function getCustomerInvoices(customerId, limit = 10) {
  const stripe = getStripe();
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit,
  });
  return invoices.data.map(inv => ({
    id: inv.id,
    number: inv.number,
    status: inv.status,
    amount: Math.round((inv.amount_paid || inv.total || 0) / 100),
    currency: inv.currency,
    date: new Date(inv.created * 1000),
    paidAt: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : null,
    invoiceUrl: inv.hosted_invoice_url,
  }));
}

async function searchCustomers(query, limit = 10) {
  const stripe = getStripe();
  const results = [];
  const q = query.trim();

  // Search by email (exact prefix match)
  const byEmail = await stripe.customers.list({ email: q.toLowerCase(), limit });
  results.push(...byEmail.data);

  // Search by name / business name
  if (results.length < limit) {
    try {
      const byName = await stripe.customers.search({
        query: `name~"${q}"`,
        limit: limit - results.length,
      });
      for (const c of byName.data) {
        if (!results.find(r => r.id === c.id)) results.push(c);
      }
    } catch { /* search API might fail on special chars */ }
  }

  // Also search in metadata/description if still few results
  if (results.length < limit && q.length >= 3) {
    try {
      const byMeta = await stripe.customers.search({
        query: `metadata["ragione_sociale"]~"${q}" OR description~"${q}"`,
        limit: limit - results.length,
      });
      for (const c of byMeta.data) {
        if (!results.find(r => r.id === c.id)) results.push(c);
      }
    } catch { /* ignore */ }
  }

  const unique = results.slice(0, limit);

  // Fetch last paid invoice for each customer (in parallel)
  const enriched = await Promise.all(unique.map(async (c) => {
    let lastInvoice = null;
    try {
      const invs = await stripe.invoices.list({ customer: c.id, limit: 1, status: 'paid' });
      if (invs.data.length > 0) {
        const inv = invs.data[0];
        lastInvoice = {
          amount: Math.round((inv.amount_paid || inv.total || 0) / 100),
          currency: inv.currency || 'eur',
          date: new Date(inv.created * 1000),
          number: inv.number,
        };
      }
    } catch { /* ignore */ }

    return {
      id: c.id,
      email: c.email,
      name: c.name,
      description: c.description || null,
      created: new Date(c.created * 1000),
      lastInvoice,
    };
  }));

  return enriched;
}

async function linkCustomerToContact(contactId, stripeCustomerId) {
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (!customer || customer.deleted) {
    throw new Error('Cliente Stripe non trovato o eliminato');
  }

  const subscription = await getActiveSubscription(stripeCustomerId);
  const invoice = await getLatestInvoice(stripeCustomerId);
  const stripeData = extractStripeData(subscription, invoice, customer);

  const updated = await Contact.findByIdAndUpdate(
    contactId,
    { stripeCustomerId, stripeData },
    { new: true }
  )
    .populate('owner', 'firstName lastName email role')
    .populate('createdBy', 'firstName lastName email')
    .populate('lastModifiedBy', 'firstName lastName email')
    .lean();

  if (!updated) throw new Error('Contatto CRM non trovato');
  return updated;
}

export {
  getStripe,
  findCustomerByEmail,
  syncContactWithStripe,
  syncAllWonContacts,
  handleWebhookEvent,
  getCustomerInvoices,
  searchCustomers,
  linkCustomerToContact,
  diagnoseContact,
};
