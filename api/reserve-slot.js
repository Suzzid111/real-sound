// api/reserve-slot.js
// Makes sure two clients can never book the same healer at the same time.
// The healer's time is split into 15-minute "cells". Holding a slot claims
// every cell it covers in ONE atomic Redis command (MSETNX): either all cells
// are free and we get them all, or someone else has one and we get none.
//
// actions:
//   hold    -> claim the cells for 15 minutes while the client pays
//   keep    -> payment went through; keep the cells until the session is over
//   release -> payment failed or the healer declined; free the cells again

const CELL_MIN = 15;
const HOLD_SECONDS = 15 * 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const REST_URL = process.env.STORAGE_KV_REST_API_URL || process.env.KV_REST_API_URL;
  const REST_TOKEN = process.env.STORAGE_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

  async function redis(cmd) {
    const r = await fetch(REST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd)
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  }

  try {
    const { action, practitionerId, start, durationMin, lockId } = req.body || {};
    const startMs = Date.parse(start);
    const dur = Number(durationMin);

    if (!/^[\w-]{1,64}$/.test(String(practitionerId || ''))) return res.status(400).json({ ok: false, error: 'Bad healer id' });
    if (!Number.isFinite(startMs)) return res.status(400).json({ ok: false, error: 'Bad start time' });
    if (!Number.isFinite(dur) || dur < 15 || dur > 600) return res.status(400).json({ ok: false, error: 'Bad session length' });

    const firstCell = Math.floor(startMs / 60000 / CELL_MIN) * CELL_MIN;
    const endMin = Math.ceil((startMs / 60000 + dur) / CELL_MIN) * CELL_MIN;
    const keys = [];
    for (let m = firstCell; m < endMin; m += CELL_MIN) keys.push(`rs:lock:${practitionerId}:${m}`);

    if (action === 'hold') {
      if (startMs < Date.now()) return res.status(400).json({ ok: false, error: 'That time has already passed. Please pick another time.' });
      const newId = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      const args = ['MSETNX'];
      keys.forEach(k => args.push(k, newId));
      const got = await redis(args);
      if (got !== 1) return res.status(200).json({ ok: false, error: 'Sorry, that time was just booked by someone else. Please pick another time.' });
      await Promise.all(keys.map(k => redis(['EXPIRE', k, HOLD_SECONDS])));
      return res.status(200).json({ ok: true, lockId: newId });
    }

    if (!/^h[a-z0-9]{4,40}$/.test(String(lockId || ''))) return res.status(400).json({ ok: false, error: 'Bad lock id' });
    const current = await redis(['MGET', ...keys]);
    const mine = keys.filter((k, i) => current[i] === lockId);

    if (action === 'keep') {
      if (mine.length !== keys.length) return res.status(200).json({ ok: false, error: 'Hold expired' });
      // Keep until one day after the session ends, then Redis cleans it up.
      const expireAt = Math.floor((startMs + dur * 60000) / 1000) + 86400;
      await Promise.all(keys.map(k => redis(['EXPIREAT', k, expireAt])));
      return res.status(200).json({ ok: true });
    }

    if (action === 'release') {
      if (mine.length) await redis(['DEL', ...mine]);
      return res.status(200).json({ ok: true, released: mine.length });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
}
