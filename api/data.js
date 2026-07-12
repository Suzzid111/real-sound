export default async function handler(req, res) {
  const REST_URL = process.env.STORAGE_KV_REST_API_URL || process.env.KV_REST_API_URL;
  const REST_TOKEN = process.env.STORAGE_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

  async function redisCmd(cmd) {
    const r = await fetch(REST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd)
    });
    const data = await r.json();
    return data.result;
  }

  if (req.method === 'GET') {
    const key = req.query.key;
    const raw = await redisCmd(['GET', 'rs:' + key]);
    return res.status(200).json({ value: raw ? JSON.parse(raw) : null });
  }

  if (req.method === 'POST') {
    const { key, value } = req.body;
    await redisCmd(['SET', 'rs:' + key, JSON.stringify(value)]);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
