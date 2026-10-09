// api/connect.js — a signed-in healer connects their own Stripe account so
// clients' payments go straight to them (REAL Holistic Network keeps 15%).
//   start  → makes their Stripe account (first time) and returns the Stripe sign-up link
//   status → asks Stripe whether their account is ready and saves the answer
import { getSession, loadHealers, saveHealers, loadBookings, selfHealer, logNote, siteUrl, stripeMode, connectOf } from './_lib.js';
import { stripe } from './_bookings.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const s = await getSession(req);
    if (!s || s.role !== 'healer') return res.status(401).json({ ok: false, error: 'Please log in again.', relogin: true });
    const body = req.body || {};
    const P = await loadHealers();
    const p = P.find(x => x.id === s.id);
    if (!p) return res.status(401).json({ ok: false, error: 'Account not found', relogin: true });
    const mode = stripeMode();
    p.connect = p.connect || {};
    let c = connectOf(p);

    if (body.action === 'start') {
      if (!c || !c.id) {
        const acct = await stripe().accounts.create({
          // Healers get their own full Stripe dashboard, pay Stripe's card fee from
          // their share, and Stripe handles fraud losses. No cost to the platform.
          controller: {
            stripe_dashboard: { type: 'full' },
            fees: { payer: 'account' },
            losses: { payments: 'stripe' },
            requirement_collection: 'stripe'
          },
          country: 'US',
          email: p.email,
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          business_profile: { product_description: 'Holistic healing sessions booked through REAL Holistic Network' },
          metadata: { healerId: p.id, healerName: p.name }
        });
        c = p.connect[mode] = { id: acct.id, charges: false, payouts: false, details: false, createdAt: new Date().toISOString() };
        await saveHealers(P);
        await logNote(`💳 ${p.name} started connecting Stripe${mode === 'test' ? ' (sandbox)' : ''}`);
      }
      const site = siteUrl(req);
      const link = await stripe().accountLinks.create({
        account: c.id, type: 'account_onboarding',
        refresh_url: `${site}/?connect=retry`, return_url: `${site}/?connect=done`
      });
      return res.json({ ok: true, url: link.url });
    }

    if (body.action === 'status') {
      if (c && c.id) {
        const a = await stripe().accounts.retrieve(c.id);
        const wasReady = !!c.charges;
        Object.assign(c, {
          charges: !!a.charges_enabled, payouts: !!a.payouts_enabled, details: !!a.details_submitted,
          due: ((a.requirements && a.requirements.currently_due) || []).length, checkedAt: new Date().toISOString()
        });
        await saveHealers(P);
        if (c.charges && !wasReady) await logNote(`✅ ${p.name} can now take payments through Stripe${mode === 'test' ? ' (sandbox)' : ''}`);
      }
      const B = await loadBookings();
      return res.json({ ok: true, healer: selfHealer(p), bookings: B.filter(b => b.practitionerId === p.id) });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Stripe could not be reached: ' + (err && err.message ? err.message : 'please try again.') });
  }
}
