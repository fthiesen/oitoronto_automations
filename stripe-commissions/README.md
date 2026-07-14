# Partner Commission System — Stripe Connect

Automates and tracks partner commissions for OiToronto. When a tagged
subscription reaches its **second paid invoice**, the partner receives the
**net amount** (after Stripe fees) via a Stripe Connect transfer — either
automatically or after manual approval in the control panel.

There is **no database**. Stripe metadata is the single source of truth and
all commission state is derived in real time from invoices and transfers.

---

## Business rules

- **1st payment** → 100% stays with the platform.
- **2nd payment** → 100% of the **net** amount goes to the partner.
- **3rd payment onward** → 100% stays with the platform.

Payout mode is **per partner**, stored on the Connect account
(`metadata.auto_transfer`):

- `"true"` → transfer automatically when the 2nd invoice is paid.
- absent / anything else → **manual** (default): a notification email is sent
  and the commission waits for approval in the panel.

Subscriptions are tagged with the partner on the **subscription** metadata:

- key `partner_id`, value = the partner's Connect account id
  (e.g. `acct_1TqMXvB0xFE5zFwz`).

---

## Files

```
stripe-commissions/
├─ index.js            # full server: webhook + panel API + email
├─ package.json
├─ .env.example        # copy to .env for local testing
├─ public/
│  ├─ index.html       # control panel
│  ├─ styles.css
│  └─ app.js
└─ README.md
```

---

## Environment variables

Set these in the **Hostinger panel** (or in a local `.env` for testing):

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_…` / `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the `/webhook` endpoint (`whsec_…`) |
| `PANEL_USER` / `PANEL_PASSWORD` | Basic-auth credentials for the panel |
| `BREVO_SMTP_HOST` | e.g. `smtp-relay.brevo.com` |
| `BREVO_SMTP_PORT` | e.g. `587` |
| `BREVO_SMTP_USER` | Brevo SMTP login |
| `BREVO_SMTP_PASS` | Brevo SMTP key |
| `NOTIFY_EMAIL` | Where notification emails are sent |
| `PANEL_URL` | Public panel URL, used in email links |
| `PORT` | Server port (**verify in the Hostinger panel** — it is usually injected automatically) |

> `noreply@oitoronto.com` must be authorized as a sender in Brevo before the
> first email test.

---

## Local run (test mode)

```bash
cd stripe-commissions
cp .env.example .env      # fill in your test values
npm install
npm start
```

Open `http://localhost:3000` and log in with `PANEL_USER` / `PANEL_PASSWORD`.

To test the webhook locally, use the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/webhook
# copy the whsec_… it prints into STRIPE_WEBHOOK_SECRET, then restart
stripe trigger invoice.payment_succeeded
```

---

## Deploy on Hostinger (Deploy Web App)

1. Push this folder to the repo (`fthiesen/oitoronto_automations`,
   subfolder `/stripe-commissions`).
2. In the Hostinger panel, create/point a **Deploy Web App** (persistent
   Node.js) at this subfolder.
   - Build/install: `npm install`
   - Start command: `npm start` (runs `node index.js`)
   - Node version: **20+**
3. Add all environment variables from the table above in the Hostinger panel.
   - **Verify in the Hostinger panel** whether `PORT` is injected
     automatically; if so, do not hard-code it.
4. Deploy and note the public HTTPS URL. Set `PANEL_URL` to it.
5. Health check: `GET /healthz` returns `{ "ok": true }` (no auth).

> Note: files written at runtime may be wiped on redeploy. This app keeps
> **no local state**, so that is fine.

---

## Stripe webhook setup (post-deploy)

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. URL: `https://<your-hostinger-url>/webhook`
3. Event: **`invoice.payment_succeeded`** (only this one is needed).
4. Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET` and redeploy.

Do this in **test mode** first; only register the **live** endpoint after the
test plan below passes.

---

## Using the panel

- **Commissions**
  - *Pending* — 2nd invoice paid, no transfer yet. Click **Approve & pay**
    to create the transfer (same idempotency key as the webhook — approving
    twice can never duplicate).
  - *Paid* — all commission transfers, newest first.
  - *Upcoming* — tagged subscriptions still awaiting the 2nd charge, with the
    expected next-charge date.
- **Subscriptions** — every subscription with its derived commission status.
  Use the per-row **partner dropdown** to tag/untag a subscription. This only
  edits metadata; it never changes the billing cycle.
- **Partners** — every Connect account linked to the platform is
  auto-discovered. Edit the **display name** and flip **Automatic payout**
  ON/OFF (default OFF = manual). New partners are created in the Stripe
  dashboard and appear here automatically — there is no account creation or
  onboarding link in the panel.

---

## Commission status reference

| Status | Meaning |
| --- | --- |
| **Paid** | Transfer exists — shows amount and date. |
| **Pending approval** | 2+ paid invoices and no transfer (manual mode, or an auto attempt failed). Shows net amount and 2nd invoice date. |
| **Awaiting 2nd payment** | Exactly 1 paid invoice. Shows expected next charge date. |
| **No payment yet** | 0 paid invoices (e.g. trialing). |
| **Canceled before 2nd** | Subscription canceled with fewer than 2 paid invoices — commission does not apply. |
| **—** | Untagged subscription. |

---

## Test plan (test mode first)

1. Create a **test Connect account** and a **test subscription** tagged with
   `partner_id`.
2. Use **Test clocks** to fast-forward to the 2nd invoice.
3. Verify:
   - **1st invoice** → nothing happens; panel shows *Awaiting 2nd payment*
     with the correct expected date.
   - **2nd invoice, manual mode (default)** → notification email arrives;
     panel shows *Pending* with the correct net amount; transfer only after
     approval; approving twice does not duplicate.
   - **2nd invoice, automatic mode ON** → transfer created + confirmation
     email.
   - **3rd invoice** → nothing happens.
   - **Resend the event** → no duplicate transfer.
   - **Assign a partner** in the panel → renewal date unchanged; status
     transitions correctly.
   - **Deliberate SMTP failure** → webhook still returns 200; transfer /
     pending state unaffected.
4. Only then register the **live** webhook endpoint.

---

## How it works (internals)

- **Partners**: `stripe.accounts.list()` — every linked Connect account shows
  up automatically. Display name = `metadata.display_name` → business profile
  name → email → id. Payout mode = `metadata.auto_transfer`.
- **Commission derivation** per subscription:
  1. `stripe.invoices.list({ subscription, status: 'paid' })`, sorted oldest
     first.
  2. Look up an existing transfer (all commission transfers carry
     `metadata.subscription_id`; the code pages through `transfers.list` and
     indexes them, since Stripe has no metadata filter on that endpoint).
  3. Apply the status table above.
- **Transfer** (webhook auto mode **and** manual approval share this exact
  logic):
  - Net amount = `charge.balance_transaction.net` of the 2nd invoice
    (never `amount_paid`/`amount_received`).
  - `stripe.transfers.create({ amount, currency, destination: partner_id,
    source_transaction: chargeId, transfer_group: subscription_id,
    metadata: { invoice_id, subscription_id, partner_id } })`
  - `idempotencyKey: transfer-invoice-<invoice.id>` → a commission can never
    be paid twice.

---

## Notes / caveats

- The panel derives status live from the Stripe API, so with many
  subscriptions a tab may take a few seconds to load (it lists paid invoices
  per subscription). This keeps the system stateless and always correct.
- All code, UI and emails are in **English**.
