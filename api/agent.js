'use strict';
// Vercel serverless function: POST /api/agent
const { handle } = require('./_core');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const out = await handle(body || {});
  res.status(out.status).json(out.json);
};
