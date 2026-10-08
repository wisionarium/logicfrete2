/**
 * DATA MANAGEMENT (Localhost Version — Postgres local via /api)
 * Logic Frete - banco Turso (nuvem) via /api. Site em http://localhost:3000
 */

const TOKEN_KEY = 'logic_frete_token';

function authHeader() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { 'Authorization': 'Bearer ' + t } : {};
  } catch (e) { return {}; }
}

// Sessao invalida/expirada: limpa e volta para a tela de login.
// So recarrega se HAVIA token (sessao expirada no meio do uso). Sem token
// (tela de login) nunca recarrega — senao cada 401 virava loop infinito,
// pois o guard _authRedirecting zera a cada reload.
function handleUnauthorized() {
  let hadToken = false;
  try {
    hadToken = !!localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem('logic_frete_session');
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
  if (hadToken && !window._authRedirecting) {
    window._authRedirecting = true;
    window.location.reload();
  }
}

async function apiGet(p) {
  const r = await fetch(p, { headers: { ...authHeader() } });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Sessao expirada. Faca login novamente.'); }
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return r.json();
}
async function apiSend(method, p, body) {
  const r = await fetch(p, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Sessao expirada. Faca login novamente.'); }
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = j.error || JSON.stringify(j); } catch (e) { /* texto */ }
    throw new Error(`${method} ${p}: ${msg}`);
  }
  // 204/DELETE pode vir sem corpo
  const txt = await r.text();
  return txt ? JSON.parse(txt) : { ok: true };
}

