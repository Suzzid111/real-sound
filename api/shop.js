// api/shop.js — Shop Partner accounts (metaphysical / holistic shops).
// A shop signs up with its business details, confirms its email from a link
// we send, and then waits for the owner (Sue) to approve the account.
// Approved shops can send events for the calendar (every event is approved
// by the owner too) and ask for changes to their listing (the owner makes
// them). Shops can NOT change their own listing.
//
// Stored in the database under "shops" (password hashes only, never plain text).
import {
  redis, hashPassword, checkPassword, createSession, getSession, endSession,
  tooManyTries, clientIp, alertOwner, logNote, newToken, sendNotice, siteUrl, str, esc, LINK_RE,
  loadEvents, saveEvents, cleanEvent, todayET, loadShops, saveShops
} from './_lib.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONFIRM_SECONDS = 60 * 60 * 48; // confirm links work for 2 days
const RESET_SECONDS = 60 * 60;        // reset links work for 1 hour

const byEmail = (S, e) => S.find(x => x.email === String(e || '').trim().toLowerCase());

// What the signed-in shop may see about itself.
function selfShop(x) {
  const { pwHash, ...rest } = x;
  return rest;
}
const httpsUrl = u => /^https:\/\/[^\s]+\.[^\s]+$/i.test(u);

export default async function handler(req, res) {
  try {
    // Email confirmation link: GET /api/shop?confirm=<token>
    if (req.method === 'GET') return await confirm(req, res);
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const b = req.body || {};
    switch (b.action) {
      case 'register': return await register(req, res, b);
      case 'login': return await login(req, res, b);
      case 'forgot': return await forgot(req, res, b);
      case 'reset': return await reset(req, res, b);
      case 'resend': return await resend(req, res, b);
      case 'logout': { const s = await getSession(req); if (s) await endSession(s.token); return res.json({ ok: true }); }
    }
    // everything below needs a signed-in shop
    const s = await getSession(req);
    if (!s || s.role !== 'shop') return res.status(401).json({ ok: false, error: 'Please log in again.', relogin: true });
    const S = await loadShops();
    const shop = S.find(x => x.id === s.id);
    if (!shop) return res.status(401).json({ ok: false, error: 'Account not found', relogin: true });

    if (b.action === 'eventSave') {
      if (shop.status !== 'approved') return res.json({ ok: false, error: 'Your account is waiting for approval. You can add events once it is approved.' });
      const raw = b.event || {};
      const c = cleanEvent(raw);
      if (c.error) return res.json({ ok: false, error: c.error.replace(" People sign up right here on REAL Holistic Network, and you'll see who's coming in your dashboard.", ' Put links in the link boxes below instead.') });
      const paid = raw.paid === true;
      const price = str(raw.price, 40), ticketUrl = str(raw.ticketUrl, 500), proofUrl = str(raw.proofUrl, 500);
      if (!proofUrl) return res.json({ ok: false, error: 'Please add a link to this event on your Facebook, Instagram, Eventbrite or website' });
      if (!httpsUrl(proofUrl)) return res.json({ ok: false, error: 'The event link must be a full web address starting with https://' });
      if (paid) {
        if (!price) return res.json({ ok: false, error: 'Please add the price' });
        if (!ticketUrl) return res.json({ ok: false, error: 'Please add the link where people buy tickets or pay' });
        if (!httpsUrl(ticketUrl)) return res.json({ ok: false, error: 'The ticket link must be a full web address starting with https://' });
      }
      if (LINK_RE.test(price)) return res.json({ ok: false, error: 'Please type just the price, like $25' });
      const E = await loadEvents();
      const id = str(raw.id, 40);
      const old = id ? E.find(x => x.id === id && x.shopId === shop.id) : null;
      if (id && !old) return res.json({ ok: false, error: 'Event not found' });
      if (!old && E.filter(x => x.shopId === shop.id && x.date >= todayET()).length >= 30) return res.json({ ok: false, error: 'You can have up to 30 upcoming events at a time' });
      const now = new Date().toISOString();
      const ev = Object.assign(old || { id: 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), healerId: '', healerAvatar: '', rsvps: [], createdAt: now, shopId: shop.id },
        c.event, {
          healerName: shop.name, kind: 'partner', paid, price: paid ? price : '', proofUrl,
          // the button people tap on the calendar: tickets for paid events, the event page for free ones
          signupUrl: paid ? ticketUrl : proofUrl, ticketUrl: paid ? ticketUrl : '',
          status: 'pending', declineReason: '', updatedAt: now
        });
      if (!old) E.push(ev);
      await saveEvents(E);
      await alertOwner(`🏪 Shop event waiting for your approval: "${ev.title}" by ${shop.name} (${ev.date})`, [`${paid ? 'PAID: ' + price : 'FREE'}`, `Check it's real: ${proofUrl}`, 'Approve or decline it in your admin panel.']);
    } else if (b.action === 'eventDelete') {
      const E = await loadEvents();
      const ev = E.find(x => x.id === str(b.id, 40) && x.shopId === shop.id);
      if (!ev) return res.json({ ok: false, error: 'Event not found' });
      await saveEvents(E.filter(x => x !== ev));
      await logNote(`🗑 ${shop.name} removed their event "${ev.title}"`);
    } else if (b.action === 'changeRequest') {
      const msg = str(b.message, 1500);
      if (msg.length < 5) return res.json({ ok: false, error: 'Please tell us what should change' });
      if (await tooManyTries('shopreq:' + shop.id, 10)) return res.json({ ok: false, error: 'Too many requests today. Please try again later.' });
      shop.requests = (shop.requests || []).concat({ id: 'r' + Date.now().toString(36), message: msg, status: 'new', at: new Date().toISOString() }).slice(-30);
      await saveShops(S);
      await alertOwner(`🏪 ${shop.name} asked for a listing change`, [msg, '', `Shop email: ${shop.email}`]);
    } else if (b.action === 'newsletter') {
      shop.newsletter = !!b.on;
      await saveShops(S);
    } else if (b.action !== 'me') {
      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }
    return res.json(await meResponse(shop));
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}

