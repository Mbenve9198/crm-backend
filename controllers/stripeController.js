import * as stripeService from '../services/stripeService.js';
import Contact from '../models/contactModel.js';

export const syncSingleContact = async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.findById(id).lean();
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    }
    if (!contact.email) {
      return res.status(400).json({ success: false, message: 'Il contatto non ha un indirizzo email' });
    }

    const result = await stripeService.syncContactWithStripe(contact);
    const updated = await Contact.findById(id)
      .populate('owner', 'firstName lastName email role')
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email')
      .lean();

    res.json({ success: true, data: updated, sync: result });
  } catch (error) {
    console.error('Stripe sync error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const syncAllWon = async (req, res) => {
  try {
    const results = await stripeService.syncAllWonContacts();
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Stripe bulk sync error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getInvoices = async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.findById(id).lean();
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    }
    if (!contact.stripeCustomerId) {
      return res.json({ success: true, data: [] });
    }

    const invoices = await stripeService.getCustomerInvoices(contact.stripeCustomerId);
    res.json({ success: true, data: invoices });
  } catch (error) {
    console.error('Stripe invoices error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    const stripe = stripeService.getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

  try {
    const result = await stripeService.handleWebhookEvent(event);
    console.log(`[Stripe Webhook] ${event.type} → `, result);
    res.json({ received: true, ...result });
  } catch (error) {
    console.error(`[Stripe Webhook] Error handling ${event.type}:`, error);
    res.status(500).json({ received: true, error: error.message });
  }
};

export const searchCustomers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }
    const customers = await stripeService.searchCustomers(q);
    res.json({ success: true, data: customers });
  } catch (error) {
    console.error('Stripe search error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const linkCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { stripeCustomerId } = req.body;
    if (!stripeCustomerId) {
      return res.status(400).json({ success: false, message: 'stripeCustomerId richiesto' });
    }
    const updated = await stripeService.linkCustomerToContact(id, stripeCustomerId);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Stripe link error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const diagnose = async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.findById(id).lean();
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    }
    const result = await stripeService.diagnoseContact(contact);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Stripe diagnose error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const unlinkCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Contact.findByIdAndUpdate(
      id,
      { $unset: { stripeCustomerId: 1, stripeData: 1 } },
      { new: true }
    )
      .populate('owner', 'firstName lastName email role')
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email')
      .lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Stripe unlink error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const unmatchedCustomers = async (req, res) => {
  try {
    const result = await stripeService.getUnmatchedStripeCustomers();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Stripe unmatched customers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export default { syncSingleContact, syncAllWon, getInvoices, handleWebhook, searchCustomers, linkCustomer, unlinkCustomer, unmatchedCustomers };
