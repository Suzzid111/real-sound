// api/seo.js — plain, readable pages made for Google, Bing and AI tools (ChatGPT etc.).
// The main site is one big JavaScript app, which search engines can't see inside.
// These pages show the same healers and shops as simple HTML, each at its own address:
//   /healers                 every practitioner, with links
//   /healer/<name>-<1234>    one practitioner's profile (Book button opens the real booking page)
//   /shops                   shop directory: list of states
//   /shops/<state>           every shop in that state, grouped by town
//   /sitemap.xml             the list of all these pages, for Google and Bing
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { loadHealers, publicHealer, healerSlug, esc, loadReviews, reviewStats, loadServices } from './_lib.js';

const BASE = 'https://www.realholisticnetwork.com';
const STATES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'Washington, DC',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };

// ---------- shop list (shared with the website: /shops-data.js) ----------
let shopCache = null;
async function loadShops(req) {
  if (shopCache) return shopCache;
  let src = '';
  try { src = fs.readFileSync(path.join(process.cwd(), 'shops-data.js'), 'utf8'); } catch (e) {}
  if (!src) {
    try { const host = req.headers['x-forwarded-host'] || req.headers.host; src = await (await fetch('https://' + host + '/shops-data.js')).text(); } catch (e) {}
  }
  try { shopCache = new Function(src + ';return SHOPS;')(); } catch (e) { shopCache = []; }
  return shopCache;
}

