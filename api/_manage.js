// api/_manage.js — helpers for clients managing their own bookings:
// private "manage" links, cancelling (with automatic refunds under the
// 24-hour policy), "add to calendar" links, and the emails that use them.
import { loadBookings, saveBookings, loadHealers, releaseSlot, logNote, sendNotice, sessionWhen, newToken, esc } from './_lib.js';
import { stripe } from './_bookings.js';
import { releaseBookingGifts, refundBookingGifts, cardPart, giftBackLine } from './_gifts.js';

export const CANCEL_HOURS = 24;
export const SITE = () => (process.env.SITE_URL || 'https://realholisticnetwork.com').replace(/\/$/, '');

// ---------- when the session starts ----------
const zoneName = tz => ({ 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii' }[tz] || String(tz || '').replace(/_/g, ' '));

// Turns a date + time in a time zone into a real moment (ms).
function zonedMs(date, time, tz) {
  const guess = Date.parse(`${date}T${time || '00:00'}:00Z`);
  if (!Number.isFinite(guess)) return null;
  // find the zone's offset at that moment and correct for it
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).reduce((o, p) => (o[p.type] = p.value, o), {});
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return guess - (asIfUtc - guess);
}
// Start of the session in ms (null if we don't know the date).
export function sessionStart(b) {
  if (b.startUTC) return Date.parse(b.startUTC);
  if (!b.date) return null;
  return zonedMs(b.date, b.time || '00:00', b.healerTz || 'America/New_York');
}
export function sessionEnd(b) {
  const s = sessionStart(b);
  return s == null ? null : s + (b.durationMin || 60) * 60000;
}
// "Tuesday, October 14 at 6:30 PM (Eastern time) — that's 3:30 PM your time (Pacific)"
export function clientWhen(b) {
  const base = sessionWhen(b);
  const ctz = b.clientTz, htz = b.healerTz || 'America/New_York';
  if (!b.startUTC || !ctz || ctz === htz) return base;
  try {
    const d = new Date(b.startUTC);
    const sameDay = d.toLocaleDateString('en-US', { timeZone: ctz }) === d.toLocaleDateString('en-US', { timeZone: htz });
    const t = d.toLocaleTimeString('en-US', { timeZone: ctz, hour: 'numeric', minute: '2-digit' });
    const day = sameDay ? '' : d.toLocaleDateString('en-US', { timeZone: ctz, weekday: 'long', month: 'long', day: 'numeric' }) + ' at ';
    return `${base} — that's ${day}${t} your time (${zoneName(ctz)})`;
  } catch (e) { return base; }
}

// ---------- private links ----------
export function ensureKeys(b) {
  let changed = false;
  if (!b.manageKey) { b.manageKey = newToken().slice(0, 24); changed = true; }
  if (!b.icsKey) { b.icsKey = newToken().slice(0, 24); changed = true; }
  return changed;
}
export const manageLink = b => `${SITE()}/?booking=${b.id}.${b.manageKey}`;
export const icsLink = b => `${SITE()}/api/manage?ics=${b.id}.${b.icsKey}`;

// ---------- calendar ----------
const icsDate = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function calTitle(b, forHealer) {
  if (forHealer) return `${b.status === 'confirmed' ? '' : 'Request (not confirmed yet): '}${b.sessionType || 'Session'} with ${b.venueName}`;
  return `${b.sessionType || 'Session'} with ${b.practitionerName}`;
}
function calDetails(b, h, forHealer) {
  const lines = [];
  if (b.online && h && h.videoLink) lines.push(`Join online: ${h.videoLink}`);
  if (forHealer) {
    lines.push(`Client: ${b.venueName} (${b.email})`);
    if (b.notes) lines.push(`Notes: ${b.notes}`);
    (b.intake || []).forEach(x => lines.push(`${x.q} ${x.a}`));
  } else {
    lines.push(`Booked through REAL Holistic Network.`);
    if (b.manageKey) lines.push(`View or cancel: ${manageLink(b)}`);
  }
  return lines.join('\n');
}
// One calendar event as .ics lines.
export function icsEvent(b, h, forHealer) {
  const s = sessionStart(b), e = sessionEnd(b);
  if (s == null) return [];
  const allDay = !b.startUTC && !b.time;
  const out = ['BEGIN:VEVENT', `UID:${b.id}@realholisticnetwork.com`, `DTSTAMP:${icsDate(Date.now())}`];
  if (allDay) { const d = b.date.replace(/-/g, ''); out.push(`DTSTART;VALUE=DATE:${d}`); }
  else out.push(`DTSTART:${icsDate(s)}`, `DTEND:${icsDate(e)}`);
  out.push(`SUMMARY:${icsText(calTitle(b, forHealer))}`, `DESCRIPTION:${icsText(calDetails(b, h, forHealer))}`);
  if (b.online && h && h.videoLink) out.push(`LOCATION:${icsText(h.videoLink)}`);
  if (b.status === 'cancelled' || b.status === 'declined') out.push('STATUS:CANCELLED');
  else out.push(`STATUS:${b.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`);
  out.push('END:VEVENT');
  return out;
}
export function icsFile(events, name) {
  // lines over 75 characters are folded, as the calendar standard asks
  const fold = l => { let o = '', s = l; while (s.length > 74) { o += s.slice(0, 74) + '\r\n '; s = s.slice(74); } return o + s; };
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//REAL Holistic Network//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(name || 'REAL Holistic Network')}`]
    .concat(events.flat()).concat(['END:VCALENDAR']).map(fold).join('\r\n') + '\r\n';
}
export function googleCalLink(b, h, forHealer) {
  const s = sessionStart(b), e = sessionEnd(b);
  if (s == null) return '';
  const dates = (!b.startUTC && !b.time)
    ? `${b.date.replace(/-/g, '')}/${new Date(Date.parse(b.date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10).replace(/-/g, '')}`
    : `${icsDate(s)}/${icsDate(e)}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: calTitle(b, forHealer), dates, details: calDetails(b, h, forHealer) });
  if (b.online && h && h.videoLink) q.set('location', h.videoLink);
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

// ---------- the client's confirmation email (plain text + HTML) ----------
const btn = (href, label, color) => `<a href="${esc(href)}" style="background:${color || '#C9922A'};color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;display:inline-block;margin:0 6px 8px 0">${esc(label)}</a>`;
export function confirmedEmail(b, h, intro, paid) {
  const when = clientWhen(b);
  const video = b.online && h && h.videoLink ? h.videoLink : '';
  const g = googleCalLink(b, h, false);
  const text = `${intro}\n\nWhen: ${when}\nSession: ${b.sessionType || 'Session'} with ${b.practitionerName}${video ? `\nThis is an online session. Join here: ${video}` : ''}\n\n${paid}\n\nAdd it to your calendar:\nGoogle: ${g}\nApple / Outlook: ${icsLink(b)}\n\nNeed to cancel? Cancel at least ${CANCEL_HOURS} hours before your session for a full refund. Use this private link: ${manageLink(b)}\n\nWe'll send you a reminder the day before. We hope you enjoy your session!\n\nWith gratitude,\nREAL Holistic Network`;
  const html = `<p style="margin:0 0 14px">${esc(intro)}</p>`
    + `<p style="margin:0 0 4px;font-size:17px;font-weight:bold;color:#6B4699">${esc(when)}</p>`
    + `<p style="margin:0 0 16px">${esc(b.sessionType || 'Session')} with ${esc(b.practitionerName)}</p>`
    + (video ? `<p style="margin:0 0 16px">💻 This is an online session. <a href="${esc(video)}" style="color:#6B4699;font-weight:bold">Join here</a></p>` : '')
    + `<p style="margin:0 0 16px">${esc(paid)}</p>`
    + `<p style="margin:0 0 6px;font-weight:bold">Add it to your calendar</p><p style="margin:0 0 14px">${btn(g, 'Google Calendar', '#6B4699')}${btn(icsLink(b), 'Apple / Outlook', '#6B4699')}</p>`
    + `<p style="margin:0 0 16px;font-size:13px;color:#7A6E8A">Need to cancel? Cancel at least ${CANCEL_HOURS} hours before your session for a full refund.</p><p style="margin:0 0 16px">${btn(manageLink(b), 'View or cancel my booking')}</p>`
    + `<p style="margin:0">We'll send you a reminder the day before. We hope you enjoy your session!<br><br>With gratitude,<br>REAL Holistic Network</p>`;
  return { text, html };
}

// ---------- cancelling ----------
// What happens if the client cancels now. Returns { ok, refund, reason }.
export function cancelOutcome(b, now = Date.now()) {
  if (!['pending', 'proposed', 'confirmed'].includes(b.status)) return { ok: false, reason: b.status === 'cancelled' ? 'This booking was already cancelled.' : 'This booking is already closed.' };
  const s = sessionStart(b);
  if (s != null && s <= now) return { ok: false, reason: 'This session has already started, so it can no longer be cancelled here. Please write to bookings.realsound@gmail.com.' };
  if (b.status !== 'confirmed') return { ok: true, charged: false };
  const early = s == null || s - now >= CANCEL_HOURS * 3600000;
  return { ok: true, charged: true, refund: early };
}

// Cancels a booking for the client. `who` is for the activity log.
export async function cancelBooking(bookingId, check, who) {
  const B = await loadBookings();
  const b = B.find(x => x.id === bookingId);
  if (!b || !check(b)) return { ok: false, error: 'Booking not found. Please check your email for the latest link.' };
  const out = cancelOutcome(b);
  if (!out.ok) return { ok: false, error: out.reason };
  const opt = b.stripeAccount ? { stripeAccount: b.stripeAccount } : undefined;
  const card = cardPart(b);

  if (!out.charged) {
    // not charged yet: just release the card hold
    if (b.paymentIntentId) { try { await stripe().paymentIntents.cancel(b.paymentIntentId, {}, opt); } catch (e) {} }
    await releaseBookingGifts(b, 'cancelled');
  } else if (out.refund) {
    if (b.paymentIntentId && card > 0) {
      try {
        const params = { payment_intent: b.paymentIntentId };
        // on a healer's own Stripe account, REAL Holistic Network's commission is refunded too
        if (b.stripeAccount) params.refund_application_fee = true;
        const r = await stripe().refunds.create(params, Object.assign({ idempotencyKey: 'cancel-' + b.id }, opt || {}));
        b.refundId = r.id;
      } catch (err) {
        await logNote(`⚠️ Refund failed for ${b.venueName} → ${b.practitionerName} (${b.date}): ${err.message}`);
        return { ok: false, error: "We couldn't process your refund automatically. Please write to bookings.realsound@gmail.com and we'll take care of it right away. Your booking has NOT been cancelled yet." };
      }
    }
    const gp = await refundBookingGifts(b);
    if (gp.problems.length) await logNote(`⚠️ Gift money for cancelled booking ${b.id} needs checking: ${gp.problems.join('; ')}`);
  }
  // late cancellations are not refunded (the healer is paid, as the policy says)

  b.status = 'cancelled';
  b.cancelledAt = new Date().toISOString();
  b.cancelledBy = 'client';
  b.wasConfirmed = out.charged;
  b.refunded = out.charged ? !!out.refund : false;
  await saveBookings(B);
  await releaseSlot(b).catch(() => {});

  const P = await loadHealers();
  const h = P.find(x => x.id === b.practitionerId) || {};
  const when = clientWhen(b);
  let clientMsg, healerMsg, logMsg;
  if (!out.charged) {
    clientMsg = `Your booking request for ${b.sessionType || 'a session'} with ${b.practitionerName} on ${when} has been cancelled.\n\nYour card was NOT charged${b.paymentIntentId ? ' and the hold has been released' : ''}.${giftBackLine(b)}`;
    healerMsg = `${b.venueName} cancelled their booking request for ${sessionWhen(b)}. Nothing was charged, and that time is open again on your calendar.`;
    logMsg = `🚫 ${b.venueName} cancelled their request with ${b.practitionerName} (${b.date})`;
  } else if (out.refund) {
    clientMsg = `Your ${b.sessionType || 'session'} with ${b.practitionerName} on ${when} has been cancelled.\n\nBecause you cancelled at least ${CANCEL_HOURS} hours ahead, you get a full refund.${card > 0 ? ` $${card} is on its way back to your card. Refunds usually show up within 5 to 10 business days.` : ''}${b.giftTotal ? ` The $${b.giftTotal} from your gift certificate is back on your code.` : ''}`;
    healerMsg = `${b.venueName} cancelled their ${b.sessionType || 'session'} on ${sessionWhen(b)}. They cancelled at least ${CANCEL_HOURS} hours ahead, so they received a full refund under the cancellation policy. That time is open again on your calendar.`;
    logMsg = `↩️ ${b.venueName} cancelled with ${b.practitionerName} (${b.date}) — refunded $${b.total}`;
  } else {
    clientMsg = `Your ${b.sessionType || 'session'} with ${b.practitionerName} on ${when} has been cancelled.\n\nBecause it was less than ${CANCEL_HOURS} hours before your session, this cancellation isn't refunded, as our cancellation policy explains. Thank you for letting ${b.practitionerName} know.`;
    healerMsg = `${b.venueName} cancelled their ${b.sessionType || 'session'} on ${sessionWhen(b)}. It was less than ${CANCEL_HOURS} hours ahead, so under the cancellation policy it is not refunded and you are still paid. That time is open again on your calendar.`;
    logMsg = `🚫 ${b.venueName} cancelled late with ${b.practitionerName} (${b.date}) — not refunded`;
  }
  await sendNotice(b.email, b.venueName, `Your booking with ${b.practitionerName} is cancelled`, `${clientMsg}\n\nYou're welcome to book again anytime at realholisticnetwork.com.\n\nWith gratitude,\nREAL Holistic Network`);
  if (h.email) await sendNotice(h.email, h.name, `Cancelled: ${b.sessionType || 'session'} with ${b.venueName}`, `Hi ${h.name},\n\n${healerMsg}\n\nREAL Holistic Network`);
  await logNote(logMsg + (who ? ` (${who})` : ''));
  return { ok: true, status: 'cancelled', refunded: b.refunded, charged: out.charged };
}

// What the client may see about their own booking.
export function clientView(b, h) {
  const out = cancelOutcome(b);
  const confirmed = b.status === 'confirmed';
  return {
    id: b.id, healerId: b.practitionerId, healerName: b.practitionerName, sessionType: b.sessionType, total: b.total,
    giftTotal: b.giftTotal || 0, status: b.status, refunded: !!b.refunded, when: clientWhen(b),
    start: sessionStart(b), past: (sessionEnd(b) || 0) < Date.now(), online: !!b.online,
    videoLink: confirmed && b.online && h && h.videoLink ? h.videoLink : '',
    canCancel: out.ok, cancelCharged: !!out.charged, cancelRefund: !!out.refund, cancelHours: CANCEL_HOURS,
    googleCal: confirmed ? googleCalLink(b, h, false) : '', icsUrl: confirmed && b.icsKey ? icsLink(b) : '',
    reviewUrl: confirmed && b.reviewKey && !b.reviewed && (sessionEnd(b) || Infinity) < Date.now() ? `${SITE()}/?review=${b.id}.${b.reviewKey}` : '',
    manageCode: b.manageKey ? `${b.id}.${b.manageKey}` : ''
  };
}
