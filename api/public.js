// api/public.js — the only data any visitor can read: healer profiles
// (no emails, passwords or private notes) and which times are already taken.
import { loadHealers, loadBookings, publicHealer, publicBooking } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const [P, B] = await Promise.all([loadHealers(), loadBookings()]);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ practitioners: P.map(publicHealer), bookings: B.map(publicBooking) });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
