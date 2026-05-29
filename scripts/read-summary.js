import 'dotenv/config';
import Stripe from 'stripe';

const env = process.argv[2];

if (env !== 'sandbox' && env !== 'live') {
  console.error('Usage: node scripts/read-summary.js <sandbox|live>');
  process.exit(1);
}

const key = env === 'live'
  ? process.env.STRIPE_KEY_LIVE
  : process.env.STRIPE_KEY_SANDBOX;

if (!key) {
  console.error(`Missing key for ${env}. Check your .env file.`);
  process.exit(1);
}

const stripe = new Stripe(key, {
  apiVersion: '2024-06-20',
  maxNetworkRetries: 2,
});

const products = await stripe.products.list({ limit: 100, active: true });
const balance = await stripe.balance.retrieve();

console.log(`Environment:      ${env}`);
console.log(`Active products:  ${products.data.length}${products.has_more ? '+ (more not shown)' : ''}`);
console.log(`Available balance:`);
for (const b of balance.available) {
  console.log(`  ${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`);
}
console.log(`Pending balance:`);
for (const b of balance.pending) {
  console.log(`  ${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`);
}
