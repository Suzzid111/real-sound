// api/admin.js — admin panel actions. Owner can do everything; the team
// login can view and edit but cannot remove healers or change team access.
import {
  getSession, endSession, loadHealers, saveHealers, loadBookings, getJSON, setJSON,
  selfHealer, hashPassword, logNote, str
} from './_lib.js';
import { setBookingStatus } from './_bookings.js';
import { loadContent, loadEvents, saveEvents } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const s = await getSession(req);
    if (!s || (s.role !== 'owner' && s.role !== 'team')) return res.status(401).json({ ok: false, error: 'Please enter the admin code again.', relogin: true });
    // If the owner turns team access off, team sessions stop working right away.
    if (s.role === 'team' && !(await getJSON('teamAdminActive', true))) {
      await endSession(s.token);
      return res.status(401).json({ ok: false, error: 'Team access is currently turned off', relogin: true });
    }
    const isOwner = s.role === 'owner';
    const body = req.body || {};

    switch (body.action) {
      case 'all': break;
      case 'status': {
        const r = await setBookingStatus(str(body.bookingId, 40), body.status, null, isOwner ? 'owner' : 'team admin');
        if (!r.ok) return res.json(r);
        break;
      }
      case 'remove': {
        if (!isOwner) return res.json({ ok: false, error: 'Only the owner login can remove healers' });
        const P = await loadHealers();
        const p = P.find(x => x.id === body.id);
        await saveHealers(P.filter(x => x.id !== body.id));
        if (p) await logNote(`🗑 Removed healer: ${p.name}`);
        break;
      }
      case 'team': {
        if (!isOwner) return res.json({ ok: false, error: 'Only the owner can change team access' });
        const on = !!body.on;
        await setJSON('teamAdminActive', on);
        await logNote(`👥 Team admin access turned ${on ? 'ON' : 'OFF'}`);
        break;
      }
      case 'edit': {
        const f = body.fields || {};
        const P = await loadHealers();
        const p = P.find(x => x.id === body.id);
        if (!p) return res.json({ ok: false, error: 'Healer not found' });
        const tiers = (Array.isArray(f.sessionTypes) ? f.sessionTypes : []).slice(0, 20)
          .map((t, i) => ({ id: 't' + i + '_' + Date.now(), name: str(t.name, 80), price: parseInt(t.price, 10) }))
          .filter(t => t.name && Number.isFinite(t.price) && t.price > 0);
        if (!str(f.name) || !str(f.location) || !str(f.email) || !tiers.length) return res.json({ ok: false, error: 'Please fill all required fields' });
        const email = str(f.email, 200);
        if (P.some(x => x.id !== p.id && String(x.email || '').toLowerCase() === email.toLowerCase())) return res.json({ ok: false, error: 'Another healer already uses that email' });
        Object.assign(p, {
          name: str(f.name, 100), location: str(f.location, 120), email, bio: str(f.bio, 3000),
          calendlyUrl: str(f.calendlyUrl, 300), sessionTypes: tiers, rate: Math.min(...tiers.map(t => t.price)),
          available: !!f.available
        });
        if (f.newPassword) {
          if (String(f.newPassword).length < 6) return res.json({ ok: false, error: 'New password must be at least 6 characters' });
          p.pwHash = hashPassword(f.newPassword);
          p.mustChangePassword = true;
          await logNote(`🔑 Temporary password set for ${p.name}`);
        }
        await saveHealers(P);
        break;
      }
      case 'contentSave': {
        const sec = body.section;
        if (!['journals', 'teachings', 'resources', 'products'].includes(sec)) return res.json({ ok: false, error: 'Unknown section' });
        const it = body.item || {};
        const C = await loadContent();
        const clean = {
          id: /^[a-z0-9]{6,30}$/.test(String(it.id || '')) ? it.id : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: str(it.title, 150), description: str(it.description, 5000), active: it.active !== false,
          updatedAt: new Date().toISOString()
        };
        if (!clean.title) return res.json({ ok: false, error: 'Please add a title' });
        if (sec === 'journals') {
          clean.price = Math.round(parseFloat(it.price) * 100) / 100;
          if (!(clean.price >= 1)) return res.json({ ok: false, error: 'Please add a price of at least $1' });
          Object.assign(clean, { filePath: str(it.filePath, 400), fileName: str(it.fileName, 200), imagePath: str(it.imagePath, 400) });
          if (!clean.filePath) return res.json({ ok: false, error: 'Please upload the file people will download' });
        } else if (sec === 'teachings') {
          clean.kind = ['article', 'video', 'class'].includes(it.kind) ? it.kind : 'article';
          Object.assign(clean, { body: str(it.body, 30000), videoUrl: str(it.videoUrl, 400), date: str(it.date, 10), time: str(it.time, 5), location: str(it.location, 200), signupUrl: str(it.signupUrl, 400), imagePath: str(it.imagePath, 400) });
        } else if (sec === 'products') {
          Object.assign(clean, { url: str(it.url, 1000), imageUrl: str(it.imageUrl, 1000), price: str(it.price, 30), recommendedBy: str(it.recommendedBy, 80) || 'Suzzanna', category: str(it.category, 60) });
          if (!/^https?:\/\//i.test(clean.url)) return res.json({ ok: false, error: 'Please paste the full affiliate link, starting with https://' });
          if (clean.imageUrl && !/^https:\/\//i.test(clean.imageUrl)) return res.json({ ok: false, error: 'The picture address must start with https://' });
        } else {
          Object.assign(clean, { url: str(it.url, 500), category: str(it.category, 60) || 'General' });
          if (!/^https?:\/\//i.test(clean.url)) return res.json({ ok: false, error: 'Please add a full web address starting with https://' });
        }
        const list = C[sec] || (C[sec] = []);
        const i = list.findIndex(x => x.id === clean.id);
        if (i >= 0) list[i] = Object.assign({}, list[i], clean); else { clean.createdAt = clean.updatedAt; list.unshift(clean); }
        await setJSON('content', C);
        await logNote(`📚 ${i >= 0 ? 'Updated' : 'Added'} ${sec.slice(0, -1)}: ${clean.title}`);
        break;
      }
      case 'contentDelete': {
        const C = await loadContent();
        const sec = body.section;
        if (!C[sec]) return res.json({ ok: false, error: 'Unknown section' });
        const gone = C[sec].find(x => x.id === body.id);
        C[sec] = C[sec].filter(x => x.id !== body.id);
        await setJSON('content', C);
        if (gone) await logNote(`🗑 Removed ${sec.slice(0, -1)}: ${gone.title}`);
        break;
      }
      case 'eventStatus': {
        const E = await loadEvents();
        const ev = E.find(x => x.id === body.id);
        if (!ev) return res.json({ ok: false, error: 'Event not found' });
        if (body.status === 'remove') {
          await saveEvents(E.filter(x => x !== ev));
          await logNote(`🗑 Removed event "${ev.title}" by ${ev.healerName}`);
          break;
        }
        if (!['approved', 'declined'].includes(body.status)) return res.json({ ok: false, error: 'Bad status' });
        ev.status = body.status;
        ev.declineReason = body.status === 'declined' ? str(body.reason, 300) : '';
        ev.reviewedAt = new Date().toISOString();
        await saveEvents(E);
        await logNote(`${body.status === 'approved' ? '✅ Approved' : '✗ Declined'} event "${ev.title}" by ${ev.healerName}`);
        break;
      }
      case 'orderLink': {
        const o = await getJSON('order:' + str(body.id, 80), null);
        if (!o) return res.json({ ok: false, error: 'Order not found' });
        const site = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'realholisticnetwork.com');
        return res.json({ ok: true, link: `${site}/api/learn?order=${o.id}&k=${o.key}`, email: o.email });
      }
      default:
        return res.status(400).json({ ok: false, error: 'Unknown action' });
    }

    const [P, B, notes, teamActive, content, orders, E] = await Promise.all([loadHealers(), loadBookings(), getJSON('adminNotes', []), getJSON('teamAdminActive', true), loadContent(), getJSON('orders', []), loadEvents()]);
    return res.json({ ok: true, role: s.role, practitioners: P.map(selfHealer), bookings: B, notes, teamActive, content, orders, events: E });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
