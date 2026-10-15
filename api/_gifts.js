// api/_gifts.js — gift certificates (shared helpers).
//
// HOW THE MONEY WORKS
// - A buyer pays REAL Holistic Network (the main Stripe account) for a gift
//   certificate. Each certificate gets its own code, like RHN-7KQM-4XPA.
// - At booking, the client types in one or more codes. The codes pay for as
//   much of the session as they can; the client's card pays the rest.
// - The gift money is set aside ("held") as soon as the booking request is sent.
//   If the healer declines, or the request closes, the money goes back on the code.
// - When the healer confirms, the healer is sent their 85% of the gift part
//   straight to their own Stripe account (a Stripe "transfer"), just like a
//   card booking. REAL Holistic Network keeps 15%.
// - Whatever is left on a code stays there for next time.
import crypto from 'crypto';
import { redis, getJSON, setJSON, str, stripeMode, platformFeeCents, alertOwner, logNote } from './_lib.js';
import { stripe } from './_bookings.js';

export const GIFT_AMOUNTS = [25, 50, 75, 100];
export const MAX_GIFT_QTY = 10;
export const MAX_CODES_PER_BOOKING = 5;

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L — easy to read and type
export function newGiftCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `RHN-${s.slice(0, 4)}-${s.slice(4)}`;
}
// Accepts "rhn 7kqm 4xpa", "RHN7KQM4XPA", etc. Returns "RHN-7KQM-4XPA" or ''.
export function normGiftCode(v) {
  let t = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (t.length === 8) t = 'RHN' + t;
  if (!/^RHN[A-Z0-9]{8}$/.test(t)) return '';
  return `RHN-${t.slice(3, 7)}-${t.slice(7)}`;
}

export const loadGift = code => getJSON('gift:' + code, null);
export const saveGift = g => setJSON('gift:' + g.code, g);

