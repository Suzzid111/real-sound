// api/h.js — a healer's shareable link (realholisticnetwork.com/h/<name>-<1234>).
// Shows a nice preview card when shared on Facebook, Instagram, texts, etc.,
// then sends the visitor straight to that healer's booking page.
import { loadHealers, healerSlug, esc } from './_lib.js';

export default async function handler(req, res) {
  const slug = String((req.query || {}).s || '').toLowerCase().slice(0, 80);
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'realholisticnetwork.com';
  const site = 'https://' + host;
  let p = null;
  try { p = (await loadHealers()).find(x => healerSlug(x) === slug); } catch (e) {}
  if (!p) { res.setHeader('Location', '/'); return res.status(302).send(''); }
  const target = '/?book=' + encodeURIComponent(slug) + '&src=share';
  const title = `Book a session with ${p.name} on REAL Holistic Network`;
  const mods = (p.modalities || []).slice(0, 3).join(' · ');
  const desc = (mods ? mods + ' — ' : '') + (p.location ? p.location + '. ' : '') + 'Find your healer. Feel the shift.';
  const img = p.photoV ? `${site}/api/photo?id=${encodeURIComponent(p.id)}&v=${p.photoV}` : '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="REAL Holistic Network">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(site + '/h/' + slug)}">
${img ? `<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="400"><meta property="og:image:height" content="400">` : ''}
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<style>body{font-family:Georgia,serif;background:#F6F1FB;color:#2A1F3D;text-align:center;padding:60px 20px}a{color:#6B4699}</style>
</head><body><p>Taking you to ${esc(p.name)}'s booking page…</p><p><a href="${esc(target)}">Continue</a></p>
<script>location.replace(${JSON.stringify(target)});</script></body></html>`);
}
