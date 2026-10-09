// api/events.js — a visitor saves their spot at a free community event.
// The host healer (and the admin) can see who is coming; the public cannot.
import { loadEvents, saveEvents, str, tooManyTries, clientIp, todayET } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const b = req.body || {};
    if (b.action !== 'rsvp') return res.status(400).json({ ok: false, error: 'Unknown action' });
    if (await tooManyTries('rsvp:' + clientIp(req), 20)) return res.status(429).json({ ok: false, error: 'Too many tries. Please wait a few minutes.' });
    const name = str(b.name, 80), email = str(b.email, 200).toLowerCase(), guests = Math.max(1, Math.min(10, parseInt(b.guests, 10) || 1));
    if (!name) return res.json({ ok: false, error: 'Please enter your name' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.json({ ok: false, error: 'Please enter a valid email' });
    const E = await loadEvents();
    const ev = E.find(x => x.id === b.eventId && x.status === 'approved');
    if (!ev || ev.date < todayET()) return res.json({ ok: false, error: 'This event is no longer available' });
    ev.rsvps = ev.rsvps || [];
    if (ev.rsvps.some(r => r.email === email)) return res.json({ ok: true, already: true });
    const taken = ev.rsvps.reduce((n, r) => n + (r.guests || 1), 0);
    if (ev.spots && taken + guests > ev.spots) return res.json({ ok: false, error: ev.spots - taken > 0 ? `Only ${ev.spots - taken} spot(s) left` : 'Sorry, this event is full' });
    ev.rsvps.push({ name, email, guests, at: new Date().toISOString() });
    await saveEvents(E);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
