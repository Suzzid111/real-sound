// api/gift.js — buying and checking gift certificates.
//
//   POST {action:"buy", amount, qty, buyerName, buyerEmail, delivery, recipientName, recipientEmail, message}
//        → starts a card payment to REAL Holistic Network
//   POST {action:"complete", paymentIntentId}   → payment went through: make the codes and email them
//   POST {action:"check", code}                  → how much is left on a code
//   GET  ?view=RHN-XXXX-XXXX                      → the certificate as a page to print or save
//
// See _gifts.js for how the money moves when a code is used for a booking.
import { getJSON, setJSON, redis, str, esc, tooManyTries, clientIp, alertOwner, sendNotice, siteUrl, stripeMode } from './_lib.js';
import { stripe } from './_bookings.js';
import { GIFT_AMOUNTS, MAX_GIFT_QTY, newGiftCode, normGiftCode, loadGift, saveGift, giftView, loadGiftIndex, saveGiftIndex } from './_gifts.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await view(req, res);
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const body = req.body || {};
    if (body.action === 'buy') return await buy(req, res, body);
    if (body.action === 'complete') return await complete(req, res, body);
    if (body.action === 'check') return await check(req, res, body);
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Something went wrong: ' + (err && err.message ? err.message : 'please try again.') });
  }
}

async function buy(req, res, b) {
  if (await tooManyTries('giftbuy:' + clientIp(req), 20)) return res.status(429).json({ ok: false, error: 'Too many tries. Please wait a few minutes.' });
  const amount = parseInt(b.amount, 10), qty = parseInt(b.qty, 10) || 1;
  if (!GIFT_AMOUNTS.includes(amount)) return res.json({ ok: false, error: 'Please choose an amount' });
  if (qty < 1 || qty > MAX_GIFT_QTY) return res.json({ ok: false, error: `You can buy 1 to ${MAX_GIFT_QTY} at a time` });
  const o = {
    amount, qty,
    buyerName: str(b.buyerName, 80), buyerEmail: str(b.buyerEmail, 200).toLowerCase(),
    delivery: b.delivery === 'email' ? 'email' : 'print',
    recipientName: str(b.recipientName, 80), recipientEmail: str(b.recipientEmail, 200).toLowerCase(),
    message: str(b.message, 300)
  };
  if (!o.buyerName) return res.json({ ok: false, error: 'Please enter your name' });
  if (!EMAIL_RE.test(o.buyerEmail)) return res.json({ ok: false, error: 'Please enter your email so we can send your receipt' });
  if (!o.recipientName) return res.json({ ok: false, error: "Please enter the name of the person you're giving it to" });
  if (o.delivery === 'email' && !EMAIL_RE.test(o.recipientEmail)) return res.json({ ok: false, error: "Please enter their email, or choose \"I'll print it\"" });
  if (o.delivery !== 'email') o.recipientEmail = '';
  const pi = await stripe().paymentIntents.create({
    amount: amount * qty * 100, currency: 'usd', receipt_email: o.buyerEmail,
    description: `REAL Holistic Network gift certificate${qty > 1 ? 's' : ''}: ${qty} × $${amount}`,
    metadata: { kind: 'gift', amount: String(amount), qty: String(qty), buyerEmail: o.buyerEmail }
  });
  await redis(['SET', 'rs:giftorder:' + pi.id, JSON.stringify(o), 'EX', 60 * 60 * 24 * 7]);
  return res.json({ ok: true, clientSecret: pi.client_secret, paymentIntentId: pi.id, total: amount * qty });
}

