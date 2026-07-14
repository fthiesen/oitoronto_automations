# Technical Plan — Partner Commission System (Stripe Connect)
# Version 5 — webhook + control panel + commission tracking + notifications

## Goal
1. Automatically or manually transfer to a partner the NET amount 
   (after Stripe fees) of the SECOND monthly payment of tagged 
   subscriptions, via Stripe Connect.
2. Web control panel: approve commissions, view partners, assign 
   partners to subscriptions, track commission status.
3. Email notification when a commission needs approval or is paid.

## Context
- Platform: OiToronto Stripe account (Canada, CAD)
- Current partner: acct_1TqMXvB0xFE5zFwz (Connect recipient, Company)
- Subscription tagging: metadata on the SUBSCRIPTION
  - key: partner_id / value: partner's Connect account ID
- Business rule:
  - 1st payment: 100% stays with the platform
  - 2nd payment: 100% of the NET amount goes to the partner
  - 3rd payment onward: 100% stays with the platform
- Payout mode is PER PARTNER:
  - Stored in the partner's Connect account metadata.auto_transfer 
    ("true"/"false")
  - DEFAULT when absent: MANUAL (approval required)
  - Editable via control panel toggle

## Hosting
- Hostinger Business plan, "Deploy Web App" (persistent Node.js, 
  public HTTPS URL — confirmed)
- CONFIRMED: files created at runtime may be deleted on redeploy.
  NO local file state. All persistent state lives in Stripe metadata.
- Repo: fthiesen/oitoronto_automations, folder /stripe-commissions
- Environment variables set in the Hostinger panel

## Stack
- Node.js v20+, Express, official stripe library, nodemailer (Brevo SMTP)
- Panel: plain HTML/CSS/JS served by Express
- No database — Stripe is the single source of truth
- ALL code, interface and emails in ENGLISH

## State architecture
- Partners: auto-discovered via stripe.accounts.list(). Every Connect 
  account linked to the platform automatically appears in the panel. 
  No partner creation through the panel.
- Partner display name: metadata.display_name on the Connect account 
  (editable in the panel); fallback to business profile name.
- Per-partner payout mode: metadata.auto_transfer on the Connect 
  account ("true"/"false", default "false" = manual).
- Commission status per subscription: DERIVED in real time (below).
  Nothing stored besides the transfers themselves.

## Commission status derivation (per tagged subscription)
1. Paid invoices: stripe.invoices.list({subscription, status:'paid'})
2. Existing transfer: stripe.transfers.list filtered by 
   metadata.subscription_id (or by the 2nd invoice id)
3. Resulting status:
   - PAID → transfer exists. Show: transferred amount, transfer date.
   - PENDING APPROVAL → 2+ paid invoices AND no transfer (manual mode,
     or an automatic attempt failed). Show: net amount 
     (balance_transaction.net of the 2nd invoice), 2nd invoice date,
     "Approve & pay" button.
   - AWAITING 2ND PAYMENT → exactly 1 paid invoice. Show: expected 
     next charge date = subscription.current_period_end (when the 
     2nd invoice will be generated and the commission will be born).
   - NO PAYMENT YET → 0 paid invoices (e.g. trialing). Show expected 
     first charge date.
   - CANCELED BEFORE 2ND → subscription canceled with fewer than 2 
     paid invoices. Commission does not apply.

## Component 1 — Webhook
- Route POST /webhook, event invoice.payment_succeeded
- RAW body (express.raw) on this route only, signature verification 
  with STRIPE_WEBHOOK_SECRET
- Logic:
  1. Verify event signature.
  2. invoice.subscription null → 200.
  3. Fetch subscription; no metadata.partner_id → 200.
  4. Confirm this invoice is exactly the 2nd PAID invoice of the 
     subscription (paid invoices sorted by created). If not → 200.
  5. Read the PARTNER's auto_transfer metadata (from the Connect 
     account referenced by partner_id):
     - "true" → transfer now (step 6) + send confirmation email.
     - anything else (default) → do NOT transfer. Send PENDING 
       APPROVAL notification email (step 7). Return 200.
  6. Transfer:
     - Get the invoice charge with expand: ['balance_transaction']
     - amount = balance_transaction.net (NEVER amount_paid/received)
     - stripe.transfers.create({amount, currency:'cad',
       destination: partner_id, source_transaction: chargeId,
       description: 'Commission — 2nd payment — invoice {id}',
       metadata: {invoice_id, subscription_id, partner_id}})
     - idempotencyKey: 'transfer-invoice-{invoice.id}'
  7. Notification email:
     - nodemailer + Brevo SMTP
     - From: noreply@oitoronto.com / To: NOTIFY_EMAIL
     - Subject (pending): "Commission pending approval — {customer}"
     - Subject (auto-paid): "Commission paid — {customer}"
     - Body: customer, partner, net amount, invoice date, direct 
       link to the panel
     - Email failure must NOT fail the webhook (isolated try/catch, 
       log the error)
  8. Unexpected error → 500 (Stripe retries; idempotency prevents 
     duplicates).

