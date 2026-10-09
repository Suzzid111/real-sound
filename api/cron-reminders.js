// api/cron-reminders.js — runs once a day (see "crons" in vercel.json).
// Emails the client and the healer the day before each confirmed session.
import { loadBookings, saveBookings, loadHealers, sendNotice, sessionWhen, logNote, todayET } from './_lib.js';

export default async function handler(req, res) {
  // Vercel adds this secret to its own scheduled calls; nobody else can trigger it.
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization || '') !== 'Bearer ' + secret) return res.status(401).json({ ok: false });
  try {
    const today = todayET();
    const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
    const [B, P] = await Promise.all([loadBookings(), loadHealers()]);
    let sent = 0;
    for (const b of B) {
      if (b.status !== 'confirmed' || b.reminderSent) continue;
      const day = b.startUTC ? new Intl.DateTimeFormat('en-CA', { timeZone: b.healerTz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(b.startUTC)) : b.date;
      if (day !== tomorrow) continue;
      const when = sessionWhen(b);
      const h = P.find(x => x.id === b.practitionerId);
      await sendNotice(b.email, b.venueName, `Reminder: your session with ${b.practitionerName} is tomorrow`,
        `This is a friendly reminder that your ${b.sessionType || 'session'} with ${b.practitionerName} is tomorrow, ${when}.\n\nA few gentle tips: wear comfortable clothes, drink some water, and give yourself a few quiet minutes afterward.\n\nIf something has come up, please reply to this email as soon as possible.\n\nWe hope it's a beautiful session.\nREAL Holistic Network`);
      if (h && h.email) await sendNotice(h.email, h.name, `Reminder: ${b.sessionType || 'session'} tomorrow with ${b.venueName}`,
        `Hi ${h.name},\n\nJust a reminder: you have a ${b.sessionType || 'session'} tomorrow, ${when}, with ${b.venueName}${b.groupSize ? ' (group of ' + b.groupSize + ')' : ''}.${b.notes ? '\n\nTheir notes: ' + b.notes : ''}\n\nClient email: ${b.email}\n\nWishing you a wonderful session!\nREAL Holistic Network`);
      b.reminderSent = new Date().toISOString();
      sent++;
    }
    if (sent) { await saveBookings(B); await logNote(`⏰ Sent ${sent} session reminder${sent > 1 ? 's' : ''} for tomorrow`); }
    return res.json({ ok: true, sent });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
