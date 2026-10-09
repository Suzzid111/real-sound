// api/_lib.js — shared helpers for the server endpoints.
// Files starting with "_" are not their own web address on Vercel; the other
// api files import from here.
//
// SECURITY MODEL
// - Healer passwords are stored only as salted scrypt hashes, never plain text.
// - Private fields (emails, password hashes, schedule notes, client details)
//   never leave the server except to the signed-in healer they belong to, or
//   to a signed-in admin.
// - All saving happens here on the server, one healer/booking at a time,
//   instead of the browser overwriting the whole database.

import crypto from 'crypto';

const REST_URL = process.env.STORAGE_KV_REST_API_URL || process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.STORAGE_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

export async function redis(cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}
export async function getJSON(key, dflt) {
  const raw = await redis(['GET', 'rs:' + key]);
  return raw ? JSON.parse(raw) : dflt;
}
export async function setJSON(key, value) {
  await redis(['SET', 'rs:' + key, JSON.stringify(value)]);
}

// ---------- passwords ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const test = crypto.scryptSync(String(pw), salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function newToken() { return crypto.randomBytes(24).toString('hex'); }

// ---------- data ----------
// Loads healers. Any old plain-text password is converted to a hash the first
// time this runs, so plain-text passwords disappear from the database.
export async function loadHealers() {
  const P = await getJSON('practitioners', []);
  let changed = false;
  for (const p of P) {
    if (p.password && !p.pwHash) { p.pwHash = hashPassword(p.password); changed = true; }
    if ('password' in p) { delete p.password; changed = true; }
  }
  if (changed) await setJSON('practitioners', P);
  return P;
}
export const saveHealers = P => setJSON('practitioners', P);
export const loadBookings = () => getJSON('bookings', []);
export const saveBookings = B => setJSON('bookings', B);

export function findByEmail(P, email) {
  const e = String(email || '').trim().toLowerCase();
  return e ? P.find(p => String(p.email || '').trim().toLowerCase() === e) : undefined;
}

// What anyone visiting the site may see about a healer.
export function publicHealer(p) {
  return {
    id: p.id, name: p.name, location: p.location, zip: p.zip, avatar: p.avatar, bio: p.bio,
    instruments: p.instruments || [], venueTypes: p.venueTypes || [], modalities: p.modalities || [],
    rate: p.rate, sessionTypes: p.sessionTypes || [], calendlyUrl: p.calendlyUrl || '',
    available: !!p.available,
    photo: p.photoV ? '/api/photo?id=' + encodeURIComponent(p.id) + '&v=' + p.photoV : '',
    availability: p.availability || null,
    // only the busy times, never the healer's private notes
    schedule: (p.schedule || []).map(s => ({ date: s.date, time: s.time || '', end: s.end || '' }))
  };
}
// What the signed-in healer sees about themselves (everything but the hash).
export function selfHealer(p) {
  const { pwHash, ...rest } = p;
  return rest;
}
// What anyone may see about bookings: only that a time is taken.
export function publicBooking(b) {
  return { practitionerId: b.practitionerId, status: b.status, date: b.date, time: b.time || '', startUTC: b.startUTC || null, durationMin: b.durationMin || null };
}

// ---------- sessions ----------
const SESSION_SECONDS = 60 * 60 * 24 * 14;
export async function createSession(data) {
  const token = newToken();
  await redis(['SET', 'rs:sess:' + token, JSON.stringify(data), 'EX', SESSION_SECONDS]);
  return token;
}
export async function getSession(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const raw = await redis(['GET', 'rs:sess:' + token]);
  return raw ? Object.assign(JSON.parse(raw), { token }) : null;
}
export async function endSession(token) { if (token) await redis(['DEL', 'rs:sess:' + token]); }

// Simple brute-force protection: max `limit` tries per key per 15 minutes.
export async function tooManyTries(key, limit) {
  const k = 'rs:rl:' + key;
  const n = await redis(['INCR', k]);
  if (n === 1) await redis(['EXPIRE', k, 900]);
  return n > limit;
}
export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

// ---------- admin activity log ----------
export async function logNote(msg) {
  const notes = await getJSON('adminNotes', []);
  notes.unshift({ msg, ts: new Date().toISOString() });
  await setJSON('adminNotes', notes.slice(0, 50));
}

// ---------- slot reservations (see reserve-slot.js) ----------
export async function releaseSlot(b) {
  if (!b || !b.startUTC || !b.lockId) return;
  const startMs = Date.parse(b.startUTC), dur = b.durationMin || 60;
  const first = Math.floor(startMs / 60000 / 15) * 15, end = Math.ceil((startMs / 60000 + dur) / 15) * 15;
  const keys = [];
  for (let m = first; m < end; m += 15) keys.push(`rs:lock:${b.practitionerId}:${m}`);
  const cur = await redis(['MGET', ...keys]);
  const mine = keys.filter((k, i) => cur[i] === b.lockId);
  if (mine.length) await redis(['DEL', ...mine]);
}

