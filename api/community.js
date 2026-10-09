// api/community.js — things any visitor can send in:
//   newsletter sign-up / unsubscribe, and workplace & group wellness requests.
// Everything is stored privately; only the admin can see it.
import { getJSON, setJSON, logNote, newToken, str, tooManyTries, clientIp } from './_lib.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  try {
    // Unsubscribe link from an email: GET /api/community?unsub=<token>
    if (req.method === 'GET') {
      const t = String((req.query || {}).unsub || '');
      let done = false;
      if (/^[a-f0-9]{48}$/.test(t)) {
        const S = await getJSON('subscribers', []);
        const keep = S.filter(s => s.token !== t);
        if (keep.length !== S.length) { await setJSON('subscribers', keep); done = true; await logNote('📭 Someone unsubscribed from the newsletter'); }
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><body style="font-family:Georgia,serif;background:#F6F1FB;color:#2A1F3D;text-align:center;padding:60px 20px"><h2 style="font-weight:normal">${done ? "You've been unsubscribed." : "You're not on our list."}</h2><p style="color:#7A6E8A">You won't receive any more newsletters from REAL Holistic Network.</p><p><a href="/" style="color:#6B4699">Back to REAL Holistic Network</a></p></body>`);
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'subscribe') {
      if (await tooManyTries('sub:' + clientIp(req), 10)) return res.status(429).json({ ok: false, error: 'Too many tries. Please wait a few minutes.' });
      const email = str(b.email, 200).toLowerCase(), name = str(b.name, 60);
      if (!EMAIL_RE.test(email)) return res.json({ ok: false, error: 'Please enter a valid email' });
      const S = await getJSON('subscribers', []);
      if (S.some(s => s.email === email)) return res.json({ ok: true, already: true });
      S.push({ email, name, source: str(b.source, 40) || 'website', createdAt: new Date().toISOString(), token: newToken() });
      await setJSON('subscribers', S);
      await logNote(`💌 New newsletter subscriber${name ? ': ' + name : ''} (${S.length} total)`);
      return res.json({ ok: true });
    }

    if (b.action === 'workplace') {
      if (await tooManyTries('wp:' + clientIp(req), 5)) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
      const r = {
        id: 'w' + Date.now().toString(36), org: str(b.org, 150), contact: str(b.contact, 100), email: str(b.email, 200),
        phone: str(b.phone, 40), type: str(b.type, 60), interests: (Array.isArray(b.interests) ? b.interests : []).slice(0, 12).map(x => str(x, 60)),
        groupSize: str(b.groupSize, 20), when: str(b.when, 200), location: str(b.location, 200), budget: str(b.budget, 60),
        notes: str(b.notes, 3000), status: 'new', adminNote: '', createdAt: new Date().toISOString()
      };
      if (!r.org || !r.contact || !EMAIL_RE.test(r.email)) return res.json({ ok: false, error: 'Please add your organization, your name and a valid email' });
      const W = await getJSON('workplaceRequests', []);
      W.unshift(r);
      await setJSON('workplaceRequests', W.slice(0, 500));
      await logNote(`🏢 New group wellness request from ${r.org} (${r.type || 'group'}, ${r.groupSize || '?'} people)`);
      return res.json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
