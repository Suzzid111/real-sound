// api/_bookings.js — accepting/declining a booking (charges or releases the
// card hold in Stripe). Used by both the healer dashboard and the admin panel.
import Stripe from 'stripe';
import { loadBookings, saveBookings, releaseSlot, logNote } from './_lib.js';

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
      if (status === 'confirmed') await stripe().paymentIntents.capture(b.paymentIntentId);
      else await stripe().paymentIntents.cancel(b.paymentIntentId);
    } catch (err) {
      // e.g. the 7-day card hold expired — tell them instead of pretending it worked
      if (status === 'confirmed') return { ok: false, error: "The client's card could not be charged (" + err.message + "). The card hold may have expired — please contact the client." };
    }
  }
  b.status = status;
  b.respondedAt = new Date().toISOString();
  await saveBookings(B);
  if (status === 'declined') await releaseSlot(b).catch(() => {});
  await logNote(`${status === 'confirmed' ? '✅ Confirmed' : '✗ Declined'}: ${b.venueName} → ${b.practitionerName} (${b.date}) by ${who}`);
  return { ok: true, booking: b };
}
