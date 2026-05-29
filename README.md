# Stripe Catalogue Partner — Working Agreement & Setup Guide

**Owner:** [YOUR NAME], [YOUR COMPANY]
**Partner:** [PARTNER NAME]
**Stripe account:** [YOUR COMPANY] (Australia)
**Document version:** 1.0 — [DATE]

---

## 1. What this document is

This is everything you need to set up products, prices, vouchers, and subscriptions in our Stripe account, plus the rules we work by. Read it once, end to end, before you start. If anything is unclear, ask before acting.

## 2. Your access at a glance

You will receive **two restricted API keys** — one for Sandbox (test environment) and one for Live (real customers, real money). You will *not* receive dashboard login credentials by default; if you need them, ask and we'll set up a separate custom role.

### What you CAN do

| Area | Sandbox | Live |
| --- | --- | --- |
| Create / edit Products | Yes | Yes |
| Create / edit Prices | Yes | Yes |
| Create / edit Coupons | Yes | Yes |
| Create / edit Promotion codes | Yes | Yes |
| Create / edit Tax rates | Yes | Yes |
| Upload product images (Files) | Yes | Yes |
| Test Customers, Subscriptions, Payments | Yes (write) | View only |
| View Balance & Payouts | View | View |

### What you CANNOT do (by design)

- Cannot see or change our bank account details
- Cannot issue refunds or move money
- Cannot create, modify, or delete real customers in Live
- Cannot create or process real charges in Live
- Cannot change account settings, team, or webhooks
- Cannot generate or revoke API keys

If something you need to do isn't on the "can" list, **stop and ask**. Do not look for workarounds.

## 3. Environments

We use two environments. Treat them as completely separate.

### Sandbox
- Test environment. Fake money, fake customers.
- All initial work happens here.
- Mistakes cost nothing.
- API key prefix: `rk_sandbox_...` or `rk_test_...`

### Live
- Real customers, real payments.
- Only used after Owner has reviewed and signed off your Sandbox work.
- The Owner promotes catalogue from Sandbox to Live, OR you re-run the same script against the Live key — but **only after written sign-off**.
- API key prefix: `rk_live_...`

**Rule:** Never run a script against Live without an email or message from the Owner saying "approved for Live." No exceptions.

## 4. Initial setup

### Step 1 — Receive your keys

You will receive two keys via [1Password shared vault / encrypted message / one-time link]. Do not paste them anywhere else.

### Step 2 — Store them securely

- Save both keys in your own password manager (1Password, Bitwarden, etc.).
- **Never** commit them to Git.
- **Never** paste them into Slack, WeChat, email, chat with AI assistants, or any shared document.
- **Never** save them in plain text files on your machine outside of a `.env` file that's in `.gitignore`.

### Step 3 — Set up your local environment

Install Node.js 20+ then, from this folder:

```bash
npm install
cp .env.example .env
```

Open `.env` and paste in the two keys you were given. Also set `PARTNER_TAG` to your partner identifier (e.g. `partner-jd`) — this is stamped on every object you create via `metadata.created_by` and is how the Owner traces work back to you.

### Step 4 — Verify the Sandbox key works

```bash
node scripts/verify.js sandbox
```

If it prints a number, you're connected. If you see a 401 error, the key is wrong — contact the Owner.

### Step 5 — Confirm you've read this document

Reply to the Owner: *"I've read the Stripe partner guide v1.0 and I'm ready to start."* This is a checkpoint, not a formality.

## 5. What to build

You'll be setting up three kinds of catalogue items.

### 5.1 One-off products
Single-purchase items (e.g. a single window film installation, a one-time service fee).

- Stripe object: `Product` + a `Price` with `type: 'one_time'`
- Currency: AUD
- Tax behaviour: confirm with Owner per product

### 5.2 Vouchers / Credits ($30, $50, $100)

**Our pattern: Top-up wallet.**

Each voucher is a Stripe Product priced at $30 / $50 / $100. When a customer buys one, our backend credits their account balance equal to the purchase amount. **You set up the products and prices only.** The Owner handles the backend redemption logic.

If a different pattern is needed for any specific voucher, the Owner will update this section before you start work on it.

