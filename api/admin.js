// api/admin.js — admin panel actions. Owner can do everything; the team
// login can view and edit but cannot remove healers or change team access.
import {
  getSession, endSession, loadHealers, saveHealers, loadBookings, getJSON, setJSON,
  selfHealer, hashPassword, logNote, str
} from './_lib.js';
import { setBookingStatus } from './_bookings.js';

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
      default:
        return res.status(400).json({ ok: false, error: 'Unknown action' });
    }

    const [P, B, notes, teamActive] = await Promise.all([loadHealers(), loadBookings(), getJSON('adminNotes', []), getJSON('teamAdminActive', true)]);
    return res.json({ ok: true, role: s.role, practitioners: P.map(selfHealer), bookings: B, notes, teamActive });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
