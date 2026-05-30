# Partner restricted-key setup

How to mint the partner's restricted API keys in the Stripe Dashboard, scoped to
the working agreement in **README §2**. This is the canonical checklist for
issuing a new partner key (Sandbox now, Live when signed off).

> **Stripe keys cannot be created via the API.** Restricted (`rk_…`) and secret
> (`sk_…`) keys are minted only in the Dashboard: **Developers → API keys →
> Create restricted key**. There is no `POST /v1/api_keys`.

## Scope (maps README §2 → Stripe restricted-key permissions)

| Stripe resource | Sandbox | Live | Driven by |
| --- | --- | --- | --- |
| Products | **Write** | **Write** | `products.create` (load-products) |
| Prices | **Write** | **Write** | `prices.create` |
| Coupons | **Write** | **Write** | `coupons.create` (load-coupons) |
| Promotion codes | **Write** | **Write** | `promotionCodes.create` |
| Tax rates | **Write** | **Write** | §2 (partner manages tax rates) |
| Files | **Write** | **Write** | §2 (product image upload) |
| Customers | **Write** | **Read** | §2: sandbox write / live view-only |
| Subscriptions | **Write** | **Read** | §2: sandbox write / live view-only |
| Charges / PaymentIntents | **Write** | **Read** | §2: sandbox write / live view-only |
| Balance | **Read** | **Read** | `balance.retrieve` (read-summary) |
| Payouts | **Read** | **Read** | §2 view |
| **Everything else** | **None** | **None** | §2 "cannot": bank details, refunds, account/team/**webhooks**, key management |

The loaders strictly require only Products, Prices, Coupons, Promotion codes
(Write) + Balance (Read). The remaining permissions match the broader §2 partner
agreement — grant the full set so the key reflects the documented access.

## Contractor build key (full payment solution — test mode)

The catalogue key above is scoped for loading products/prices/coupons. A
**contractor building the full payment solution** (Stripe Checkout, subscriptions,
credit-wallet fulfilment) needs more — but only in **test mode**, where there is
no real money or real customers. The governing principle:

> **Test mode: generous. Live mode: locked.** Give the contractor a broad *test*
> key so they can build and iterate freely; the Owner alone holds live access and
> performs the live cutover (live key, live webhook registration, live env).

### Contractor test key scope (`rk_test_…`)

| Stripe resource | Setting |
| --- | --- |
| Products, Prices, Coupons, Promotion codes, Tax rates, Files | **Write** |
| Checkout Sessions, Payment Links | **Write** (build checkout) |
| PaymentIntents, Customers, Subscriptions, Invoices | **Write** (test flows) |
| Events | **Read** (debug webhooks) |
| Balance, Payouts | **Read** |
| Refunds | **Write** *in test only*, if testing refund flows |
| Webhook endpoints | **None** — Owner registers endpoints; contractor uses `stripe listen` for local testing |
| Account, Team, API keys, everything else | **None** |

### What stays with the Owner (never the contractor)

- The standard secret key (`sk_…`), in any mode.
- **All live access** — live keys, live webhook registration, live env vars.
- Account/bank settings, team, and API-key management.

### Beyond Stripe

The contractor needs only **repo access + a test Stripe key** — nothing else.
They develop locally and exercise webhooks with the Stripe CLI (`stripe listen`).
The Owner alone owns hosting and all secrets and performs deployments; do not
grant the contractor access to either.

## Steps

1. **Sandbox:** in the **test-mode** Dashboard, Create restricted key named
   e.g. `partner-catalogue-sandbox`, set the permissions in the Sandbox column,
   create, and copy the `rk_test_…` value.
2. **Store it** in your secret store (or `.env.local`) — see naming below.
3. **Wire `.env`:** the scripts read `STRIPE_KEY_SANDBOX` / `STRIPE_KEY_LIVE`
   via `dotenv/config`. Set:
   ```bash
   STRIPE_KEY_SANDBOX=rk_test_xxxxxxxxxxxx
   PARTNER_TAG=partner-xx
   ```
   Use `KEY=value` — no spaces, no colon. (A malformed line can leak the value
   when sourced.)
4. **Verify:**
   ```bash
   npm run verify:sandbox     # expect: connected
   npm run summary:sandbox    # expect: balances + product count
   ```
   Out-of-scope calls (refunds, account settings, webhooks) should return 403 —
   that confirms the key is correctly restricted.
5. **Live:** repeat in **live mode** with the Live column scopes (Customers /
   Subscriptions / Charges → **Read**). Per README §6/§8, a live key and any
   live run require the Owner's **written sign-off**.

## Naming conventions

- Stripe key name: `partner-catalogue-sandbox` / `partner-catalogue-live`
- `.env` var: `STRIPE_KEY_SANDBOX` / `STRIPE_KEY_LIVE`
- Audit tag stamped on every created object: `PARTNER_TAG` (e.g. `partner-jd`)

## If a key is exposed

Restricted keys can't be rolled via API. In the Dashboard → API keys → the key →
**Roll** (or delete + recreate), then update the stored value everywhere it lives
(your secret store, `.env`). Test-mode exposure is low impact but still warrants a roll.
