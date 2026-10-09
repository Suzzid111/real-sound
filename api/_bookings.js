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
  if (b.status !== 'pending') return { ok: false, error: 'This booking was already ' + b.status };

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
