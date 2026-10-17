// api/healer.js — everything a signed-in healer can do to their OWN account:
// reload their data, save schedule / booking hours, acknowledge the payment
// terms, change their password, accept or decline their bookings.
import { getSession, loadHealers, saveHealers, loadBookings, selfHealer, hashPassword, checkPassword, logNote, alertOwner, str, loadEvents, saveEvents, cleanEvent, todayET, cleanPhoto, savePhoto, loadReviews, saveBookings, newToken } from './_lib.js';
import { setBookingStatus, proposeTime } from './_bookings.js';
import { cleanServices, LINK_RE, loadServices, siteUrl, tierName, normalizeServices, currentServices } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    await loadServices();
    const s = await getSession(req);
    if (!s || s.role !== 'healer') return res.status(401).json({ ok: false, error: 'Please log in again.', relogin: true });
    const body = req.body || {};

    if (body.action === 'respond') {
      const r = await setBookingStatus(str(body.bookingId, 40), body.status, s.id, 'healer');
      if (!r.ok) return res.json(r);
    } else if (body.action === 'propose') {
      const r = await proposeTime(s.id, body, siteUrl(req));
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
            bufferMin: [0, 5, 10, 15, 20, 30, 45, 60].includes(+a.bufferMin) ? +a.bufferMin : 0,
            updatedAt: new Date().toISOString()
          };
        }
      }
      if ('sessionTypes' in f) {
        const old = p.sessionTypes || [];
        const tiers = [];
        for (const [i, t] of (Array.isArray(f.sessionTypes) ? f.sessionTypes : []).slice(0, 20).entries()) {
          const service = str(t.service, 60), details = str(t.details, 60).replace(/\s+/g, ' '), price = parseInt(t.price, 10);
          if (!currentServices().includes(service)) return res.json({ ok: false, error: 'Please choose a healing service for each session' });
          if (details && (LINK_RE.test(details) || /massage/i.test(details))) return res.json({ ok: false, error: /massage/i.test(details) ? 'Massage therapy is not offered on REAL Holistic Network' : "Session details can't include website links" });
          if (!Number.isFinite(price) || price < 1 || price > 10000) return res.json({ ok: false, error: `Please enter a price in whole dollars for ${service}` });
          const keep = old.find(o => o.id === t.id);
          tiers.push({ id: keep ? keep.id : 't' + Date.now() + i, name: tierName(service, details), service, details, price, online: t.online === true });
        }
        if (!tiers.length) return res.json({ ok: false, error: 'Please keep at least one session' });
        if (new Set(tiers.map(t => t.name.toLowerCase())).size !== tiers.length) return res.json({ ok: false, error: 'Two sessions are the same. Add details (like "30 min" and "60 min") to tell them apart.' });
        // keep each session's length setting when its name changes
        if (p.availability && p.availability.durations) {
          const d = p.availability.durations;
          tiers.forEach(t => { const o = old.find(x => x.id === t.id); if (o && o.name !== t.name && d[o.name] && !d[t.name]) d[t.name] = d[o.name]; });
        }
        p.sessionTypes = tiers;
        p.rate = Math.min(...tiers.map(t => t.price));
        // every service they sell a session for is one of their healing services
        p.modalities = normalizeServices((p.modalities || []).concat(tiers.map(t => t.service)));
        await logNote(`💲 ${p.name} updated their sessions & prices`);
      }
      if ('modalities' in f) {
        const mods = cleanServices(f.modalities);
        if (mods.error) return res.json({ ok: false, error: mods.error });
        if (!mods.list.length) return res.json({ ok: false, error: 'Please choose at least one healing service' });
        p.modalities = mods.list;
      }
      if ('videoLink' in f) {
        const v = str(f.videoLink, 300);
        if (v && !/^https:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(v)) return res.json({ ok: false, error: 'Please paste the full video link, starting with https:// (for example your Zoom or Google Meet link)' });
        if (v) p.videoLink = v; else delete p.videoLink;
      }
      if ('intakeQuestions' in f) {
        const qs = (Array.isArray(f.intakeQuestions) ? f.intakeQuestions : []).slice(0, 5).map(q => str(q, 200).replace(/\s+/g, ' ')).filter(Boolean);
        if (qs.some(q => LINK_RE.test(q))) return res.json({ ok: false, error: "Questions can't include website links" });
        p.intakeQuestions = qs;
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
      await alertOwner(`📣 Event waiting for your approval: "${ev.title}" by ${p.name} (${ev.date})`, ['Approve or decline it in your admin panel.']);
    } else if (body.action === 'calFeed') {
      // private link that lets the healer's own calendar app show their bookings
      const P = await loadHealers();
      const p = P.find(x => x.id === s.id);
      if (!p) return res.status(401).json({ ok: false, error: 'Account not found', relogin: true });
      if (!p.calFeedKey || body.reset === true) { p.calFeedKey = newToken().slice(0, 32); await saveHealers(P); }
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
