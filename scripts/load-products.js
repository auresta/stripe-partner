import 'dotenv/config';
import Stripe from 'stripe';
import { parse } from 'csv-parse/sync';
import fs from 'fs';

const STRIPE_API_VERSION = '2024-06-20';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
const env = positional[0];
const csvPath = positional[1];

if (!env || !csvPath || (env !== 'sandbox' && env !== 'live')) {
  console.error('Usage: node scripts/load-products.js <sandbox|live> <path-to-csv> [--dry-run]');
  process.exit(1);
}

const partnerTag = process.env.PARTNER_TAG;
if (!partnerTag) {
  console.error('Missing PARTNER_TAG in .env (e.g. PARTNER_TAG=partner-jd).');
  process.exit(1);
}

const key = env === 'live'
  ? process.env.STRIPE_KEY_LIVE
  : process.env.STRIPE_KEY_SANDBOX;

if (!key && !dryRun) {
  console.error(`Missing key for ${env}. Check your .env file.`);
  process.exit(1);
}

const rows = parse(fs.readFileSync(csvPath), {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});

const allowedTaxBehavior = new Set(['inclusive', 'exclusive', 'unspecified']);
const seenSkus = new Set();
const seenLookupKeys = new Set();
for (const [i, row] of rows.entries()) {
  const where = `row ${i + 2} (${row.sku || '<no sku>'})`;
  if (!row.sku) { console.error(`${where}: sku is required.`); process.exit(1); }
  if (!row.name) { console.error(`${where}: name is required.`); process.exit(1); }
  if (!row.batch) { console.error(`${where}: batch is required.`); process.exit(1); }
  if (!row.price_aud || isNaN(parseFloat(row.price_aud))) {
    console.error(`${where}: price_aud must be a number.`); process.exit(1);
  }
  if (!allowedTaxBehavior.has(row.tax_behavior)) {
    console.error(`${where}: tax_behavior must be one of inclusive|exclusive|unspecified, got "${row.tax_behavior}".`);
    process.exit(1);
  }
  if (row.type !== 'one_time' && row.type !== 'recurring') {
    console.error(`${where}: type must be one_time or recurring.`); process.exit(1);
  }
  if (row.type === 'recurring' && !row.interval) {
    console.error(`${where}: interval is required when type=recurring.`); process.exit(1);
  }
  const dedupeKey = `${row.batch}:${row.sku}`;
  if (seenSkus.has(dedupeKey)) {
    console.error(`${where}: duplicate sku within the same batch.`); process.exit(1);
  }
  seenSkus.add(dedupeKey);
  if (row.lookup_key) {
    if (seenLookupKeys.has(row.lookup_key)) {
      console.error(`${where}: duplicate lookup_key "${row.lookup_key}" within this CSV.`); process.exit(1);
    }
    seenLookupKeys.add(row.lookup_key);
  }
}

function buildPayloads(row) {
  const productParams = {
    name: row.name,
    description: row.description || undefined,
    metadata: {
      sku: row.sku,
      created_by: partnerTag,
      batch: row.batch,
    },
  };
  if (row.tax_code) productParams.tax_code = row.tax_code;

  const priceParams = {
    unit_amount: Math.round(parseFloat(row.price_aud) * 100),
    currency: 'aud',
    tax_behavior: row.tax_behavior,
  };
  if (row.lookup_key) priceParams.lookup_key = row.lookup_key;
  if (row.type === 'recurring') {
    priceParams.recurring = { interval: row.interval };
  }

  return { productParams, priceParams };
}

function buildSummary(rows) {
  const lines = [`Plan: ${rows.length} products + ${rows.length} prices on ${env}.`];

  const groups = new Map();
  for (const row of rows) {
    const k = row.type === 'recurring' ? `recurring/${row.interval}` : 'one_time';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(parseFloat(row.price_aud));
  }
  const order = ['one_time', 'recurring/day', 'recurring/week', 'recurring/month', 'recurring/year'];
  const keys = [...groups.keys()].sort((a, b) => {
    const ai = order.indexOf(a); const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const padLen = Math.max(...keys.map((k) => k.length));
  for (const k of keys) {
    const prices = groups.get(k);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)}–$${max.toFixed(2)}`;
    lines.push(`  ${k.padEnd(padLen)}  ${String(prices.length).padStart(2)}  ${range} AUD`);
  }

  const taxCounts = {};
  for (const row of rows) taxCounts[row.tax_behavior] = (taxCounts[row.tax_behavior] || 0) + 1;
  lines.push(`  tax: ${Object.entries(taxCounts).map(([k, v]) => `${v} ${k}`).join(', ')}`);

  const withLookup = rows.filter((r) => r.lookup_key).length;
  if (withLookup) lines.push(`  lookup_key: ${withLookup} of ${rows.length} rows`);

  const batches = [...new Set(rows.map((r) => r.batch))];
  lines.push(`  batch: ${batches.join(', ')}`);

  return lines.join('\n');
}

console.log(buildSummary(rows) + '\n');

if (dryRun) {
  console.log(`[dry-run] No API calls will be made. Payload preview:\n`);
  for (const [i, row] of rows.entries()) {
    const { productParams, priceParams } = buildPayloads(row);
    const idemProduct = `${row.batch}:${row.sku}:product`;
    const idemPrice = `${row.batch}:${row.sku}:price`;
    console.log(`[${i + 1}/${rows.length}] ${row.sku} — ${row.name}`);
    console.log(`  products.create (Idempotency-Key: ${idemProduct})`);
    console.log('    ' + JSON.stringify(productParams, null, 2).replace(/\n/g, '\n    '));
    console.log(`  prices.create   (Idempotency-Key: ${idemPrice})`);
    console.log('    ' + JSON.stringify({ product: '<from above>', ...priceParams }, null, 2).replace(/\n/g, '\n    '));
    console.log('');
  }
  console.log(`[dry-run] No API calls made. Re-run without --dry-run against ${env} to apply.`);
  process.exit(0);
}

if (env === 'live') {
  console.log(`⚠️  LIVE MODE. Press Ctrl+C in 5 seconds to abort.`);
  await new Promise((r) => setTimeout(r, 5000));
}

const stripe = new Stripe(key, {
  apiVersion: STRIPE_API_VERSION,
  maxNetworkRetries: 2,
});

let created = 0;

for (const row of rows) {
  try {
    const { productParams, priceParams } = buildPayloads(row);

    const product = await stripe.products.create(
      productParams,
      { idempotencyKey: `${row.batch}:${row.sku}:product` },
    );

    const price = await stripe.prices.create(
      { product: product.id, ...priceParams },
      { idempotencyKey: `${row.batch}:${row.sku}:price` },
    );

    console.log(
      `✓ ${row.name}  →  product ${product.id}  price ${price.id}  ` +
      `[req ${price.lastResponse?.requestId ?? '—'}]`
    );
    created++;
  } catch (err) {
    console.error(`✗ Failed: ${row.name}`);
    console.error(`  ${err.type || 'Error'}: ${err.message}`);
    console.error(`  request_id: ${err.requestId ?? '—'}`);
    console.error('  Halting. Re-running the same CSV is safe — idempotency keys (batch:sku) prevent duplicates.');
    process.exit(1);
  }
}

console.log(`\nDone. Loaded ${created} of ${rows.length} products to ${env}.`);
