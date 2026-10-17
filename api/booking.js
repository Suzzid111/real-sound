// api/booking.js — saves a new booking request after the client's card has
// been authorized. The server checks the real Stripe payment (amount and
// status) against the healer's actual price before saving anything.
import { loadHealers, loadBookings, saveBookings, logNote, alertOwner, sendNotice, sessionWhen, redis, str, tooManyTries, clientIp, connectOf, platformFeeCents, bookingPct, saveReferralClaim } from './_lib.js';
import { stripe } from './_bookings.js';
import { planGifts, holdGifts, releaseBookingGifts } from './_gifts.js';
import { ensureKeys, manageLink, clientWhen } from './_manage.js';

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
    // 15% normally; 10% when the healer brought this client with their own link.
    const rate = await bookingPct(p, str(b.email, 200), str(b.refHealer, 60), B);
    const acct = str(b.stripeAccount, 60);
    const mine = connectOf(p);
    if (acct && !(mine && mine.id === acct)) return res.json({ ok: false, error: 'Payment did not match this healer. Your card was not charged. Please try again.' });
    const opt = acct ? { stripeAccount: acct } : undefined;
    const piId = str(b.paymentIntentId, 100);
    const cancel = async () => { if (piId) { try { await stripe().paymentIntents.cancel(piId, {}, opt); } catch (e) {} } };
    // Answers to the healer's questions for new clients (all must be answered).
    const qs = Array.isArray(p.intakeQuestions) ? p.intakeQuestions : [];
    const answers = Array.isArray(b.intake) ? b.intake : [];
    if (qs.length && answers.length !== qs.length) { await cancel(); return res.json({ ok: false, error: `${p.name} just updated their questions. Please refresh the page and try again. Your card was not charged.` }); }
    const intake = qs.map((q, i) => ({ q, a: str(answers[i], 1000) }));
    if (intake.some(x => !x.a)) { await cancel(); return res.json({ ok: false, error: `Please answer ${p.name}'s questions. Your card was not charged.` }); }
    let pi = null;
    if (cardDollars > 0) {
      if (!/^pi_[A-Za-z0-9]+$/.test(piId)) return res.json({ ok: false, error: 'Missing payment' });
      if (B.some(x => x.paymentIntentId === piId)) return res.json({ ok: false, error: 'This payment was already used' });
      // Payments made straight to the healer's Stripe account live in THEIR account.
      pi = await stripe().paymentIntents.retrieve(piId, {}, opt);
      const feeOk = acct ? pi.application_fee_amount === platformFeeCents(cardDollars, rate.pct) : true;
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

    const platformFee = Math.round(tier.price * rate.pct / 100);
    const bk = {
      id: 'b' + Date.now(), paymentIntentId: pi ? piId : null, practitionerId: p.id, practitionerName: p.name,
      venueName: str(b.venueName, 150), email: str(b.email, 200), date: str(b.date, 10), time: str(b.time, 5),
      venueType: str(b.venueType, 60), groupSize: str(b.groupSize, 10), notes: str(b.notes, 2000),
      sessionType: tier.name, price: tier.price, fee: tier.price - platformFee, platformFee, total: tier.price,
      status: 'pending', paymentMethodId: (pi && pi.payment_method) || null, createdAt: new Date().toISOString(),
      startUTC, durationMin, healerTz, lockId, source: str(b.source, 40) || 'direct',
      stripeAccount: acct || null, platformPct: rate.pct, referral: rate.referral || undefined,
      giftUses: plan.uses.length ? plan.uses : undefined, giftTotal: plan.total || undefined,
      clientTz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(str(b.clientTz, 60)) ? str(b.clientTz, 60) : undefined,
      online: tier.online ? true : undefined, intake: intake.length ? intake : undefined,
      bufferMin: startUTC ? Math.max(0, Math.min(60, parseInt(b.bufferMin, 10) || 0)) || undefined : undefined
    };
    ensureKeys(bk);
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
    if (rate.referral) { try { await saveReferralClaim(p, bk.email, rate.claim, bk.id); } catch (e) {} }
    await alertOwner(`🔔 New booking request: ${bk.venueName} → ${bk.practitionerName} (${bk.date})`, [`Client: ${bk.venueName} (${bk.email})`, `Healer: ${bk.practitionerName}`, `Session: ${bk.sessionType} ($${bk.total}${bk.giftTotal ? ', $' + bk.giftTotal + ' paid by gift certificate' : ''})`, `When: ${bk.date} ${bk.time || ''}`, `Notes: ${bk.notes || 'None'}`, bk.referral ? `💜 ${bk.practitionerName} brought this client with their own link (10% commission)` : '']);
    // Tell the healer right away, so they can confirm before the card hold runs out.
    const when = sessionWhen(bk);
    if (p.email) {
      const answersText = intake.length ? '\n\nTheir answers to your questions:\n' + intake.map(x => `• ${x.q}\n  ${x.a}`).join('\n') : '';
      await sendNotice(p.email, p.name, `New booking request: ${bk.sessionType} with ${bk.venueName}`,
        `Hi ${p.name},\n\nYou have a new booking request!\n\nClient: ${bk.venueName}\nSession: ${bk.sessionType} ($${bk.total})${bk.online ? ' — online' : ''}\nWhen: ${when}${bk.groupSize ? '\nGroup size: ' + bk.groupSize : ''}${bk.notes ? '\n\nTheir notes: ' + bk.notes : ''}${answersText}\n\nPlease log in to your dashboard at realholisticnetwork.com to confirm it, decline it, or suggest a new time. The client's card is only charged after you confirm.\n\nPlease answer within a few days — the hold on the client's card lasts about a week.\n\nREAL Holistic Network`);
    }
    // And let the client know their request arrived.
    await sendNotice(bk.email, bk.venueName, `We received your booking request with ${bk.practitionerName}`,
      `Thank you for booking with REAL Holistic Network!\n\nYour request for a ${bk.sessionType} with ${bk.practitionerName} on ${clientWhen(bk)} has been sent.\n\n${cardDollars > 0 ? 'Your card has NOT been charged yet. It is only charged once your session is confirmed.' : 'Your gift certificate is being held for this session.'} ${bk.practitionerName} will confirm soon, and you'll get an email as soon as they do.\n\nChanged your mind? You can view or cancel your request here: ${manageLink(bk)}\n\nWith gratitude,\nREAL Holistic Network`);
    return res.json({ ok: true, booking: { id: bk.id, date: bk.date, time: bk.time, total: bk.total, manageCode: `${bk.id}.${bk.manageKey}` } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
