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
  console.error('Usage: node scripts/load-coupons.js <sandbox|live> <path-to-csv> [--dry-run]');
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

const allowedDurations = new Set(['once', 'forever', 'repeating']);
const seenNames = new Set();
for (const [i, row] of rows.entries()) {
  const where = `row ${i + 2} (${row.name || '<no name>'})`;
  if (!row.name) { console.error(`${where}: name is required.`); process.exit(1); }
  if (!row.batch) { console.error(`${where}: batch is required.`); process.exit(1); }
  if (!allowedDurations.has(row.duration)) {
    console.error(`${where}: duration must be one of once|forever|repeating.`); process.exit(1);
  }
  if (!row.amount_off_aud && !row.percent_off) {
    console.error(`${where}: either amount_off_aud or percent_off must be set.`); process.exit(1);
  }
  if (row.amount_off_aud && row.percent_off) {
    console.error(`${where}: set only one of amount_off_aud or percent_off.`); process.exit(1);
  }
  if (row.duration === 'repeating' && !row.duration_in_months) {
    console.error(`${where}: duration_in_months is required when duration=repeating.`); process.exit(1);
  }
  const dedupeKey = `${row.batch}:${row.name}`;
  if (seenNames.has(dedupeKey)) {
    console.error(`${where}: duplicate coupon name within the same batch.`); process.exit(1);
  }
  seenNames.add(dedupeKey);
}

function buildCouponParams(row) {
  const couponParams = {
    name: row.name,
    duration: row.duration,
    metadata: {
      created_by: partnerTag,
      batch: row.batch,
    },
  };
  if (row.amount_off_aud) {
    couponParams.amount_off = Math.round(parseFloat(row.amount_off_aud) * 100);
    couponParams.currency = 'aud';
  } else {
    couponParams.percent_off = parseFloat(row.percent_off);
  }
  if (row.duration === 'repeating') {
    couponParams.duration_in_months = parseInt(row.duration_in_months, 10);
  }
  return couponParams;
}

function buildSummary(rows) {
  const withPromo = rows.filter((r) => r.promo_code).length;
  const lines = [`Plan: ${rows.length} coupons on ${env} (${withPromo} with customer-facing promo codes).`];

  const durationCounts = {};
  for (const row of rows) durationCounts[row.duration] = (durationCounts[row.duration] || 0) + 1;
  const order = ['once', 'repeating', 'forever'];
  const durationParts = order
    .filter((d) => durationCounts[d])
    .map((d) => `${durationCounts[d]} ${d}`);
  lines.push(`  duration: ${durationParts.join(', ')}`);

  const amountOff = rows.filter((r) => r.amount_off_aud);
  const percentOff = rows.filter((r) => r.percent_off);
  const offParts = [];
  if (amountOff.length) {
    const total = amountOff.reduce((s, r) => s + parseFloat(r.amount_off_aud), 0);
    offParts.push(`${amountOff.length} amount_off (AUD $${total.toFixed(2)} face value)`);
  }
  if (percentOff.length) offParts.push(`${percentOff.length} percent_off`);
  lines.push(`  off: ${offParts.join(', ')}`);

  const batches = [...new Set(rows.map((r) => r.batch))];
  lines.push(`  batch: ${batches.join(', ')}`);

  return lines.join('\n');
}

console.log(buildSummary(rows) + '\n');

if (dryRun) {
  console.log(`[dry-run] No API calls will be made. Payload preview:\n`);
  for (const [i, row] of rows.entries()) {
    const couponParams = buildCouponParams(row);
    const idemCoupon = `${row.batch}:${row.name}:coupon`;
    console.log(`[${i + 1}/${rows.length}] ${row.name}`);
    console.log(`  coupons.create        (Idempotency-Key: ${idemCoupon})`);
    console.log('    ' + JSON.stringify(couponParams, null, 2).replace(/\n/g, '\n    '));
    if (row.promo_code) {
      const idemPromo = `${row.batch}:${row.promo_code}:promo`;
      console.log(`  promotionCodes.create (Idempotency-Key: ${idemPromo})`);
      console.log('    ' + JSON.stringify({ coupon: '<from above>', code: row.promo_code }, null, 2).replace(/\n/g, '\n    '));
    }
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
    const couponParams = buildCouponParams(row);

    const coupon = await stripe.coupons.create(
      couponParams,
      { idempotencyKey: `${row.batch}:${row.name}:coupon` },
    );

    if (row.promo_code) {
      await stripe.promotionCodes.create(
        { coupon: coupon.id, code: row.promo_code },
        { idempotencyKey: `${row.batch}:${row.promo_code}:promo` },
      );
    }

    console.log(
      `✓ ${row.name}  →  coupon ${coupon.id}  code ${row.promo_code || '—'}  ` +
      `[req ${coupon.lastResponse?.requestId ?? '—'}]`
    );
    created++;
  } catch (err) {
    console.error(`✗ Failed: ${row.name}`);
    console.error(`  ${err.type || 'Error'}: ${err.message}`);
    console.error(`  request_id: ${err.requestId ?? '—'}`);
    console.error('  Halting. Re-running the same CSV is safe — idempotency keys (batch:name) prevent duplicates.');
    process.exit(1);
  }
}

console.log(`\nDone. Loaded ${created} of ${rows.length} coupons to ${env}.`);
