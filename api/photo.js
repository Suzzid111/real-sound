// api/photo.js — shows a healer's profile photo.
import { redis } from './_lib.js';

export default async function handler(req, res) {
  try {
    const id = String((req.query || {}).id || '');
    if (!/^[\w-]{1,64}$/.test(id)) return res.status(404).send('Not found');
    const data = await redis(['GET', 'rs:photo:' + id]);
    if (!data) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // the link changes every time a new photo is uploaded, so it can be cached for a long time
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(Buffer.from(data, 'base64'));
  } catch (err) {
    return res.status(500).send('Error');
  }
}
