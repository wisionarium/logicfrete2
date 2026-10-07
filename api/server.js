// Vercel Serverless: todo /api/* cai no Express de ../server.js
// (arquivos estaticos o CDN da Vercel serve sozinho).
const { app, ready } = require('../server');

module.exports = async (req, res) => {
  try {
    await ready;
    return app(req, res);
  } catch (e) {
    // Erro de config (ex.: env faltando) vira 500 legivel, nunca crash cego.
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'server_misconfigured', message: String((e && e.message) || e) }));
  }
};
