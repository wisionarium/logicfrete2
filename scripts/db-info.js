/** Mostra o banco do LOGIC FRETE (Turso ou SQLite local via .env). Uso: npm run db:info */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
})();

(async () => {
  const url = (process.env.TURSO_DATABASE_URL || '').trim();
  const token = (process.env.TURSO_AUTH_TOKEN || '').trim();
  if (!url) { console.error('TURSO_DATABASE_URL nao configurado no .env'); process.exit(1); }
  const isFile = url.startsWith('file:');
  console.log('Banco:', isFile ? url + ' (SQLite local)' : 'Turso (nuvem)');
  const db = createClient(isFile ? { url } : { url, authToken: token });
  const tables = ['users', 'drivers', 'vehicles', 'routes', 'deliveries', 'pending_deliveries', 'day_notes', 'settings', 'driver_locations', 'driver_consents'];
  for (const t of tables) {
    try {
      const r = await db.execute(`SELECT COUNT(*) AS c FROM ${t}`);
      console.log(`  ${t}: ${Number(r.rows[0].c)} registro(s)`);
    } catch (e) { console.log(`  ${t}: (tabela ausente — rode npm run dev uma vez)`); }
  }
  try {
    const u = await db.execute('SELECT username, role FROM users ORDER BY username');
    console.log('Usuarios:', u.rows.map((x) => `${x.username} (${x.role})`).join(', ') || '(nenhum)');
  } catch (e) { console.log('Usuarios: (rode npm run dev uma vez)'); }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
