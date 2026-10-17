// api/manage.js — clients managing their own bookings, without a password.
//
// POST actions:
//   info    {code}            one booking, from the private link in their email
//   cancel  {code}            cancel it (full refund 24+ hours ahead, as the policy says)
//   link    {email}           email the client a private "My bookings" link
//   list    {token}           all bookings for that email
//   cancelMine {token, id}    cancel one of them from the list
// GET:
//   ?ics=<id>.<key>           "add to calendar" file for one booking
//   ?feed=<healerId>.<key>    a healer's private calendar feed (subscribed in Google / Apple Calendar)
import { loadBookings, saveBookings, loadHealers, redis, newToken, sendNotice, tooManyTries, clientIp, str, safeEqual } from './_lib.js';
import { cancelBooking, clientView, ensureKeys, icsEvent, icsFile, SITE } from './_manage.js';

const CODE_RE = /^(b\d{6,20})\.([a-f0-9]{24})$/;
const TOKEN_TTL = 3 * 86400; // "My bookings" links work for 3 days
const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

async function emailForToken(token) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return null;
  return redis(['GET', 'rs:mb:' + token]);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return calendar(req, res);
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const body = req.body || {};
    if (await tooManyTries('manage:' + clientIp(req), 60)) return res.status(429).json({ ok: false, error: 'Too many tries. Please wait a few minutes.' });

    if (body.action === 'info' || body.action === 'cancel') {
      const m = CODE_RE.exec(String(body.code || ''));
      if (!m) return res.json({ ok: false, error: 'This link is not valid. Please check your email for the latest link.' });
      const check = b => !!b.manageKey && safeEqual(b.manageKey, m[2]);
      if (body.action === 'cancel') return res.json(await cancelBooking(m[1], check, 'from their email link'));
      const [B, P] = await Promise.all([loadBookings(), loadHealers()]);
      const b = B.find(x => x.id === m[1]);
      if (!b || !check(b)) return res.json({ ok: false, error: 'This link is not valid. Please check your email for the latest link.' });
      return res.json({ ok: true, booking: clientView(b, P.find(x => x.id === b.practitionerId)) });
    }

    if (body.action === 'link') {
      const email = str(body.email, 200).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.json({ ok: false, error: 'Please enter the email address you booked with' });
      if (await tooManyTries('mblink:' + clientIp(req), 8) || await tooManyTries('mblink:' + email, 3)) return res.json({ ok: false, error: 'We just sent a link. Please check your email (and spam folder), or try again in 15 minutes.' });
      const B = await loadBookings();
      // Only send an email when there really are bookings, but always answer the same way,
      // so nobody can use this to find out who has booked.
      if (B.some(b => sameEmail(b.email, email))) {
        const token = newToken();
        await redis(['SET', 'rs:mb:' + token, email, 'EX', TOKEN_TTL]);
        const link = `${SITE()}/?mybookings=${token}`;
        await sendNotice(email, '', 'Your REAL Holistic Network bookings',
          `Here is your private link to see your bookings, add them to your calendar, cancel, or book again:\n\n${link}\n\nThis link works for 3 days. If you didn't ask for it, you can ignore this email.\n\nWith gratitude,\nREAL Holistic Network`);
      }
      return res.json({ ok: true });
    }

    if (body.action === 'list' || body.action === 'cancelMine') {
      const email = await emailForToken(body.token);
      if (!email) return res.json({ ok: false, expired: true, error: 'This link has expired. Please ask for a new one below.' });
      if (body.action === 'cancelMine') {
        const r = await cancelBooking(str(body.id, 40), b => sameEmail(b.email, email), 'from My Bookings');
        if (!r.ok) return res.json(r);
      }
      const [B, P] = await Promise.all([loadBookings(), loadHealers()]);
      const mine = B.filter(b => sameEmail(b.email, email));
      let changed = false;
      mine.forEach(b => { if (ensureKeys(b)) changed = true; });
      if (changed) await saveBookings(B);
      const list = mine.map(b => clientView(b, P.find(x => x.id === b.practitionerId)))
        .sort((a, b) => (b.start || 0) - (a.start || 0)).slice(0, 60);
      return res.json({ ok: true, email, bookings: list });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}

async function calendar(req, res) {
  const q = req.query || {};
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (q.ics) {
    const m = /^(b\d{6,20})\.([a-f0-9]{24})$/.exec(String(q.ics));
    const [B, P] = await Promise.all([loadBookings(), loadHealers()]);
    const b = m && B.find(x => x.id === m[1] && x.icsKey && safeEqual(x.icsKey, m[2]));
    if (!b) { res.setHeader('Content-Type', 'text/plain'); return res.status(404).send('This calendar link is not valid.'); }
    const h = P.find(x => x.id === b.practitionerId);
    res.setHeader('Content-Disposition', 'attachment; filename="session.ics"');
    return res.send(icsFile([icsEvent(b, h, false)], 'REAL Holistic Network'));
  }
  if (q.feed) {
    const m = /^([\w-]{1,64})\.([a-f0-9]{32})$/.exec(String(q.feed));
    const P = await loadHealers();
    const h = m && P.find(x => x.id === m[1] && x.calFeedKey && safeEqual(x.calFeedKey, m[2]));
    if (!h) { res.setHeader('Content-Type', 'text/plain'); return res.status(404).send('This calendar link is not valid.'); }
    const B = await loadBookings();
    const since = Date.now() - 60 * 86400000;
    // confirmed sessions, plus requests still waiting (shown as "tentative") so the time isn't double-booked
    const mine = B.filter(b => b.practitionerId === h.id && ['confirmed', 'pending', 'proposed'].includes(b.status))
      .filter(b => { const s = b.startUTC ? Date.parse(b.startUTC) : Date.parse((b.date || '') + 'T12:00:00Z'); return Number.isFinite(s) && s > since; });
    return res.send(icsFile(mine.map(b => icsEvent(b, h, true)), 'REAL Holistic Network bookings'));
  }
  res.setHeader('Content-Type', 'text/plain');
  return res.status(400).send('Missing calendar link');
}
