'use strict';

/**
 * Partner Commission System — Stripe Connect
 * ------------------------------------------
 * Single-file Express server providing:
 *   1. POST /webhook  — reacts to the 2nd paid invoice of a tagged subscription
 *   2. Control panel  — Partners / Subscriptions / Commissions (basic auth)
 *   3. Email notifications via Brevo SMTP
 *
 * No database. Stripe metadata is the single source of truth.
 * All commission state is DERIVED in real time from invoices + transfers.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');

// ---------------------------------------------------------------------------
// Environment loading (optional local .env; on Hostinger vars come from panel)
// ---------------------------------------------------------------------------
(function loadDotEnvIfPresent() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  PANEL_USER,
  PANEL_PASSWORD,
  BREVO_SMTP_HOST,
  BREVO_SMTP_PORT,
  BREVO_SMTP_USER,
  BREVO_SMTP_PASS,
  NOTIFY_EMAIL,
  PANEL_URL,
  PORT,
} = process.env;

// Fail fast on the two vars we cannot operate without.
if (!STRIPE_SECRET_KEY) {
  console.error('FATAL: STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}
for (const [name, val] of Object.entries({
  STRIPE_WEBHOOK_SECRET,
  PANEL_USER,
  PANEL_PASSWORD,
  NOTIFY_EMAIL,
  PANEL_URL,
})) {
  if (!val) console.warn(`WARNING: ${name} is not set — related feature will be limited.`);
}

const stripe = require('stripe')(STRIPE_SECRET_KEY);
const FROM_EMAIL = 'noreply@oitoronto.com';
const panelUrl = (PANEL_URL || '').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Email (Brevo SMTP) — created lazily, failures never break business logic
// ---------------------------------------------------------------------------
let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  if (!BREVO_SMTP_HOST || !BREVO_SMTP_USER || !BREVO_SMTP_PASS) return null;
  mailer = nodemailer.createTransport({
    host: BREVO_SMTP_HOST,
    port: Number(BREVO_SMTP_PORT || 587),
    secure: Number(BREVO_SMTP_PORT) === 465,
    auth: { user: BREVO_SMTP_USER, pass: BREVO_SMTP_PASS },
  });
  return mailer;
}

async function sendEmail(subject, html) {
  try {
    const transport = getMailer();
    if (!transport || !NOTIFY_EMAIL) {
      console.warn('Email skipped (SMTP or NOTIFY_EMAIL not configured):', subject);
      return;
    }
    await transport.sendMail({ from: FROM_EMAIL, to: NOTIFY_EMAIL, subject, html });
    console.log('Email sent:', subject);
  } catch (err) {
    // Isolated: an email failure must NEVER fail a webhook or an approval.
    console.error('Email send failed (ignored):', err.message);
  }
}

// ---------------------------------------------------------------------------
// Formatting / small helpers
// ---------------------------------------------------------------------------
function money(amountCents, currency) {
  if (amountCents == null) return null;
  const value = (amountCents / 100).toFixed(2);
  return `$${value} ${String(currency || 'cad').toUpperCase()}`;
}

function partnerName(account) {
  return (
    (account.metadata && account.metadata.display_name) ||
    (account.business_profile && account.business_profile.name) ||
    account.email ||
    account.id
  );
}

function customerLabel(customer) {
  if (!customer || typeof customer === 'string') return customer || '—';
  if (customer.deleted) return '(deleted customer)';
  return customer.name || customer.email || customer.id;
}

function productLabel(subscription) {
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  if (!item) return '—';
  const price = item.price;
  const product = price && price.product;
  if (product && typeof product === 'object' && product.name) return product.name;
  if (price && price.nickname) return price.nickname;
  return (price && price.id) || '—';
}

function subscriptionAmount(subscription) {
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  if (!item || !item.price) return null;
  const qty = item.quantity || 1;
  const unit = item.price.unit_amount != null ? item.price.unit_amount * qty : null;
  return { amount: unit, currency: item.price.currency };
}

function periodEnd(subscription) {
  if (subscription.current_period_end) return subscription.current_period_end;
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  return (item && item.current_period_end) || null;
}

// ---------------------------------------------------------------------------
// Stripe data helpers
// ---------------------------------------------------------------------------

// Every Connect account linked to the platform (auto-discovered).
async function listPartners() {
  const partners = [];
  let startingAfter;
  do {
    const page = await stripe.accounts.list({ limit: 100, starting_after: startingAfter });
    for (const acc of page.data) {
      partners.push({
        id: acc.id,
        name: partnerName(acc),
        display_name: (acc.metadata && acc.metadata.display_name) || '',
        business_name: (acc.business_profile && acc.business_profile.name) || '',
        email: acc.email || '',
        payouts_enabled: !!acc.payouts_enabled,
        charges_enabled: !!acc.charges_enabled,
        auto_transfer: !!(acc.metadata && acc.metadata.auto_transfer === 'true'),
      });
    }
    startingAfter = page.has_more ? page.data[page.data.length - 1].id : null;
  } while (startingAfter);
  return partners;
}

// All commission transfers (those we created carry metadata.subscription_id),
// indexed by subscription id. Stripe's transfers.list has no metadata filter,
// so we page through and filter client-side.
async function loadCommissionTransfers() {
  const bySubscription = {};
  const all = [];
  let startingAfter;
  let guard = 0;
  do {
    const page = await stripe.transfers.list({ limit: 100, starting_after: startingAfter });
    for (const t of page.data) {
      if (t.metadata && t.metadata.subscription_id) {
        bySubscription[t.metadata.subscription_id] = t;
        all.push(t);
      }
    }
    startingAfter = page.has_more ? page.data[page.data.length - 1].id : null;
  } while (startingAfter && ++guard < 50);
  return { bySubscription, all };
}

// Paid invoices of a subscription, oldest first.
async function paidInvoicesAsc(subscriptionId) {
  const res = await stripe.invoices.list({
    subscription: subscriptionId,
    status: 'paid',
    limit: 100,
  });
  return res.data.slice().sort((a, b) => a.created - b.created);
}

// Net amount (after Stripe fees) of an invoice's charge.
async function invoiceNet(invoiceId) {
  const inv = await stripe.invoices.retrieve(invoiceId, {
    expand: ['charge.balance_transaction'],
  });
  const charge = inv.charge && typeof inv.charge === 'object' ? inv.charge : null;
  const bt = charge && charge.balance_transaction && typeof charge.balance_transaction === 'object'
    ? charge.balance_transaction
    : null;
  return {
    chargeId: charge ? charge.id : null,
    net: bt ? bt.net : null,
    currency: bt ? bt.currency : inv.currency,
    fee: bt ? bt.fee : null,
  };
}

/**
 * Derive commission status for one subscription.
 * `transferMap` maps subscription_id -> transfer (may be null to force a lookup skip).
 * When `computeNet` is true and the status is PENDING, the 2nd invoice net is fetched.
 */
