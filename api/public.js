// api/public.js — the only data any visitor can read: healer profiles
// (no emails, passwords or private notes) and which times are already taken.
import { loadHealers, loadBookings, publicHealer, publicBooking, getJSON } from './_lib.js';
import { loadContent, loadEvents, publicEvent, todayET, loadReviews, reviewStats } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const [P, B, C, E, R, requireConnect] = await Promise.all([loadHealers(), loadBookings(), loadContent(), loadEvents(), loadReviews(), getJSON('requireConnect', false)]);
    const photoOf = {}; P.forEach(p => { if (p.photoV) photoOf[p.id] = '/api/photo?id=' + encodeURIComponent(p.id) + '&v=' + p.photoV; });
    const today = todayET();
    const events = E.filter(e => e.status === 'approved' && e.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).map(e => Object.assign(publicEvent(e), { healerPhoto: photoOf[e.healerId] || '' }));
    const img = x => (x.imagePath ? '/api/learn?img=' + x.id : '');
    const content = {
      journals: (C.journals || []).filter(x => x.active !== false && x.filePath).map(x => ({ id: x.id, title: x.title, description: x.description, price: x.price, image: img(x) })),
      teachings: (C.teachings || []).filter(x => x.active !== false).map(x => ({ id: x.id, kind: x.kind, title: x.title, description: x.description, body: x.body, videoUrl: x.videoUrl, date: x.date, time: x.time, location: x.location, signupUrl: x.signupUrl, image: img(x), createdAt: x.createdAt })),
      resources: (C.resources || []).filter(x => x.active !== false).map(x => ({ id: x.id, title: x.title, description: x.description, url: x.url, category: x.category })),
      products: (C.products || []).filter(x => x.active !== false).map(x => ({ id: x.id, title: x.title, description: x.description, url: x.url, imageUrl: x.imageUrl, price: x.price, recommendedBy: x.recommendedBy, category: x.category }))
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ stripePk: process.env.STRIPE_PUBLISHABLE_KEY || '', requireConnect: !!requireConnect, practitioners: P.map(p => Object.assign(publicHealer(p), reviewStats(R, p.id))), bookings: B.map(publicBooking), content, events });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
