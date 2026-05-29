# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A small set of Node.js scripts a contracted partner uses to populate the Owner's Stripe account (Australia, AUD) with Products, Prices, Coupons, and Promotion Codes from CSV files. It is **not** an application — there is no server, no tests, no build step. Each script is a one-shot CLI that takes an environment (`sandbox` | `live`) and optionally a CSV path.

The README is the source of truth for the working agreement with the partner. Read it before making any change that affects partner-facing behavior — its rules (sign-off gates, audit metadata, error-halt semantics, etc.) are load-bearing, not stylistic.

## Commands

```bash
npm install                                              # one-time setup
cp .env.example .env                                     # then paste keys into .env

node scripts/verify.js <sandbox|live>                    # check the key works
node scripts/load-products.js <sandbox|live> <csv>       # bulk-create products + prices
node scripts/load-coupons.js  <sandbox|live> <csv>       # bulk-create coupons + promo codes
node scripts/read-summary.js  <sandbox|live>             # read-only state check
```

npm script shortcuts (`verify:sandbox`, `load:products:sandbox`, `load:coupons:sandbox`, `summary:sandbox`, `summary:live`) wrap the common sandbox invocations. There are deliberately **no `:live` shortcuts for the loaders** — running against Live must be an explicit, conscious command. Do not add them.

There is no lint, test, or build command. Node 20+, ES modules (`"type": "module"`).

## Architecture

All four scripts share the same skeleton:

1. Parse `process.argv[2]` as the env (`sandbox` | `live`), reject anything else.
2. Read `PARTNER_TAG` and `STRIPE_KEY_SANDBOX`/`STRIPE_KEY_LIVE` from `.env` via `dotenv/config`. Restricted keys (`rk_test_*` / `rk_live_*`), not full secret keys. Missing `PARTNER_TAG` is a hard error — it's the audit handle.
3. For CSV-driven scripts: parse with `csv-parse/sync` (`columns: true, skip_empty_lines: true, trim: true`), then **validate the whole file first** (required columns, enums, duplicate keys within a batch). Only after validation passes do any API calls happen.
4. If `live`, print a one-line summary of intended writes and sleep 5 seconds with an abort message — **do not remove this delay** (called out in README §7.2). This is the last-chance human checkout for irreversible operations.
5. Construct the Stripe client with `{ apiVersion: '2024-06-20', maxNetworkRetries: 2 }`. The pinned `apiVersion` matters: leaving it implicit means the account's default API version applies, which can shift. `maxNetworkRetries: 2` enables the SDK's retry-with-same-idempotency-key behavior on network errors and `Stripe-Should-Retry` responses — that's why throttling and explicit 429 handling aren't needed in user code.
6. Each create call passes an `idempotencyKey`: `${batch}:${sku}:product` and `:price` for products, `${batch}:${name}:coupon` and `${batch}:${promo_code}:promo` for coupons. **Re-running the same CSV is safe** — Stripe returns the originally-created object instead of duplicating it (24h+ key lifetime). Keep keys derived from CSV fields, not generated at runtime; that's what makes re-runs idempotent.
7. On any per-row failure, log the error type, message, and Stripe `requestId`, then `process.exit(1)`. The halt-on-first-error stance is preserved, but recovery is now trivial: fix the row and re-run.

Every created object carries a `metadata` block with:

- `created_by: process.env.PARTNER_TAG` — sourced from `.env` so each partner stamps their own identifier without code edits. Never hardcode it back into the script.
- `batch: <row.batch>` — the CSV's batch tag, used to group an upload run for audit/rollback.

Products additionally stamp `sku: <row.sku>` into their metadata; coupons carry only `created_by` and `batch`. (Prices and promotion codes inherit auditability via their parent product/coupon, so they get no metadata block of their own.)

## Dry-run mode

Both loaders accept `--dry-run` as a flag anywhere in argv. In dry-run mode the script still requires `PARTNER_TAG` (because it appears in the previewed payload), but does not require a Stripe key, does not perform the 5-second live delay, and never constructs the Stripe client. It runs CSV validation, prints the plan summary, then prints exact `JSON.stringify`'d create payloads alongside the idempotency key each call would use, then exits 0. The output is the canonical artifact for the README §6 REVIEW step — do not change its shape without flagging it, the Owner workflow depends on diffable preview output.

## Plan summary

After validation passes, every invocation (sandbox, live, dry-run) prints a multi-line `Plan:` summary built by `buildSummary(rows)` — counts grouped by type/interval (products) or duration (coupons), AUD price range, tax-behavior split, batch tags. In live mode this is the last thing printed before the 5-second abort window, so it's what the partner actually verifies during the gate. If you add new CSV columns, extend `buildSummary` so the partner can see them in the abort window — silent additions defeat the purpose of the gate.

## Tax handling (AUD/GST — load-bearing)

`tax_behavior` is a required column on products.csv with values `inclusive` | `exclusive` | `unspecified`. Stripe's "Automatic" tax default treats AUD as **inclusive** (GST baked into the displayed price) — so an $89 inclusive price nets the Owner ~$80.91, while $89 exclusive nets $89 and adds GST on top. **`tax_behavior` is immutable on a Price once set**, so a wrong choice in Live is permanent at the price level — the fix is to archive and re-create. `tax_code` is optional; omit it to fall back to the account's preset product tax code.

CSV schemas live in README Appendix A. Example CSVs in `examples/` are the canonical reference for column names and value formats — keep them in sync with any parser change.

## Things to be careful with

- **Live runs require written Owner sign-off** (README §6, §8). Never run a loader against `live` on the user's behalf without explicit, in-message authorization for that specific run — past authorization doesn't carry over.
- **Prices in CSVs are decimal AUD** (e.g. `89.00`); Stripe expects integer cents. The loaders do `Math.round(parseFloat(x) * 100)` — match this if adding new amount fields.
- **Idempotency keys are derived from CSV fields** (`batch:sku`, `batch:name`). Don't generate them at runtime (UUIDs, timestamps) — that breaks the safe-re-run contract. If you change the key formula, the README §7 paragraph about re-runs needs to change too.
- **`lookup_key` is optional but globally unique** within the account's active prices. The loader pre-checks uniqueness within the CSV; cross-CSV collisions surface as a Stripe error on `prices.create`. To repoint a `lookup_key` to a new price intentionally, that needs `transfer_lookup_key: true` (not currently exposed) — for now, ask the Owner.
- **Coupons require exactly one of** `amount_off_aud` or `percent_off`. If `duration === 'repeating'`, `duration_in_months` is also required. Validation runs up-front; preserve that strictness.
- **Restricted-key scope is narrow** (README §2 table). 403s are expected if a script reaches for customers, refunds, webhooks, or account settings — don't widen scope by changing the script; that's an Owner-level decision.
- `.env` and any real keys must never be committed. `.gitignore` covers `.env`; don't override it.
