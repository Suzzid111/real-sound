// api/_bookings.js — accepting/declining a booking (charges or releases the
// card hold in Stripe). Used by both the healer dashboard and the admin panel.
import Stripe from 'stripe';
import { loadBookings, saveBookings, releaseSlot, logNote, newToken, sendNotice, sessionWhen } from './_lib.js';

export const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY);

// status: "confirmed" (charge the card) or "declined" (release the hold).
// onlyHealerId: when a healer is acting, they may only touch their own bookings.
export async function setBookingStatus(id, status, onlyHealerId, who) {
  if (status !== 'confirmed' && status !== 'declined') return { ok: false, error: 'Bad status' };
  const B = await loadBookings();
  const b = B.find(x => x.id === id);
  if (!b || (onlyHealerId && b.practitionerId !== onlyHealerId)) return { ok: false, error: 'Booking not found' };
  if (b.status !== 'pending' && b.status !== 'proposed') return { ok: false, error: 'This booking was already ' + b.status };

  if (b.paymentIntentId) {
    try {
      // bookings paid straight to a healer's Stripe account are handled in that account
      const opt = b.stripeAccount ? { stripeAccount: b.stripeAccount } : undefined;
      if (status === 'confirmed') await stripe().paymentIntents.capture(b.paymentIntentId, {}, opt);
      else await stripe().paymentIntents.cancel(b.paymentIntentId, {}, opt);
    } catch (err) {
      // e.g. the 7-day card hold expired — tell them instead of pretending it worked
      if (status === 'confirmed') return { ok: false, error: "The client's card could not be charged (" + err.message + "). The card hold may have expired — please contact the client." };
    }
  }
  b.status = status;
  if (status === 'confirmed' && !b.reviewKey) b.reviewKey = newToken().slice(0, 24);
  b.respondedAt = new Date().toISOString();
  await saveBookings(B);
  if (status === 'declined') await releaseSlot(b).catch(() => {});
  // Let the client know right away.
  if (status === 'confirmed') {
    await sendNotice(b.email, b.venueName, `Your session with ${b.practitionerName} is confirmed`,
      `Good news! ${b.practitionerName} has confirmed your ${b.sessionType || 'session'} on ${sessionWhen(b)}.\n\nYour card has now been charged $${b.total}. Need to cancel? Cancellations made at least 24 hours before your session get a full refund. Just reply to this email or write to bookings.realsound@gmail.com.\n\nWe'll send you a reminder the day before. We hope you enjoy your session!\n\nWith gratitude,\nREAL Holistic Network`);
  } else {
    await sendNotice(b.email, b.venueName, `About your booking request with ${b.practitionerName}`,
      `Thank you for your booking request. Unfortunately ${b.practitionerName} isn't able to take this session on ${sessionWhen(b)}.\n\nYour card was NOT charged. The temporary hold has been released.\n\nYou're welcome to choose another time or another healer at realholisticnetwork.com.\n\nWith gratitude,\nREAL Holistic Network`);
  }
  await logNote(`${status === 'confirmed' ? '✅ Confirmed' : '✗ Declined'}: ${b.venueName} → ${b.practitionerName} (${b.date}) by ${who}`);
  return { ok: true, booking: b };
}

// ---------- A healer suggests a different time instead of declining ----------
// The client's card hold stays in place. The client gets an email with a
// private link: if they accept, the session moves to the new time and the card
// is charged (the healer already agreed); if they say no, the hold is released.
const HOLD_DAYS = 6; // Stripe card holds last about 7 days
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function proposeTime(healerId, body, site) {
  const { loadHealers } = await import('./_lib.js');
  const B = await loadBookings();
  const b = B.find(x => x.id === String(body.bookingId || '') && x.practitionerId === healerId);
  if (!b) return { ok: false, error: 'Booking not found' };
  if (b.status !== 'pending') return { ok: false, error: 'You can only suggest a new time for a booking that is waiting for your answer.' };
  if (Date.now() - Date.parse(b.createdAt || 0) > HOLD_DAYS * 86400000) return { ok: false, error: "This request is almost a week old, so the client's card hold is about to expire. Please decline it and ask the client to book the new time." };
  const date = String(body.date || ''), time = String(body.time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d\d:\d\d$/.test(time)) return { ok: false, error: 'Please choose a new date and time' };
  const start = Date.parse(body.startUTC);
  if (!Number.isFinite(start) || start < Date.now() + 3600000) return { ok: false, error: 'Please choose a time in the future' };
  const P = await loadHealers();
  const p = P.find(x => x.id === healerId) || {};
  const tz = String(body.tz || b.healerTz || (p.availability && p.availability.tz) || 'America/New_York').slice(0, 60);
  b.proposal = { date, time, startUTC: new Date(start).toISOString(), healerTz: tz, message: String(body.message || '').trim().slice(0, 500), key: newToken().slice(0, 24), at: new Date().toISOString() };
  b.status = 'proposed';
  await saveBookings(B);
  const newWhen = sessionWhen({ startUTC: b.proposal.startUTC, healerTz: tz });
  const link = `${site}/?resched=${b.id}.${b.proposal.key}`;
  const msg = b.proposal.message;
  await sendNotice(b.email, b.venueName, `${b.practitionerName} suggested a new time for your session`,
    `${b.practitionerName} can't make ${sessionWhen(b)}, but would love to see you on ${newWhen} instead.${msg ? '\n\nTheir note: "' + msg + '"' : ''}\n\nPlease choose here: ${link}\n\nIf you accept, your session is confirmed and your card is charged $${b.total}. If you say no, your card is not charged and the hold is released.\n\nWith gratitude,\nREAL Holistic Network`,
    `<p style="margin:0 0 14px">${esc(b.practitionerName)} can't make <strong>${esc(sessionWhen(b))}</strong>, but would love to see you on:</p><p style="font-size:18px;font-weight:bold;color:#6B4699;margin:0 0 16px">${esc(newWhen)}</p>${msg ? `<p style="margin:0 0 16px;font-style:italic">"${esc(msg)}"</p>` : ''}<p style="text-align:center;margin:0 0 18px"><a href="${esc(link)}" style="background:#C9922A;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold;display:inline-block">Accept or decline the new time</a></p><p style="font-size:13px;color:#7A6E8A;margin:0">If you accept, your session is confirmed and your card is charged $${esc(b.total)}. If you say no, your card is not charged and the hold is released.</p>`);
  await logNote(`📅 ${b.practitionerName} suggested a new time to ${b.venueName}: ${newWhen}`);
  return { ok: true };
}