### 5.3 Monthly subscriptions
Recurring charges (e.g. monthly maintenance plan, membership).

- Stripe object: `Product` + a `Price` with `recurring: { interval: 'month' }`
- Set `tax_behavior` and `tax_code` per Owner's instructions
- For subscription discounts, create Coupons with `duration: 'forever' | 'once' | 'repeating'`

## 6. Workflow — how each change reaches Live

We work in five steps. Every catalogue change goes through all five. No shortcuts.

```
1. PLAN     →  You draft the change in a CSV (see Appendix A)
2. REVIEW   →  Owner reviews and approves the CSV
3. SANDBOX  →  You run the script against Sandbox
4. VERIFY   →  Owner checks Sandbox dashboard, gives written sign-off
5. LIVE     →  You (or Owner) run the same script against Live
```

**Why this matters:** every step creates an audit trail. If something goes wrong in Live, we can trace it back to the CSV and the sign-off.

## 7. Scripts

Three scripts cover almost everything you'll need. They live in `scripts/`.

**Re-running is safe.** Every create call uses an `Idempotency-Key` derived from the CSV (`batch:sku` for products and prices, `batch:name` for coupons, `batch:promo_code` for promotion codes). If a script crashes partway through, fix the failing row and re-run the same CSV — Stripe returns the originally-created objects instead of duplicating them. Idempotency keys are honored by Stripe for at least 24 hours.

**Dry-run before any real run.** Both loaders accept `--dry-run`, which validates the entire CSV and prints the exact `products.create` / `prices.create` / `coupons.create` payloads (with computed cents amounts and idempotency keys) without making any API call. This is the artifact to attach to the REVIEW step in §6:

```bash
node scripts/load-products.js sandbox examples/products.csv --dry-run > plan.txt
# email plan.txt to the Owner; once approved, re-run without --dry-run.
```

### 7.1 Verify connection — `scripts/verify.js`

```bash
node scripts/verify.js sandbox
node scripts/verify.js live
```
Confirms the key works. Run this any time you want to check connectivity.

### 7.2 Bulk product + price loader — `scripts/load-products.js`

```bash
node scripts/load-products.js sandbox examples/products.csv
```

Reads a CSV of products and creates them in Stripe. CSV format: see Appendix A.

Both loaders print a `Plan:` summary before any writes — counts by type/duration, AUD price range, tax-behavior split, batch tags. In `live` mode the summary is followed by a 5-second `Ctrl+C` abort window — **the summary is what you actually verify in those 5 seconds**, so read it. **Do not remove this delay.**

### 7.3 Coupon / promotion code loader — `scripts/load-coupons.js`

```bash
node scripts/load-coupons.js sandbox examples/coupons.csv
```

Reads a CSV of coupons and creates them, optionally with a customer-facing promotion code.

### 7.4 Read-only summary — `scripts/read-summary.js`

```bash
node scripts/read-summary.js sandbox
```

Prints active product count and current balance. Useful for confirming state without touching anything.

## 8. Rules of engagement

These are the rules. Breaking them is grounds for ending the engagement.

1. **Sandbox first, always.** Never run anything against Live until the Owner has signed off the equivalent Sandbox run.
2. **Never share the API keys.** Not with team members, contractors, AI assistants, or anyone. One person, one key.
3. **Always use the `metadata.created_by` field** on every object you create. This is how we track who made what.
4. **Never delete or archive products in Live** without written Owner approval. If something is wrong, flag it — don't fix it silently.
5. **Never create real customers or charges in Live.** Your Live key blocks this, but don't try.
6. **No refunds, ever.** Not in Sandbox, not in Live. Refunds are an Owner responsibility.
7. **Communicate before deviating from the plan.** If the CSV doesn't cover an edge case, ask. Don't improvise.
8. **Don't store customer data anywhere outside Stripe.** No exports to local CSVs, no copying to your own systems.
9. **Report errors immediately**, including ones that "seem to have worked anyway."

## 9. Monitoring and accountability

You should know exactly what's visible to the Owner:

- **Every API call you make** is logged in Stripe → Developers → Logs, with timestamp, IP, endpoint, and response.
- **Every object you create** has your `created_by` metadata tag.
- **Every successful product/price/coupon creation** triggers an event the Owner is subscribed to.
- **Dashboard audit logs** track any UI activity (if you're given dashboard access later).

This isn't suspicion — it's how we trace problems when they happen, and how we both stay accountable.

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `401 Unauthorized` | Wrong key, or using Live key against Sandbox endpoint | Check `.env` file; confirm prefix matches environment |
| `403 Forbidden — permission denied` | Trying to access a resource your key isn't scoped for | Stop. Ask Owner — don't request scope expansion via API |
| `Rate limit exceeded` | Too many requests too fast | The loader already throttles; if you hit this, contact Owner |
| Stripe dashboard slow / unreachable | China network filtering | Use a VPN, or stick to API workflows (which work fine) |
| Created wrong product in Live | Mistake | Tell the Owner immediately. Do not delete it yourself |
| Script crashed halfway through | Partial run | Re-run the same CSV — idempotency keys prevent duplicates. If the failure repeats, tell the Owner with the `request_id` from the error output |

## 11. Communication

- **Day-to-day questions:** [SLACK CHANNEL / EMAIL / WECHAT]
- **Owner response SLA:** within [24] business hours
- **Urgent (production issue, accidental Live change):** [PHONE / SIGNAL] — anytime
- **Weekly sync:** [DAY / TIME / TIMEZONE], 30 minutes
- **Status updates:** end-of-week summary email, every Friday, listing what was created/changed

## 12. Key rotation and end of engagement

- Keys will be rotated every **90 days** for security hygiene. You'll receive new keys at least 7 days before the old ones are revoked.
- When the engagement ends, both keys will be revoked within 24 hours of final sign-off. No grace period.
- All scripts and CSVs you've written for this project remain the Owner's property and should not be reused for other clients.

---

## Appendix A — CSV schemas

### Products CSV — see `examples/products.csv`

| Column | Required | Notes |
| --- | --- | --- |
| `sku` | Yes | Your internal SKU, stored in product metadata |
| `name` | Yes | Customer-facing product name |
| `description` | No | Customer-facing description |
| `price_aud` | Yes | Decimal AUD, e.g. `89.00` |
| `type` | Yes | `one_time` or `recurring` |
| `interval` | Only if recurring | `day`, `week`, `month`, `year` |
| `tax_behavior` | Yes | `inclusive` (GST included in price), `exclusive` (GST added on top), or `unspecified`. **Once set on a Price, this cannot be changed** — confirm with Owner per product before any Live run |
| `tax_code` | No | Stripe tax code (e.g. `txcd_99999999`). Falls back to the account's preset product tax code if omitted |
| `lookup_key` | No | Stable handle for this Price (e.g. `wf-cer-60-aud`). Lets the Owner's backend reference the price by name instead of by environment-specific ID. Must be unique within the CSV and across active prices in the account |
| `batch` | Yes | Tag for this upload run, e.g. `2026-05-batch1` |

### Coupons CSV — see `examples/coupons.csv`

| Column | Required | Notes |
| --- | --- | --- |
| `name` | Yes | Internal name |
| `amount_off_aud` | Either this or `percent_off` | Decimal AUD |
| `percent_off` | Either this or `amount_off_aud` | Integer, e.g. `20` |
| `duration` | Yes | `once`, `forever`, or `repeating` |
| `duration_in_months` | Only if repeating | Integer |
| `promo_code` | No | If set, creates a promotion code customers can enter |
| `batch` | Yes | Tag for this upload run |

---

## Appendix B — Glossary

- **Sandbox / Test mode:** Stripe's isolated test environment. Fake money, fake everything.
- **Live mode:** Real money, real customers, real payments.
- **Restricted API key:** A key with specific scoped permissions, unlike a full secret key.
- **Product:** A thing you sell.
- **Price:** A specific price for a product (a product can have many prices — e.g. monthly vs annual).
- **Coupon:** A reusable discount definition.
- **Promotion code:** The customer-facing code that applies a coupon at checkout.
- **Customer Balance:** Pre-paid credit attached to a Stripe Customer record.
- **Webhook:** An HTTP callback Stripe makes to our backend when events happen.

---

**Document end. Questions: [OWNER EMAIL / CHANNEL].**