## Component 2 — Control panel (English UI)
- Basic auth (PANEL_USER / PANEL_PASSWORD via env)

### 2a. Partners
- Auto-lists all Connect accounts linked to the platform: display 
  name, account ID, payouts status
- Edit display name (metadata.display_name on the Connect account)
- Per-partner toggle: "Automatic payout" ON/OFF (default OFF = manual),
  writes metadata.auto_transfer
- No account creation and no onboarding link generation in the panel — 
  new partners are created directly in the Stripe dashboard and appear 
  here automatically

### 2b. Subscriptions
- stripe.subscriptions.list (status all), newest first, paginated
- Columns: customer (name/email), product, amount, subscription 
  status, assigned partner, COMMISSION STATUS (derived), and expected 
  next charge date when applicable (current_period_end)
- Partner dropdown per row (all discovered partners + "none"); 
  save = subscriptions.update(metadata) — does not change the 
  billing cycle
- Untagged subscriptions show commission status "—"

### 2c. Commissions
- "Pending" tab: derived (2nd paid, no transfer). Columns: customer,
  partner, net amount, 2nd invoice date, "Approve & pay" button 
  (same logic and same idempotencyKey as the webhook — can never 
  duplicate)
- "Paid" tab: stripe.transfers.list with metadata — customer, 
  partner, amount, date
- "Upcoming" tab: tagged subscriptions awaiting the 2nd charge, 
  with expected date (current_period_end)

## Component 3 — Email notifications
- Brevo SMTP (host, port, user, password via env vars)
- From: noreply@oitoronto.com / To: NOTIFY_EMAIL (env)
- Triggers:
  - Commission became pending (manual mode) → immediate email from 
    the webhook
  - Commission auto-paid (automatic mode) → confirmation email
- Emails always include a direct link to the panel
- NOTE: noreply@oitoronto.com must be authorized as a sender in 
  Brevo before the first test

## Environment variables
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- PANEL_USER / PANEL_PASSWORD
- BREVO_SMTP_HOST / BREVO_SMTP_PORT / BREVO_SMTP_USER / BREVO_SMTP_PASS
- NOTIFY_EMAIL
- PANEL_URL (public panel URL, used in email links)
- PORT (from Hostinger)

## Stripe configuration (post-deploy)
1. Developers > Webhooks > Add endpoint
2. URL: https://{hostinger-url}/webhook
3. Event: invoice.payment_succeeded
4. Signing secret → env vars

## Test plan (test mode first)
1. Test Connect account + test subscription tagged with partner_id.
2. Test clocks to fast-forward to the 2nd invoice.
3. Verify:
   - 1st invoice: nothing happens; panel shows "awaiting 2nd payment"
     with correct expected date
   - 2nd invoice (manual mode, default): notification email arrives;
     panel shows pending with correct net amount; transfer only after 
     approval; approving twice does not duplicate
   - 2nd invoice (automatic mode ON for the partner): transfer 
     created + confirmation email
   - 3rd invoice: nothing happens
   - Event resend: no duplicate
   - Panel: assigning a partner does not change the renewal date; 
     commission status transitions correctly between states
   - Deliberate SMTP failure: webhook still returns 200; transfer/
     pending state unaffected
4. Only then register the live endpoint.

## Expected deliverables
- /stripe-commissions/index.js (full server: webhook + panel + API)
- /stripe-commissions/public/ (panel files, if separated)
- /stripe-commissions/package.json
- /stripe-commissions/README.md (Hostinger deploy, Stripe webhook 
  setup, panel usage, test instructions)
- ALWAYS complete files, never abbreviated snippets

## Style constraints
- Complete copy-paste-ready files
- Do not speculate about unconfirmed infrastructure — flag 
  "verify in the Hostinger panel" where applicable
- All code, UI and emails in English
