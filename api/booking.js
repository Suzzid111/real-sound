// api/booking.js — saves a new booking request after the client's card has
// been authorized. The server checks the real Stripe payment (amount and
// status) against the healer's actual price before saving anything.
import { loadHealers, loadBookings, saveBookings, logNote, redis, str, tooManyTries, clientIp } from './_lib.js';
import { stripe } from './_bookings.js';

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

    const piId = str(b.paymentIntentId, 100);
    if (!/^pi_[A-Za-z0-9]+$/.test(piId)) return res.json({ ok: false, error: 'Missing payment' });
    const B = await loadBookings();
    if (B.some(x => x.paymentIntentId === piId)) return res.json({ ok: false, error: 'This payment was already used' });
    const pi = await stripe().paymentIntents.retrieve(piId);
    if (pi.status !== 'requires_capture' || pi.amount !== Math.round(tier.price * 100)) {
      try { await stripe().paymentIntents.cancel(piId); } catch (e) {}
      return res.json({ ok: false, error: 'Payment did not match this session. Your card was not charged. Please try again.' });
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
        try { await stripe().paymentIntents.cancel(piId); } catch (e) {}
        return res.json({ ok: false, error: 'Your time slot reservation expired. Your card was not charged — please pick a time again.' });
      }
    }

    const platformFee = Math.round(tier.price * 0.15);
    const bk = {
      id: 'b' + Date.now(), paymentIntentId: piId, practitionerId: p.id, practitionerName: p.name,
      venueName: str(b.venueName, 150), email: str(b.email, 200), date: str(b.date, 10), time: str(b.time, 5),
      venueType: str(b.venueType, 60), groupSize: str(b.groupSize, 10), notes: str(b.notes, 2000),
      sessionType: tier.name, price: tier.price, fee: tier.price - platformFee, platformFee, total: tier.price,
      status: 'pending', paymentMethodId: pi.payment_method || null, createdAt: new Date().toISOString(),
      startUTC, durationMin, healerTz, lockId
    };
    if (!bk.venueName || !bk.email || !bk.date) return res.json({ ok: false, error: 'Please fill in required fields' });
    B.push(bk);
    await saveBookings(B);
    await logNote(`🔔 New booking request: ${bk.venueName} → ${bk.practitionerName} (${bk.date})`);
    return res.json({ ok: true, booking: { id: bk.id, date: bk.date, time: bk.time, total: bk.total } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
