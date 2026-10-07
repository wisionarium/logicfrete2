// Vercel Serverless: todo /api/* cai no Express de ../server.js
// (arquivos estaticos o CDN da Vercel serve sozinho).
const { app, ready } = require('../server');

module.exports = async (req, res) => {
  await ready;
  return app(req, res);
};