async function meResponse(shop) {
  const S = await loadShops();
  const fresh = S.find(x => x.id === shop.id) || shop;
  const E = await loadEvents();
  return { ok: true, shop: selfShop(fresh), events: E.filter(e => e.shopId === fresh.id).map(e => { const { rsvps, ...r } = e; return r; }) };
}

async function sendConfirm(req, shop) {
  const token = newToken();
  await redis(['SET', 'rs:shopconfirm:' + token, shop.id, 'EX', CONFIRM_SECONDS]);
  const link = `${siteUrl(req)}/api/shop?confirm=${token}`;
  const html = `<p style="font-size:18px;margin:0 0 16px">Hi ${esc(shop.contact || shop.name)},</p><p style="margin:0 0 18px">Thank you for signing up <strong>${esc(shop.name)}</strong> as a REAL Holistic Network Shop Partner! Please confirm your email by clicking the button below.</p><p style="text-align:center;margin:0 0 22px"><a href="${esc(link)}" style="background:#C9922A;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold;display:inline-block">Confirm My Email</a></p><p style="font-size:13px;color:#7A6E8A;margin:0 0 12px">This link works for 2 days. If the button doesn't work, copy this link into your browser:<br><a href="${esc(link)}" style="color:#6B4699;word-break:break-all">${esc(link)}</a></p><p style="font-size:13px;color:#7A6E8A;margin:0">If you didn't sign up, you can ignore this email.</p>`;
  return sendNotice(shop.email, shop.contact || shop.name, 'Please confirm your REAL Holistic Network Shop Partner account',
    `Hi ${shop.contact || shop.name}, please confirm your email for your REAL Holistic Network Shop Partner account: ${link} (works for 2 days). If you didn't sign up, you can ignore this email.`, html);
}

