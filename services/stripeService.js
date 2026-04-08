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
    expand: ['data.default_payment_method'],
  });

  // Priorità: active > trialing > past_due > altri
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

function extractStripeData(subscription, invoice, customer) {
  const data = {
    syncedAt: new Date(),
  };

  if (subscription) {
    const safeDate = (ts) => (ts && typeof ts === 'number') ? new Date(ts * 1000) : null;

    const items = subscription.items?.data || [];

    // Log raw data for debugging
    console.log(`[Stripe] Subscription ${subscription.id}: ${items.length} items`);
    for (const item of items) {
      console.log(`[Stripe]   Item: unit_amount=${item.price?.unit_amount}, quantity=${item.quantity}, interval=${item.price?.recurring?.interval}, interval_count=${item.price?.recurring?.interval_count}, nickname=${item.price?.nickname}`);
    }

    // Calculate MRR: sum all items, convert to monthly
    let totalMonthlyCents = 0;
    for (const item of items) {
      const price = item.price;
      const unitAmount = price?.unit_amount || 0;
      const quantity = item.quantity || 1;
      const interval = price?.recurring?.interval || 'month';
      const intervalCount = price?.recurring?.interval_count || 1;

      // Total per billing cycle for this item
      let itemTotalPerCycle = unitAmount * quantity;

      // Convert to monthly
      if (interval === 'year') itemTotalPerCycle = Math.round(itemTotalPerCycle / (12 * intervalCount));
      else if (interval === 'week') itemTotalPerCycle = Math.round(itemTotalPerCycle * 52 / (12 * intervalCount));
      else if (interval === 'day') itemTotalPerCycle = Math.round(itemTotalPerCycle * 365 / (12 * intervalCount));
      else itemTotalPerCycle = Math.round(itemTotalPerCycle / intervalCount); // month

      totalMonthlyCents += itemTotalPerCycle;
    }

    // If items-based MRR seems too low compared to what's actually invoiced,
    // use the latest invoice as a more accurate source
    if (invoice && invoice.lines?.data?.length > 0) {
      // Sum recurring line items from the invoice (excludes one-off charges)
      let invoiceRecurringCents = 0;
      let invoiceInterval = 'month';
      for (const line of invoice.lines.data) {
        if (line.type === 'subscription' || line.price?.type === 'recurring') {
          invoiceRecurringCents += line.amount || 0;
          if (line.price?.recurring?.interval) invoiceInterval = line.price.recurring.interval;
        }
      }

      if (invoiceRecurringCents > 0) {
        let invoiceMonthlyCents = invoiceRecurringCents;
        if (invoiceInterval === 'year') invoiceMonthlyCents = Math.round(invoiceRecurringCents / 12);
        else if (invoiceInterval === 'week') invoiceMonthlyCents = Math.round(invoiceRecurringCents * 52 / 12);

        console.log(`[Stripe]   Items-based MRR: €${Math.round(totalMonthlyCents / 100)}, Invoice-based MRR: €${Math.round(invoiceMonthlyCents / 100)}`);

        // Use the higher of the two (invoice is usually more accurate as it includes all charges)
        if (invoiceMonthlyCents > totalMonthlyCents) {
          totalMonthlyCents = invoiceMonthlyCents;
        }
      }
    }

    const firstItem = items[0];
    const firstPrice = firstItem?.price;
    const interval = firstPrice?.recurring?.interval || 'month';
    const productName = product(firstPrice);
    const planLabel = firstPrice?.nickname || firstItem?.plan?.nickname || productName || null;

    data.subscriptionId = subscription.id;
    data.subscriptionStatus = subscription.status;
    data.planName = planLabel || `€${Math.round(totalMonthlyCents / 100)}/mese`;
    data.planInterval = interval;
    data.mrrFromStripe = Math.round(totalMonthlyCents / 100);
    data.subscriptionStartDate = safeDate(subscription.start_date);
    data.currentPeriodEnd = safeDate(subscription.current_period_end);
    data.canceledAt = safeDate(subscription.canceled_at);

    const pm = subscription.default_payment_method;
    if (pm && typeof pm === 'object' && pm.card) {
      data.paymentMethodBrand = pm.card.brand;
      data.paymentMethodLast4 = pm.card.last4;
    }

    console.log(`[Stripe]   Final MRR: €${data.mrrFromStripe}, Plan: ${data.planName}, Status: ${data.subscriptionStatus}`);
  }

  if (invoice) {
    const paidTs = invoice.status_transitions?.paid_at || invoice.created;
    data.lastPaymentDate = paidTs ? new Date(paidTs * 1000) : null;
    data.lastPaymentAmount = Math.round((invoice.amount_paid || 0) / 100);
    console.log(`[Stripe]   Last invoice: €${data.lastPaymentAmount} (amount_paid=${invoice.amount_paid}, subtotal=${invoice.subtotal}, total=${invoice.total})`);
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

export {
  getStripe,
  findCustomerByEmail,
  syncContactWithStripe,
  syncAllWonContacts,
  handleWebhookEvent,
  getCustomerInvoices,
};
