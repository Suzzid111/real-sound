// api/healer.js — everything a signed-in healer can do to their OWN account:
// reload their data, save schedule / booking hours, acknowledge the payment
// terms, change their password, accept or decline their bookings.
import { getSession, loadHealers, saveHealers, loadBookings, selfHealer, hashPassword, checkPassword, logNote, str, loadEvents, saveEvents, cleanEvent, todayET, cleanPhoto, savePhoto, loadReviews, saveBookings, newToken } from './_lib.js';
import { setBookingStatus } from './_bookings.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const s = await getSession(req);
    if (!s || s.role !== 'healer') return res.status(401).json({ ok: false, error: 'Please log in again.', relogin: true });
    const body = req.body || {};

    if (body.action === 'respond') {
      const r = await setBookingStatus(str(body.bookingId, 40), body.status, s.id, 'healer');
      if (!r.ok) return res.json(r);
    } else if (body.action === 'update') {
      const P = await loadHealers();
      const p = P.find(x => x.id === s.id);
      if (!p) return res.status(401).json({ ok: false, error: 'Account not found', relogin: true });
      const f = body.fields || {};

      if ('schedule' in f) {
        const old = p.schedule || [];
        p.schedule = (Array.isArray(f.schedule) ? f.schedule : []).slice(0, 500).map(e => ({
          id: str(e.id, 40), date: str(e.date, 10), time: str(e.time, 5), end: str(e.end, 5), note: str(e.note, 200),
          // when it was added: keep the saved date, or work it out from the id ("sch" + timestamp)
          createdAt: (old.find(o => o.id === e.id) || {}).createdAt || (/^sch\d{12,14}$/.test(e.id) ? new Date(+e.id.slice(3)).toISOString() : new Date().toISOString())
        })).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
      }
      if ('availability' in f) {
        const a = f.availability;
        if (!a) delete p.availability;
        else {
          const weekly = {};
          for (let d = 0; d < 7; d++) {
            const w = a.weekly && a.weekly[d];
            if (Array.isArray(w)) weekly[d] = w.slice(0, 4).map(x => ({ start: str(x.start, 5), end: str(x.end, 5) })).filter(x => /^\d\d:\d\d$/.test(x.start) && /^\d\d:\d\d$/.test(x.end) && x.end > x.start);
          }
          const durations = {};
          Object.keys(a.durations || {}).slice(0, 30).forEach(k => { const v = parseInt(a.durations[k], 10); if (v >= 15 && v <= 600) durations[str(k, 80)] = v; });
          p.availability = {
            tz: str(a.tz, 60) || 'America/New_York', weekly, durations,
            minNoticeHours: Math.max(0, Math.min(336, parseInt(a.minNoticeHours, 10) || 0)),
            maxDaysAhead: Math.max(1, Math.min(180, parseInt(a.maxDaysAhead, 10) || 60)),
            step: [15, 30, 60].includes(+a.step) ? +a.step : 30,
            updatedAt: new Date().toISOString()
          };
        }
      }
      if (f.payTermsVersion) {
        p.payTermsVersion = str(f.payTermsVersion, 40);
        p.payTermsAcceptedAt = new Date().toISOString();
        await logNote(`✅ ${p.name} acknowledged the payment terms`);
      }
      if (f.newPassword !== undefined) {
        if (String(f.newPassword).length < 6) return res.json({ ok: false, error: 'New password must be at least 6 characters' });
        if (!p.mustChangePassword && !checkPassword(f.currentPassword, p.pwHash)) return res.json({ ok: false, error: 'Current password is not correct' });
        p.pwHash = hashPassword(f.newPassword);
        delete p.mustChangePassword;
      }
      await saveHealers(P);
    } else if (body.action === 'eventSave') {
      const P = await loadHealers();
      const p = P.find(x => x.id === s.id);
      if (!p) return res.status(401).json({ ok: false, error: 'Account not found', relogin: true });
      const c = cleanEvent(body.event || {});
      if (c.error) return res.json({ ok: false, error: c.error });
      const E = await loadEvents();
      const id = str((body.event || {}).id, 40);
      const old = id ? E.find(x => x.id === id && x.healerId === s.id) : null;
      if (id && !old) return res.json({ ok: false, error: 'Event not found' });
      if (!old && E.filter(x => x.healerId === s.id && x.date >= todayET()).length >= 30) return res.json({ ok: false, error: 'You can have up to 30 upcoming events at a time' });
      const now = new Date().toISOString();
      const ev = Object.assign(old || { id: 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), healerId: p.id, rsvps: [], createdAt: now },
        c.event, { healerName: p.name, healerAvatar: p.avatar, status: 'pending', declineReason: '', updatedAt: now });
      if (!old) E.push(ev);
      await saveEvents(E);
      await logNote(`📣 Event waiting for your approval: "${ev.title}" by ${p.name} (${ev.date})`);
    } else if (body.action === 'photo') {
      const c = cleanPhoto(body.photo);
      if (c.error) return res.json({ ok: false, error: c.error });
      const P = await loadHealers();
      const p = P.find(x => x.id === s.id);
      if (!p) return res.status(401).json({ ok: false, error: 'Account not found', relogin: true });
      await savePhoto(p.id, c.data);
      p.photoV = Date.now();
      await saveHealers(P);
      await logNote(`📷 ${p.name} added a profile photo`);
    } else if (body.action === 'eventDelete') {
      const E = await loadEvents();
      const ev = E.find(x => x.id === body.id && x.healerId === s.id);
      if (!ev) return res.json({ ok: false, error: 'Event not found' });
      await saveEvents(E.filter(x => x !== ev));
      await logNote(`🗑 ${ev.healerName} removed their event "${ev.title}"`);
    } else if (body.action !== 'me') {
      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }

    const P = await loadHealers();
    const p = P.find(x => x.id === s.id);
    if (!p) return res.status(401).json({ ok: false, error: 'Account not found', relogin: true });
    const [B, E, R] = await Promise.all([loadBookings(), loadEvents(), loadReviews()]);
    // older confirmed bookings get their private review link the first time it's needed
    let addedKeys = false;
    B.forEach(b => { if (b.practitionerId === s.id && b.status === 'confirmed' && !b.reviewKey) { b.reviewKey = newToken().slice(0, 24); addedKeys = true; } });
    if (addedKeys) await saveBookings(B);
    return res.json({ ok: true, healer: selfHealer(p), bookings: B.filter(b => b.practitionerId === s.id), events: E.filter(e => e.healerId === s.id), reviews: R.filter(r => r.healerId === s.id && !r.hidden) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