async function deriveCommission(subscription, transferMap, { computeNet = false } = {}) {
  const partnerId = subscription.metadata && subscription.metadata.partner_id;
  const base = {
    subscription_id: subscription.id,
    partner_id: partnerId || null,
    customer: customerLabel(subscription.customer),
    customer_email:
      subscription.customer && typeof subscription.customer === 'object'
        ? subscription.customer.email || ''
        : '',
    product: productLabel(subscription),
    subscription_status: subscription.status,
    expected_next_charge: periodEnd(subscription),
  };
  const amt = subscriptionAmount(subscription);
  base.amount = amt ? money(amt.amount, amt.currency) : null;

  if (!partnerId) {
    return { ...base, status: 'UNTAGGED', label: '—' };
  }

  const transfer = transferMap ? transferMap[subscription.id] : null;
  if (transfer) {
    return {
      ...base,
      status: 'PAID',
      label: 'Paid',
      transfer_id: transfer.id,
      transfer_amount: money(transfer.amount, transfer.currency),
      transfer_date: transfer.created,
    };
  }

  const paid = await paidInvoicesAsc(subscription.id);
  const count = paid.length;

  if (count >= 2) {
    const second = paid[1];
    const out = {
      ...base,
      status: 'PENDING_APPROVAL',
      label: 'Pending approval',
      second_invoice_id: second.id,
      second_invoice_date: second.status_transitions
        ? second.status_transitions.paid_at || second.created
        : second.created,
      net_amount: null,
    };
    if (computeNet) {
      try {
        const n = await invoiceNet(second.id);
        out.net_amount = money(n.net, n.currency);
        out.net_cents = n.net;
        out.net_currency = n.currency;
      } catch (err) {
        console.error('invoiceNet failed for', second.id, err.message);
      }
    }
    return out;
  }

  if (subscription.status === 'canceled') {
    return { ...base, status: 'CANCELED_BEFORE_2ND', label: 'Canceled before 2nd' };
  }

  if (count === 1) {
    return { ...base, status: 'AWAITING_2ND', label: 'Awaiting 2nd payment' };
  }

  return { ...base, status: 'NO_PAYMENT_YET', label: 'No payment yet' };
}

