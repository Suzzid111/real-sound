// api/public.js — the only data any visitor can read: healer profiles
// (no emails, passwords or private notes) and which times are already taken.
import { loadHealers, loadBookings, publicHealer, publicBooking } from './_lib.js';
import { loadContent } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const [P, B, C] = await Promise.all([loadHealers(), loadBookings(), loadContent()]);
    const img = x => (x.imagePath ? '/api/learn?img=' + x.id : '');
    const content = {
      journals: (C.journals || []).filter(x => x.active !== false && x.filePath).map(x => ({ id: x.id, title: x.title, description: x.description, price: x.price, image: img(x) })),
      teachings: (C.teachings || []).filter(x => x.active !== false).map(x => ({ id: x.id, kind: x.kind, title: x.title, description: x.description, body: x.body, videoUrl: x.videoUrl, date: x.date, time: x.time, location: x.location, signupUrl: x.signupUrl, image: img(x), createdAt: x.createdAt })),
      resources: (C.resources || []).filter(x => x.active !== false).map(x => ({ id: x.id, title: x.title, description: x.description, url: x.url, category: x.category }))
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ practitioners: P.map(publicHealer), bookings: B.map(publicBooking), content });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