// ---------- page frame (gold & purple) ----------
function page({ title, desc, canonical, body, jsonld }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<script defer src="/_vercel/insights/script.js"></script>
<meta property="og:type" content="website"><meta property="og:site_name" content="REAL Holistic Network">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
<style>
body{font-family:Georgia,serif;background:#F6F1FB;color:#2A1F3D;margin:0;line-height:1.6}
header{background:#2A1F3D;padding:14px 20px}header a{color:#C9922A;text-decoration:none;letter-spacing:.12em;font-size:14px}
main{max-width:820px;margin:0 auto;padding:24px 20px 48px}
h1{font-weight:normal;color:#4B2C73;font-size:28px;margin:8px 0 6px}h2{font-weight:normal;color:#6B4699;font-size:20px;margin:28px 0 8px;border-bottom:1px solid #E3D6F0;padding-bottom:4px}
a{color:#6B4699}.soft{color:#7A6A92;font-size:14px}.card{background:#fff;border:1px solid #E3D6F0;border-radius:12px;padding:16px 18px;margin:12px 0}
.tag{display:inline-block;background:#EFE5F8;color:#4B2C73;border-radius:20px;padding:2px 10px;font-size:13px;margin:2px 4px 2px 0}
.btn{display:inline-block;background:#C9922A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:24px;font-size:16px;margin:8px 0}
.photo{width:140px;height:140px;border-radius:50%;object-fit:cover;border:3px solid #C9922A;float:right;margin:0 0 12px 16px}
table{border-collapse:collapse;width:100%}td{padding:6px 4px;border-bottom:1px solid #EFE5F8;vertical-align:top}
footer{text-align:center;font-size:13px;color:#7A6A92;padding:20px}
</style></head><body>
<header><a href="/">◉ REAL HOLISTIC NETWORK</a></header>
<main>${body}</main>
<footer><a href="/">Home</a> · <a href="/healers">Practitioners</a> · <a href="/shops">Holistic shops</a> · <a href="/join">Join as a practitioner</a> · <a href="/sue">About the founder</a><br>REAL Holistic Network: find holistic practitioners near you, or online.</footer>
</body></html>`;
}

const money = n => (n == null || n === '' || isNaN(Number(n)) ? '' : '$' + Number(n).toFixed(Number(n) % 1 ? 2 : 0));
const listJoin = a => a.length < 3 ? a.join(' & ') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
const stateOf = loc => { const m = String(loc || '').match(/,\s*([A-Za-z]{2})\b\s*$/); return m ? m[1].toUpperCase() : ''; };

function healerCard(h) {
  const mods = (h.modalities || []).map(m => `<span class="tag">${esc(m)}</span>`).join('');
  return `<div class="card"><a href="/healer/${esc(healerSlug(h))}" style="font-size:18px">${esc(h.name)}</a>
<div class="soft">${esc(h.location || 'Online')}</div><div>${mods}</div></div>`;
}

async function healersPage() {
  await loadServices();
  const P = (await loadHealers()).map(publicHealer).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const mods = [...new Set(P.flatMap(h => h.modalities || []))];
  const body = `<h1>Holistic Practitioners</h1>
<p>Find and book independent holistic practitioners on REAL Holistic Network${mods.length ? ': ' + esc(listJoin(mods.slice(0, 8))) : ''}. Tap a name to see their sessions, prices and reviews, and book online.</p>
${P.map(healerCard).join('') || '<p>New practitioners are joining now. Check back soon.</p>'}
<p><a class="btn" href="/join">Are you a practitioner? Join REAL Holistic Network</a></p>`;
  return page({
    title: 'Holistic Practitioners: Reiki, Sound Healing, Energy Work & More | REAL Holistic Network',
    desc: 'Browse and book holistic practitioners: Reiki, sound healing, breathwork, meditation, tarot, astrology, life coaching and more.',
    canonical: BASE + '/healers', body,
    jsonld: { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Holistic practitioners on REAL Holistic Network',
      itemListElement: P.map((h, i) => ({ '@type': 'ListItem', position: i + 1, url: BASE + '/healer/' + healerSlug(h), name: h.name })) }
  });
}

async function healerPage(slug) {
  await loadServices();
  const raw = (await loadHealers()).find(x => healerSlug(x) === slug);
  if (!raw) return null;
  const h = publicHealer(raw);
  const stats = reviewStats(await loadReviews(), raw.id);
  const mods = h.modalities || [];
  const where = h.location || '';
  const url = BASE + '/healer/' + slug;
  const img = h.photo ? BASE + h.photo : '';
  const tiers = (h.sessionTypes || []).filter(t => t && (t.service || t.name || t.details));
  const sessions = tiers.length
    ? `<table>${tiers.map(t => `<tr><td>${esc([t.service, t.details].filter(Boolean).join(' · ') || t.name)}${t.online ? ' <span class="soft">(online)</span>' : ''}</td><td style="text-align:right;white-space:nowrap">${esc(money(t.price))}</td></tr>`).join('')}</table>`
    : (h.rate ? `<p>Sessions from ${esc(money(h.rate))}</p>` : '');
  const reviews = stats.reviewCount
    ? `<h2>Client reviews</h2><p>${'★'.repeat(Math.round(stats.rating))} ${esc(stats.rating)} from ${stats.reviewCount} verified booking${stats.reviewCount > 1 ? 's' : ''}</p>` +
      stats.recentReviews.map(r => `<div class="card"><b>${'★'.repeat(r.stars)}</b> ${esc(r.text)}<div class="soft">${esc(r.name)} · ${esc(r.date)}</div></div>`).join('')
    : '';
  const title = `${h.name}${mods.length ? ', ' + listJoin(mods.slice(0, 3)) : ''}${where ? ' in ' + where : ''} | REAL Holistic Network`;
  const desc = `Book ${mods.length ? listJoin(mods.slice(0, 3)) + ' ' : ''}with ${h.name}${where ? ' (' + where + ')' : ''} on REAL Holistic Network. ` + String(h.bio || '').replace(/\s+/g, ' ').slice(0, 110);
  const body = `${img ? `<img class="photo" src="${esc(h.photo)}" alt="${esc(h.name)}">` : ''}
<h1>${esc(h.name)}</h1>
<div class="soft">${esc(where || 'Online sessions')}</div>
<div style="margin:8px 0">${mods.map(m => `<span class="tag">${esc(m)}</span>`).join('')}</div>
<a class="btn" href="/?book=${esc(slug)}">Book a session with ${esc(h.name)}</a>
<div style="clear:both"></div>
${h.bio ? `<h2>About</h2><p>${esc(h.bio).replace(/\n/g, '<br>')}</p>` : ''}
${sessions ? `<h2>Sessions &amp; prices</h2>${sessions}` : ''}
${reviews}
<p><a class="btn" href="/?book=${esc(slug)}">Book with ${esc(h.name)}</a></p>
<p class="soft"><a href="/healers">← See all practitioners</a></p>`;
  const ld = { '@context': 'https://schema.org', '@type': 'ProfessionalService', name: h.name, url, description: String(h.bio || '').slice(0, 300),
    knowsAbout: mods, isPartOf: { '@type': 'WebSite', name: 'REAL Holistic Network', url: BASE } };
  if (img) ld.image = img;
  if (where) { const st = stateOf(where); ld.address = { '@type': 'PostalAddress', addressLocality: where.replace(/,\s*[A-Za-z]{2}\s*$/, ''), addressRegion: st || undefined, postalCode: h.zip || undefined, addressCountry: 'US' }; ld.areaServed = where; }
  if (tiers.length) ld.makesOffer = tiers.filter(t => t.price).map(t => ({ '@type': 'Offer', name: [t.service, t.details].filter(Boolean).join(' · ') || t.name, price: Number(t.price), priceCurrency: 'USD' }));
  return page({ title, desc, canonical: url, body, jsonld: ld });
}


// ---------- /sue — the founder's page (helps Google connect Sue Downing's accounts) ----------
const SUE_LINKS = [
  ['Instagram', 'https://www.instagram.com/suzzid111/', '@suzzid111'],
  ['TikTok', 'https://www.tiktok.com/@suzzid9', '@suzzid9 · Get REAL with SuzziD'],
  ['Threads', 'https://www.threads.com/@suzzid111', '@suzzid111'],
  ['Facebook', 'https://www.facebook.com/share/1CVCoQ7pRa/', 'Sue Downing'],
  ['REAL Holistic Network on Facebook', 'https://www.facebook.com/share/1KQpW9RihL/', 'REAL Holistic Network'],
];
async function founderPage() {
  let me = null;
  try { me = (await loadHealers()).find(x => /suzz?ann?a\s+downing|sue\s+downing/i.test(String(x.name || ''))) || null; } catch (e) {}
  const h = me ? publicHealer(me) : null;
  const slug = me ? healerSlug(me) : '';
  const url = BASE + '/sue';
  const body = `${h && h.photo ? `<img class="photo" src="${esc(h.photo)}" alt="Sue Downing">` : ''}
<h1>Sue Downing</h1>
<div class="soft">Founder of REAL Holistic Network · Reiki practitioner · Cranston, Rhode Island</div>
<p>Hi, I'm Sue (Suzzanna Downing). I'm a mom of five, a Reiki Level 2 practitioner, and the founder of REAL Holistic Network.</p>
<p>I started REAL Holistic Network so people can find holistic practitioners they trust, and so healers have a place to be found, book clients and grow their businesses. Reiki, sound healing, energy work, breathwork, coaching and more, all in one place.</p>
<h2>Why "REAL"</h2>
<p>The name REAL honors my late mother. The elephant you'll see on my cards, with its trunk up for good luck, is for my late father, who collected elephants.</p>
<p>I'm also the author of <a href="https://a.co/d/0eKMIA6o" target="_blank" rel="noopener">The REAL Life Journal</a>, a 56-day daily wellness journal.</p>
<div style="clear:both"></div>
<h2>Find me online</h2>
${SUE_LINKS.map(([n, u, l]) => `<div class="card"><b>${esc(n)}</b> · <a href="${esc(u)}" target="_blank" rel="me noopener">${esc(l)}</a></div>`).join('')}
<p>${h ? `<a class="btn" href="/healer/${esc(slug)}">Book a Reiki session with me</a> ` : ''}<a class="btn" href="/join">Join as a practitioner</a></p>
<p class="soft"><a href="/healers">See all practitioners</a> · <a href="/shops">Holistic shops</a></p>`;
  const ld = { '@context': 'https://schema.org', '@type': 'ProfilePage', url, mainEntity: {
    '@type': 'Person', name: 'Sue Downing', alternateName: ['Suzzanna Downing', 'SuzziD', 'suzzid111'], url,
    jobTitle: 'Founder', knowsAbout: ['Reiki', 'Holistic wellness'],
    worksFor: { '@type': 'Organization', name: 'REAL Holistic Network', url: BASE },
    address: { '@type': 'PostalAddress', addressLocality: 'Cranston', addressRegion: 'RI', addressCountry: 'US' },
    sameAs: SUE_LINKS.slice(0, 4).map(x => x[1]) } };
  if (h && h.photo) ld.mainEntity.image = BASE + h.photo;
  return page({ title: 'Sue Downing (Suzzanna Downing), Founder of REAL Holistic Network | Reiki, Cranston, RI',
    desc: 'Meet Sue Downing (@suzzid111), Reiki practitioner in Cranston, Rhode Island and founder of REAL Holistic Network, where people find and book holistic practitioners.',
    canonical: url, body, jsonld: ld });
}

async function shopsIndex(req) {
  const S = await loadShops(req);
  const by = {}; S.forEach(s => { by[s.state] = (by[s.state] || 0) + 1; });
  const sts = Object.keys(by).sort((a, b) => (STATES[a] || a).localeCompare(STATES[b] || b));
  const body = `<h1>Holistic, Metaphysical &amp; Apothecary Shops by State</h1>
<p>Crystal shops, metaphysical stores, botanicas, apothecaries and holistic boutiques. Pick a state to see every shop, town by town. Want the ones closest to you? <a href="/?page=shops">Search by ZIP code</a>.</p>
${sts.map(st => `<div class="card"><a href="/shops/${st.toLowerCase()}" style="font-size:18px">${esc(STATES[st] || st)}</a> <span class="soft">· ${by[st]} shops</span></div>`).join('')}
<p class="soft">Know a shop we missed? Tell us on social media @realholisticnetwork.</p>`;
  return page({ title: 'Holistic, Metaphysical & Apothecary Shops by State | REAL Holistic Network',
    desc: `Find crystal shops, metaphysical stores, apothecaries and holistic boutiques near you in ${listJoin(sts.map(s => STATES[s] || s))}.`,
    canonical: BASE + '/shops', body });
}

async function shopsState(req, st) {
  const S = (await loadShops(req)).filter(s => s.state === st);
  if (!S.length) return null;
  const name = STATES[st] || st;
  const towns = {}; S.forEach(s => { const t = String(s.town || '').trim() || 'Other'; (towns[t] = towns[t] || []).push(s); });
  const tnames = Object.keys(towns).sort();
  const site = w => { const u = /^https?:\/\//i.test(w) ? w : 'https://' + w; return `<a href="${esc(u)}" rel="nofollow noopener" target="_blank">${esc(w.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>`; };
  const body = `<h1>Holistic, Metaphysical &amp; Apothecary Shops in ${esc(name)}</h1>
<p>${S.length} crystal, metaphysical, apothecary and holistic shops in ${esc(name)}, by town. <a href="/?page=shops">Search by ZIP code</a> to see how far each one is from you.</p>
<p class="soft">Towns: ${tnames.map(t => `<a href="#${esc(t.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${esc(t)}</a>`).join(' · ')}</p>
${tnames.map(t => `<h2 id="${esc(t.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${esc(t)}</h2>` + towns[t].map(s => `<div class="card"><b>${esc(s.name)}</b>
<div class="soft">${esc(s.address || '')}</div>${s.sells ? `<div>${esc(s.sells)}</div>` : ''}
<div class="soft">${[s.phone ? esc(s.phone) : '', s.website ? site(s.website) : ''].filter(Boolean).join(' · ')}</div></div>`).join('')).join('')}
<p><a href="/shops">← All states</a></p>`;
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: `Holistic, metaphysical and apothecary shops in ${name}`,
    itemListElement: S.map((s, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Store', name: s.name,
      address: s.address || undefined, telephone: s.phone || undefined, description: s.sells || undefined } })) };
  return page({ title: `Crystal, Metaphysical & Apothecary Shops in ${name} (${S.length}) | REAL Holistic Network`,
    desc: `${S.length} crystal shops, metaphysical stores, apothecaries and holistic boutiques in ${name}: ${listJoin(tnames.slice(0, 6))} and more. Addresses, phone numbers and what each sells.`,
    canonical: BASE + '/shops/' + st.toLowerCase(), body, jsonld: ld });
}

async function sitemap(req) {
  const P = await loadHealers();
  const S = await loadShops(req);
  const sts = [...new Set(S.map(s => s.state))].sort();
  const urls = ['/', '/sue', '/healers', '/shops', '/join', ...sts.map(s => '/shops/' + s.toLowerCase()), ...P.map(p => '/healer/' + healerSlug(p))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${esc(BASE + u)}</loc></url>`).join('\n') + `\n</urlset>\n`;
}

// ---------- every Google-friendly page, with a fingerprint of what's on it ----------
// Used by the daily IndexNow ping (api/_indexnow.js) to tell Bing which pages are new or changed.
export async function pageFingerprints(req) {
  await loadServices();
  const P = (await loadHealers()).map(p => [healerSlug(p), publicHealer(p)]);
  const S = await loadShops(req);
  const fp = x => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);
  const out = [];
  out.push({ url: BASE + '/sue', fp: fp(['sue-v1', SUE_LINKS]) });
  out.push({ url: BASE + '/healers', fp: fp(P.map(([s, h]) => [s, h.name, h.location, h.modalities])) });
  for (const [slug, h] of P) out.push({ url: BASE + '/healer/' + slug, fp: fp([h.name, h.location, h.zip, h.bio, h.modalities, h.sessionTypes, h.photo]) });
  const sts = [...new Set(S.map(s => s.state))].sort();
  out.push({ url: BASE + '/shops', fp: fp(sts.map(st => [st, S.filter(s => s.state === st).length])) });
  for (const st of sts) out.push({ url: BASE + '/shops/' + st.toLowerCase(), fp: fp(S.filter(s => s.state === st)) });
  return out;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const t = String(q.t || '');
  try {
    if (t === 'sitemap') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(await sitemap(req));
    }
    let html = null;
    if (t === 'founder') html = await founderPage();
    else if (t === 'healers') html = await healersPage();
    else if (t === 'healer') html = await healerPage(String(q.s || '').toLowerCase().slice(0, 80));
    else if (t === 'shops' && q.st) html = await shopsState(req, String(q.st).toUpperCase().slice(0, 2));
    else if (t === 'shops') html = await shopsIndex(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!html) return res.status(404).send(page({ title: 'Page not found | REAL Holistic Network', desc: 'Page not found', canonical: BASE + '/', body: '<h1>Sorry, that page isn\'t here</h1><p><a href="/healers">See all practitioners</a> or <a href="/shops">browse holistic shops</a>.</p>' }));
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).send('Server error');
  }
}