// ---------- email (EmailJS, sent from the server) ----------
// Needs EMAILJS_PRIVATE_KEY and EMAILJS_RESET_TEMPLATE_ID set in Vercel, and
// "Allow EmailJS API for non-browser applications" turned on in EmailJS.
export async function sendEmail(templateId, params) {
  const key = process.env.EMAILJS_PRIVATE_KEY;
  if (!key || !templateId) return false;
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID || 'service_bl7o2cm',
      template_id: templateId,
      user_id: process.env.EMAILJS_PUBLIC_KEY || '2iDmkgKIVLziQiw1Y',
      accessToken: key,
      template_params: params
    })
  });
  return r.ok;
}

export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `https://${host}` : 'https://realholisticnetwork.com';
}

export function str(v, max = 2000) { return String(v == null ? '' : v).trim().slice(0, max); }
export const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|us|biz|info|me|site|online|shop|store)\b)/i;

// ---------- Learn section content (journals, teachings, resources) ----------
export const loadContent = () => getJSON('content', { journals: [], teachings: [], resources: [], products: [] });

// ---------- Community events posted by healers (approved by the admin) ----------
export const loadEvents = () => getJSON('events', []);
export const saveEvents = E => setJSON('events', E);
export function todayET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
// What anyone may see: never the sign-up list (names / emails).
export function publicEvent(e) {
  const taken = (e.rsvps || []).reduce((n, r) => n + (r.guests || 1), 0);
  return {
    id: e.id, healerId: e.healerId, healerName: e.healerName, healerAvatar: e.healerAvatar || '',
    title: e.title, date: e.date, start: e.start, end: e.end || '', location: e.location, description: e.description,
    spots: e.spots || 0, spotsLeft: e.spots ? Math.max(0, e.spots - taken) : null, going: taken
  };
}
// Checks and cleans an event a healer submits. Returns { error } or { event }.
export function cleanEvent(it) {
  const ev = {
    title: str(it.title, 120), date: str(it.date, 10), start: str(it.start, 5), end: str(it.end, 5),
    location: str(it.location, 200), description: str(it.description, 3000),
    spots: Math.max(0, Math.min(10000, parseInt(it.spots, 10) || 0))
  };
  if (!ev.title || !ev.date || !ev.start || !ev.location) return { error: 'Please fill in the title, date, start time and where it is' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date) || !/^\d\d:\d\d$/.test(ev.start) || (ev.end && !/^\d\d:\d\d$/.test(ev.end))) return { error: 'Please check the date and times' };
  if (ev.end && ev.end <= ev.start) return { error: 'The end time must be after the start time' };
  const today = todayET();
  if (ev.date < today) return { error: 'That date has already passed' };
  const max = new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10);
  if (ev.date > max) return { error: 'Events can be posted up to one year ahead' };
  if ([ev.title, ev.location, ev.description].some(f => LINK_RE.test(f))) return { error: "Please remove website links. People sign up right here on REAL Holistic Network, and you'll see who's coming in your dashboard." };
  return { event: ev };
}

// ---------- Healer photos (small JPEGs kept in the database) ----------
export function cleanPhoto(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { error: 'Please choose a photo (JPG or PNG)' };
  if (m[1].length > 400000) return { error: 'That photo is too large. Please try a smaller one.' };
  return { data: m[1] };
}
export async function savePhoto(id, data) { await redis(['SET', 'rs:photo:' + id, data]); }

// ---------- Client reviews (only from real, confirmed bookings) ----------
export const loadReviews = () => getJSON('reviews', []);
export const saveReviews = R => setJSON('reviews', R);
export function reviewStats(R, healerId) {
  const mine = R.filter(r => r.healerId === healerId && !r.hidden);
  const count = mine.length;
  const avg = count ? Math.round((mine.reduce((n, r) => n + r.stars, 0) / count) * 10) / 10 : null;
  const recent = mine.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6)
    .map(r => ({ name: r.name, stars: r.stars, text: r.text, date: r.createdAt.slice(0, 10) }));
  return { rating: avg, reviewCount: count, recentReviews: recent };
}

// ---------- Shareable healer links: realholisticnetwork.com/h/tricia-4821 ----------
export function healerSlug(p) {
  const base = String(p.name || 'healer').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'healer';
  return base + '-' + String(p.id).slice(-4);
}
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Emails to clients and healers (one general EmailJS template) ----------
// Template fields: {{to_email}} {{to_name}} {{subject}} {{message}}
export async function sendNotice(toEmail, toName, subject, message) {
  const tpl = process.env.EMAILJS_NOTICE_TEMPLATE_ID;
  if (!tpl || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(toEmail || ''))) return false;
  try { return await sendEmail(tpl, { to_email: toEmail, email: toEmail, to_name: toName || '', name: toName || '', subject, message }); }
  catch (e) { return false; }
}
// "Tuesday, October 14 at 6:30 PM (Eastern time)" from a booking
export function sessionWhen(b) {
  if (b.startUTC) {
    const tz = b.healerTz || 'America/New_York';
    const d = new Date(b.startUTC);
    const day = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    const zone = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific' }[tz] || tz.replace(/_/g, ' ');
    return `${day} at ${time} (${zone} time)`;
  }
  const day = b.date ? new Date(b.date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }) : 'your chosen date';
  if (!b.time) return day;
  const [h, m] = b.time.split(':').map(Number);
  return `${day} at ${((h % 12) || 12)}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