// A short lock so two bookings can never spend the same money at the same moment.
async function withLock(code, fn) {
  const key = 'rs:giftlock:' + code;
  for (let i = 0; i < 20; i++) {
    const got = await redis(['SET', key, '1', 'NX', 'EX', 15]);
    if (got) {
      try { return await fn(); } finally { await redis(['DEL', key]).catch(() => {}); }
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Gift certificate is busy. Please try again in a moment.');
}

// What anyone holding the code may see.
export function giftView(g) {
  return { code: g.code, amount: g.amount, balance: g.balance, active: g.active !== false };
}

// Works out how much of `price` the codes can pay. Does not change anything.
// Returns { uses: [{code, amount}], total } or { error }.
export async function planGifts(codesIn, price) {
  const codes = [];
  for (const c of (Array.isArray(codesIn) ? codesIn : []).slice(0, MAX_CODES_PER_BOOKING + 1)) {
    const n = normGiftCode(c);
    if (!n) return { error: `"${str(c, 30)}" doesn't look like a gift certificate code. Codes look like RHN-XXXX-XXXX.` };
    if (!codes.includes(n)) codes.push(n);
  }
  if (codes.length > MAX_CODES_PER_BOOKING) return { error: `You can use up to ${MAX_CODES_PER_BOOKING} gift certificates on one booking.` };
  const uses = [];
  let left = Math.round(price);
  for (const code of codes) {
    const g = await loadGift(code);
    if (!g || g.mode !== stripeMode()) return { error: `We couldn't find gift certificate ${code}. Please check the code.` };
    if (g.active === false) return { error: `Gift certificate ${code} can't be used. Please write to bookings.realsound@gmail.com.` };
    if (!(g.balance > 0)) return { error: `Gift certificate ${code} has already been used up.` };
    if (left <= 0) return { error: `You don't need gift certificate ${code} for this session. Please remove it so its money stays saved.` };
    const amount = Math.min(g.balance, left);
    uses.push({ code, amount });
    left -= amount;
  }
  return { uses, total: Math.round(price) - left };
}

// Sets the gift money aside for a booking. All or nothing.
export async function holdGifts(uses, bookingId) {
  const done = [];
  try {
    for (const u of uses) {
      await withLock(u.code, async () => {
        const g = await loadGift(u.code);
        if (!g || g.active === false || g.mode !== stripeMode() || !(g.balance >= u.amount))
          throw new Error(`Gift certificate ${u.code} no longer has enough on it. Please check it and try again.`);
        g.balance = Math.round((g.balance - u.amount) * 100) / 100;
        g.history = (g.history || []).concat({ type: 'hold', bookingId, amount: u.amount, at: new Date().toISOString() }).slice(-50);
        await saveGift(g);
      });
      done.push(u);
    }
    return { ok: true };
  } catch (e) {
    await giveBack(done, bookingId, 'undo');
    return { ok: false, error: e.message };
  }
}

async function giveBack(uses, bookingId, why) {
  for (const u of uses) {
    try {
      await withLock(u.code, async () => {
        const g = await loadGift(u.code);
        if (!g) return;
        g.balance = Math.round((g.balance + u.amount) * 100) / 100;
        g.history = (g.history || []).concat({ type: 'release', why, bookingId, amount: u.amount, at: new Date().toISOString() }).slice(-50);
        await saveGift(g);
      });
    } catch (e) {
      await logNote(`⚠️ Could not put $${u.amount} back on gift certificate ${u.code} (booking ${bookingId}). Please check it in the admin panel.`);
    }
  }
}

// The booking was declined / closed: put the gift money back on the codes.
// Safe to call more than once. Changes `b` (caller saves the booking).
export async function releaseBookingGifts(b, why) {
  if (!b || !b.giftUses || !b.giftUses.length || b.giftReleased || b.giftPaidOut) return;
  b.giftReleased = new Date().toISOString();
  await giveBack(b.giftUses, b.id, why || 'declined');
}

// The booking was confirmed: send the healer their 85% of the gift part
// (90% when the healer brought this client with their own link).
// Safe to call more than once. Changes `b` (caller saves the booking).
export async function payHealerGifts(b) {
  if (!b || !b.giftUses || !b.giftUses.length || b.giftReleased) return;
  b.giftPaidOut = b.giftPaidOut || new Date().toISOString();
  const problems = [];
  for (const u of b.giftUses) {
    if (u.payout && u.payout.status === 'sent') continue;
    const healerCents = Math.round(u.amount * 100) - platformFeeCents(u.amount, b.platformPct || undefined);
    if (!b.stripeAccount) {
      u.payout = { status: 'owed', cents: healerCents, at: new Date().toISOString() };
      problems.push(`$${(healerCents / 100).toFixed(2)} from ${u.code} (healer hasn't connected Stripe)`);
      continue;
    }
    try {
      const g = await loadGift(u.code);
      const params = {
        amount: healerCents, currency: 'usd', destination: b.stripeAccount, transfer_group: b.id,
        description: `Gift certificate ${u.code}: ${b.sessionType || 'session'} for ${b.venueName || 'a client'}`,
        metadata: { bookingId: b.id, giftCode: u.code }
      };
      // Tie the transfer to the gift purchase, so Stripe sends it as soon as that money is available.
      if (g && g.chargeId) params.source_transaction = g.chargeId;
      const t = await stripe().transfers.create(params, { idempotencyKey: `gift-${b.id}-${u.code}` });
      u.payout = { status: 'sent', cents: healerCents, transferId: t.id, at: new Date().toISOString() };
    } catch (e) {
      u.payout = { status: 'failed', cents: healerCents, error: str(e && e.message, 300), at: new Date().toISOString() };
      problems.push(`$${(healerCents / 100).toFixed(2)} from ${u.code}: ${u.payout.error}`);
    }
  }
  if (problems.length) {
    await alertOwner(`⚠️ Gift certificate payment to ${b.practitionerName} needs attention`, [
      `Booking: ${b.venueName} → ${b.practitionerName} (${b.date})`,
      ...problems,
      'Open the admin panel → Gift Certificates to try again.'
    ]);
  }
}

// Every gift certificate, newest first (for the admin panel).
export const loadGiftIndex = () => getJSON('gifts', []);
export const saveGiftIndex = L => setJSON('gifts', L.slice(0, 2000));

// How much of a booking the client's card pays (the rest was paid by gift certificates).
export const cardPart = b => Math.round(((b.total || 0) - (b.giftTotal || 0)) * 100) / 100;
// Extra sentence for "not charged" emails when gift money was put back.
export const giftBackLine = b => (b && b.giftTotal ? ` The $${b.giftTotal} from your gift certificate${b.giftUses && b.giftUses.length > 1 ? 's' : ''} is back on your code${b.giftUses && b.giftUses.length > 1 ? 's' : ''}, ready to use again.` : '');

// "$75 gift certificate covered" text for emails.
export function paidLine(b) {
  const g = b.giftTotal || 0, card = Math.round(((b.total || 0) - g) * 100) / 100;
  if (!g) return `Your card has now been charged $${b.total}.`;
  if (card <= 0) return `Your gift certificate${b.giftUses.length > 1 ? 's' : ''} paid the full $${b.total}.`;
  return `Your gift certificate${b.giftUses.length > 1 ? 's' : ''} paid $${g} and your card has now been charged $${card}.`;
}
