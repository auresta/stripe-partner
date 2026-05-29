import 'dotenv/config';
import Stripe from 'stripe';

const env = process.argv[2];

if (env !== 'sandbox' && env !== 'live') {
  console.error('Usage: node scripts/verify.js <sandbox|live>');
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

try {
  const products = await stripe.products.list({ limit: 1 });
  console.log(`✓ Connected to ${env}. Existing products: ${products.data.length > 0 ? 'at least 1' : '0'}`);
} catch (err) {
  console.error(`✗ Could not connect to ${env}.`);
  console.error(`  ${err.type || 'Error'}: ${err.message}`);
  process.exit(1);
}
