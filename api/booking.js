// api/booking.js — saves a new booking request after the client's card has
// been authorized. The server checks the real Stripe payment (amount and
// status) against the healer's actual price before saving anything.
import { loadHealers, loadBookings, saveBookings, logNote, alertOwner, redis, str, tooManyTries, clientIp, connectOf, platformFeeCents } from './_lib.js';
import { stripe } from './_bookings.js';
import { planGifts, holdGifts, releaseBookingGifts } from './_gifts.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    if (await tooManyTries('booking:' + clientIp(req), 20)) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
    const b = req.body || {};
    const P = await loadHealers();
    const p = P.find(x => x.id === b.practitionerId);
    if (!p) return res.json({ ok: false, error: 'Healer not found' });
    const tiers = p.sessionTypes && p.sessionTypes.length ? p.sessionTypes : [{ id: 'legacy', name: 'Session', price: p.rate || 0 }];
    const tier = tiers.find(t => t.id === b.tierId) || tiers.find(t => t.name === b.sessionType);
    if (!tier) return res.json({ ok: false, error: 'Session type not found' });

    // Gift certificates pay first; the card (if any) pays the rest.
    let plan = { uses: [], total: 0 };
    if (Array.isArray(b.giftCodes) && b.giftCodes.length) {
      plan = await planGifts(b.giftCodes, tier.price);
      if (plan.error) return res.json({ ok: false, error: plan.error });
    }
    const cardDollars = Math.round(tier.price) - plan.total;

    const B = await loadBookings();
    const acct = str(b.stripeAccount, 60);
    const mine = connectOf(p);
    if (acct && !(mine && mine.id === acct)) return res.json({ ok: false, error: 'Payment did not match this healer. Your card was not charged. Please try again.' });
    const opt = acct ? { stripeAccount: acct } : undefined;
    const piId = str(b.paymentIntentId, 100);
    const cancel = async () => { if (piId) { try { await stripe().paymentIntents.cancel(piId, {}, opt); } catch (e) {} } };
    let pi = null;
    if (cardDollars > 0) {
      if (!/^pi_[A-Za-z0-9]+$/.test(piId)) return res.json({ ok: false, error: 'Missing payment' });
      if (B.some(x => x.paymentIntentId === piId)) return res.json({ ok: false, error: 'This payment was already used' });
      // Payments made straight to the healer's Stripe account live in THEIR account.
      pi = await stripe().paymentIntents.retrieve(piId, {}, opt);
      const feeOk = acct ? pi.application_fee_amount === platformFeeCents(cardDollars) : true;
      if (pi.status !== 'requires_capture' || pi.amount !== Math.round(cardDollars * 100) || !feeOk) {
        await cancel();
        return res.json({ ok: false, error: 'Payment did not match this session. Your card was not charged. Please try again.' });
      }
    } else if (piId) {
      await cancel(); // the gift certificates already cover it all
    }

    // If a calendar slot was chosen, make sure the reservation belongs to this booking.
    let startUTC = null, durationMin = null, lockId = null, healerTz = null;
    if (b.startUTC) {
      startUTC = new Date(Date.parse(b.startUTC)).toISOString();
      durationMin = Math.max(15, Math.min(600, parseInt(b.durationMin, 10) || 60));
      lockId = str(b.lockId, 60);
      healerTz = str(b.healerTz, 60);
      const cell = Math.floor(Date.parse(startUTC) / 60000 / 15) * 15;
      const holder = await redis(['GET', `rs:lock:${p.id}:${cell}`]);
      if (holder !== lockId) {
        await cancel();
        return res.json({ ok: false, error: 'Your time slot reservation expired. Your card was not charged — please pick a time again.' });
      }
    }

    const platformFee = Math.round(tier.price * 0.15);
    const bk = {
      id: 'b' + Date.now(), paymentIntentId: pi ? piId : null, practitionerId: p.id, practitionerName: p.name,
      venueName: str(b.venueName, 150), email: str(b.email, 200), date: str(b.date, 10), time: str(b.time, 5),
      venueType: str(b.venueType, 60), groupSize: str(b.groupSize, 10), notes: str(b.notes, 2000),
      sessionType: tier.name, price: tier.price, fee: tier.price - platformFee, platformFee, total: tier.price,
      status: 'pending', paymentMethodId: (pi && pi.payment_method) || null, createdAt: new Date().toISOString(),
      startUTC, durationMin, healerTz, lockId, source: str(b.source, 40) || 'direct',
      stripeAccount: acct || null,
      giftUses: plan.uses.length ? plan.uses : undefined, giftTotal: plan.total || undefined
    };
    if (!bk.venueName || !bk.email || !bk.date) { await cancel(); return res.json({ ok: false, error: 'Please fill in required fields' }); }
    if (plan.uses.length) {
      const held = await holdGifts(plan.uses, bk.id);
      if (!held.ok) { await cancel(); return res.json({ ok: false, error: held.error + ' Your card was not charged.' }); }
    }
    try {
      const B2 = await loadBookings(); // fresh copy, in case it changed while we checked the payment
      B2.push(bk);
      await saveBookings(B2);
    } catch (e) {
      await releaseBookingGifts(bk, 'error');
      throw e;
    }
    await alertOwner(`🔔 New booking request: ${bk.venueName} → ${bk.practitionerName} (${bk.date})`, [`Client: ${bk.venueName} (${bk.email})`, `Healer: ${bk.practitionerName}`, `Session: ${bk.sessionType} ($${bk.total}${bk.giftTotal ? ', $' + bk.giftTotal + ' paid by gift certificate' : ''})`, `When: ${bk.date} ${bk.time || ''}`, `Notes: ${bk.notes || 'None'}`]);
    return res.json({ ok: true, booking: { id: bk.id, date: bk.date, time: bk.time, total: bk.total } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
