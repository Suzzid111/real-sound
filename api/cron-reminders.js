// api/cron-reminders.js — runs once a day (see "crons" in vercel.json).
// Emails the client and the healer the day before each confirmed session.
import { loadBookings, saveBookings, loadHealers, saveHealers, payAccount, healerWelcomeEmail, healerStripeReminderEmail, NEW_HEALER_EMAILS_SINCE, sendNotice, sessionWhen, logNote, todayET, releaseSlot, newToken } from './_lib.js';
import { stripe } from './_bookings.js';
import { releaseBookingGifts, giftBackLine } from './_gifts.js';
import { ensureKeys, manageLink, clientWhen, sessionEnd, SITE } from './_manage.js';
import { pingIndexNow } from './_indexnow.js';

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
      ensureKeys(b);
      const video = b.online && h && h.videoLink ? h.videoLink : '';
      await sendNotice(b.email, b.venueName, `Reminder: your session with ${b.practitionerName} is tomorrow`,
        `This is a friendly reminder that your ${b.sessionType || 'session'} with ${b.practitionerName} is tomorrow, ${clientWhen(b)}.${video ? `\n\nThis is an online session. Join here: ${video}` : ''}\n\nA few gentle tips: wear comfortable clothes, drink some water, and give yourself a few quiet minutes afterward.\n\nIf something has come up, you can view or cancel your booking here: ${manageLink(b)}\n(Cancellations less than 24 hours ahead are not refunded.)\n\nWe hope it's a beautiful session.\nREAL Holistic Network`);
      if (h && h.email) {
        const answers = (b.intake || []).map(x => `• ${x.q}\n  ${x.a}`).join('\n');
        await sendNotice(h.email, h.name, `Reminder: ${b.sessionType || 'session'} tomorrow with ${b.venueName}`,
          `Hi ${h.name},\n\nJust a reminder: you have a ${b.sessionType || 'session'} tomorrow, ${when}, with ${b.venueName}${b.groupSize ? ' (group of ' + b.groupSize + ')' : ''}.${video ? `\n\nIt's online. Your video link: ${video}` : (b.online ? "\n\nIt's an online session, but you haven't saved a video link yet. Please add it in your dashboard (My Profile), or email the client a link." : '')}${b.notes ? '\n\nTheir notes: ' + b.notes : ''}${answers ? '\n\nTheir answers to your questions:\n' + answers : ''}\n\nClient email: ${b.email}\n\nWishing you a wonderful session!\nREAL Holistic Network`);
      }
      b.reminderSent = new Date().toISOString();
      sent++;
    }
    if (sent) { await saveBookings(B); await logNote(`⏰ Sent ${sent} session reminder${sent > 1 ? 's' : ''} for tomorrow`); }
    // After a session, automatically ask the client for a review (once).
    // Only paid, confirmed RHN bookings can be reviewed, so reviews stay real.
    let asked = 0;
    for (const b of B) {
      // confirmed = the client's card was charged (or paid by gift certificate);
      // cancelled, declined, refunded and unpaid bookings never get asked.
      if (b.status !== 'confirmed' || b.reviewed || b.reviewAskSent || !b.email) continue;
      if (b.refunded || b.refundId) continue;
      if (!(Number(b.total) > 0 || Number(b.giftTotal) > 0 || b.paymentIntentId)) continue;
      const end = sessionEnd(b);
      // only once the session time is fully over (2+ hours after it ends), and not for old sessions
      if (!end || Date.now() < end + 2 * 3600000 || Date.now() - end > 14 * 86400000) continue;
      if (!b.reviewKey) b.reviewKey = newToken().slice(0, 24);
      await sendNotice(b.email, b.venueName, `How was your session with ${b.practitionerName}?`,
        `Thank you for booking your ${b.sessionType || 'session'} with ${b.practitionerName} through REAL Holistic Network!\n\nWe'd love to hear how it went. Your review takes about a minute and helps others find the right healer:\n${SITE()}/?review=${b.id}.${b.reviewKey}\n\nWith gratitude,\nREAL Holistic Network`);
      b.reviewAskSent = new Date().toISOString();
      asked++;
    }
    if (asked) { await saveBookings(B); await logNote(`⭐ Asked ${asked} client${asked > 1 ? 's' : ''} for a review`); }
    // Suggested new times nobody answered before the card hold ran out: close them.
    let closed = 0;
    for (const b of B) {
      if (b.status !== 'proposed' || Date.now() - Date.parse(b.createdAt || 0) < 6.5 * 86400000) continue;
      const opt = b.stripeAccount ? { stripeAccount: b.stripeAccount } : undefined;
      if (b.paymentIntentId) { try { await stripe().paymentIntents.cancel(b.paymentIntentId, {}, opt); } catch (e) {} }
      b.status = 'declined'; b.respondedAt = new Date().toISOString(); if (b.proposal) b.proposal.answer = 'expired';
      await releaseBookingGifts(b, 'expired');
      await releaseSlot(b).catch(() => {});
      await sendNotice(b.email, b.venueName, `Your booking request with ${b.practitionerName} has closed`, `We didn't hear back about the new time ${b.practitionerName} suggested, so this request has closed. Your card was NOT charged.${giftBackLine(b)}\n\nYou're welcome to book again anytime at realholisticnetwork.com.\n\nREAL Holistic Network`);
      closed++;
    }
    if (closed) { await saveBookings(B); await logNote(`⌛ Closed ${closed} unanswered new-time request${closed > 1 ? 's' : ''} (client not charged)`); }
    // New healers: welcome email (once), then Stripe reminders after 3 and 7 days if still not connected.
    let healerMails = 0;
    try {
      const H = await loadHealers();
      let changed = false;
      for (const h of H) {
        if (!h.email || !h.joinedAt || h.joinedAt.slice(0, 10) < NEW_HEALER_EMAILS_SINCE) continue;
        const days = (Date.now() - Date.parse(h.joinedAt)) / 86400000;
        let mail = null, mark = null;
        if (!h.welcomeSent) { mail = healerWelcomeEmail(h); mark = 'welcomeSent'; }
        else if (!payAccount(h) && days >= 7 && !h.stripeNudge2) { mail = healerStripeReminderEmail(h, 2); mark = 'stripeNudge2'; if (!h.stripeNudge1) h.stripeNudge1 = 'skipped'; }
        else if (!payAccount(h) && days >= 3 && !h.stripeNudge1) { mail = healerStripeReminderEmail(h, 1); mark = 'stripeNudge1'; }
        if (!mail) continue;
        if (await sendNotice(h.email, h.name, mail.subject, mail.text)) { h[mark] = new Date().toISOString(); changed = true; healerMails++; }
      }
      if (changed) { await saveHealers(H); await logNote(`💌 Sent ${healerMails} welcome/Stripe reminder email${healerMails > 1 ? 's' : ''} to new healers`); }
    } catch (e) { await logNote('New-healer emails failed: ' + e.message).catch(() => {}); }
    // Tell Bing about new or changed healer and shop pages (never blocks the reminders).
    let indexed = 0;
    try { indexed = await pingIndexNow(req); } catch (e) { await logNote('IndexNow ping failed: ' + e.message).catch(() => {}); }
    return res.json({ ok: true, sent, asked, indexed, healerMails });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
