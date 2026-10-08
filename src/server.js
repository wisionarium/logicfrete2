/**
 * LOGIC FRETE — Servidor (Turso na nuvem)
 * Backend Express + Turso (SQLite/libSQL na nuvem). Frontend estático via CDN da Vercel, API via function api/server.js.
 *
 * Uso:
 *   npm install
 *   npm run dev   -> http://localhost:3000  (banco no Turso)
 *   (este arquivo fica em src/ de propósito — ver nota do ROOT acima)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@libsql/client');

// Este arquivo vive em src/ (NÃO na raiz: a Vercel trataria um server.js
// da raiz como function e quebraria o site estático com "Invalid export").
// ROOT = pasta do projeto (frontend estático, .env, db/).
const ROOT = path.join(__dirname, '..');

// ---- .env simples (sem dependencia extra) ----
(function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
})();

const PORT = parseInt(process.env.PORT || '3000', 10);
const WEBHOOK_SECRET = (process.env.LOGIC_FRETE_WEBHOOK_SECRET || 'local-secret-troque-aqui').trim();
const TURSO_URL = (process.env.TURSO_DATABASE_URL || '').trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || '').trim();

let configError = null;
if (!TURSO_URL || TURSO_URL.includes('COLE_AQUI')) {
  configError = 'TURSO_DATABASE_URL nao configurado (Vercel: Settings > Environment Variables).';
}
const IS_LOCAL_FILE = TURSO_URL.startsWith('file:');
if (!configError && !IS_LOCAL_FILE && (!TURSO_TOKEN || TURSO_TOKEN.includes('COLE_AQUI'))) {
  configError = 'TURSO_AUTH_TOKEN nao configurado (Vercel: Settings > Environment Variables).';
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ============ AUTH (JWT) ============
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-troque-no-env';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h';
if (!process.env.JWT_SECRET) {
  console.warn('  AVISO: JWT_SECRET nao definido no .env — usando segredo padrao de desenvolvimento.');
}
function signToken(u) {
  return jwt.sign({ id: u.id, username: u.username, role: u.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
function isAdminRole(role) {
  return ['admin', 'master', 'gerente'].includes(String(role || '').trim().toLowerCase());
}
// Exige token em toda a API, exceto login/health/webhook (webhook tem o proprio secret)
app.use('/api', (req, res, next) => {
  const open = (req.method === 'POST' && req.path === '/login')
    || (req.method === 'GET' && req.path === '/health')
    || (req.method === 'POST' && req.path === '/webhook');
  if (open) return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'session_expired' });
  }
});
// Escrita em usuarios: so admin; o proprio usuario pode editar nome/senha (sem trocar role)
function requireAdminOrSelf(req, res, next) {
  if (req.auth && isAdminRole(req.auth.role)) return next();
  if (req.auth && req.method !== 'POST' && String(req.auth.id) === String(req.params.id)) {
    if (req.method === 'DELETE') return res.status(403).json({ error: 'forbidden' });
    if (req.body) { delete req.body.role; delete req.body.permissions; delete req.body.username; }
    return next();
  }
  return res.status(403).json({ error: 'forbidden' });
}
function requireAdmin(req, res, next) {
  if (req.auth && isAdminRole(req.auth.role)) return next();
  return res.status(403).json({ error: 'forbidden' });
}

// ============ DB (Turso / SQLite) ============
const db = createClient(IS_LOCAL_FILE ? { url: TURSO_URL } : { url: TURSO_URL, authToken: TURSO_TOKEN });

// Converte $1,$2... em ? (repetindo o valor a cada ocorrencia) e booleans em 1/0.
async function q(text, params = []) {
  const args = [];
  const sql = text.replace(/\$(\d+)/g, (_, n) => {
    const v = params[Number(n) - 1];
    if (v === undefined) args.push(null);
    else if (typeof v === 'boolean') args.push(v ? 1 : 0);
    else if (v !== null && typeof v === 'object') args.push(JSON.stringify(v));
    else args.push(v);
    return '?';
  });
  const rs = await db.execute({ sql, args });
  return { rows: rs.rows.map((r) => ({ ...r })) };
}
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

function parseMaybeJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}
const num = (v) => Number(v);

// Regra de roles (era normalize_role/is_admin no Postgres)
function normalizeRole(r) {
  const u = String(r || '').trim().toUpperCase();
  if (u === 'MASTER') return 'Master';
  if (u === 'GERENTE') return 'Gerente';
  if (u === 'ADMIN') return 'Admin';
  if (u === 'VENDEDOR') return 'Vendedor';
  if (!u) return 'Motorista';
  if (u === 'MOTORISTA') return 'Motorista';
  return String(r).trim();
}

async function initDb() {
  await db.execute('PRAGMA foreign_keys = ON');
  const schema = fs.readFileSync(path.join(ROOT, 'db', 'schema-turso.sql'), 'utf8');
  const stmts = schema.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  await db.batch(stmts.map((sql) => ({ sql, args: [] })));
  // Migracoes idempotentes (bancos criados por versoes antigas do schema).
  // Padrao seguro: cria _new + copia + drop + renomeia _new para o lugar.
  // (Nunca renomear a tabela referenciada: o SQLite reescreveria as FKs p/ o nome velho.)
  async function rebuildTable(name, createSql, cols, indexes = []) {
    await db.execute('PRAGMA foreign_keys = OFF');
    try {
      await db.execute(createSql.replace(`TABLE ${name} (`, `TABLE ${name}_new (`));
      await db.execute(`INSERT INTO ${name}_new (${cols}) SELECT ${cols} FROM ${name}`);
      await db.execute(`DROP TABLE ${name}`);
      await db.execute(`ALTER TABLE ${name}_new RENAME TO ${name}`);
      for (const ix of indexes) await db.execute(ix);
    } finally {
      await db.execute('PRAGMA foreign_keys = ON');
    }
  }
  const ROUTES_COLS = 'id, name, date, notes, vehicle, plate, color, status, distance_km, duration_min, driver_id, origin, created_at';
  const ROUTES_DDL = `CREATE TABLE routes (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT, notes TEXT,
    vehicle TEXT, plate TEXT, color TEXT DEFAULT 'default', status TEXT DEFAULT 'planned',
    distance_km REAL, duration_min REAL, driver_id TEXT, origin TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`;
  const DELIV_COLS = 'id, recipient, cpf, phone, model, reference, address, lat, lng, "order", status, notes, route_id, sale_id, created_at';
  const DELIV_DDL = `CREATE TABLE deliveries (
    id TEXT PRIMARY KEY, recipient TEXT, cpf TEXT, phone TEXT, model TEXT,
    reference TEXT, address TEXT, lat REAL, lng REAL, "order" INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending', notes TEXT,
    route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
    sale_id TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`;
  const LOC_COLS = 'driver_id, route_id, lat, lng, accuracy, speed, heading, is_sharing, updated_at';
  const LOC_DDL = `CREATE TABLE driver_locations (
    driver_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    route_id TEXT,
    lat REAL NOT NULL, lng REAL NOT NULL, accuracy INTEGER, speed REAL, heading REAL,
    is_sharing INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`;
  try {
    // 1) routes.driver_id aceitava so drivers.id -> agora aceita users.id tambem
    const fk = await q(`SELECT "table" AS parent, "from" AS col FROM pragma_foreign_key_list('routes')`);
    if (fk.rows.some((r) => r.parent === 'drivers' && r.col === 'driver_id')) {
      console.log('Migracao: routes.driver_id sem FK (preservando dados)...');
      await rebuildTable('routes', ROUTES_DDL, ROUTES_COLS);
    }
    // 2) FKs apontando p/ tabela fantasma routes_old -> reconstruir certo
    for (const [t, ddl, cols, idx] of [
      ['deliveries', DELIV_DDL, DELIV_COLS,
        ['CREATE INDEX IF NOT EXISTS idx_deliveries_route ON deliveries(route_id)',
         'CREATE INDEX IF NOT EXISTS idx_deliveries_sale ON deliveries(sale_id)']],
      ['driver_locations', LOC_DDL, LOC_COLS,
        ['CREATE INDEX IF NOT EXISTS idx_driver_locations_sharing ON driver_locations(is_sharing)',
         'CREATE INDEX IF NOT EXISTS idx_driver_locations_updated ON driver_locations(updated_at)']]
    ]) {
      const cur = await q('SELECT sql FROM sqlite_master WHERE name = $1', [t]);
      if (cur.rows[0] && String(cur.rows[0].sql || '').includes('routes_old')) {
        console.log(`Migracao: reconstruindo ${t} sem routes_old (preservando dados)...`);
        await rebuildTable(t, ddl, cols, idx);
      }
    }
  } catch (e) { console.warn('Migracao pulada:', e.message); }
  // Normaliza roles legadas (idempotente)
  const all = await q('SELECT id, role FROM users');
  for (const u of all.rows) {
    const fixed = normalizeRole(u.role);
    if (fixed !== u.role) await q('UPDATE users SET role = $1 WHERE id = $2', [fixed, u.id]);
  }
  // Seed: usuario admin se tabela vazia
  const count = await q('SELECT COUNT(*) AS c FROM users');
  if (num(count.rows[0].c) === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await q(
      'INSERT INTO users (id, name, username, password_hash, role, permissions) VALUES ($1,$2,$3,$4,$5,$6)',
      [uuid(), 'Administrador', 'admin', hash, 'Master', JSON.stringify(['view_route', 'edit_route', 'reorder_stops', 'edit_notes'])]
    );
    console.log('Seed: usuario criado -> login: admin | senha: admin123');
  }
}

const uuid = () => crypto.randomUUID();

const pubUser = (u) => ({
  id: u.id, name: u.name, username: u.username, role: u.role,
  permissions: parseMaybeJson(u.permissions, []),
  created_at: u.created_at
});

// ============ AUTH ============
app.post('/api/login', async (req, res) => {
  try {
    let { username = '', password = '' } = req.body || {};
    username = String(username).trim();
    if (!username) return res.status(401).json({ error: 'invalid_credentials' });
    const r = await q('SELECT * FROM users WHERE LOWER(username) = LOWER(TRIM($1)) LIMIT 1', [username]);
    const u = r.rows[0];
    if (!u) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(String(password), u.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    res.json({ user: pubUser(u), token: signToken(u) });
  } catch (e) {
    console.error('login:', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============ USERS ============
app.get('/api/users', async (_req, res) => {
  const r = await q('SELECT * FROM users ORDER BY name');
  res.json(r.rows.map(pubUser));
});
app.post('/api/users', requireAdminOrSelf, async (req, res) => {
  try {
    const { name, username, password, role = 'Motorista', permissions = [] } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_username_required' });
    if (!username || !String(username).trim()) return res.status(400).json({ error: 'name_username_required' });
    if (!password) return res.status(400).json({ error: 'password_required' });
    const hash = await bcrypt.hash(String(password), 10);
    const id = uuid();
    try {
      await q(
        'INSERT INTO users (id, name, username, password_hash, role, permissions) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, String(name).trim(), String(username).trim().toLowerCase(), hash, normalizeRole(role), JSON.stringify(permissions || [])]
      );
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'username_exists' });
      throw e;
    }
    const r = await q('SELECT * FROM users WHERE id = $1', [id]);
    res.status(201).json(pubUser(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal' }); }
});
app.put('/api/users/:id', requireAdminOrSelf, async (req, res) => {
  try {
    const { name, username, password, role, permissions } = req.body || {};
    if (password) {
      const up = await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(String(password), 10), req.params.id]);
      if (up.rows === undefined) { /* libsql update ok */ }
      const chk = await q('SELECT id FROM users WHERE id = $1', [req.params.id]);
      if (!chk.rows.length) return res.status(404).json({ error: 'not_found' });
    }
    const sets = [], vals = [];
    if (name) { sets.push('name = $' + (vals.length + 1)); vals.push(String(name).trim()); }
    if (username) { sets.push('username = $' + (vals.length + 1)); vals.push(String(username).trim().toLowerCase()); }
    if (role) { sets.push('role = $' + (vals.length + 1)); vals.push(normalizeRole(role)); }
    if (permissions !== undefined) { sets.push('permissions = $' + (vals.length + 1)); vals.push(JSON.stringify(permissions)); }
    if (sets.length) {
      try {
        await q(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`, [...vals, req.params.id]);
      } catch (e) {
        if (String(e.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'username_exists' });
        throw e;
      }
    }
    const r = await q('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(pubUser(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal' }); }
});
app.delete('/api/users/:id', requireAdminOrSelf, async (req, res) => {
  try {
    const cur = await q('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'not_found' });
    await q('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal' }); }
});

// ============ GENERIC CRUD ============
function crud(table, opts = {}) {
  const { orderBy = 'created_at DESC', serialize = (r) => r } = opts;
  app.get(`/api/${table}`, async (_req, res) => {
    try {
      const r = await q(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
      res.json(r.rows.map(serialize));
    } catch (e) { console.error(table, e); res.status(500).json({ error: 'internal' }); }
  });
  app.post(`/api/${table}`, async (req, res) => {
    try {
      const body = req.body || {};
      const id = body.id || uuid();
      const cols = Object.keys(body).filter((k) => k !== 'id');
      const allCols = ['id', ...cols];
      const vals = [id, ...cols.map((k) => body[k])];
      const ph = allCols.map((_, i) => `$${i + 1}`).join(',');
      const quoted = allCols.map((c) => `"${c}"`).join(',');
      await q(`INSERT INTO ${table} (${quoted}) VALUES (${ph})`, vals);
      const r = await q(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      res.status(201).json(serialize(r.rows[0]));
    } catch (e) { console.error(table, e); res.status(500).json({ error: e.message }); }
  });
  app.put(`/api/${table}/:id`, async (req, res) => {
    try {
      const body = { ...(req.body || {}) };
      delete body.id;
      const cols = Object.keys(body);
      if (!cols.length) {
        const r = await q(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
        return res.json(r.rows[0] ? serialize(r.rows[0]) : null);
      }
      const set = cols.map((c, i) => `"${c}"=$${i + 2}`).join(',');
      await q(`UPDATE ${table} SET ${set} WHERE id = $1`, [req.params.id, ...cols.map((k) => body[k])]);
      const r = await q(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      res.json(r.rows[0] ? serialize(r.rows[0]) : null);
    } catch (e) { console.error(table, e); res.status(500).json({ error: e.message }); }
  });
  app.delete(`/api/${table}/:id`, async (req, res) => {
    try {
      await q(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (e) { console.error(table, e); res.status(500).json({ error: 'internal' }); }
  });
}

crud('drivers', { orderBy: 'name ASC' });
crud('vehicles', { orderBy: 'name ASC' });
crud('routes', {
  orderBy: 'date DESC, created_at DESC',
  serialize: (r) => ({ ...r, origin: parseMaybeJson(r.origin, null) })
});
crud('deliveries', { orderBy: 'created_at ASC', serialize: (r) => r });
crud('pending_deliveries', { orderBy: 'created_at DESC' });

// day_notes (PK = date) e settings (PK = key): upsert dedicado
app.get('/api/day-notes', async (_req, res) => {
  const r = await q('SELECT * FROM day_notes ORDER BY date DESC');
  res.json(r.rows);
});
app.put('/api/day-notes/:date', async (req, res) => {
  const { note = '' } = req.body || {};
  if (!note || !String(note).trim()) {
    await q('DELETE FROM day_notes WHERE date = $1', [req.params.date]);
    return res.json({ ok: true, deleted: true });
  }
  await q(
    `INSERT INTO day_notes (date, note, updated_at) VALUES ($1,$2,${NOW})
     ON CONFLICT (date) DO UPDATE SET note = excluded.note, updated_at = ${NOW}`,
    [req.params.date, note]
  );
  const r = await q('SELECT * FROM day_notes WHERE date = $1', [req.params.date]);
  res.json(r.rows[0]);
});
app.delete('/api/day-notes/:date', async (req, res) => {
  await q('DELETE FROM day_notes WHERE date = $1', [req.params.date]);
  res.json({ ok: true });
});
app.get('/api/settings', async (_req, res) => {
  const r = await q('SELECT * FROM settings');
  const obj = {};
  r.rows.forEach((s) => { obj[s.key] = s.value; });
  res.json(obj);
});
app.put('/api/settings/:key', async (req, res) => {
  const value = req.body && req.body.value !== undefined ? String(req.body.value) : '';
  await q(
    'INSERT INTO settings ("key", "value") VALUES ($1,$2) ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"',
    [req.params.key, value]
  );
  res.json({ ok: true });
});

// ============ RASTREIO MOTORISTA AO VIVO (tracking v2) ============
app.post('/api/track/location', async (req, res) => {
  try {
    const { lat, lng, accuracy = null, speed = null, heading = null, route_id = null } = req.body || {};
    const la = Number(lat), ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || la === 0 || ln === 0) {
      return res.status(400).json({ error: 'invalid_coords' });
    }
    if (la < -90 || la > 90 || ln < -180 || ln > 180) {
      return res.status(400).json({ error: 'invalid_coords' });
    }
    if (accuracy !== null && accuracy !== undefined && Number(accuracy) > 100) {
      return res.status(400).json({ error: 'poor_accuracy' });
    }
    await q(
      `INSERT INTO driver_locations (driver_id, route_id, lat, lng, accuracy, speed, heading, is_sharing, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,${NOW})
       ON CONFLICT (driver_id) DO UPDATE SET route_id = excluded.route_id, lat = excluded.lat,
         lng = excluded.lng, accuracy = excluded.accuracy, speed = excluded.speed,
         heading = excluded.heading, is_sharing = 1, updated_at = ${NOW}`,
      [req.auth.id, route_id || null, la, ln,
       accuracy === null || accuracy === undefined ? null : Math.round(Number(accuracy)),
       speed === null || speed === undefined ? null : Number(speed),
       heading === null || heading === undefined ? null : Number(heading)]
    );
    res.json({ ok: true });
  } catch (e) { console.error('track/location:', e); res.status(500).json({ error: 'internal' }); }
});

app.post('/api/track/sharing', async (req, res) => {
  try {
    const sharing = !!(req.body && req.body.is_sharing);
    await q(
      `INSERT INTO driver_locations (driver_id, lat, lng, is_sharing, updated_at)
       VALUES ($1, 0, 0, $2, ${sharing ? NOW : "'1970-01-01T00:00:00.000Z'"})
       ON CONFLICT (driver_id) DO UPDATE SET is_sharing = excluded.is_sharing,
         updated_at = CASE WHEN excluded.is_sharing = 1 THEN ${NOW} ELSE driver_locations.updated_at END`,
      [req.auth.id, sharing]
    );
    res.json({ ok: true, is_sharing: sharing });
  } catch (e) { console.error('track/sharing:', e); res.status(500).json({ error: 'internal' }); }
});

app.post('/api/track/consent', async (req, res) => {
  try {
    const granted = !!(req.body && req.body.granted);
    await q(
      `INSERT INTO driver_consents (driver_id, granted, granted_at, revoked_at, v)
       VALUES ($1, $2, CASE WHEN $2 = 1 THEN ${NOW} ELSE NULL END, CASE WHEN $2 = 1 THEN NULL ELSE ${NOW} END, 'v2-autoresume')
       ON CONFLICT (driver_id) DO UPDATE SET granted = excluded.granted,
         granted_at = CASE WHEN excluded.granted = 1 THEN COALESCE(driver_consents.granted_at, ${NOW}) ELSE driver_consents.granted_at END,
         revoked_at = CASE WHEN excluded.granted = 1 THEN NULL ELSE ${NOW} END,
         v = 'v2-autoresume'`,
      [req.auth.id, granted]
    );
    res.json({ ok: true, granted });
  } catch (e) { console.error('track/consent:', e); res.status(500).json({ error: 'internal' }); }
});

app.get('/api/track/consent', async (req, res) => {
  try {
    const r = await q('SELECT * FROM driver_consents WHERE driver_id = $1', [req.auth.id]);
    const row = r.rows[0] || { driver_id: req.auth.id, granted: 0, v: 'v2-autoresume' };
    res.json({ ...row, granted: !!num(row.granted) });
  } catch (e) { console.error('track/consent:', e); res.status(500).json({ error: 'internal' }); }
});

app.get('/api/driver-locations', requireAdmin, async (_req, res) => {
  try {
    const r = await q(
      `SELECT l.*, u.name AS driver_name, u.role AS driver_role, rt.name AS route_name
       FROM driver_locations l
       LEFT JOIN users u ON u.id = l.driver_id
       LEFT JOIN routes rt ON rt.id = l.route_id
       ORDER BY l.updated_at DESC LIMIT 100`
    );
    res.json(r.rows.map((row) => ({ ...row, is_sharing: !!num(row.is_sharing) })));
  } catch (e) { console.error('driver-locations:', e); res.status(500).json({ error: 'internal' }); }
});

// ============ WEBHOOK (integracao de vendas) ============
app.post('/api/webhook', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
    if (token !== WEBHOOK_SECRET) return res.status(401).json({ error: 'Token invalido' });
    const { event, sale_id, ...data } = req.body || {};
    if (!sale_id) return res.status(400).json({ error: 'sale_id obrigatorio' });
    if (event === 'sale.created') {
      const payload = {
        sale_id, store_name: data.store_name || null, client_name: data.client_name || null,
        client_phone: data.client_phone || null, client_cpf: data.client_cpf || null,
        client_address: data.client_address || null, client_cep: data.client_cep || null,
        client_reference: data.client_reference || null, product_name: data.product_name || null,
        variant_name: data.variant_name || null, delivery_date: data.delivery_date || null,
        observations: data.observations || null, status: 'pending'
      };
      const cols = Object.keys(payload);
      const vals = cols.map((k) => payload[k]);
      const sets = cols.filter((c) => c !== 'sale_id').map((c) => `${c} = excluded.${c}`).join(', ');
      const r = await q(
        `INSERT INTO pending_deliveries (id, ${cols.join(',')}) VALUES ($1,${cols.map((_, i) => `$${i + 2}`).join(',')})
         ON CONFLICT (sale_id) DO UPDATE SET ${sets} RETURNING *`,
        [uuid(), ...vals]
      );
      return res.json({ success: true, message: 'Entrega salva!', data: r.rows[0] });
    }
    if (event === 'sale.cancelled') {
      await q('DELETE FROM pending_deliveries WHERE sale_id = $1', [sale_id]);
      await q('DELETE FROM deliveries WHERE sale_id = $1', [sale_id]);
      return res.json({ success: true, message: 'Entrega cancelada/removida!' });
    }
    return res.status(400).json({ error: `Evento desconhecido: ${event}` });
  } catch (e) {
    console.error('webhook:', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await db.execute('SELECT 1');
    res.json({ ok: true, db: IS_LOCAL_FILE ? 'sqlite-local' : 'turso', time: new Date().toISOString() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Mostra onde esta o banco e quantos registros ha em cada tabela
app.get('/api/db-info', async (_req, res) => {
  try {
    const tables = ['users', 'drivers', 'vehicles', 'routes', 'deliveries', 'pending_deliveries', 'day_notes', 'settings', 'driver_locations', 'driver_consents'];
    const counts = {};
    for (const t of tables) {
      const r = await q(`SELECT COUNT(*) AS c FROM ${t}`);
      counts[t] = num(r.rows[0].c);
    }
    const objs = await q(`SELECT type, name FROM sqlite_master WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY 1, 2`);
    res.json({
      project: 'LOGIC FRETE',
      db: IS_LOCAL_FILE ? 'SQLite local (teste)' : 'Turso (nuvem)',
      dbUrl: IS_LOCAL_FILE ? TURSO_URL : TURSO_URL.replace(/:\/\/[^@]+@/, '://***@'),
      tables: counts,
      objects: objs.rows.map((o) => `${o.type}:${o.name}`)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ DEBUG TEMPORÁRIO (remover depois de estabilizar) ============
app.get('/api/debug-bundle', requireAdmin, async (_req, res) => {
  const cands = {
    ROOT,
    up1: path.join(__dirname, '..'),
    up2: path.join(__dirname, '..', '..'),
    dirname: __dirname,
    cwd: process.cwd()
  };
  const want = ['index.html', 'style.css', 'data.js', 'maps.js', 'app.js', 'tracking.js',
    'sw.js', 'manifest.json', 'apple-touch-icon.png', 'icone-192.png', 'supra-bike.png',
    'db/schema-turso.sql', 'src/server.js', 'api/server.js'];
  const out = { cands: {}, staticDir: findBundleStatic() };
  for (const [name, dir] of Object.entries(cands)) {
    try {
      const entries = fs.readdirSync(dir).slice(0, 40);
      const has = {};
      for (const f of want) {
        try { has[f] = fs.existsSync(path.join(dir, f)); } catch (e) { has[f] = false; }
      }
      out.cands[name] = { dir, entries, has };
    } catch (e) { out.cands[name] = { dir, error: e.message }; }
  }
  res.json(out);
});

// ============ STATIC ============
// Local (node src/server.js): express.static direto da pasta.
// Vercel (function api/server.js): o mesmo Express serve o frontend a partir
// dos arquivos incluídos no bundle (vercel.json -> includeFiles), pois o
// vercel.json roteia TUDO (/api/* e demais paths) para a function.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};
// Nunca servir pela function (nem pelo server local)
const BUNDLE_BLOCKED = [/^\/src\//, /^\/db\//, /^\/data\//, /^\/scripts\//, /^\/node_modules\//, /^\/\.env/, /\/\.env$/, /\.sql$/, /\.log$/];
// Acha a pasta do frontend dentro do bundle da Vercel (estrutura pode variar);
// localmente é sempre a raiz do projeto (ROOT).
let bundleDirCache = null;
function findBundleStatic() {
  if (bundleDirCache) return bundleDirCache;
  const cands = [ROOT, path.join(__dirname, '..'), path.join(__dirname, '..', '..'), path.join(__dirname), process.cwd()];
  for (const c of cands) {
    try {
      if (c && fs.existsSync(path.join(c, 'index.html'))) { bundleDirCache = c; return c; }
    } catch (e) {}
  }
  return null;
}
// Whitelist de arquivos do frontend servidos pela function.
// Cada path é literal de propósito: é assim que o bundler da Vercel
// detecta e inclui os arquivos no bundle (includeFiles sozinho não bastou).
const BUNDLE_FILES = {
  '/': path.join(__dirname, '..', 'index.html'),
  '/index.html': path.join(__dirname, '..', 'index.html'),
  '/style.css': path.join(__dirname, '..', 'style.css'),
  '/data.js': path.join(__dirname, '..', 'data.js'),
  '/maps.js': path.join(__dirname, '..', 'maps.js'),
  '/app.js': path.join(__dirname, '..', 'app.js'),
  '/tracking.js': path.join(__dirname, '..', 'tracking.js'),
  '/sw.js': path.join(__dirname, '..', 'sw.js'),
  '/manifest.json': path.join(__dirname, '..', 'manifest.json'),
  '/apple-touch-icon.png': path.join(__dirname, '..', 'apple-touch-icon.png'),
  '/icone-180.png': path.join(__dirname, '..', 'icone-180.png'),
  '/icone-192.png': path.join(__dirname, '..', 'icone-192.png'),
  '/icone-512.png': path.join(__dirname, '..', 'icone-512.png'),
  '/supra-bike.png': path.join(__dirname, '..', 'supra-bike.png')
};
const BUNDLE_INDEX = path.join(__dirname, '..', 'index.html');
// Espelha o bloco local: arquivo existente = serve; rota sem extensão = index.html (SPA);
// /api/* desconhecido = 404 JSON; resto com extensão inexistente = 404 texto.
function serveBundleStatic(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  if (BUNDLE_BLOCKED.some((re) => re.test(req.path))) return res.status(403).send('Forbidden');
  let rel = req.path;
  try { rel = decodeURIComponent(req.path); } catch (e) {}
  const sendBuf = (f, isIndex) => {
    fs.readFile(f, (err, buf) => {
      if (!err) {
        res.setHeader('Content-Type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
        return res.send(buf);
      }
      if (isIndex) return res.status(404).send('Not found');
      return sendBuf(BUNDLE_INDEX, true);
    });
  };
  const file = BUNDLE_FILES[rel];
  if (file) return sendBuf(file, rel === '/' || rel === '/index.html');
  if (!path.extname(rel)) return sendBuf(BUNDLE_INDEX, true);
  return res.status(404).send('Not found');
}
if (require.main === module) {
  const BLOCKED = [/^\/.env/, /^\/src\//, /^\/db\//, /^\/data\//, /^\/node_modules\//, /\/\.env$/, /\.sql$/, /^\/api\/webhook\.js/];
  app.use((req, res, next) => {
    if (BLOCKED.some((re) => re.test(req.path))) return res.status(403).send('Forbidden');
    next();
  });
  app.use(express.static(ROOT, { index: 'index.html' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(ROOT, 'index.html'));
  });
} else {
  app.use(serveBundleStatic);
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
}

const INDEX_PATH = path.join(ROOT, 'index.html');

// Pronto quando o schema do Turso foi aplicado (reuso local + serverless Vercel).
// Sem process.exit na importacao: na Vercel, erro de config vira 500 JSON (debugavel),
// nunca FUNCTION_INVOCATION_FAILED.
const ready = configError
  ? Promise.reject(new Error(configError))
  : initDb().then(() => app);

// Servidor local: node src/server.js / npm run dev
if (require.main === module) {
  if (configError) {
    console.error('\n  ERRO: ' + configError);
    console.error('  Coloque os valores no .env e rode de novo.\n');
    process.exit(1);
  }
  ready.then(() => {
    const server = app.listen(PORT, () => {
      console.log('\n  === LOGIC FRETE ===');
      console.log(`  Pasta do projeto : ${ROOT}`);
      console.log(`  Pagina inicial   : ${INDEX_PATH}`);
      console.log(`  Banco            : ${IS_LOCAL_FILE ? 'SQLite local (teste)' : 'Turso (nuvem)'}`);
      console.log(`  -> Site  : http://localhost:${PORT}   (titulo "LOGIC FRETE")`);
      console.log(`  -> Banco : http://localhost:${PORT}/api/db-info`);
      console.log('  -> Login padrao: admin / admin123\n');
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n  ERRO: a porta ${PORT} ja esta em uso por OUTRO programa/site.`);
        console.error('  Feche o outro projeto OU rode este com outra porta, ex.:');
        console.error('    PowerShell: $env:PORT=3001; npm run dev\n');
        process.exit(1);
      }
      throw err;
    });
  }).catch((e) => { console.error('Falha ao iniciar banco:', e); process.exit(1); });
}

// NUNCA mudem este export para objeto puro: a Vercel pode carregar este
// arquivo como function (entrypoint auto-detectado); o export PRECISA ser
// uma função (com .app/.ready pendurados para o api/server.js usar).
async function vercelServer(req, res) {
  await ready;
  return app(req, res);
}
vercelServer.app = app;
vercelServer.ready = ready;

module.exports = vercelServer;
