# Partner handoff — Sandbox

What to send the partner so they can load and fully test the catalogue in
**Sandbox** (test mode). Nothing here touches Live.

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

```
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

## 6. Going to Live (later, Owner only)

Live uses a separate `rk_live_…` key and requires the Owner's **written
sign-off** per README §6/§8. The partner does **not** run Live.