export async function findProposal(code) {
  const m = /^(b\d{6,20})\.([a-f0-9]{24})$/.exec(String(code || ''));
  if (!m) return {};
  const B = await loadBookings();
  const b = B.find(x => x.id === m[1] && x.proposal && x.proposal.key === m[2]);
  return { B, b };
}

export async function answerProposal(code, yes) {
  const { loadHealers } = await import('./_lib.js');
  const { B, b } = await findProposal(code);
  if (!b) return { ok: false, error: 'This link is not valid. Please check your email for the latest message.' };
  if (b.status !== 'proposed') return { ok: false, error: b.status === 'confirmed' ? 'This session is already confirmed. See you there!' : 'This request has already been answered.' };
  const opt = b.stripeAccount ? { stripeAccount: b.stripeAccount } : undefined;
  const P = await loadHealers();
  const h = P.find(x => x.id === b.practitionerId) || {};
  if (yes) {
    if (b.paymentIntentId) {
      try { await stripe().paymentIntents.capture(b.paymentIntentId, {}, opt); }
      catch (err) {
        b.status = 'declined'; b.respondedAt = new Date().toISOString();
        await saveBookings(B); await releaseSlot(b).catch(() => {});
        await logNote(`⚠️ ${b.venueName} accepted ${b.practitionerName}'s new time but the card hold had expired`);
        return { ok: false, error: `Sorry, the temporary hold on your card has expired, so we couldn't confirm. You were NOT charged. Please book the new time again at realholisticnetwork.com.` };
      }
    }
    await releaseSlot(b).catch(() => {});
    const old = sessionWhen(b);
    Object.assign(b, { date: b.proposal.date, time: b.proposal.time, startUTC: b.proposal.startUTC, healerTz: b.proposal.healerTz, lockId: null, status: 'confirmed', respondedAt: new Date().toISOString() });
    if (!b.reviewKey) b.reviewKey = newToken().slice(0, 24);
    b.proposal.answer = 'accepted';
    await saveBookings(B);
    const when = sessionWhen(b);
    await sendNotice(b.email, b.venueName, `Your session with ${b.practitionerName} is confirmed`,
      `Your ${b.sessionType || 'session'} with ${b.practitionerName} is confirmed for ${when}.\n\nYour card has now been charged $${b.total}. Need to cancel? Cancellations made at least 24 hours before your session get a full refund. Just reply to this email or write to bookings.realsound@gmail.com.\n\nWe'll send you a reminder the day before.\n\nWith gratitude,\nREAL Holistic Network`);
    if (h.email) await sendNotice(h.email, h.name, `${b.venueName} accepted your new time`, `Good news! ${b.venueName} accepted the new time you suggested.\n\nYour ${b.sessionType || 'session'} is now confirmed for ${when} (instead of ${old}). The payment has gone through.\n\nClient email: ${b.email}\n\nREAL Holistic Network`);
    await logNote(`✅ ${b.venueName} accepted ${b.practitionerName}'s new time: ${when}`);
    return { ok: true, status: 'confirmed', when };
  }
  if (b.paymentIntentId) { try { await stripe().paymentIntents.cancel(b.paymentIntentId, {}, opt); } catch (e) {} }
  b.status = 'declined'; b.declinedBy = 'client'; b.respondedAt = new Date().toISOString(); b.proposal.answer = 'declined';
  await saveBookings(B);
  await releaseSlot(b).catch(() => {});
  if (h.email) await sendNotice(h.email, h.name, `${b.venueName} couldn't make the new time`, `${b.venueName} said the new time you suggested doesn't work for them. Their card was not charged and the booking is closed.\n\nREAL Holistic Network`);
  await logNote(`✗ ${b.venueName} declined ${b.practitionerName}'s new time`);
  return { ok: true, status: 'declined' };
}
