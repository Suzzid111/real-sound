// api/reviews.js — a client leaves a review using the private link their
// healer sent after a confirmed session. One review per booking.
import { loadBookings, saveBookings, loadReviews, saveReviews, logNote, str, tooManyTries, clientIp, todayET } from './_lib.js';

async function findBooking(code) {
  const m = /^(b\d{6,20})\.([a-f0-9]{24})$/.exec(String(code || ''));
  if (!m) return {};
  const B = await loadBookings();
  const b = B.find(x => x.id === m[1] && x.reviewKey === m[2] && x.status === 'confirmed');
  return { B, b };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const body = req.body || {};
    if (await tooManyTries('review:' + clientIp(req), 30)) return res.status(429).json({ ok: false, error: 'Too many tries. Please wait a few minutes.' });
    const { B, b } = await findBooking(body.code);
    if (!b) return res.json({ ok: false, error: 'This review link is not valid. Please ask your healer to send it again.' });
    if (b.reviewed) return res.json({ ok: false, error: 'Thank you! A review was already left for this session.' });
    if (b.date && b.date > todayET()) return res.json({ ok: false, error: 'You can leave a review after your session on ' + b.date + '.' });

    if (body.action === 'info') return res.json({ ok: true, healerName: b.practitionerName, sessionType: b.sessionType, date: b.date });
    if (body.action !== 'submit') return res.status(400).json({ ok: false, error: 'Unknown action' });

    const stars = parseInt(body.stars, 10), name = str(body.name, 40), text = str(body.text, 1000);
    if (!(stars >= 1 && stars <= 5)) return res.json({ ok: false, error: 'Please choose a star rating' });
    if (!name) return res.json({ ok: false, error: 'Please add your first name' });
    const R = await loadReviews();
    R.push({ id: 'r' + Date.now().toString(36), healerId: b.practitionerId, healerName: b.practitionerName, bookingId: b.id, stars, name, text, createdAt: new Date().toISOString(), hidden: false });
    await saveReviews(R);
    b.reviewed = true;
    await saveBookings(B);
    await logNote(`⭐ New ${stars}-star review for ${b.practitionerName} from ${name}`);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
