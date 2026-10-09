// api/auth.js — healer sign-up, healer login, admin login, logout,
// "forgot password" emails and resetting a password from the emailed link.
import {
  redis, getJSON, loadHealers, saveHealers, loadBookings, findByEmail, selfHealer,
  hashPassword, checkPassword, safeEqual, createSession, getSession, endSession,
  tooManyTries, clientIp, logNote, newToken, sendEmail, siteUrl, str, LINK_RE, NOTICE_TEMPLATE, esc
} from './_lib.js';

const RESET_SECONDS = 60 * 60; // reset links work for 1 hour

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const body = req.body || {};
  try {
    switch (body.action) {
      case 'login': return await login(req, res, body);
      case 'signup': return await signup(req, res, body);
      case 'admin': return await adminLogin(req, res, body);
      case 'logout': { const s = await getSession(req); if (s) await endSession(s.token); return res.json({ ok: true }); }
      case 'forgot': return await forgot(req, res, body);
      case 'reset': return await reset(req, res, body);
      default: return res.status(400).json({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}

async function login(req, res, { email, password }) {
  const e = str(email, 200).toLowerCase();
  if (await tooManyTries('login:' + e, 10) || await tooManyTries('loginip:' + clientIp(req), 30))
    return res.status(429).json({ ok: false, error: 'Too many tries. Please wait 15 minutes and try again.' });
  const P = await loadHealers();
  const p = findByEmail(P, e);
  if (!p || !checkPassword(password, p.pwHash)) return res.json({ ok: false, error: 'Email or password not recognised.' });
  await redis(['DEL', 'rs:rl:login:' + e]);
  const token = await createSession({ role: 'healer', id: p.id });
  const B = await loadBookings();
  return res.json({ ok: true, token, healer: selfHealer(p), bookings: B.filter(b => b.practitionerId === p.id) });
}

async function signup(req, res, b) {
  if (await tooManyTries('signup:' + clientIp(req), 10))
    return res.status(429).json({ ok: false, error: 'Too many sign-ups from this connection. Please try again later.' });
  const name = str(b.name, 100), email = str(b.email, 200), password = String(b.password || ''),
    location = str(b.location, 120), zip = str(b.zip, 10), bio = str(b.bio, 3000), calendlyUrl = str(b.calendlyUrl, 300);
  if (!name || !email || !location) return res.json({ ok: false, error: 'Please fill all required fields' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.json({ ok: false, error: 'Please enter a valid email' });
  if (password.length < 6) return res.json({ ok: false, error: 'Password must be at least 6 characters' });
  if ([name, location, bio].some(f => LINK_RE.test(f))) return res.json({ ok: false, error: "Please remove website links from your profile — links to outside sites aren't allowed." });
  const tiers = (Array.isArray(b.sessionTypes) ? b.sessionTypes : []).slice(0, 20)
    .map((t, i) => ({ id: 't' + Date.now() + i, name: str(t.name, 80), price: parseInt(t.price, 10) }))
    .filter(t => t.name && Number.isFinite(t.price) && t.price > 0);
  if (!tiers.length) return res.json({ ok: false, error: 'Please add at least one session type & price' });
  if (!b.agreedTerms || !b.agreedPayTerms) return res.json({ ok: false, error: 'Please agree to the terms' });
  const list = a => (Array.isArray(a) ? a : []).slice(0, 30).map(x => str(x, 80)).filter(Boolean);

  const P = await loadHealers();
  if (findByEmail(P, email)) return res.json({ ok: false, error: 'Email already registered' });
  const avatars = ['🌿', '🎵', '🌸', '💫', '🔔', '🌀', '🪬'];
  const now = new Date().toISOString();
  const p = {
    id: 'p' + Date.now(), name, email, pwHash: hashPassword(password), location, zip,
    rate: Math.min(...tiers.map(t => t.price)), sessionTypes: tiers, calendlyUrl,
    instruments: list(b.instruments), venueTypes: list(b.venueTypes), modalities: list(b.modalities),
    bio, available: true, avatar: avatars[Math.floor(Math.random() * avatars.length)],
    source: str(b.source, 60) || 'direct', joinedAt: now,
    payTermsVersion: str(b.payTermsVersion, 40), payTermsAcceptedAt: now
  };
  P.push(p);
  await saveHealers(P);
  await logNote(`🌟 New healer: ${name} (${location})`);
  const token = await createSession({ role: 'healer', id: p.id });
  return res.json({ ok: true, token, healer: selfHealer(p), bookings: [] });
}

async function adminLogin(req, res, { code }) {
  if (await tooManyTries('admin:' + clientIp(req), 10))
    return res.status(429).json({ ok: false, error: 'Too many tries. Please wait 15 minutes.' });
  const owner = process.env.ADMIN_OWNER_CODE, team = process.env.ADMIN_TEAM_CODE;
  if (!owner) return res.json({ ok: false, error: 'Admin code is not set up yet (ADMIN_OWNER_CODE in Vercel).' });
  const c = String(code || '');
  let role = null;
  if (safeEqual(c, owner)) role = 'owner';
  else if (team && safeEqual(c, team)) {
    if (!(await getJSON('teamAdminActive', true))) return res.json({ ok: false, error: 'Team access is currently turned off' });
    role = 'team';
  }
  if (!role) return res.json({ ok: false, error: 'Incorrect code' });
  const token = await createSession({ role });
  return res.json({ ok: true, token, role });
}

async function forgot(req, res, { email }) {
  const e = str(email, 200).toLowerCase();
  const generic = { ok: true, message: "If that email is registered, we've sent a link to reset your password. Please check your inbox (and spam folder)." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.json({ ok: false, error: 'Please enter a valid email' });
  if (await tooManyTries('forgot:' + e, 3) || await tooManyTries('forgotip:' + clientIp(req), 10)) return res.json(generic);
  const P = await loadHealers();
  const p = findByEmail(P, e);
  if (!p) return res.json(generic); // never reveal whether an email is registered
  const token = newToken();
  await redis(['SET', 'rs:reset:' + token, p.id, 'EX', RESET_SECONDS]);
  const link = `${siteUrl(req)}/?reset=${token}`;
  const html = `<p style="font-size:18px;margin:0 0 16px">Hi ${esc(p.name)},</p><p style="margin:0 0 22px">We received a request to reset your REAL Holistic Network password. Click the button below to choose a new one.</p><p style="text-align:center;margin:0 0 22px"><a href="${esc(link)}" style="background:#C9922A;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold;display:inline-block">Choose a New Password</a></p><p style="font-size:13px;color:#7A6E8A;margin:0 0 12px">This link works for 1 hour. If the button doesn't work, copy this link into your browser:<br><a href="${esc(link)}" style="color:#6B4699;word-break:break-all">${esc(link)}</a></p><p style="font-size:13px;color:#7A6E8A;margin:0">If you didn't ask for this, you can ignore this email. Your password won't change.</p>`;
  const sent = await sendEmail(NOTICE_TEMPLATE(), {
    to_email: p.email, email: p.email, to_name: p.name, name: p.name, reset_link: link, link,
    subject: 'Reset your REAL Holistic Network password', message_html: html,
    message: `Hi ${p.name}, click this link to choose a new password for REAL Holistic Network: ${link} — it works for 1 hour. If you didn't ask for this, you can ignore this email.`
  }).catch(() => false);
  await logNote(sent ? `🔑 Password reset email sent to ${p.name}` : `⚠️ Password reset requested by ${p.name} but the email could not be sent — check EmailJS setup`);
  return res.json(generic);
}

async function reset(req, res, { token, password }) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return res.json({ ok: false, error: 'This reset link is not valid. Please request a new one.' });
  if (String(password || '').length < 6) return res.json({ ok: false, error: 'Password must be at least 6 characters' });
  const id = await redis(['GET', 'rs:reset:' + token]);
  if (!id) return res.json({ ok: false, error: 'This reset link has expired or was already used. Please request a new one.' });
  const P = await loadHealers();
  const p = P.find(x => x.id === id);
  if (!p) return res.json({ ok: false, error: 'Account not found.' });
  p.pwHash = hashPassword(password);
  delete p.mustChangePassword;
  await saveHealers(P);
  await redis(['DEL', 'rs:reset:' + token]);
  await logNote(`🔑 ${p.name} reset their password`);
  const session = await createSession({ role: 'healer', id: p.id });
  const B = await loadBookings();
  return res.json({ ok: true, token: session, healer: selfHealer(p), bookings: B.filter(b => b.practitionerId === p.id) });
}
