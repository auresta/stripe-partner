# Partner / contractor reference — Sandbox build

The single reference for the contracted build. The work has two parts, both done
in **Sandbox** (test mode): **(1)** load and test the **catalogue**
(products/prices/coupons), and **(2)** build and test **payment fulfilment**
(Stripe Checkout + webhook + credit wallet). The Owner owns **Live** and all
deployments — you build and verify in test, the Owner does the live cutover.

## What these tools do (plain English)

"Catalogue" = the things in the Stripe account that define what you sell and the
discounts on offer: **Products, Prices, Coupons, Promotion Codes**. These scripts
create them in bulk from CSV files — this is exactly how you create products, set
prices, and create coupons:

| To… | Run | It creates |
| --- | --- | --- |
| **Create products & set prices** | `scripts/load-products.js` | Stripe **Products** + **Prices** (AUD, one-time or recurring, with GST/tax behavior) |
| **Create coupons** (+ promo codes) | `scripts/load-coupons.js` | Stripe **Coupons** + **Promotion Codes** |
| Check your key works | `scripts/verify.js` | read-only connectivity check |
| See what's in the account | `scripts/read-summary.js` | read-only: product count + balances |

**Workflow:** put your products/prices into a CSV (see `examples/products.csv`),
run `load-products.js`, and the products + prices appear in Stripe. Same for
coupons with `examples/coupons.csv`.

**Stripe nuance — Prices are immutable.** You don't *edit* a Price once it's
created; to change a price you create a new one and archive the old. So "set a
price" means "create a price." Re-running the same CSV is safe — it's idempotent
(`batch:sku` / `batch:name` keys), so no duplicates.

## 1. Send the partner

- The **Sandbox restricted key** (`rk_test_…`) — share it **out-of-band** (a
  password-manager share or Stripe's key reveal), not plaintext email/Slack.
- This repo (or its URL) and a pointer to **README §6** (the working loop).

## 2. Their one-time setup

```bash
npm install
cp .env.example .env
```

Then edit `.env`:

```bash
STRIPE_KEY_SANDBOX=rk_test_…     # the key you were sent
PARTNER_TAG=partner-xx           # your own short tag, stamped on every object
```

## 3. Their sandbox test loop

```bash
npm run verify:sandbox                                            # confirms key + connectivity

node scripts/load-products.js sandbox examples/products.csv --dry-run   # REVIEW payloads first
node scripts/load-products.js sandbox examples/products.csv             # apply

node scripts/load-coupons.js  sandbox examples/coupons.csv  --dry-run
node scripts/load-coupons.js  sandbox examples/coupons.csv

npm run summary:sandbox                                          # product count + balances
```

Re-running the same CSV is safe — idempotency keys (`batch:sku`, `batch:name`)
return the existing objects instead of duplicating.

## 4. What "fully tested" looks like

- `verify:sandbox` connects.
- Dry-run output matches the intended catalogue (counts, AUD prices,
  `tax_behavior`, batch tags).
- Apply succeeds; `summary:sandbox` shows the expected product count.
- Objects in the Stripe **test** Dashboard carry `metadata.created_by` =
  their `PARTNER_TAG` and `metadata.batch`.
- A re-run produces no duplicates.

## 5. Scope notes (per README §2)

The Sandbox key can write Products, Prices, Coupons, Promotion codes, Tax rates,
Files, and (sandbox only) Customers/Subscriptions/Charges; read Balance/Payouts.
Out-of-scope calls (account settings, webhooks, key management) return **403** by
design — that's expected, not a bug. *(The key currently also has read access to
Refunds; issuing refunds is still blocked.)*

## 6. Payments & fulfilment (the build)

Beyond the catalogue, the contracted work is **payment fulfilment**: customers
pay via Stripe-hosted Checkout, and a webhook reacts to each payment to fulfil it
(top up credit, activate a subscription, complete a one-off order).

### 6.1 Architecture at a glance

- **This repo** — the catalogue (what's for sale).
- **`auresta-stripe-webhook`** (separate repo you'll be given access to) — the
  webhook that fulfils payments. The Owner hosts and deploys it.
- Customers pay via **Stripe-hosted Checkout / Payment Links** — you do **not**
  build a custom payment page.

### 6.2 The credit wallet = Stripe Customer Balance

- Credit is **not** a custom database — it's the customer's **Stripe Customer
  Balance**. Buying a credit pack tops it up.
- **Credit is spent via Stripe Invoices.** Stripe auto-applies the balance to
  invoices (subscription invoices + any invoice you raise). It does **not** apply
  to one-off Checkout payments.
- So to let a customer *spend* credit on something, bill it as a **Stripe
  Invoice**.

### 6.3 The four payment models

| Model | Customer pays via | Fulfilment (webhook) |
| --- | --- | --- |
| One-time / fixed | Checkout (payment mode) | `checkout.session.completed` → fulfil |
| Credit pack ($100/$500) | Checkout (payment mode) | `checkout.session.completed` → credit the customer balance |
| Subscription | Checkout (subscription mode) | `invoice.paid` + `customer.subscription.*` |
| Credit-funded purchase | a Stripe **Invoice** | `invoice.paid` → fulfil |

### 6.4 Credit-pack convention

A credit-pack Product/Price carries metadata **`kind=credit_pack`** and
**`credit_amount`** (in cents). The webhook reads these to credit the right amount
on purchase — and because the credit is taken from metadata (not the price paid),
you can grant bonus credit (pay $90, get $100). These are added via the catalogue
loader (implementation plan, Task 7).

### 6.5 Events the webhook handles

`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.{created,updated,deleted}`, `charge.refunded`,
`charge.dispute.created`. **Every handler must be idempotent on `event.id`** —
Stripe redelivers events.

### 6.6 What you build

1. The **webhook handler logic** in `auresta-stripe-webhook` (fill the
   `TODO(fulfilment)` stubs) — follow its design doc + implementation plan.
2. Server endpoints that **create Checkout Sessions**, always attaching a
   persistent Stripe **Customer** so the balance has a home.
3. An **"invoice the customer for a job"** flow (raise a Stripe Invoice) — this is
   how credit gets spent.

### 6.7 How you test webhooks (locally, no deploy)

Your key has **Webhook endpoints = None** on purpose. Use the Stripe CLI:

```bash
stripe listen --forward-to localhost:8888/webhook   # forwards TEST events to your local function
stripe trigger checkout.session.completed           # fire a test event
```

The CLI prints a local signing secret for verification. You never touch the
deployed endpoint.

### 6.8 Boundaries (what you do NOT do)

- **Don't register or deploy webhook endpoints** — the Owner does that, in both
  test and live.
- **Build and test in test mode only.** The Owner holds all live keys, deploys,
  and owns hosting + secrets.
- **Don't touch anything live** — the live cutover is the Owner's, per the
  test-generous / live-locked rule.

### 6.9 Where the detail lives

The full design and a step-by-step (TDD) implementation plan are in the webhook
repo:

- `docs/plans/2026-05-30-fulfilment-credit-wallet-design.md` — the design.
- `docs/plans/2026-05-30-fulfilment-credit-wallet.md` — the implementation plan.

## 7. Going to Live (later, Owner only)

Live uses a separate `rk_live_…` key and requires the Owner's **written
sign-off** per README §6/§8. The partner does **not** run Live. The Owner also
performs all webhook registration and deployment for Live.
