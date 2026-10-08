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
    rating: p.rating, reviews: p.reviews, available: !!p.available,
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
export const loadContent = () => getJSON('content', { journals: [], teachings: [], resources: [] });
