// api/_indexnow.js — tells Bing (and other IndexNow search engines) about new or
// changed healer and shop pages, so they show up in Bing and ChatGPT faster.
// Runs once a day from api/cron-reminders.js. Only pages that changed since the
// last run are sent. The key file /d46cb6134ba6bd558945d76e474762f5.txt proves the site is ours.
import { getJSON, setJSON, logNote } from './_lib.js';
import { pageFingerprints } from './seo.js';

const KEY = 'd46cb6134ba6bd558945d76e474762f5';
const HOST = 'www.realholisticnetwork.com';

export async function pingIndexNow(req) {
  const pages = await pageFingerprints(req);
  const seen = await getJSON('indexnowSeen', {});
  const changed = pages.filter(p => seen[p.url] !== p.fp).map(p => p.url);
  if (!changed.length) return 0;
  const r = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: changed.slice(0, 10000) })
  });
  if (!r.ok && r.status !== 202) throw new Error('IndexNow said ' + r.status);
  const next = {}; pages.forEach(p => { next[p.url] = p.fp; });
  await setJSON('indexnowSeen', next);
  await logNote(`🔎 Told Bing about ${changed.length} new or updated page${changed.length > 1 ? 's' : ''}`);
  return changed.length;
}
