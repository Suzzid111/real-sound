// api/reschedule.js — the client answers a healer's suggested new time,
// using the private link from their email.
import { sessionWhen, tooManyTries, clientIp } from './_lib.js';
import { findProposal, answerProposal } from './_bookings.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const body = req.body || {};
    if (await tooManyTries('resched:' + clientIp(req), 30)) return res.status(429).json({ ok: false, error: 'Too many tries. Please wait a few minutes.' });
    if (body.action === 'info') {
      const { b } = await findProposal(body.code);
      if (!b) return res.json({ ok: false, error: 'This link is not valid. Please check your email for the latest message.' });
      return res.json({ ok: true, status: b.status, answer: b.proposal.answer || null, healerName: b.practitionerName, sessionType: b.sessionType, total: b.total,
        oldWhen: b.status === 'confirmed' && b.proposal.answer === 'accepted' ? null : sessionWhen(b),
        newWhen: sessionWhen({ startUTC: b.proposal.startUTC, healerTz: b.proposal.healerTz }), message: b.proposal.message });
    }
    if (body.action === 'answer') return res.json(await answerProposal(body.code, body.yes === true));
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
}
