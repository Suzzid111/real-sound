// api/create-payment-intent.js
// Puts a HOLD on the client's card for a booking (manual capture). The card is
// only charged later, when the healer accepts.
//
// The price always comes from the healer's saved session types, never from the
// browser. If the healer has connected Stripe, the payment goes straight to
// their Stripe account and REAL Holistic Network's 15% is taken automatically
// (a "direct charge" with an application fee).
import { loadHealers, getJSON, str, tooManyTries, clientIp, payAccount, platformFeeCents } from './_lib.js';
import { stripe } from './_bookings.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    if (await tooManyTries('pi:' + clientIp(req), 30)) return res.status(429).json({ error: 'Too many tries. Please wait a few minutes.' });
    const b = req.body || {};
    const P = await loadHealers();
    const p = P.find(x => x.id === b.practitionerId);
    if (!p) return res.status(400).json({ error: 'Healer not found. Please refresh the page and try again.' });
    const tiers = p.sessionTypes && p.sessionTypes.length ? p.sessionTypes : [{ id: 'legacy', name: 'Session', price: p.rate || 0 }];
    const tier = tiers.find(t => t.id === b.tierId) || tiers.find(t => t.name === b.sessionType);
    if (!tier || !(tier.price >= 1)) return res.status(400).json({ error: 'Session type not found. Please refresh the page and try again.' });

    const acct = payAccount(p);
    if (!acct && (await getJSON('requireConnect', false)))
      return res.status(400).json({ error: `${p.name} is still finishing their payment setup, so online booking is paused for now. Please check back soon or choose another healer.` });

    const amount = Math.round(tier.price * 100);
    const email = str(b.email, 200);
    const params = {
      amount, currency: 'usd', capture_method: 'manual',
      receipt_email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined,
      description: `${tier.name} with ${p.name} (REAL Holistic Network)`,
      metadata: { practitionerId: p.id, practitioner: p.name, session: tier.name, start: str(b.start, 40) }
    };
    if (acct) params.application_fee_amount = platformFeeCents(tier.price);
    const pi = await stripe().paymentIntents.create(params, acct ? { stripeAccount: acct } : undefined);
    return res.status(200).json({ clientSecret: pi.client_secret, paymentIntentId: pi.id, stripeAccount: acct || '' });
  } catch (err) {
    return res.status(500).json({ error: 'Payment could not be started: ' + (err && err.message ? err.message : 'please try again.') });
  }
}