async function complete(req, res, { paymentIntentId }) {
  const id = str(paymentIntentId, 100);
  if (!/^pi_[A-Za-z0-9]+$/.test(id)) return res.json({ ok: false, error: 'Missing payment' });
  const site = siteUrl(req);
  const answer = d => res.json({ ok: true, delivery: d.delivery, recipientEmail: d.recipientEmail, buyerEmail: d.buyerEmail,
    certificates: d.codes.map(code => ({ code, amount: d.amount, viewUrl: `${site}/api/gift?view=${code}` })) });

  const done = await getJSON('giftdone:' + id, null);
  if (done) return answer(done);
  // Only one request may make the codes for a payment.
  const mine = await redis(['SET', 'rs:giftmaking:' + id, '1', 'NX', 'EX', 60]);
  if (!mine) return res.json({ ok: false, error: 'Still preparing your gift certificate. Please wait a moment and try again.' });

  const pi = await stripe().paymentIntents.retrieve(id);
  if (pi.status !== 'succeeded' || !pi.metadata || pi.metadata.kind !== 'gift') {
    await redis(['DEL', 'rs:giftmaking:' + id]);
    return res.json({ ok: false, error: 'Payment not completed' });
  }
  const raw = await redis(['GET', 'rs:giftorder:' + id]);
  const o = raw ? JSON.parse(raw) : { amount: parseInt(pi.metadata.amount, 10), qty: parseInt(pi.metadata.qty, 10) || 1, buyerEmail: pi.metadata.buyerEmail || pi.receipt_email || '', buyerName: '', delivery: 'print', recipientName: '', recipientEmail: '', message: '' };
  const now = new Date().toISOString();
  const codes = [];
  for (let i = 0; i < o.qty; i++) {
    let code;
    do { code = newGiftCode(); } while (await loadGift(code));
    await saveGift({
      code, amount: o.amount, balance: o.amount, active: true, mode: stripeMode(),
      paymentIntentId: id, chargeId: pi.latest_charge || null,
      buyerName: o.buyerName, buyerEmail: o.buyerEmail, recipientName: o.recipientName, recipientEmail: o.recipientEmail,
      message: o.message, delivery: o.delivery, createdAt: now, history: [{ type: 'bought', amount: o.amount, at: now }]
    });
    codes.push(code);
  }
  const record = Object.assign({}, o, { codes, paymentIntentId: id, createdAt: now });
  await setJSON('giftdone:' + id, record);
  const index = await loadGiftIndex();
  for (const code of codes) index.unshift({ code, amount: o.amount, buyerName: o.buyerName, buyerEmail: o.buyerEmail, recipientName: o.recipientName, createdAt: now, mode: stripeMode() });
  await saveGiftIndex(index);

  const list = codes.map(c => `${c} ($${o.amount}): ${site}/api/gift?view=${c}`).join('\n');
  // The person receiving it
  if (o.delivery === 'email' && o.recipientEmail) {
    await sendNotice(o.recipientEmail, o.recipientName, `${o.buyerName} sent you a REAL Holistic Network gift certificate 💜`,
      `Hi ${o.recipientName},\n\n${o.buyerName} sent you a gift of healing: ${codes.length > 1 ? codes.length + ' gift certificates' : 'a $' + o.amount + ' gift certificate'} for REAL Holistic Network.${o.message ? '\n\nTheir message: "' + o.message + '"' : ''}\n\nYour code${codes.length > 1 ? 's' : ''}:\n${list}\n\nUse it with any healer, for any session, at realholisticnetwork.com. Just type the code in when you book. Anything you don't use stays on the code for next time.\n\nWith gratitude,\nREAL Holistic Network`,
      giftEmailHtml(o, codes, site, true));
  }
  // The buyer's receipt
  await sendNotice(o.buyerEmail, o.buyerName, `Your REAL Holistic Network gift certificate${codes.length > 1 ? 's' : ''}`,
    `Thank you, ${o.buyerName}!\n\n${o.delivery === 'email' ? `We've emailed ${o.recipientName} at ${o.recipientEmail}. Here's a copy for you:` : `Here ${codes.length > 1 ? 'are your gift certificates' : 'is your gift certificate'} for ${o.recipientName}. Open the link to print it:`}\n\n${list}\n\nThe code is what matters: it works with any healer, for any session, at realholisticnetwork.com.\n\nWith gratitude,\nREAL Holistic Network`,
    giftEmailHtml(o, codes, site, false));
  await alertOwner(`🎁 Gift certificate sold: ${codes.length} × $${o.amount} ($${codes.length * o.amount})`, [`From: ${o.buyerName} (${o.buyerEmail})`, `For: ${o.recipientName}${o.recipientEmail ? ' (' + o.recipientEmail + ')' : ' (printing it)'}`, `Codes: ${codes.join(', ')}`]);
  return answer(record);
}

function giftEmailHtml(o, codes, site, forRecipient) {
  const intro = forRecipient
    ? `<p style="margin:0 0 14px">Hi ${esc(o.recipientName)},</p><p style="margin:0 0 16px"><strong>${esc(o.buyerName)}</strong> sent you a gift of healing for REAL Holistic Network.</p>`
    : `<p style="margin:0 0 14px">Thank you, ${esc(o.buyerName)}!</p><p style="margin:0 0 16px">${o.delivery === 'email' ? `We've emailed ${esc(o.recipientName)} at ${esc(o.recipientEmail)}. Here's a copy for you.` : `Here ${codes.length > 1 ? 'are your gift certificates' : 'is your gift certificate'} for ${esc(o.recipientName)}. Tap the button to open it and print it.`}</p>`;
  const msg = o.message ? `<p style="margin:0 0 16px;font-style:italic">"${esc(o.message)}"</p>` : '';
  const cards = codes.map(c => `<div style="border:2px solid #C9922A;border-radius:10px;padding:16px;margin:0 0 12px;background:#2A1342;color:#F6EEDC;text-align:center"><div style="font-size:12px;letter-spacing:3px;color:#E3C77A">GIFT CERTIFICATE · $${o.amount}</div><div style="font-size:22px;font-weight:bold;letter-spacing:3px;color:#E3C77A;margin:8px 0">${c}</div><a href="${site}/api/gift?view=${c}" style="background:#C9922A;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold;display:inline-block">Open &amp; print</a></div>`).join('');
  return `${intro}${msg}${cards}<p style="margin:12px 0 0;font-size:13px;color:#7A6E8A">Use it with any healer, for any session, at <a href="${site}" style="color:#6B4699">realholisticnetwork.com</a>. Just type the code in when you book. Anything not used stays on the code for next time.</p>`;
}

