// api/learn.js — the "Learn" section: journals for sale, teachings, resources.
//
//   GET  ?img=<itemId>                 cover picture for a journal or teaching (public)
//   GET  ?order=<orderId>&k=<key>      download a journal someone paid for
//   POST (from the admin upload box)   Vercel Blob client-upload token exchange
//   POST {action:"buy", productId, email}           start a card payment
//   POST {action:"complete", paymentIntentId}       confirm payment, create the order
//
// Files live in a PRIVATE Vercel Blob store, so they can only be downloaded
// through this file after the server checks the order is paid.
import { Readable } from 'node:stream';
import { get } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { getJSON, setJSON, getSession, logNote, newToken, str, tooManyTries, clientIp, loadContent } from './_lib.js';
import { stripe } from './_bookings.js';

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'application/zip', 'application/epub+zip'];


export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await serve(req, res);
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const body = req.body || {};

    // Admin file upload (the browser talks to Vercel Blob through this)
    if (typeof body.type === 'string' && body.type.startsWith('blob.')) {
      const json = await handleUpload({
        body, request: req,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          let token = '';
          try { token = JSON.parse(clientPayload || '{}').token || ''; } catch (e) {}
          const s = await getSession({ headers: { authorization: 'Bearer ' + token } });
          if (!s || (s.role !== 'owner' && s.role !== 'team')) throw new Error('Please enter the admin code again.');
          return { allowedContentTypes: ALLOWED, maximumSizeInBytes: 200 * 1024 * 1024, addRandomSuffix: true };
        },
        onUploadCompleted: async () => {}
      });
      return res.status(200).json(json);
    }

    if (body.action === 'buy') return await buy(req, res, body);
    if (body.action === 'complete') return await complete(req, res, body);
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Something went wrong' });
  }
}

async function streamBlob(res, pathname, headers) {
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200) return res.status(404).send('Not found');
  res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.entries(headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  Readable.fromWeb(result.stream).pipe(res);
}

async function serve(req, res) {
  const q = req.query || {};
  if (q.img) {
    const C = await loadContent();
    const item = [...C.journals, ...C.teachings].find(x => x.id === String(q.img));
    if (!item || !item.imagePath) return res.status(404).send('Not found');
    return streamBlob(res, item.imagePath, { 'Cache-Control': 'public, max-age=3600' });
  }
  if (q.order) {
    const order = await getJSON('order:' + String(q.order).slice(0, 80), null);
    if (!order || String(q.k || '') !== order.key) return res.status(404).send('This download link is not valid. Please contact bookings.realsound@gmail.com');
    const C = await loadContent();
    const p = C.journals.find(x => x.id === order.productId);
    if (!p || !p.filePath) return res.status(404).send('This file is no longer available. Please contact bookings.realsound@gmail.com');
    const name = (p.fileName || (p.title + '.pdf')).replace(/[^\w.\- ]+/g, '');
    return streamBlob(res, p.filePath, { 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${name}"` });
  }
  return res.status(400).send('Bad request');
}

async function buy(req, res, { productId, email }) {
  if (await tooManyTries('buy:' + clientIp(req), 20)) return res.status(429).json({ ok: false, error: 'Too many tries. Please wait a few minutes.' });
  const e = str(email, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.json({ ok: false, error: 'Please enter a valid email so we can send your receipt' });
  const C = await loadContent();
  const p = C.journals.find(x => x.id === productId && x.active !== false);
  if (!p || !p.filePath || !(p.price > 0)) return res.json({ ok: false, error: 'This item is not available right now' });
  const pi = await stripe().paymentIntents.create({
    amount: Math.round(p.price * 100), currency: 'usd', receipt_email: e,
    description: 'REAL Holistic Network — ' + p.title,
    metadata: { kind: 'journal', productId: p.id, email: e }
  });
  return res.json({ ok: true, clientSecret: pi.client_secret, paymentIntentId: pi.id });
}

async function complete(req, res, { paymentIntentId }) {
  const id = str(paymentIntentId, 100);
  if (!/^pi_[A-Za-z0-9]+$/.test(id)) return res.json({ ok: false, error: 'Missing payment' });
  const existing = await getJSON('order:' + id, null);
  const site = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'realholisticnetwork.com');
  if (existing) return res.json({ ok: true, downloadUrl: `${site}/api/learn?order=${id}&k=${existing.key}`, title: existing.title });
  const pi = await stripe().paymentIntents.retrieve(id);
  if (pi.status !== 'succeeded' || !pi.metadata || pi.metadata.kind !== 'journal') return res.json({ ok: false, error: 'Payment not completed' });
  const C = await loadContent();
  const p = C.journals.find(x => x.id === pi.metadata.productId);
  const order = { id, productId: pi.metadata.productId, title: p ? p.title : 'Journal', email: pi.metadata.email || pi.receipt_email || '', amount: pi.amount / 100, key: newToken(), createdAt: new Date().toISOString() };
  await setJSON('order:' + id, order);
  const list = await getJSON('orders', []);
  list.unshift({ id, title: order.title, email: order.email, amount: order.amount, createdAt: order.createdAt });
  await setJSON('orders', list.slice(0, 500));
  await logNote(`🛍 Journal sold: ${order.title} ($${order.amount}) to ${order.email}`);
  return res.json({ ok: true, downloadUrl: `${site}/api/learn?order=${id}&k=${order.key}`, title: order.title });
}