const StorageManager = {
  _cache: {
    users: [],
    drivers: [],
    routes: [],
    deliveries: [],
    vehicles: [],
    pending_deliveries: [],
    day_notes: [],
    settings: {},
    historicalRoutes: null,
    historicalDeliveries: null
  },

  _mapRoute(r) {
    if (!r) return null;
    let origin = r.origin || null;
    if (typeof origin === 'string') {
      try { origin = JSON.parse(origin); } catch (e) { origin = null; }
    }
    return {
      ...r,
      distanceKm: r.distance_km,
      durationMin: r.duration_min,
      driverId: r.driver_id,
      origin
    };
  },

  _mapDelivery(d) {
    if (!d) return null;
    return { ...d, ref: d.reference, routeId: d.route_id };
  },

  _recentRoutes(all) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cut = cutoff.toISOString().split('T')[0];
    return (all || [])
      .map((r) => this._mapRoute(r))
      .filter((r) => r.status !== 'done' || (r.date && String(r.date).slice(0, 10) >= cut));
  },

  async init() {
    console.log('Data: sincronizando com Turso...');
    const [users, drivers, vehicles, pending, notes, settings, routesRaw, deliveriesRaw] = await Promise.all([
      apiGet('/api/users').catch(() => []),
      apiGet('/api/drivers').catch(() => []),
      apiGet('/api/vehicles').catch(() => []),
      apiGet('/api/pending_deliveries').catch(() => []),
      apiGet('/api/day-notes').catch(() => []),
      apiGet('/api/settings').catch(() => ({})),
      apiGet('/api/routes').catch(() => []),
      apiGet('/api/deliveries').catch(() => [])
    ]);
    this._cache.users = users || [];
    this._cache.drivers = drivers || [];
    this._cache.vehicles = vehicles || [];
    this._cache.pending_deliveries = (pending || []).filter((p) => p.status === 'pending');
    this._cache.day_notes = notes || [];
    this._cache.settings = settings || {};
    this._cache.routes = this._recentRoutes(routesRaw);
    const visibleIds = new Set(this._cache.routes.map((r) => String(r.id)));
    this._cache.deliveries = (deliveriesRaw || [])
      .map((d) => this._mapDelivery(d))
      .filter((d) => visibleIds.has(String(d.routeId)));
    await this.autoConcludePastRoutes();
    console.log(`Data: OK [Users: ${this._cache.users.length} | Rotas: ${this._cache.routes.length} | Entregas: ${this._cache.deliveries.length}]`);
  },

  _autoConcluded: false,

  async autoConcludePastRoutes() {
    if (this._autoConcluded) return 0;
    this._autoConcluded = true;
    if (!this._cache.routes || this._cache.routes.length === 0) return 0;
    try {
      const now = new Date();
      const todayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
      const old = this._cache.routes.filter((r) => r.status !== 'done' && r.status !== 'failed' && r.date && String(r.date).slice(0, 10) < todayStr);
      if (!old.length) return 0;
      for (const r of old) {
        await apiSend('PUT', `/api/routes/${r.id}`, { status: 'done' });
        r.status = 'done';
      }
      try { if (typeof showToast === 'function') showToast(`${old.length} rota(s) antiga(s) movida(s) para Concluidas`); } catch (e) {}
      return old.length;
    } catch (e) {
      console.warn('Data: auto-conclude falhou:', e);
      return 0;
    }
  },

  async logAction(action, details) {
    if (!window.appPermissions || !window.appPermissions.currentUser) return;
    const currentUser = window.appPermissions.currentUser;
    const logEntry = {
      timestamp: Date.now(),
      userName: currentUser.name || 'Desconhecido',
      userRole: currentUser.role || 'VISUALIZADOR',
      action, details
    };
    let logs = this.getSetting('audit_logs', []);
    if (typeof logs === 'string') { try { logs = JSON.parse(logs); } catch (e) { logs = []; } }
    if (!Array.isArray(logs)) logs = [];
    logs.unshift(logEntry);
    if (logs.length > 100) logs = logs.slice(0, 100);
    try { await this.saveSetting('audit_logs', JSON.stringify(logs)); }
    catch (e) { console.error('Falha ao salvar log', e); }
  },

  // ─── VEHICLES ───
  getVehicles() { return this._cache.vehicles; },
  getVehicle(id) { return this._cache.vehicles.find((v) => String(v.id) === String(id)); },
  async fetchVehicles() {
    try { this._cache.vehicles = await apiGet('/api/vehicles'); } catch (e) { console.error(e); }
    return this._cache.vehicles;
  },
  async saveVehicle(vehicle) {
    const payload = {
      name: vehicle.name,
      plate: vehicle.plate || null,
      current_km: vehicle.current_km === '' || vehicle.current_km == null ? 0 : Number(vehicle.current_km),
      maintenance_plan_km: vehicle.maintenance_plan_km === '' || vehicle.maintenance_plan_km == null ? 0 : Number(vehicle.maintenance_plan_km),
      maintenance_type: vehicle.maintenance_type || null,
      maintenance_interval_km: vehicle.maintenance_interval_km === '' || vehicle.maintenance_interval_km == null ? 0 : Number(vehicle.maintenance_interval_km)
    };
    const saved = vehicle.id
      ? await apiSend('PUT', `/api/vehicles/${vehicle.id}`, payload)
      : await apiSend('POST', '/api/vehicles', payload);
    await this.fetchVehicles();
    if (this.logAction) this.logAction(vehicle.id ? 'EDITAR_VEICULO' : 'CRIAR_VEICULO', `Veiculo ${payload.name} salvo.`);
    return saved;
  },
  async deleteVehicle(id) {
    await apiSend('DELETE', `/api/vehicles/${id}`);
    if (this.logAction) this.logAction('EXCLUIR_VEICULO', `Veiculo ID ${id} excluido.`);
    this._cache.vehicles = this._cache.vehicles.filter((v) => String(v.id) !== String(id));
  },

  // ─── USERS ───
  getUsers() { return this._cache.users; },
  async fetchUsers() {
    try { this._cache.users = await apiGet('/api/users'); } catch (e) { console.error(e); }
    return this._cache.users;
  },
  async saveUser(user) {
    const payload = {
      name: user.name,
      username: (user.username || '').toLowerCase(),
      role: user.role,
      permissions: user.permissions || []
    };
    if (user.password) payload.password = user.password;
    let saved;
    if (!user.id) {
      if (!payload.password) throw new Error('A senha e obrigatoria para novos usuarios.');
      saved = await apiSend('POST', '/api/users', payload);
      if (this.logAction) this.logAction('CRIAR_USUARIO', `Usuario ${payload.name} (${payload.role}) criado.`);
    } else {
      saved = await apiSend('PUT', `/api/users/${user.id}`, payload.password ? payload : { ...payload, password: undefined });
      if (this.logAction) this.logAction('EDITAR_USUARIO', `Usuario ${payload.name} (${payload.role}) salvo.`);
    }
    await this.fetchUsers();
    return saved;
  },
  async deleteUser(id) {
    await apiSend('DELETE', `/api/users/${id}`);
    if (this.logAction) this.logAction('EXCLUIR_USUARIO', `Usuario ID ${id} excluido.`);
    this._cache.users = this._cache.users.filter((u) => String(u.id) !== String(id));
  },

  // ─── DRIVERS ───
  getDrivers() { return this._cache.drivers; },
  getDriver(id) { return this._cache.drivers.find((d) => String(d.id) === String(id)); },
  async fetchDrivers() {
    try { this._cache.drivers = await apiGet('/api/drivers'); } catch (e) { console.error(e); }
    return this._cache.drivers;
  },
  async saveDriver(driver) {
    const payload = { name: driver.name, phone: driver.phone || null };
    const isNew = !driver.id;
    const saved = isNew
      ? await apiSend('POST', '/api/drivers', payload)
      : await apiSend('PUT', `/api/drivers/${driver.id}`, payload);
    if (isNew && saved && saved.id) {
      try {
        const usernameBase = String(saved.name).toLowerCase().trim().replace(/\s+/g, '.');
        await this.saveUser({
          name: saved.name, username: `${usernameBase}@logicfrete.com`,
          password: 'logicfrete123', role: 'Motorista', permissions: ['view_route']
        });
      } catch (e) { console.warn('Nao foi possivel criar usuario do motorista:', e.message); }
    }
    await this.fetchDrivers();
    if (this.logAction) this.logAction(driver.id ? 'EDITAR_MOTORISTA' : 'CRIAR_MOTORISTA', `Motorista ${payload.name} salvo.`);
    return saved;
  },
  async deleteDriver(id) {
    for (const r of this._cache.routes.filter((x) => String(x.driverId) === String(id))) {
      try { await apiSend('PUT', `/api/routes/${r.id}`, { driver_id: null }); } catch (e) {}
      r.driverId = null;
    }
    await apiSend('DELETE', `/api/drivers/${id}`);
    if (this.logAction) this.logAction('EXCLUIR_MOTORISTA', `Motorista ID ${id} excluido.`);
    this._cache.drivers = this._cache.drivers.filter((d) => String(d.id) !== String(id));
  },

  // ─── ROUTES ───
  getRoutes() { return this._cache.routes; },
  getRoute(id) {
    let r = this._cache.routes.find((x) => String(x.id) === String(id));
    if (!r && this._cache.historicalRoutes) r = this._cache.historicalRoutes.find((x) => String(x.id) === String(id));
    return r;
  },
  async fetchRoutes() {
    try {
      const all = await apiGet('/api/routes');
      this._cache.routes = this._recentRoutes(all);
    } catch (e) { console.error('fetchRoutes:', e); }
    return this._cache.routes;
  },
  async fetchHistoricalRoutes() {
    try {
      const all = await apiGet('/api/routes');
      const done = (all || []).filter((r) => r.status === 'done').map((r) => this._mapRoute(r));
      const ids = new Set(done.map((r) => String(r.id)));
      const allDel = await apiGet('/api/deliveries');
      const dels = (allDel || []).map((d) => this._mapDelivery(d)).filter((d) => ids.has(String(d.routeId)));
      this._cache.historicalRoutes = done;
      this._cache.historicalDeliveries = dels;
      return { routes: done, deliveries: dels };
    } catch (e) { console.error(e); return { routes: [], deliveries: [] }; }
  },
  async saveRoute(route) {
    const payload = {
      name: route.name, date: route.date || null, notes: route.notes || null,
      vehicle: route.vehicle || null, plate: route.plate || null,
      color: route.color || 'default', status: route.status || 'planned',
      distance_km: route.distanceKm != null ? Number(route.distanceKm) : null,
      duration_min: route.durationMin != null ? Number(route.durationMin) : null,
      driver_id: route.driverId || null,
      origin: route.origin || null
    };
    const saved = route.id
      ? await apiSend('PUT', `/api/routes/${route.id}`, payload)
      : await apiSend('POST', '/api/routes', payload);
    await this.fetchRoutes();
    if (this.logAction) this.logAction(route.id ? 'EDITAR_ROTA' : 'CRIAR_ROTA', `Rota ${payload.name} salva.`);
    return this._mapRoute(saved);
  },
  async deleteRoute(id) {
    const stops = this._cache.deliveries.filter((d) => String(d.routeId) === String(id));
    for (const s of stops) { try { await apiSend('DELETE', `/api/deliveries/${s.id}`); } catch (e) {} }
    await apiSend('DELETE', `/api/routes/${id}`);
    if (this.logAction) this.logAction('EXCLUIR_ROTA', `Rota ID ${id} excluida.`);
    await this.fetchRoutes();
    await this.fetchDeliveries();
  },

  // ─── DELIVERIES ───
  getDeliveries() { return this._cache.deliveries; },
  getDeliveriesByRoute(routeId) {
    let dels = this._cache.deliveries.filter((d) => String(d.routeId) === String(routeId));
    if (!dels.length && this._cache.historicalDeliveries) {
      dels = this._cache.historicalDeliveries.filter((d) => String(d.routeId) === String(routeId));
    }
    return dels.sort((a, b) => (a.order || 0) - (b.order || 0));
  },
  async fetchDeliveries() {
    try {
      const ids = new Set((this._cache.routes || []).map((r) => String(r.id)));
      const all = await apiGet('/api/deliveries');
      this._cache.deliveries = (all || []).map((d) => this._mapDelivery(d))
        .filter((d) => ids.size === 0 || ids.has(String(d.routeId)));
    } catch (e) { console.error('fetchDeliveries:', e); }
    return this._cache.deliveries;
  },
  async saveDelivery(delivery, skipRefresh = false) {
    const payload = {
      recipient: delivery.recipient, cpf: delivery.cpf || null, phone: delivery.phone || null,
      model: delivery.model || null, reference: delivery.ref || null,
      address: delivery.address || null,
      lat: delivery.lat != null && delivery.lat !== '' ? Number(delivery.lat) : null,
      lng: delivery.lng != null && delivery.lng !== '' ? Number(delivery.lng) : null,
      order: delivery.order || 1, status: delivery.status || 'pending',
      notes: delivery.notes || null, route_id: delivery.routeId
    };
    if (delivery.sale_id) payload.sale_id = delivery.sale_id;
    const saved = delivery.id
      ? await apiSend('PUT', `/api/deliveries/${delivery.id}`, payload)
      : await apiSend('POST', '/api/deliveries', payload);
    if (!skipRefresh) await this.fetchDeliveries();
    if (this.logAction && !skipRefresh) this.logAction(delivery.id ? 'EDITAR_PARADA' : 'CRIAR_PARADA', `Parada p/ ${payload.recipient} salva.`);
    return this._mapDelivery(saved);
  },
  async deleteDelivery(id) {
    await apiSend('DELETE', `/api/deliveries/${id}`);
    if (this.logAction) this.logAction('EXCLUIR_PARADA', `Parada ID ${id} excluida.`);
    this._cache.deliveries = this._cache.deliveries.filter((d) => String(d.id) !== String(id));
    await this.fetchDeliveries();
  },

  exportData() {
    const data = {
      routes: this._cache.routes, deliveries: this._cache.deliveries,
      drivers: this._cache.drivers, exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logic-frete-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // --- PENDING DELIVERIES ---
  getPendingDeliveries() { return this._cache.pending_deliveries || []; },
  async fetchPendingDeliveries() {
    try {
      const all = await apiGet('/api/pending_deliveries');
      this._cache.pending_deliveries = (all || []).filter((p) => p.status === 'pending');
    } catch (e) { console.error(e); }
    return this._cache.pending_deliveries;
  },
  async updatePendingDeliveryStatus(id, newStatus) {
    try {
      await apiSend('PUT', `/api/pending_deliveries/${id}`, { status: newStatus });
      if (newStatus !== 'pending') {
        this._cache.pending_deliveries = this._cache.pending_deliveries.filter((pd) => String(pd.id) !== String(id));
      }
    } catch (e) { console.error(e); }
  },
  async deletePendingDelivery(id) {
    await apiSend('DELETE', `/api/pending_deliveries/${id}`);
    this._cache.pending_deliveries = this._cache.pending_deliveries.filter((pd) => String(pd.id) !== String(id));
    if (this.logAction) this.logAction('EXCLUIR_PENDENTE', `Entrega pendente ID ${id} excluida.`);
  },

  // ─── AUTH (local, com token JWT) ───
  async login(username, password) {
    const raw = String(username).trim();
    const tryLogin = async (u) => {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password })
      });
      if (!r.ok) return null;
      return r.json(); // { user, token }
    };
    let res = await tryLogin(raw);
    if (!res && !raw.includes('@')) res = await tryLogin(`${raw}@logicfrete.com`);
    if (!res || !res.user || !res.token) return false;
    try { localStorage.setItem(TOKEN_KEY, res.token); } catch (e) {}
    this.setCurrentUser(res.user);
    return true;
  },
  getCurrentUser() {
    try {
      const s = localStorage.getItem('logic_frete_session');
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  },
  setCurrentUser(user) {
    try { localStorage.setItem('logic_frete_session', JSON.stringify(user)); } catch (e) {}
  },
  logout() {
    try {
      localStorage.removeItem('logic_frete_session');
      localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  },

  // ─── DASHBOARD ───
  getDashboardStats() {
    const routes = this.getRoutes();
    const todayStr = new Date().toISOString().split('T')[0];
    const todayRoutes = routes.filter((r) => r.date && String(r.date).startsWith(todayStr));
    const totalKm = todayRoutes.reduce((s, r) => s + (parseFloat(r.distanceKm) || 0), 0);
    return {
      routesToday: todayRoutes.length,
      pending: todayRoutes.filter((r) => r.status === 'planned').length,
      done: todayRoutes.filter((r) => r.status === 'done').length,
      km: totalKm.toFixed(1)
    };
  },

  // ─── SETTINGS ───
  getSetting(key, defaultValue = null) {
    return this._cache.settings[key] !== undefined ? this._cache.settings[key] : defaultValue;
  },
  async saveSetting(key, value) {
    this._cache.settings[key] = value;
    await apiSend('PUT', `/api/settings/${encodeURIComponent(key)}`, { value: typeof value === 'string' ? value : JSON.stringify(value) });
  },

  getDayNote(date) {
    const n = this._cache.day_notes.find((x) => String(x.date).slice(0, 10) === String(date).slice(0, 10));
    return n ? n.note : null;
  },
  async saveDayNote(date, note) {
    try {
      if (!note || !String(note).trim()) {
        await apiSend('DELETE', `/api/day-notes/${date}`);
        this._cache.day_notes = this._cache.day_notes.filter((n) => String(n.date).slice(0, 10) !== String(date).slice(0, 10));
        return { error: null };
      }
      const saved = await apiSend('PUT', `/api/day-notes/${date}`, { note });
      const i = this._cache.day_notes.findIndex((n) => String(n.date).slice(0, 10) === String(date).slice(0, 10));
      if (i >= 0) this._cache.day_notes[i] = saved;
      else this._cache.day_notes.push(saved);
      return { error: null, data: saved };
    } catch (e) { return { error: { message: e.message } }; }
  },

  // ─── RASTREIO MOTORISTA AO VIVO (tracking v2) ───
  async sendDriverLocation(payload) {
    return apiSend('POST', '/api/track/location', payload);
  },
  async setSharing(isSharing) {
    return apiSend('POST', '/api/track/sharing', { is_sharing: !!isSharing });
  },
  async getDriverLocations() {
    return apiGet('/api/driver-locations');
  },
  async getTrackConsent() {
    try { return await apiGet('/api/track/consent'); }
    catch (e) { return { granted: false }; }
  },
  async saveTrackConsent(granted) {
    return apiSend('POST', '/api/track/consent', { granted: !!granted });
  }
};