/**
 * Create the commission transfer for a subscription's 2nd paid invoice.
 * Shared by the webhook (automatic mode) and the panel (manual approval).
 * The idempotency key guarantees a transfer can never be duplicated.
 */
async function createCommissionTransfer(subscription, secondInvoice) {
  const partnerId = subscription.metadata.partner_id;
  const n = await invoiceNet(secondInvoice.id);
  if (!n.chargeId) {
    throw new Error(`No charge found on invoice ${secondInvoice.id}; cannot transfer.`);
  }
  if (n.net == null || n.net <= 0) {
    throw new Error(`Net amount unavailable/zero for invoice ${secondInvoice.id}.`);
  }
  const transfer = await stripe.transfers.create(
    {
      amount: n.net,
      currency: n.currency || 'cad',
      destination: partnerId,
      source_transaction: n.chargeId,
      transfer_group: subscription.id,
      description: `Commission — 2nd payment — invoice ${secondInvoice.id}`,
      metadata: {
        invoice_id: secondInvoice.id,
        subscription_id: subscription.id,
        partner_id: partnerId,
      },
    },
    { idempotencyKey: `transfer-invoice-${secondInvoice.id}` }
  );
  return { transfer, net: n };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

// --- Webhook FIRST, with raw body (only on this route) ---
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'invoice.payment_succeeded') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  try {
    const invoice = event.data.object;
    const subId = invoice.subscription;
    if (!subId) return res.status(200).json({ received: true, reason: 'no subscription' });

    const subscription = await stripe.subscriptions.retrieve(subId, {
      expand: ['customer'],
    });
    const partnerId = subscription.metadata && subscription.metadata.partner_id;
    if (!partnerId) return res.status(200).json({ received: true, reason: 'not tagged' });

    // Confirm this invoice is EXACTLY the 2nd paid invoice.
    const paid = await paidInvoicesAsc(subId);
    if (paid.length < 2 || paid[1].id !== invoice.id) {
      return res.status(200).json({ received: true, reason: 'not the 2nd paid invoice' });
    }
    const secondInvoice = paid[1];

    // Read the PARTNER's payout mode.
    const account = await stripe.accounts.retrieve(partnerId);
    const auto = !!(account.metadata && account.metadata.auto_transfer === 'true');

    const customer = customerLabel(subscription.customer);
    const pName = partnerName(account);

    if (auto) {
      const { transfer, net } = await createCommissionTransfer(subscription, secondInvoice);
      await sendEmail(
        `Commission paid — ${customer}`,
        commissionEmailHtml({
          heading: 'Commission automatically paid',
          customer,
          partner: pName,
          amount: money(transfer.amount, transfer.currency),
          invoiceDate: secondInvoice.created,
          extra: `Transfer ID: ${transfer.id}`,
        })
      );
      return res.status(200).json({ received: true, transferred: transfer.id });
    }

    // Manual mode (default): notify, do not transfer.
    const n = await invoiceNet(secondInvoice.id);
    await sendEmail(
      `Commission pending approval — ${customer}`,
      commissionEmailHtml({
        heading: 'Commission pending approval',
        customer,
        partner: pName,
        amount: money(n.net, n.currency),
        invoiceDate: secondInvoice.created,
        extra: 'Open the panel to approve and pay this commission.',
      })
    );
    return res.status(200).json({ received: true, pending: true });
  } catch (err) {
    // Unexpected error → 500 so Stripe retries; idempotency prevents duplicates.
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// --- JSON body for everything else ---
app.use(express.json());

// Public health check (no auth) — handy for Hostinger uptime checks.
app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

// --- Basic auth for the panel and its API ---
function safeEqual(a, b) {
  const ba = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

app.use((req, res, next) => {
  if (!PANEL_USER || !PANEL_PASSWORD) {
    return res.status(500).send('Panel auth is not configured (PANEL_USER / PANEL_PASSWORD).');
  }
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (safeEqual(user, PANEL_USER) && safeEqual(pass, PANEL_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Commission Panel"');
  return res.status(401).send('Authentication required.');
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

// Partners --------------------------------------------------------------
app.get('/api/partners', async (req, res) => {
  try {
    res.json({ partners: await listPartners() });
  } catch (err) {
    console.error('GET /api/partners', err);
    res.status(500).json({ error: err.message });
  }
});

// Update display_name and/or auto_transfer on a Connect account.
app.post('/api/partners/:id', async (req, res) => {
  try {
    const metadata = {};
    if (typeof req.body.display_name === 'string') {
      metadata.display_name = req.body.display_name.trim();
    }
    if (req.body.auto_transfer !== undefined) {
      metadata.auto_transfer = req.body.auto_transfer ? 'true' : 'false';
    }
    if (Object.keys(metadata).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }
    const acc = await stripe.accounts.update(req.params.id, { metadata });
    res.json({
      ok: true,
      partner: {
        id: acc.id,
        name: partnerName(acc),
        display_name: (acc.metadata && acc.metadata.display_name) || '',
        auto_transfer: !!(acc.metadata && acc.metadata.auto_transfer === 'true'),
      },
    });
  } catch (err) {
    console.error('POST /api/partners/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// Subscriptions ---------------------------------------------------------
app.get('/api/subscriptions', async (req, res) => {
  try {
    const startingAfter = req.query.starting_after || undefined;
    const page = await stripe.subscriptions.list({
      status: 'all',
      limit: 20,
      starting_after: startingAfter,
      expand: ['data.customer', 'data.items.data.price.product'],
    });
    const { bySubscription } = await loadCommissionTransfers();
    const partners = await listPartners();
    const rows = [];
    for (const sub of page.data) {
      rows.push(await deriveCommission(sub, bySubscription, { computeNet: false }));
    }
    res.json({
      subscriptions: rows,
      partners: partners.map((p) => ({ id: p.id, name: p.name })),
      has_more: page.has_more,
      next_cursor: page.has_more ? page.data[page.data.length - 1].id : null,
    });
  } catch (err) {
    console.error('GET /api/subscriptions', err);
    res.status(500).json({ error: err.message });
  }
});

// Assign / clear the partner on a subscription (metadata only; no cycle change).
app.post('/api/subscriptions/:id/partner', async (req, res) => {
  try {
    const partnerId = req.body.partner_id || '';
    const updated = await stripe.subscriptions.update(req.params.id, {
      metadata: { partner_id: partnerId || null },
    });
    res.json({ ok: true, partner_id: (updated.metadata && updated.metadata.partner_id) || null });
  } catch (err) {
    console.error('POST /api/subscriptions/:id/partner', err);
    res.status(500).json({ error: err.message });
  }
});

// Commissions -----------------------------------------------------------

// Scan all tagged subscriptions once, deriving status for the tabs.
async function scanTaggedSubscriptions({ computeNet } = {}) {
  const { bySubscription } = await loadCommissionTransfers();
  const results = [];
  let startingAfter;
  let guard = 0;
  do {
    const page = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      starting_after: startingAfter,
      expand: ['data.customer', 'data.items.data.price.product'],
    });
    for (const sub of page.data) {
      if (!(sub.metadata && sub.metadata.partner_id)) continue;
      results.push(await deriveCommission(sub, bySubscription, { computeNet }));
    }
    startingAfter = page.has_more ? page.data[page.data.length - 1].id : null;
  } while (startingAfter && ++guard < 50);
  return { results, transfers: bySubscription };
}

app.get('/api/commissions/pending', async (req, res) => {
  try {
    const partners = await listPartners();
    const nameById = Object.fromEntries(partners.map((p) => [p.id, p.name]));
    const { results } = await scanTaggedSubscriptions({ computeNet: true });
    const pending = results
      .filter((r) => r.status === 'PENDING_APPROVAL')
      .map((r) => ({ ...r, partner_name: nameById[r.partner_id] || r.partner_id }));
    res.json({ pending });
  } catch (err) {
    console.error('GET /api/commissions/pending', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/commissions/upcoming', async (req, res) => {
  try {
    const partners = await listPartners();
    const nameById = Object.fromEntries(partners.map((p) => [p.id, p.name]));
    const { results } = await scanTaggedSubscriptions({ computeNet: false });
    const upcoming = results
      .filter((r) => r.status === 'AWAITING_2ND' || r.status === 'NO_PAYMENT_YET')
      .map((r) => ({ ...r, partner_name: nameById[r.partner_id] || r.partner_id }));
    res.json({ upcoming });
  } catch (err) {
    console.error('GET /api/commissions/upcoming', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/commissions/paid', async (req, res) => {
  try {
    const partners = await listPartners();
    const nameById = Object.fromEntries(partners.map((p) => [p.id, p.name]));
    const { all } = await loadCommissionTransfers();
    // Enrich with the customer name via the subscription (best effort).
    const paid = [];
    for (const t of all) {
      let customer = '—';
      const subId = t.metadata && t.metadata.subscription_id;
      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId, { expand: ['customer'] });
          customer = customerLabel(sub.customer);
        } catch (_) {
          /* subscription may be gone; leave placeholder */
        }
      }
      paid.push({
        transfer_id: t.id,
        customer,
        partner_id: t.metadata.partner_id || t.destination,
        partner_name: nameById[t.metadata.partner_id || t.destination] || t.destination,
        amount: money(t.amount, t.currency),
        date: t.created,
        invoice_id: t.metadata.invoice_id || '',
      });
    }
    paid.sort((a, b) => b.date - a.date);
    res.json({ paid });
  } catch (err) {
    console.error('GET /api/commissions/paid', err);
    res.status(500).json({ error: err.message });
  }
});

// Approve & pay — same logic and idempotency key as the webhook.
app.post('/api/commissions/approve', async (req, res) => {
  try {
    const subId = req.body.subscription_id;
    if (!subId) return res.status(400).json({ error: 'subscription_id is required.' });

    const subscription = await stripe.subscriptions.retrieve(subId, { expand: ['customer'] });
    const partnerId = subscription.metadata && subscription.metadata.partner_id;
    if (!partnerId) return res.status(400).json({ error: 'Subscription is not tagged with a partner.' });

    // Guard: must not already have a transfer.
    const { bySubscription } = await loadCommissionTransfers();
    if (bySubscription[subId]) {
      return res.status(200).json({ ok: true, already_paid: true, transfer_id: bySubscription[subId].id });
    }

    const paid = await paidInvoicesAsc(subId);
    if (paid.length < 2) {
      return res.status(400).json({ error: 'Subscription does not have a 2nd paid invoice yet.' });
    }
    const secondInvoice = paid[1];

    const { transfer } = await createCommissionTransfer(subscription, secondInvoice);

    const account = await stripe.accounts.retrieve(partnerId);
    await sendEmail(
      `Commission paid — ${customerLabel(subscription.customer)}`,
      commissionEmailHtml({
        heading: 'Commission approved & paid',
        customer: customerLabel(subscription.customer),
        partner: partnerName(account),
        amount: money(transfer.amount, transfer.currency),
        invoiceDate: secondInvoice.created,
        extra: `Transfer ID: ${transfer.id}`,
      })
    );

    res.json({ ok: true, transfer_id: transfer.id, amount: money(transfer.amount, transfer.currency) });
  } catch (err) {
    console.error('POST /api/commissions/approve', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Static panel (behind auth) ---
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Email template
// ---------------------------------------------------------------------------
function commissionEmailHtml({ heading, customer, partner, amount, invoiceDate, extra }) {
  const dateStr = invoiceDate ? new Date(invoiceDate * 1000).toLocaleDateString('en-CA') : '—';
  const link = panelUrl
    ? `<p><a href="${panelUrl}" style="background:#635bff;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Open the commission panel</a></p>`
    : '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
    <h2 style="margin:0 0 12px;">${heading}</h2>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Customer</td><td>${customer}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Partner</td><td>${partner}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Net amount</td><td><strong>${amount || '—'}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">2nd invoice date</td><td>${dateStr}</td></tr>
    </table>
    ${extra ? `<p style="color:#444;">${extra}</p>` : ''}
    ${link}
    <p style="color:#999;font-size:12px;">OiToronto — Partner Commission System</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const port = Number(PORT || 3000);
app.listen(port, () => {
  console.log(`Commission system listening on port ${port}`);
  if (panelUrl) console.log(`Panel URL: ${panelUrl}`);
});
