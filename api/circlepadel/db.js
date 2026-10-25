let memoryDB = null;

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (data && typeof data === 'object') {
        memoryDB = data;
      }
      return res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }

  if (req.method === 'GET') {
    if (memoryDB) {
      return res.status(200).json(memoryDB);
    }
    return res.status(200).json({ ok: true, players: [], bookings: [] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
