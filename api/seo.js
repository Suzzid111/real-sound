// api/seo.js — plain, readable pages made for Google, Bing and AI tools (ChatGPT etc.).
// The main site is one big JavaScript app, which search engines can't see inside.
// These pages show the same healers and shops as simple HTML, each at its own address:
//   /healers                 every practitioner, with links
//   /healer/<name>-<1234>    one practitioner's profile (Book button opens the real booking page)
//   /shops                   shop directory: list of states
//   /shops/<state>           every shop in that state, grouped by town
//   /services                every healing service on RHN
//   /services/<service>      one service: what it is + every practitioner who offers it
//   /sitemap.xml             the list of all these pages, for Google and Bing
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { loadHealers, publicHealer, healerSlug, esc, loadReviews, reviewStats, loadServices, currentServices } from './_lib.js';

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
function page({ title, desc, canonical, body, jsonld, noindex }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">${noindex ? '\n<meta name="robots" content="noindex, follow">' : ''}
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
<footer><a href="/">Home</a> · <a href="/healers">Practitioners</a> · <a href="/services">Healing services</a> · <a href="/shops">Holistic shops</a> · <a href="/join">Join as a practitioner</a> · <a href="/sue">About the founder</a><br>REAL Holistic Network: find holistic practitioners near you, or online.</footer>
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
<div style="margin:8px 0">${mods.map(m => `<a class="tag" href="/services/${esc(serviceSlug(m))}" style="text-decoration:none">${esc(m)}</a>`).join('')}</div>
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


// ---------- /services and /services/<service> — one page per healing service ----------
// Each page aims at one search phrase ("reiki practitioner", "sound bath near me"...).
// Built from the live service list, so a service Sue adds in admin gets its own page.
// Plain descriptions only: what it is and what a session is like. No health claims.
const serviceSlug = name => String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const SERVICE_INFO = {
  'sound bath & gong bath': ['sound bath', 'A sound bath is a deeply relaxing session where you rest, lying down or seated, while the practitioner plays gongs, crystal or Tibetan singing bowls, chimes and other instruments. People come for rest, calm and a quiet mind. Sessions can be one-on-one or in a group.'],
  'reiki & crystal healing': ['Reiki practitioner', 'Reiki is a gentle Japanese energy practice. You rest fully clothed while the practitioner places their hands lightly on or just above you. Many practitioners also work with crystals, placing stones on or around you during the session. Most people describe it as deeply calming.'],
  'breathwork': ['breathwork session', 'Breathwork is guided, intentional breathing. A practitioner leads you through breathing patterns, from slow and calming to more active and energizing, to help you relax, release stress and feel more present. Sessions can be in person or online.'],
  'meditation': ['meditation teacher', 'Meditation is the practice of training your attention, often by focusing on the breath, a word, a sound or a guided journey. A teacher can show you simple techniques you can use every day, one-on-one or in a group, in person or online.'],
  'creative art healing': ['creative art healing', 'Creative art healing uses painting, drawing, collage, journaling and other creative activities as a way to relax, reflect and express yourself. No art skills are needed. The focus is on the process, not on making something perfect.'],
  'herbalist': ['herbalist', 'An herbalist works with plants, such as teas, tinctures, salves and blends, drawing on traditions that go back thousands of years. Sessions may include learning about herbs, custom blends or classes. Always tell your doctor about herbs you take.'],
  'life coach': ['life coach', 'A life coach helps you get clear on what you want and make a plan to get there, whether that is a career change, better habits, confidence or balance. Coaching looks forward: goals, next steps and accountability. Sessions are often online.'],
  'astrology & birth charts': ['astrologer', 'An astrologer reads your birth chart, a map of where the sun, moon and planets were at the moment you were born. A reading can cover personality, relationships, timing and the year ahead. You usually need your birth date, time and place.'],
  'tarot': ['tarot reader', 'A tarot reader uses a deck of 78 cards to explore your question, whether it is about love, work, a decision or your path. Many people use tarot for reflection and insight. Readings can be in person, by phone or by video.'],
  'pilates instructor': ['Pilates instructor', 'Pilates is a low-impact exercise method that builds core strength, posture, balance and flexibility. An instructor guides you through mat or equipment work, private or in small groups, at your own level.'],
  'tai chi & qigong': ['tai chi and qigong', 'Tai chi and qigong are ancient Chinese movement practices: slow, flowing movements paired with breathing and focus. They are gentle on the body and suit almost any age or fitness level.'],
  'health & wellness coach': ['health and wellness coach', 'A health and wellness coach helps you build everyday habits around food, movement, sleep and stress, with steady support and accountability. Coaches work alongside, not in place of, your doctor.'],
  'psychic & medium': ['psychic medium', 'A psychic offers intuitive readings about your life and path. A medium focuses on connecting with loved ones who have passed. Readings can be in person, by phone or by video.'],
  'energy healing': ['energy healer', 'Energy healing is a family of practices that work with the body\'s energy, using light touch or no touch at all. Sessions are usually quiet and restful, and you stay fully clothed.'],
  'shamanic healing': ['shamanic healer', 'Shamanic healing draws on very old traditions from cultures around the world. A practitioner may use drumming, rattles, guided journeys and ceremony. Sessions are usually quiet and reflective.'],
  'eft / tapping': ['EFT tapping', 'EFT (Emotional Freedom Techniques), or tapping, means gently tapping on certain points on the face and body while talking about what is on your mind. A practitioner guides you, and you can learn to use it on your own too.'],
  'aromatherapy': ['aromatherapy', 'Aromatherapy uses essential oils from plants, through scent, diffusers, baths or custom blends, to create a calming, uplifting experience. A practitioner can help you choose oils and use them safely.'],
  'hypnotherapy': ['hypnotherapist', 'Hypnotherapy uses guided relaxation and focused attention to help you reach a calm, deeply relaxed state. You stay aware and in control the whole time. People often come to work on habits, confidence or stress.'],
  'childbirth education': ['childbirth educator', 'A childbirth educator helps you and your partner get ready for labor, birth and the first weeks with your baby: what to expect, comfort measures, breathing and positions. Classes can be private or in a group, in person or online.'],
  'birth doula': ['birth doula', 'A birth doula gives emotional and physical support before, during and just after birth: comfort measures, encouragement and help for your partner too. Doulas support you alongside your doctor or midwife and do not give medical care.'],
  'death doula': ['death doula', 'A death doula, or end-of-life doula, offers gentle, non-medical support to a person nearing the end of life and to their family: companionship, planning, legacy projects and comfort. They work alongside hospice and medical care.'],
  'ayurvedic wellness coach': ['Ayurvedic wellness coach', 'Ayurveda is a traditional wellness system from India, thousands of years old. An Ayurvedic wellness coach helps you build daily routines around food, sleep, movement and the seasons that suit your own nature.'],
  'yoga instructor': ['yoga instructor', 'A yoga instructor guides you through postures, breathing and relaxation at your own level, from gentle and restorative to more active styles. Private sessions let the practice fit your body and your goals.'],
  'spiritual coach': ['spiritual coach', 'A spiritual coach supports you in exploring meaning, purpose, intuition and your spiritual path, with no one belief system required. Sessions are conversations with practices you can take home.'],
};
const NOT_MEDICAL = 'Practitioners on REAL Holistic Network are independent. Holistic sessions are not medical care and do not replace care from your doctor or other licensed provider.';
function serviceInfo(name) {
  const i = SERVICE_INFO[String(name).toLowerCase()];
  return i ? { phrase: i[0], about: i[1] } : { phrase: String(name).toLowerCase(), about: `Find independent ${name} practitioners on REAL Holistic Network. See their sessions and prices, and book online.` };
}
async function servicesData() {
  await loadServices();
  const P = (await loadHealers()).filter(p => p.available !== false).map(p => [healerSlug(p), publicHealer(p)]);
  return currentServices().map(name => ({ name, slug: serviceSlug(name), healers: P.filter(([, h]) => (h.modalities || []).includes(name)) })).filter(x => x.slug);
}
async function servicesIndex() {
  const L = await servicesData();
  const body = `<h1>Holistic Healing Services</h1>
<p>Every healing service on REAL Holistic Network. Tap one to learn what it is and see the practitioners who offer it, in person or online.</p>
${L.map(x => `<div class="card"><a href="/services/${esc(x.slug)}" style="font-size:18px">${esc(x.name)}</a> <span class="soft">· ${x.healers.length ? x.healers.length + ' practitioner' + (x.healers.length > 1 ? 's' : '') : 'new'}</span></div>`).join('')}
<p><a class="btn" href="/join">Are you a practitioner? Join REAL Holistic Network</a></p>`;
  return page({ title: 'Holistic Healing Services: Reiki, Sound Baths, Breathwork, Tarot & More | REAL Holistic Network',
    desc: `Explore ${L.length} holistic healing services and book independent practitioners: ${listJoin(L.slice(0, 6).map(x => x.name))} and more.`,
    canonical: BASE + '/services', body,
    jsonld: { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Holistic healing services on REAL Holistic Network',
      itemListElement: L.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: BASE + '/services/' + x.slug, name: x.name })) } });
}
async function servicePage(slug) {
  const L = await servicesData();
  const x = L.find(v => v.slug === slug);
  if (!x) return null;
  const { phrase, about } = serviceInfo(x.name);
  const n = x.healers.length;
  const sts = [...new Set(x.healers.map(([, h]) => stateOf(h.location)).filter(Boolean))].map(st => STATES[st] || st);
  const others = L.filter(v => v !== x && v.healers.length).slice(0, 8);
  const body = `<h1>${esc(x.name)} Practitioners</h1>
<p class="soft">${n ? `${n} practitioner${n > 1 ? 's' : ''}${sts.length ? ' in ' + esc(listJoin(sts)) : ''}, plus online sessions` : 'New on REAL Holistic Network'}</p>
<h2>What is ${esc(x.name)}?</h2>
<p>${esc(about)}</p>
<h2>Book a ${esc(phrase)}</h2>
${n ? x.healers.map(([, h]) => healerCard(h)).join('') : `<p>Practitioners for ${esc(x.name)} are joining now. In the meantime, <a href="/healers">browse all practitioners</a>.</p>`}
<p><a class="btn" href="/join">Do you offer ${esc(x.name)}? Join REAL Holistic Network</a></p>
<p class="soft">Looking for crystals, herbs, oils or tools? <a href="/shops">Find a holistic shop near you</a>.</p>
${others.length ? `<h2>Other healing services</h2><p>${others.map(v => `<a class="tag" href="/services/${esc(v.slug)}" style="text-decoration:none">${esc(v.name)}</a>`).join('')} <a href="/services">See all</a></p>` : ''}
<p class="soft" style="font-size:12px">${esc(NOT_MEDICAL)}</p>`;
  const url = BASE + '/services/' + x.slug;
  return page({
    title: `${x.name} Practitioners: Book a ${phrase.charAt(0).toUpperCase() + phrase.slice(1)} Near You or Online | REAL Holistic Network`,
    desc: `${about.split('. ')[0]}. Book ${x.name.toLowerCase()} with independent practitioners${sts.length ? ' in ' + listJoin(sts) : ''}, in person or online.`.slice(0, 300),
    canonical: url, body, noindex: !n,
    jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${x.name} practitioners`, url, description: about,
      isPartOf: { '@type': 'WebSite', name: 'REAL Holistic Network', url: BASE },
      mainEntity: { '@type': 'ItemList', itemListElement: x.healers.map(([s, h], i) => ({ '@type': 'ListItem', position: i + 1, url: BASE + '/healer/' + s, name: h.name })) } }
  });
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
  const SV = (await servicesData()).filter(x => x.healers.length);
  const urls = ['/', '/sue', '/healers', '/services', '/shops', '/join', ...SV.map(x => '/services/' + x.slug), ...sts.map(s => '/shops/' + s.toLowerCase()), ...P.map(p => '/healer/' + healerSlug(p))];
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
  const SV = await servicesData();
  out.push({ url: BASE + '/services', fp: fp(['svc-v1', SV.map(x => [x.slug, x.healers.length])]) });
  for (const x of SV) if (x.healers.length) out.push({ url: BASE + '/services/' + x.slug, fp: fp(['svc-v1', x.name, x.healers.map(([sl, h]) => [sl, h.name, h.location])]) });
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
    else if (t === 'services' && q.s) html = await servicePage(String(q.s).toLowerCase().slice(0, 80));
    else if (t === 'services') html = await servicesIndex();
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