async function register(req, res, b) {
  if (await tooManyTries('shopsignup:' + clientIp(req), 6))
    return res.status(429).json({ ok: false, error: 'Too many sign-ups from this connection. Please try again later.' });
  const f = {
    name: str(b.name, 120), contact: str(b.contact, 80), address: str(b.address, 200), town: str(b.town, 80),
    state: str(b.state, 2).toUpperCase(), zip: str(b.zip, 10), phone: str(b.phone, 40),
    website: str(b.website, 300), email: str(b.email, 200).toLowerCase()
  };
  const password = String(b.password || '');
  if (!f.name || !f.address || !f.town || !f.state || !f.email) return res.json({ ok: false, error: 'Please fill in your shop name, street address, town, state and email' });
  if (!/^[A-Z]{2}$/.test(f.state)) return res.json({ ok: false, error: 'Please use the 2-letter state, like RI' });
  if (f.zip && !/^\d{5}$/.test(f.zip)) return res.json({ ok: false, error: 'Please enter a 5-digit ZIP code' });
  if (!EMAIL_RE.test(f.email)) return res.json({ ok: false, error: 'Please enter a valid email' });
  if (password.length < 8) return res.json({ ok: false, error: 'Password must be at least 8 characters' });
  if ([f.name, f.contact, f.address, f.town].some(x => LINK_RE.test(x))) return res.json({ ok: false, error: 'Please remove website links (put your website in the website box)' });
  if (f.website && !/^(https?:\/\/)?[^\s]+\.[^\s]+$/i.test(f.website)) return res.json({ ok: false, error: 'Please check your website or Facebook link' });
  if (!b.agree) return res.json({ ok: false, error: 'Please agree to the Shop Partner terms' });
  const S = await loadShops();
  const old = byEmail(S, f.email);
  if (old && old.emailVerified) return res.json({ ok: false, error: 'That email already has a Shop Partner account. Please log in instead.' });
  const now = new Date().toISOString();
  let shop;
  if (old) { Object.assign(old, f, { pwHash: hashPassword(password), newsletter: !!b.newsletter, updatedAt: now }); shop = old; }
  else {
    shop = Object.assign({ id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }, f, {
      pwHash: hashPassword(password), newsletter: !!b.newsletter, emailVerified: false, status: 'unconfirmed',
      requests: [], createdAt: now, termsAcceptedAt: now
    });
    S.push(shop);
  }
  await saveShops(S);
  const sent = await sendConfirm(req, shop);
  await logNote(`🏪 New Shop Partner sign-up (email not confirmed yet): ${shop.name}, ${shop.town} ${shop.state}${sent ? '' : ' — ⚠️ confirm email could not be sent'}`);
  return res.json({ ok: true, sent, email: shop.email });
}

async function resend(req, res, b) {
  const e = str(b.email, 200).toLowerCase();
  if (await tooManyTries('shopresend:' + e, 3) || await tooManyTries('shopresendip:' + clientIp(req), 10)) return res.json({ ok: true });
  const S = await loadShops();
  const shop = byEmail(S, e);
  if (shop && !shop.emailVerified) await sendConfirm(req, shop);
  return res.json({ ok: true });
}

