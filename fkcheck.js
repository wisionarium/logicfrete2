const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim().replace(/^"|"$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  for (const t of ['deliveries', 'driver_locations', 'routes']) {
    const r = await db.execute(`SELECT sql FROM sqlite_master WHERE name = '${t}'`);
    console.log('--- ' + t + ' ---');
    console.log((r.rows[0] || {}).sql);
  }
  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
