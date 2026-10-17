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
    instruments: p.instruments || [], venueTypes: p.venueTypes || [], modalities: normalizeServices(p.modalities),
    rate: p.rate, sessionTypes: (p.sessionTypes || []).map(tierView), calendlyUrl: p.calendlyUrl || '',
    available: !!p.available,
    // questions the healer asks new clients when they book (never the video link)
    intakeQuestions: Array.isArray(p.intakeQuestions) ? p.intakeQuestions : [],
    photo: p.photoV ? '/api/photo?id=' + encodeURIComponent(p.id) + '&v=' + p.photoV : '',
    availability: p.availability || null,
    // Stripe account id (not secret: the card form needs it to pay the healer directly)
    payAcct: payAccount(p) || '',
    // only the busy times, never the healer's private notes
    schedule: (p.schedule || []).map(s => ({ date: s.date, time: s.time || '', end: s.end || '' }))
  };
}
// What the signed-in healer sees about themselves (everything but the hash).
export function selfHealer(p) {
  const { pwHash, ...rest } = p;
  rest.payStatus = Object.assign({ mode: stripeMode() }, connectOf(p) || {});
  rest.modalities = normalizeServices(p.modalities);
  rest.sessionTypes = (p.sessionTypes || []).map(tierView);
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
  // the break after a session was reserved too
  const startMs = Date.parse(b.startUTC), dur = (b.durationMin || 60) + (b.bufferMin || 0);
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
    spots: e.spots || 0, spotsLeft: e.spots ? Math.max(0, e.spots - taken) : null, going: taken,
    kind: e.kind || '', paid: !!e.paid, signupUrl: e.kind === 'partner' ? (e.signupUrl || '') : ''
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
// EmailJS's free plan allows only 2 templates, so every email to a client or
// healer goes through ONE template (the "Password Reset" one) that just shows
// {{subject}} and {{{message_html}}}.
export const NOTICE_TEMPLATE = () => process.env.EMAILJS_NOTICE_TEMPLATE_ID || process.env.EMAILJS_RESET_TEMPLATE_ID || 'template_jeavpos';
export function textToHtml(t) {
  return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#6B4699">$1</a>').replace(/\n/g, '<br>');
}
export async function sendNotice(toEmail, toName, subject, message, html) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(toEmail || ''))) return false;
  try {
    return await sendEmail(NOTICE_TEMPLATE(), { to_email: toEmail, email: toEmail, to_name: toName || '', name: toName || '', subject, message, message_html: html || textToHtml(message) });
  } catch (e) { return false; }
}
// ---------- Alerts to the owner (new healer, booking, subscriber, etc.) ----------
// Logs it in the admin "Recent Activity" feed AND emails the owner from the
// server, using the same template as password resets (so it works reliably).
export const OWNER_EMAIL = () => process.env.ALERT_EMAIL || 'bookings.realsound@gmail.com';
export async function alertOwner(summary, details) {
  await logNote(summary);
  const lines = [summary, ''].concat((details || []).filter(Boolean)).concat(['', 'See everything in your admin panel: https://realholisticnetwork.com']);
  return sendNotice(OWNER_EMAIL(), 'Suzzanna', 'REAL Holistic Network: ' + summary.replace(/^\W+\s*/, ''), lines.join('\n'));
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

// ---------- Stripe Connect (healers get paid straight to their own bank) ----------
// Test ("sandbox") and live accounts are kept apart, so trying things out in
// the sandbox can never mix with real money.
export const stripeMode = () => (String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test') ? 'test' : 'live');
export const connectOf = p => ((p && p.connect) || {})[stripeMode()] || null;
// The healer's Stripe account, only once Stripe says it can take card payments.
export const payAccount = p => { const c = connectOf(p); return c && c.id && c.charges ? c.id : null; };
export const PLATFORM_PCT = 15;
export const platformFeeCents = (dollars, pct = PLATFORM_PCT) => Math.round(Math.round(dollars * 100) * pct / 100);

// ---------- "Bring your own clients" (healer referral links) ----------
// A client who first comes to a healer through that healer's own link
// (realholisticnetwork.com/h/<name>) and books them is "the healer's client".
// For 12 months from that client's first booking with the healer, REAL
// Holistic Network keeps 10% instead of 15% on that client's bookings with
// that healer. Bookings with any OTHER healer are always the normal 15%.
// Launch offer: only for healers who join on or before REFERRAL_JOIN_BY.
export const REFERRAL_PCT = 10;
export const REFERRAL_MONTHS = 12;
export const REFERRAL_JOIN_BY = () => process.env.REFERRAL_JOIN_BY || '2027-10-15';
const refKey = (healerId, email) => 'refclient:' + healerId + ':' + crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex').slice(0, 32);
export function referralEligible(p) {
  return !!p && (!p.joinedAt || String(p.joinedAt).slice(0, 10) <= REFERRAL_JOIN_BY());
}
// Works out RHN's commission for this client + healer. Returns
// { pct, referral, claim } — claim is the saved record (or a new one to save).
export async function bookingPct(p, email, refHealerId, bookings) {
  const plain = { pct: PLATFORM_PCT, referral: false, claim: null };
  const e = String(email || '').trim().toLowerCase();
  if (!p || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return plain;
  const saved = await getJSON(refKey(p.id, e), null);
  if (saved) return saved.until > new Date().toISOString() ? { pct: REFERRAL_PCT, referral: true, claim: saved } : plain;
  if (refHealerId !== p.id || !referralEligible(p)) return plain;
  // If this client already booked this healer before WITHOUT the healer's
  // link, REAL Holistic Network found them first, so the normal 15% stays.
  const B = bookings || await loadBookings();
  if (B.some(b => b.practitionerId === p.id && String(b.email || '').trim().toLowerCase() === e && b.status !== 'declined')) return plain;
  const now = new Date(), until = new Date(now); until.setMonth(until.getMonth() + REFERRAL_MONTHS);
  return { pct: REFERRAL_PCT, referral: true, claim: { since: now.toISOString(), until: until.toISOString(), isNew: true } };
}
// Called once the booking is saved: starts the client's 12 months (first booking only).
export async function saveReferralClaim(p, email, claim, bookingId) {
  if (!claim || !claim.isNew) return;
  const key = 'rs:' + refKey(p.id, email);
  // NX: never overwrite an existing claim (keeps the ORIGINAL 12-month window)
  await redis(['SET', key, JSON.stringify({ since: claim.since, until: claim.until, firstBooking: bookingId }), 'NX']);
}

// ---------- Healing services a healer offers (shown on their profile and used by search) ----------
// One official list, so search never shows the same service three different ways.
// Anything a healer typed that clearly means one of these is matched to it.
// Massage therapy is never offered on REAL Holistic Network (it needs a state license).
export const DEFAULT_SERVICES = ['Sound Bath & Gong Bath', 'Reiki & Crystal Healing', 'Breathwork', 'Meditation', 'Art Therapy', 'Herbalist', 'Life Coach', 'Astrology & Birth Charts', 'Tarot'];
// The live list is kept in the database so the owner can add services from the admin page.
let SERVICES = DEFAULT_SERVICES.slice();
export const currentServices = () => SERVICES;
export async function loadServices() {
  const list = await getJSON('services', null);
  SERVICES = Array.isArray(list) && list.length ? list : DEFAULT_SERVICES.slice();
  return SERVICES;
}
export function cleanServiceName(m) {
  const t = str(m, 50).replace(/\s+/g, ' ');
  if (!t) return { error: 'Please type a service name' };
  if (!/^[A-Za-z0-9 &,\/().+-]+$/.test(t)) return { error: 'Please use only letters, numbers, spaces and & , / ( ) - in the name' };
  if (LINK_RE.test(t)) return { error: "Service names can't include website links" };
  if (/massage/i.test(t)) return { error: 'Massage therapy is not offered on REAL Holistic Network' };
  return { name: t };
}
const SERVICE_MATCH = [
  [/astrolog|birth\s*chart|natal/i, 'Astrology & Birth Charts'],
  [/tarot|oracle card/i, 'Tarot'],
  [/reiki|crystal/i, 'Reiki & Crystal Healing'],
  [/sound|gong|singing bowl/i, 'Sound Bath & Gong Bath'],
  [/breath/i, 'Breathwork'],
  [/meditat/i, 'Meditation'],
  [/art\s*therap/i, 'Art Therapy'],
  [/herb/i, 'Herbalist'],
  [/coach/i, 'Life Coach']
];
export function officialService(m) {
  const t = str(m, 80);
  const exact = SERVICES.find(x => x.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const hit = SERVICE_MATCH.find(([re, name]) => re.test(t) && SERVICES.includes(name));
  return hit ? hit[1] : t;
}
export function normalizeServices(list) {
  const out = [];
  // only services on the owner's official list are shown or searchable
  for (const m of (Array.isArray(list) ? list : [])) { const o = officialService(m); if (o && SERVICES.includes(o) && !out.includes(o)) out.push(o); }
  return out;
}
export function cleanServices(list) {
  const raw = (Array.isArray(list) ? list : []).slice(0, 20).map(x => str(x, 60).replace(/\s+/g, ' ')).filter(Boolean);
  for (const m of raw) {
    if (LINK_RE.test(m)) return { error: "Healing services can't include website links" };
    if (/massage/i.test(m)) return { error: 'Massage therapy is not offered on REAL Holistic Network' };
  }
  return { list: normalizeServices(raw).slice(0, 15) };
}

// A session type is tied to one official healing service, plus optional details (like "30 min").
// Older sessions only had a typed name: we work out their service from it where we can.
export function tierView(t) {
  let service = t.service && SERVICES.includes(t.service) ? t.service : '';
  if (!service) { const g = officialService(t.name || ''); if (SERVICES.includes(g)) service = g; }
  let details = t.service ? (t.details || '') : (t.name === service ? '' : (t.name || ''));
  if (!t.service && service && details) {
    // "30 min Reiki" -> "30 min", "Tarot Reading" -> "" (the service already says it)
    const m = SERVICE_MATCH.find(([re, name]) => name === service);
    if (m) details = details.replace(new RegExp(m[0].source + '\\w*', 'ig'), ' ').replace(/\b(reading|session)s?\b/ig, ' ').replace(/[\s·,&-]+/g, ' ').trim();
  }
  return { id: t.id, name: t.name, price: t.price, service, details, online: !!t.online };
}
export function tierName(service, details) { return details ? `${service} · ${details}` : service; }
