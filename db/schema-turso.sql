-- LOGIC FRETE — Schema Turso (SQLite/libSQL)
-- Mesmo modelo do Postgres local, traduzido para SQLite.
-- Regras de roles/consentimento que eram funcoes PL/pgSQL vivem no src/server.js.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Motorista',
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plate TEXT,
  current_km REAL DEFAULT 0,
  maintenance_plan_km REAL DEFAULT 0,
  maintenance_type TEXT,
  maintenance_interval_km REAL DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT,
  notes TEXT,
  vehicle TEXT,
  plate TEXT,
  color TEXT DEFAULT 'default',
  status TEXT DEFAULT 'planned',
  distance_km REAL,
  duration_min REAL,
  -- Sem FK: pode ser drivers.id OU users.id (motorista). Integridade via aplicacao.
  driver_id TEXT,
  origin TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  recipient TEXT,
  cpf TEXT,
  phone TEXT,
  model TEXT,
  reference TEXT,
  address TEXT,
  lat REAL,
  lng REAL,
  "order" INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
  sale_id TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_deliveries_route ON deliveries(route_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_sale ON deliveries(sale_id);

CREATE TABLE IF NOT EXISTS pending_deliveries (
  id TEXT PRIMARY KEY,
  sale_id TEXT UNIQUE NOT NULL,
  store_name TEXT,
  client_name TEXT,
  client_phone TEXT,
  client_cpf TEXT,
  client_address TEXT,
  client_cep TEXT,
  client_reference TEXT,
  product_name TEXT,
  variant_name TEXT,
  delivery_date TEXT,
  observations TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pending_sale ON pending_deliveries(sale_id);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_deliveries(status);

CREATE TABLE IF NOT EXISTS day_notes (
  date TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  "key" TEXT PRIMARY KEY,
  "value" TEXT
);

-- Rastreio motorista ao vivo (1 linha por motorista, sem historico)
CREATE TABLE IF NOT EXISTS driver_locations (
  driver_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  route_id TEXT REFERENCES routes(id) ON DELETE SET NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy INTEGER,
  speed REAL,
  heading REAL,
  is_sharing INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_driver_locations_sharing ON driver_locations(is_sharing);
CREATE INDEX IF NOT EXISTS idx_driver_locations_updated ON driver_locations(updated_at);

CREATE TABLE IF NOT EXISTS driver_consents (
  driver_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted INTEGER NOT NULL DEFAULT 0,
  granted_at TEXT,
  revoked_at TEXT,
  v TEXT DEFAULT 'v2-autoresume'
);