async function confirm(req, res) {
  const t = String((req.query || {}).confirm || '');
  let shop = null;
  if (/^[a-f0-9]{48}$/.test(t)) {
    const id = await redis(['GET', 'rs:shopconfirm:' + t]);
    if (id) {
      const S = await loadShops();
      shop = S.find(x => x.id === id) || null;
      if (shop && !shop.emailVerified) {
        shop.emailVerified = true;
        shop.confirmedAt = new Date().toISOString();
        if (shop.status === 'unconfirmed') shop.status = 'pending';
        await saveShops(S);
        await alertOwner(`🏪 Shop Partner waiting for your approval: ${shop.name} (${shop.town}, ${shop.state})`, [
          `Shop: ${shop.name}`, `Contact: ${shop.contact || '—'}`, `Address: ${shop.address}, ${shop.town}, ${shop.state} ${shop.zip}`,
          `Email (confirmed): ${shop.email}`, `Phone: ${shop.phone || '—'}`, `Website/Facebook: ${shop.website || '—'}`,
          `Shop newsletter: ${shop.newsletter ? 'yes' : 'no'}`, '', 'Approve or decline it in your admin panel (Shop Partners).'
        ]);
      }
      await redis(['DEL', 'rs:shopconfirm:' + t]);
    }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const body = shop
    ? `<h2 style="font-weight:normal">Thank you, your email is confirmed! 🌿</h2><p style="color:#7A6E8A;line-height:1.7;max-width:460px;margin:0 auto 20px">Your Shop Partner account for <strong>${esc(shop.name)}</strong> is now waiting for approval. We review every shop to keep REAL Holistic Network safe, usually within a day or two. You'll be able to add events as soon as it's approved.</p><p><a href="/shop-partner" style="background:#6B4699;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">Go to Shop Partner login</a></p>`
    : `<h2 style="font-weight:normal">This link has expired or was already used.</h2><p style="color:#7A6E8A;line-height:1.7">If you already confirmed, just log in. Otherwise, log in and we'll send you a new link.</p><p><a href="/shop-partner" style="color:#6B4699">Go to Shop Partner login</a></p>`;
  return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shop Partner · REAL Holistic Network</title><body style="font-family:Georgia,serif;background:#F6F1FB;color:#2A1F3D;text-align:center;padding:60px 20px"><div style="color:#C9922A;letter-spacing:.12em;font-size:13px;margin-bottom:24px">◉ REAL HOLISTIC NETWORK</div>${body}</body>`);
}

async function login(req, res, { email, password }) {
  const e = str(email, 200).toLowerCase();
  if (await tooManyTries('shoplogin:' + e, 10) || await tooManyTries('shoploginip:' + clientIp(req), 30))
    return res.status(429).json({ ok: false, error: 'Too many tries. Please wait 15 minutes and try again.' });
  const S = await loadShops();
  const shop = byEmail(S, e);
  if (!shop || !checkPassword(password, shop.pwHash)) return res.json({ ok: false, error: 'Email or password not recognised.' });
  if (!shop.emailVerified) return res.json({ ok: false, unconfirmed: true, error: "Please confirm your email first. Check your inbox (and spam folder) for our email, or tap \"Send it again\"." });
  if (shop.status === 'declined') return res.json({ ok: false, error: 'This Shop Partner account was not approved. Questions? Email bookings.realsound@gmail.com' });
  await redis(['DEL', 'rs:rl:shoplogin:' + e]);
  const token = await createSession({ role: 'shop', id: shop.id });
  return res.json(Object.assign(await meResponse(shop), { token }));
}

async function forgot(req, res, { email }) {
  const e = str(email, 200).toLowerCase();
  const generic = { ok: true, message: "If that email has a Shop Partner account, we've sent a link to reset the password. Please check your inbox (and spam folder)." };
  if (!EMAIL_RE.test(e)) return res.json({ ok: false, error: 'Please enter a valid email' });
  if (await tooManyTries('shopforgot:' + e, 3) || await tooManyTries('shopforgotip:' + clientIp(req), 10)) return res.json(generic);
  const S = await loadShops();
  const shop = byEmail(S, e);
  if (!shop || !shop.emailVerified) return res.json(generic);
  const token = newToken();
  await redis(['SET', 'rs:shopreset:' + token, shop.id, 'EX', RESET_SECONDS]);
  const link = `${siteUrl(req)}/shop-partner?reset=${token}`;
  const html = `<p style="font-size:18px;margin:0 0 16px">Hi ${esc(shop.contact || shop.name)},</p><p style="margin:0 0 22px">We received a request to reset the password for your REAL Holistic Network Shop Partner account. Click below to choose a new one.</p><p style="text-align:center;margin:0 0 22px"><a href="${esc(link)}" style="background:#C9922A;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold;display:inline-block">Choose a New Password</a></p><p style="font-size:13px;color:#7A6E8A;margin:0">This link works for 1 hour. If you didn't ask for this, you can ignore this email.</p>`;
  await sendNotice(shop.email, shop.contact || shop.name, 'Reset your Shop Partner password', `Choose a new password for your REAL Holistic Network Shop Partner account: ${link} (works for 1 hour).`, html);
  return res.json(generic);
}

async function reset(req, res, { token, password }) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return res.json({ ok: false, error: 'This reset link is not valid. Please request a new one.' });
  if (String(password || '').length < 8) return res.json({ ok: false, error: 'Password must be at least 8 characters' });
  const id = await redis(['GET', 'rs:shopreset:' + token]);
  if (!id) return res.json({ ok: false, error: 'This reset link has expired or was already used. Please request a new one.' });
  const S = await loadShops();
  const shop = S.find(x => x.id === id);
  if (!shop) return res.json({ ok: false, error: 'Account not found.' });
  shop.pwHash = hashPassword(password);
  await saveShops(S);
  await redis(['DEL', 'rs:shopreset:' + token]);
  await logNote(`🔑 Shop Partner ${shop.name} reset their password`);
  if (shop.status === 'declined') return res.json({ ok: false, error: 'Password changed, but this account was not approved.' });
  const session = await createSession({ role: 'shop', id: shop.id });
  return res.json(Object.assign(await meResponse(shop), { token: session }));
}