async function check(req, res, { code }) {
  if (await tooManyTries('giftcheck:' + clientIp(req), 30)) return res.status(429).json({ ok: false, error: 'Too many tries. Please wait a few minutes.' });
  const c = normGiftCode(code);
  if (!c) return res.json({ ok: false, error: "That doesn't look like a gift certificate code. Codes look like RHN-XXXX-XXXX." });
  const g = await loadGift(c);
  if (!g || g.mode !== stripeMode()) return res.json({ ok: false, error: "We couldn't find that gift certificate. Please check the code." });
  if (g.active === false) return res.json({ ok: false, error: "That gift certificate can't be used. Please write to bookings.realsound@gmail.com." });
  if (!(g.balance > 0)) return res.json({ ok: false, error: 'That gift certificate has already been used up.' });
  return res.json({ ok: true, gift: giftView(g) });
}

// The printable certificate (gold and purple, letter-size landscape friendly).
async function view(req, res) {
  const c = normGiftCode((req.query || {}).view);
  if (c && (await tooManyTries('giftview:' + clientIp(req), 60))) return res.status(429).send('Too many tries. Please wait a few minutes.');
  const g = c ? await loadGift(c) : null;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!g) return res.status(404).send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><p style="font-family:Georgia,serif;padding:24px">We couldn\'t find that gift certificate. Please check the link or write to bookings.realsound@gmail.com.</p>');
  const left = g.balance < g.amount ? `<div class="left">${g.balance > 0 ? `$${g.balance} left on this certificate` : 'This certificate has been used up'}</div>` : '';
  return res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gift Certificate · REAL Holistic Network</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500&family=Jost:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;background:#EFE8F6;font-family:Jost,Georgia,sans-serif;color:#F6EEDC;padding:20px 12px}
.cert{max-width:880px;margin:0 auto;background:#2A1342;padding:18px;border-radius:8px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.b1{border:2px solid #D4AF5A;border-radius:6px;padding:7px}
.b2{border:1px solid #D4AF5A;border-radius:3px;padding:28px clamp(18px,5vw,44px);display:flex;flex-direction:column;gap:22px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.brand{font-size:12px;letter-spacing:4px;text-transform:uppercase;color:#D4AF5A;font-weight:600}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-size:clamp(40px,8vw,64px);line-height:1;margin:6px 0 4px;color:#FBF4E4;font-weight:700}
.sub{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:21px;color:#D9C9EC}
.val{width:124px;height:124px;border-radius:62px;border:2px solid #D4AF5A;background:#3D1F5E;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:none}
.val small{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#D9C9EC}
.val b{font-family:'Cormorant Garamond',Georgia,serif;font-size:44px;color:#D4AF5A}
.names{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px 32px}
.lbl{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#D4AF5A;margin-bottom:4px}
.name{font-family:'Cormorant Garamond',Georgia,serif;font-size:27px;border-bottom:1px solid #8A6FA8;padding-bottom:5px;min-height:40px}
.msg{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:20px;color:#E7DDF3}
.bottom{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;flex-wrap:wrap}
.how{font-size:14px;color:#E7DDF3;line-height:1.6}
.how a{color:#E3C77A}
.code{font-size:20px;font-weight:600;letter-spacing:3px;color:#D4AF5A;border:1px dashed #D4AF5A;padding:6px 14px;border-radius:4px;white-space:nowrap}
.left{font-size:13px;color:#E3C77A}
.actions{max-width:880px;margin:16px auto 0;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.actions button,.actions a{font-family:inherit;font-size:15px;border-radius:8px;padding:12px 22px;min-height:44px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.print{background:#C9922A;color:#fff;border:none;font-weight:600}
.home{background:#fff;color:#6B4699;border:1.5px solid #6B4699}
@media print{body{background:#fff;padding:0}.actions{display:none}@page{size:letter landscape;margin:0.4in}}
</style></head><body>
<div class="cert"><div class="b1"><div class="b2">
<div class="top"><div><div class="brand">REAL Holistic Network</div><h1>Gift Certificate</h1><div class="sub">A gift of healing, just for you</div></div>
<div class="val"><small>Value</small><b>$${esc(g.amount)}</b></div></div>
<div class="names"><div><div class="lbl">To</div><div class="name">${esc(g.recipientName)}</div></div><div><div class="lbl">From</div><div class="name">${esc(g.buyerName)}</div></div></div>
${g.message ? `<div class="msg">“${esc(g.message)}”</div>` : ''}
<div class="bottom"><div class="how">Good toward any session with any healer on the network.<br>Book at <a href="https://realholisticnetwork.com">REALholisticnetwork.com</a> and enter your code.${left}</div>
<div><div class="lbl" style="text-align:right">Gift code</div><div class="code">${esc(g.code)}</div></div></div>
</div></div></div>
<div class="actions"><button class="print" onclick="window.print()">Print or save as PDF</button><a class="home" href="/">Find a healer</a></div>
</body></html>`);
}
