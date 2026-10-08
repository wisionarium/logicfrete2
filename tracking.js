/**
 * LOGIC FRETE — Rastreio Motorista Ao Vivo (tracking v2)
 * Foreground + Wake Lock + auto-retoma. Sem lib nova, sem custo extra.
 * Realtime local: motorista envia a cada 15s/30m; ADM lê via polling de 15s.
 *
 * Premissa aceita (PWA): rastreio só com app aberto em 1º plano e tela ligada.
 * Minimizar/apagar = pausa (navegador suspende o GPS). Wake Lock impede a tela
 * de apagar; NÃO é rastreio em background.
 */
(function () {
  'use strict';

  // ---- Constantes (mesmos números do PRD) ----
  var INTENT_KEY = 'lf_tracking_intent';   // 1 = motorista quer compartilhar
  var CONSENT_KEY = 'lf_tracking_consent'; // espelho local do consentimento LGPD
  var LAYER_KEY = 'lf_driver_layer';       // camada Motoristas ON/OFF (ADM)
  var SEND_MS = 15000;          // envio a cada 15s
  var MIN_DIST_M = 30;          // ...ou a cada 30m
  var HEARTBEAT_MS = 60000;     // parado >5min: 1 ping/min
  var STOPPED_MS = 5 * 60 * 1000;
  var ONLINE_MS = 2 * 60 * 1000; // ADM: verde <2min, cinza acima
  var POLL_ADM_MS = 15000;
  var RETRY_MS = 30000;          // retry do auto-start (dados ainda carregando)
  var MAX_ACCURACY = 100;
  var SNAP_MIN_MOVE_M = 30;      // só re-cola na via se moveu >30m
  var SNAP_TTL_MS = 60000;       // ...ou passou 60s do último snap
  var SNAP_MAX_JUMP_M = 60;      // ignora via colada a >60m do GPS (rua paralela errada)
  var HIDE_KEY = 'lf_driver_hidden'; // motoristas ocultos na gaveta (JSON array de ids)
  var FOLLOW_KEY = 'lf_driver_follow'; // motorista seguido no GPS (id ou '')

  // ---- Helpers ----
  function $(id) { return document.getElementById(id); }
  function hasSM() { return typeof StorageManager !== 'undefined'; }
  function hasMap() { return typeof MapService !== 'undefined' && MapService.map; }
  function roleOf(u) { return String((u && u.role) || '').toLowerCase(); }
  function isMotorista(u) { return roleOf(u) === 'motorista'; }
  function isAdmin(u) {
    var r = roleOf(u);
    return r === 'master' || r === 'gerente' || r === 'admin';
  }
  function todayStr() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  function distM(a, b, c, d) {
    var R = 6371000, p = Math.PI / 180;
    var s1 = Math.sin((c - a) * p / 2), s2 = Math.sin((d - b) * p / 2);
    var h = s1 * s1 + Math.cos(a * p) * Math.cos(c * p) * s2 * s2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function agoText(ts) {
    if (!ts) return 'nunca';
    var s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 5) return 'agora';
    if (s < 60) return 'há ' + s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return 'há ' + m + 'min';
    return 'há ' + Math.floor(m / 60) + 'h';
  }
  // Toast próprio (o showToast do app.js não é global)
  function trackToast(msg) {
    var c = $('lfTrackToasts');
    if (!c) {
      c = document.createElement('div');
      c.id = 'lfTrackToasts';
      document.body.appendChild(c);
    }
    var t = document.createElement('div');
    t.className = 'lf-toast';
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, 4500);
  }

  // ================= MOTORISTA: TrackingService =================
  var TrackingService = {
    sharing: false,
    watchId: null,
    wakeLock: null,
    lastSentAt: 0,
    lastSentPos: null,
    stoppedSince: 0,
    routeId: null,
    weakWarned: false,
    retryTimer: null,
    chipTimer: null,
    sessionDismissed: false,

    getIntent: function () {
      try { return localStorage.getItem(INTENT_KEY) === '1' ? 1 : 0; } catch (e) { return 0; }
    },
    setIntent: function (v) {
      try { localStorage.setItem(INTENT_KEY, v ? '1' : '0'); } catch (e) {}
    },
    consentGranted: function () {
      try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch (e) { return false; }
    },
    setConsentLocal: function (v) {
      try { localStorage.setItem(CONSENT_KEY, v ? '1' : '0'); } catch (e) {}
    },

    // Rota de hoje do motorista (planned/active, driverId = ele ou homônimo)
    findTodayRoute: function (user) {
      if (!hasSM() || !user) return null;
      var today = todayStr();
      var routes = StorageManager.getRoutes() || [];
      var ids = [String(user.id)];
      try {
        var all = (StorageManager.getDrivers() || []).concat(StorageManager.getUsers() || []);
        all.forEach(function (d) {
          if (d && d.name && user.name && String(d.name).trim().toLowerCase() === String(user.name).trim().toLowerCase()) {
            ids.push(String(d.id));
          }
        });
      } catch (e) {}
      for (var i = 0; i < routes.length; i++) {
        var r = routes[i];
        if (!r || !r.date) continue;
        if (String(r.date).slice(0, 10) !== today) continue;
        if (r.status !== 'planned' && r.status !== 'active') continue;
        if (ids.indexOf(String(r.driverId)) !== -1) return r;
      }
      return null;
    },

    // Chamado pelo checkAuth() pós-login, no boot com sessão e ao voltar pra aba
    onAuth: function (user) {
      if (!user) { this.stop('logout', true); this.hideAll(); return; }
      if (!isMotorista(user)) return; // ADM: nada a iniciar (só a camada do mapa, via polling)
      if (this.sharing) return;
      if (this.getIntent() === 1 && this.consentGranted()) {
        this.tryStart(user);
      } else if (!this.sessionDismissed) {
        this.showBanner();
      }
    },

    scheduleRetry: function () {
      var self = this;
      if (this.retryTimer) return;
      this.retryTimer = setTimeout(function () {
        self.retryTimer = null;
        if (self.sharing || self.getIntent() !== 1) return;
        var u = hasSM() ? StorageManager.getCurrentUser() : null;
        if (u && isMotorista(u) && self.consentGranted()) self.tryStart(u);
      }, RETRY_MS);
    },

    tryStart: function (user) {
      user = user || (hasSM() ? StorageManager.getCurrentUser() : null);
      if (!user || !isMotorista(user) || this.sharing) return false;
      if (this.getIntent() !== 1 || !this.consentGranted()) return false;
      if (!('geolocation' in navigator)) { trackToast('Este aparelho não tem GPS.'); return false; }
      var route = this.findTodayRoute(user);
      if (!route) { this.scheduleRetry(); return false; } // sem rota hoje: não inicia
      this.routeId = route.id;
      var self = this;
      try {
        this.watchId = navigator.geolocation.watchPosition(
          function (p) { self.onPos(p); },
          function (e) { self.onErr(e); },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
      } catch (e) { trackToast('Não foi possível ativar o GPS.'); return false; }
      this.sharing = true;
      this.lastSentAt = 0;
      this.requestWakeLock();
      this.showChip();
      this.hideBanner();
      if (hasSM()) StorageManager.setSharing(true).catch(function () {});
      return true;
    },

    onPos: function (pos) {
      if (!this.sharing || !pos || !pos.coords) return;
      var c = pos.coords;
      if (!isFinite(c.latitude) || !isFinite(c.longitude) || (c.latitude === 0 && c.longitude === 0)) return;
      if (c.accuracy && c.accuracy > MAX_ACCURACY) {
        if (!this.weakWarned) { this.weakWarned = true; trackToast('Sinal de GPS fraco — precisão acima de 100m, aguardando melhorar.'); }
        return;
      }
      var now = Date.now();
      var d = this.lastSentPos ? distM(this.lastSentPos.lat, this.lastSentPos.lng, c.latitude, c.longitude) : 9999;
      var speed = (c.speed !== null && c.speed !== undefined) ? Number(c.speed) : null;
      if (d < MIN_DIST_M && (speed === null || speed < 1)) {
        if (!this.stoppedSince) this.stoppedSince = now;
      } else {
        this.stoppedSince = 0;
      }
      var elapsed = now - this.lastSentAt;
      var economy = this.stoppedSince && (now - this.stoppedSince > STOPPED_MS);
      var due = (!this.lastSentAt) || d > MIN_DIST_M || elapsed >= (economy ? HEARTBEAT_MS : SEND_MS);
      if (!due) return;
      var self = this;
      var u = hasSM() ? StorageManager.getCurrentUser() : null;
      var r = (u && this.findTodayRoute(u)) || null;
      if (r) this.routeId = r.id;
      var payload = {
        lat: c.latitude, lng: c.longitude,
        accuracy: c.accuracy != null ? Math.round(c.accuracy) : null,
        speed: speed, heading: (c.heading !== null && c.heading !== undefined) ? Number(c.heading) : null,
        route_id: this.routeId
      };
      if (hasSM()) {
        StorageManager.sendDriverLocation(payload).then(function () {
          self.lastSentAt = Date.now();
          self.lastSentPos = { lat: c.latitude, lng: c.longitude };
        }).catch(function () {});
      }
    },

    onErr: function (e) {
      if (!this.sharing) return;
      if (e && e.code === 1) { // PERMISSION_DENIED
        this.revokeByPermission();
      } else if (e && e.code === 2) {
        trackToast('GPS indisponível no momento. Tentando novamente…');
      }
    },

    revokeByPermission: function () {
      this.stop('denied', true);
      this.setIntent(0);
      this.setConsentLocal(false);
      if (hasSM()) StorageManager.saveTrackConsent(false).catch(function () {});
      this.showBlocked();
    },

    stop: function (_reason, silent) {
      var was = this.sharing;
      if (this.watchId !== null) { try { navigator.geolocation.clearWatch(this.watchId); } catch (e) {} this.watchId = null; }
      this.releaseWakeLock();
      this.sharing = false;
      this.lastSentAt = 0;
      this.lastSentPos = null;
      this.stoppedSince = 0;
      this.hideChip();
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      if (was && hasSM()) {
        this.setIntent(0);
        StorageManager.setSharing(false).catch(function () {});
        if (!silent) trackToast('Compartilhamento de localização parado.');
      }
    },

    // ---- Wake Lock ----
    requestWakeLock: function () {
      if (!('wakeLock' in navigator)) return; // falha silenciosa sem suporte
      var self = this;
      try {
        navigator.wakeLock.request('screen').then(function (lock) {
          self.wakeLock = lock;
          lock.addEventListener('release', function () {
            self.wakeLock = null;
            if (self.sharing) self.requestWakeLock(); // re-tenta se ainda compartilhando
          });
        }).catch(function () {});
      } catch (e) {}
    },
    releaseWakeLock: function () {
      if (this.wakeLock) { try { this.wakeLock.release(); } catch (e) {} this.wakeLock = null; }
    },

    // ---- UI: banner / chip / modal ----
    showBanner: function () {
      if ($('lfTrackBanner') || this.sharing) return;
      var b = document.createElement('div');
      b.id = 'lfTrackBanner';
      b.innerHTML = '<span class="lf-b-ico">📍</span>' +
        '<span class="lf-b-txt">Ativar localização para o ADM acompanhar sua rota?</span>' +
        '<button class="lf-b-btn primary" id="lfBYes">Ativar</button>' +
        '<button class="lf-b-btn" id="lfBNo">Agora não</button>';
      document.body.appendChild(b);
      $('lfBYes').addEventListener('click', function () { TrackingService.flowActivate(); });
      $('lfBNo').addEventListener('click', function () {
        TrackingService.sessionDismissed = true;
        TrackingService.hideBanner();
      });
    },
    hideBanner: function () { var b = $('lfTrackBanner'); if (b) b.remove(); },
    showBlocked: function () {
      this.hideBanner();
      if ($('lfTrackBanner')) return;
      var b = document.createElement('div');
      b.id = 'lfTrackBanner';
      b.className = 'warn';
      b.innerHTML = '<span class="lf-b-ico">📍</span>' +
        '<span class="lf-b-txt"><strong>Localização bloqueada.</strong> Como ativar: cadeado ao lado do endereço &gt; Localização &gt; Permitir.</span>' +
        '<button class="lf-b-btn primary" id="lfBRe">Reativar</button>';
      document.body.appendChild(b);
      $('lfBRe').addEventListener('click', function () {
        TrackingService.hideBanner();
        TrackingService.flowActivate();
      });
    },
    hideAll: function () { this.hideBanner(); this.hideChip(); var m = $('lfTrackModal'); if (m) m.remove(); },

    flowActivate: function () {
      var self = this;
      if (!('geolocation' in navigator)) { trackToast('Este aparelho não tem GPS.'); return; }
      var proceed = function () { self.showConsent(); };
      try {
        if (navigator.permissions && navigator.permissions.query) {
          navigator.permissions.query({ name: 'geolocation' }).then(function (st) {
            if (st.state === 'denied') self.showBlocked();
            else proceed();
          }).catch(proceed);
        } else proceed();
      } catch (e) { proceed(); }
    },

    showConsent: function () {
      if ($('lfTrackModal')) return;
      var m = document.createElement('div');
      m.id = 'lfTrackModal';
      m.innerHTML = '<div class="lf-m-box">' +
        '<h3>📍 Compartilhar localização</h3>' +
        '<ul>' +
        '<li><strong>Finalidade:</strong> permitir que o ADM acompanhe sua posição <strong>somente durante a rota de hoje</strong>.</li>' +
        '<li><strong>Quando:</strong> apenas com o app aberto e a tela ligada. Fechou ou apagou, pausa sozinho.</li>' +
        '<li><strong>Retenção:</strong> guardamos só a <strong>última posição</strong> (sem histórico de 30 dias acumulado).</li>' +
        '<li><strong>Revogação:</strong> 1 clique em <strong>Parar</strong> no chip verde, a qualquer momento.</li>' +
        '</ul>' +
        '<div class="lf-m-actions">' +
        '<button class="lf-b-btn" id="lfMCancel">Fechar</button>' +
        '<button class="lf-b-btn primary" id="lfMOk">Concordo, compartilhar</button>' +
        '</div></div>';
      document.body.appendChild(m);
      $('lfMCancel').addEventListener('click', function () { m.remove(); });
      $('lfMOk').addEventListener('click', function () {
        m.remove();
        TrackingService.grantConsent();
      });
    },

    grantConsent: function () {
      var self = this;
      var done = function () {
        self.setConsentLocal(true);
        self.setIntent(1);
        self.sessionDismissed = false;
        var u = hasSM() ? StorageManager.getCurrentUser() : null;
        if (!self.tryStart(u)) {
          // Sem rota hoje: mantém intent/consent e avisa (auto-inicia quando houver rota)
          self.scheduleRetry();
          trackToast('Tudo certo! O compartilhamento inicia sozinho quando houver rota para você hoje.');
        }
      };
      if (hasSM()) StorageManager.saveTrackConsent(true).then(done).catch(done);
      else done();
    },

    showChip: function () {
      var chip = $('lfTrackChip');
      if (!chip) {
        chip = document.createElement('div');
        chip.id = 'lfTrackChip';
        chip.innerHTML = '<span class="lf-dot"></span><span id="lfChipTxt">Compartilhando</span>' +
          '<button id="lfChipStop">Parar</button>';
        document.body.appendChild(chip);
        $('lfChipStop').addEventListener('click', function () {
          TrackingService.stop('toggle');
          trackToast('Compartilhamento de localização parado.');
        });
      }
      chip.style.display = 'flex';
      var self = this;
      if (this.chipTimer) clearInterval(this.chipTimer);
      this.chipTimer = setInterval(function () { self.tickChip(); }, 5000);
      this.tickChip();
    },
    tickChip: function () {
      var t = $('lfChipTxt');
      if (!t) return;
      if (!this.sharing) { this.hideChip(); return; }
      t.textContent = 'Compartilhando • ' + agoText(this.lastSentAt || Date.now());
      // Sem rota hoje no meio do dia: para sozinho (RF5)
      if (hasSM()) {
        var u = StorageManager.getCurrentUser();
        if (u && isMotorista(u) && !this.findTodayRoute(u)) {
          this.stop('no-route');
          trackToast('Sem rota para hoje: compartilhamento parado.');
        }
      }
    },
    hideChip: function () {
      var c = $('lfTrackChip');
      if (c) c.style.display = 'none';
      if (this.chipTimer) { clearInterval(this.chipTimer); this.chipTimer = null; }
    }
  };

  // ================= ADM: camada Motoristas no mapa =================
  function currentUser() {
    try {
      if (typeof window.appPermissions !== 'undefined' && window.appPermissions && window.appPermissions.currentUser) {
        return window.appPermissions.currentUser;
      }
    } catch (e) {}
    return hasSM() ? StorageManager.getCurrentUser() : null;
  }
  function mapVisible() {
    var el = $('map');
    if (!el || el.style.display === 'none' || !el.offsetParent) return false;
    return true;
  }

  function extendMap() {
    if (typeof MapService === 'undefined' || MapService._trackExt) return;
    MapService._trackExt = true;
    MapService.driverMarkers = {};
    MapService.destMarkers = {};
    MapService.destLineIds = [];
    MapService.snapCache = {}; // id -> { lng, lat, rawLng, rawLat, at, retryAt }
    MapService.routeGeoCache = {}; // routeId -> geometry OSRM (trajeto âmbar)
    MapService.routeGeoFetch = {}; // routeId -> promise em andamento
    MapService.routeGeoError = {}; // routeId -> último erro OSRM
    MapService._lastLoc = {};  // id -> última loc crua (p/ drawer + seguir)
    MapService.hiddenDrivers = (function () {
      try { return JSON.parse(localStorage.getItem(HIDE_KEY) || '[]'); } catch (e) { return []; }
    })();
    MapService.followDriverId = (function () {
      try { return localStorage.getItem(FOLLOW_KEY) || ''; } catch (e) { return ''; }
    })();
    MapService.driverLayerOn = (function () {
      try { return localStorage.getItem(LAYER_KEY) !== '0'; } catch (e) { return true; }
    })();
    MapService._zoomHooked = false;

    // Foto do motorista: API (driver_photo) > cache drivers/users > avatar local > null (genérico)
    MapService.resolveDriverPhoto = function (loc) {
      if (loc && (loc.driver_photo || loc.photo)) return loc.driver_photo || loc.photo;
      var id = loc ? String(loc.driver_id) : '';
      try {
        if (hasSM()) {
          var d = StorageManager.getDrivers().filter(function (x) { return String(x.id) === id; })[0];
          if (d && d.photo) return d.photo;
          var u = StorageManager.getUsers().filter(function (x) { return String(x.id) === id; })[0];
          if (u && u.photo) return u.photo;
        }
      } catch (e) {}
      try {
        var av = localStorage.getItem('user_avatar_' + id);
        if (av) return av;
      } catch (e) {}
      return null;
    };

    MapService.buildDriverEl = function (name, photo, online) {
      var initial = (String(name || 'M').trim().charAt(0) || 'M').toUpperCase();
      var photoHtml = photo
        ? '<img class="dm-photo" src="' + photo + '" alt="">'
        : '<div class="dm-photo-fallback">' + escapeHtml(initial) + '</div>';
      return '<div class="driver-marker ' + (online ? 'online' : 'offline') + '">' +
        '<div class="dm-name">' + escapeHtml(String(name || 'Motorista').toUpperCase()) + '</div>' +
        '<div class="dm-balloon">' + photoHtml + '</div>' +
        '<div class="dm-car">🚚</div></div>';
    };

    // ===== Fase A: colar carro na pista (OSRM nearest + fallback GPS cru) =====
    MapService.getSnappedPos = function (id, lng, lat) {
      var c = this.snapCache[id];
      if (c && c.ok && isFinite(c.lng) && isFinite(c.lat)) return { lng: c.lng, lat: c.lat, snapped: true };
      return { lng: lng, lat: lat, snapped: false };
    };

    MapService.maybeSnapToRoad = function (id, lng, lat) {
      var self = this;
      var now = Date.now();
      var c = this.snapCache[id];
      if (c && c.rawLng !== undefined) {
        if (now < (c.retryAt || 0)) return; // falhou recente: espera o backoff
        var moved = distM(c.rawLat, c.rawLng, lat, lng);
        if (moved < SNAP_MIN_MOVE_M && (now - c.at) < SNAP_TTL_MS) return; // cache ainda vale
      }
      var url = 'https://router.project-osrm.org/nearest/v1/driving/' + lng + ',' + lat;
      try {
        fetch(url, { signal: AbortSignal.timeout(5000) }).then(function (r) {
          return r.json();
        }).then(function (data) {
          var wp = data && data.waypoints && data.waypoints[0];
          var p = wp && wp.location;
          if (p && isFinite(p[0]) && isFinite(p[1])) {
            // Coerência: só cola na via se ela estiver perto do GPS (evita pular p/ rua paralela errada)
            var jump = distM(lat, lng, p[1], p[0]);
            if (jump <= SNAP_MAX_JUMP_M) {
              self.snapCache[id] = { lng: p[0], lat: p[1], rawLng: lng, rawLat: lat, at: Date.now(), ok: true };
            } else {
              self.snapCache[id] = { lng: lng, lat: lat, rawLng: lng, rawLat: lat, at: Date.now(), ok: false };
            }
          } else {
            self.snapCache[id] = { lng: lng, lat: lat, rawLng: lng, rawLat: lat, at: Date.now(), ok: false };
          }
          self.applySnappedPos(id);
        }).catch(function () {
          // offline/falha: preserva último snap e tenta de novo em 5min
          var prev = self.snapCache[id];
          var keep = (prev && prev.ok && isFinite(prev.lng) && isFinite(prev.lat))
            ? { lng: prev.lng, lat: prev.lat, ok: true } : { lng: lng, lat: lat, ok: false };
          self.snapCache[id] = { lng: keep.lng, lat: keep.lat, rawLng: lng, rawLat: lat, at: Date.now(), retryAt: Date.now() + 5 * 60 * 1000, ok: keep.ok };
        });
      } catch (e) {}
    };

    // Reposiciona marcador + linha após o snap chegar (sem recriar nada)
    MapService.applySnappedPos = function (id) {
      var mk = this.driverMarkers[id];
      var loc = this._lastLoc[id];
      if (!mk || !loc) return;
      var p = this.getSnappedPos(id, Number(loc.lng), Number(loc.lat));
      try { mk.setLngLat([p.lng, p.lat]); } catch (e) {}
      var adj = {};
      for (var k in loc) adj[k] = loc[k];
      adj.lng = p.lng; adj.lat = p.lat;
      this.drawDriverDestinations(id, adj);
      if (String(this.followDriverId) === String(id) && this.map && mapVisible()) {
        try { this.map.easeTo({ center: [p.lng, p.lat] }); } catch (e) {}
      }
    };

    // ===== Chave on/off por motorista (gaveta) =====
    MapService.isDriverHidden = function (id) {
      return (this.hiddenDrivers || []).indexOf(String(id)) !== -1;
    };
    MapService.setDriverHidden = function (id, hide) {
      id = String(id);
      var arr = this.hiddenDrivers || [];
      var i = arr.indexOf(id);
      if (hide && i === -1) arr.push(id);
      if (!hide && i !== -1) arr.splice(i, 1);
      this.hiddenDrivers = arr;
      try { localStorage.setItem(HIDE_KEY, JSON.stringify(arr)); } catch (e) {}
      if (hide) {
        var mk = this.driverMarkers[id];
        if (mk) { try { mk.remove(); } catch (e) {} delete this.driverMarkers[id]; }
        var key = 'dest_' + id;
        if (this.destMarkers[key]) {
          this.destMarkers[key].forEach(function (m) { try { m.remove(); } catch (e) {} });
          delete this.destMarkers[key];
        }
        this.removeDriverLines(id);
        if (String(this.followDriverId) === id) this.setFollowDriver('');
      } else {
        var loc = this._lastLoc[id];
        if (loc) this.upsertDriverMarker(loc);
      }
      this.renderDriverDrawer();
    };
    MapService.setFollowDriver = function (id) {
      this.followDriverId = id ? String(id) : '';
      try { localStorage.setItem(FOLLOW_KEY, this.followDriverId); } catch (e) {}
      this.renderDriverDrawer();
    };

    MapService.toggleDriverDrawer = function (force) {
      this.ensureDriverDrawer();
      var d = $('lfDriverDrawer');
      if (!d) return;
      var open = (force !== undefined) ? !!force : d.style.display === 'none';
      d.style.display = open ? 'flex' : 'none';
      if (open) this.renderDriverDrawer();
    };

    MapService.ensureDriverDrawer = function () {
      if ($('lfDriverDrawer')) return;
      var self = this;
      var d = document.createElement('div');
      d.id = 'lfDriverDrawer';
      d.style.display = 'none';
      d.innerHTML =
        '<div class="lf-drawer-head">' +
          '<strong>🚚 Motoristas</strong>' +
          '<label class="lf-switch" title="Camada ON/OFF"><input type="checkbox" id="lfDriverGlobalSwitch"><span></span></label>' +
          '<button id="lfDrawerClose" title="Fechar">✕</button>' +
        '</div>' +
        '<div class="lf-drawer-sub">Toque no motorista para centralizar e seguir. A chave ao lado mostra/oculta ele no mapa.</div>' +
        '<div id="lfDriverDrawerList" class="lf-drawer-list"></div>';
      document.body.appendChild(d);
      $('lfDrawerClose').addEventListener('click', function () { self.toggleDriverDrawer(false); });
      var gsw = $('lfDriverGlobalSwitch');
      if (gsw) {
        gsw.checked = !!self.driverLayerOn;
        gsw.addEventListener('change', function () { self.setDriverLayer(gsw.checked); });
      }
    };

    MapService.renderDriverDrawer = function (rows) {
      var list = $('lfDriverDrawerList');
      if (!list) return;
      var self = this;
      if (!rows) {
        if (hasSM()) {
          StorageManager.getDriverLocations().then(function (r) { self.renderDriverDrawer(r || []); }).catch(function () {});
        }
        return;
      }
      rows = (rows || []).slice().sort(function (a, b) {
        return String(a.driver_name || '').localeCompare(String(b.driver_name || ''));
      });
      if (!rows.length) {
        list.innerHTML = '<div class="lf-drawer-empty">Nenhum motorista compartilhando.</div>';
        return;
      }
      list.innerHTML = '';
      rows.forEach(function (loc) {
        var id = String(loc.driver_id);
        var st = driverRowStatus(loc);
        var photo = self.resolveDriverPhoto(loc);
        var initial = (String(loc.driver_name || 'M').trim().charAt(0) || 'M').toUpperCase();
        var row = document.createElement('div');
        row.className = 'lf-drawer-row' + (String(self.followDriverId) === id ? ' following' : '') + (st.online ? '' : ' off');
        var photoHtml = photo
          ? '<img class="lf-drawer-photo" src="' + photo + '" alt="">'
          : '<div class="lf-drawer-photo fallback">' + escapeHtml(initial) + '</div>';
        row.innerHTML =
          '<div class="lf-drawer-info">' + photoHtml +
            '<div class="lf-drawer-txt"><strong>' + escapeHtml(loc.driver_name || 'Motorista') + '</strong>' +
            '<small>' + escapeHtml(loc.route_name || 'sem rota') + ' • ' + escapeHtml(st.txt) + '</small></div>' +
          '</div>' +
          '<label class="lf-switch" title="Mostrar/ocultar"><input type="checkbox"' + (self.isDriverHidden(id) ? '' : ' checked') + '><span></span></label>';
        row.addEventListener('click', function (e) {
          if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SPAN')) return;
          self.focusDriver(id);
        });
        var sw = row.querySelector('input');
        sw.addEventListener('change', function () { self.setDriverHidden(id, !sw.checked); });
        list.appendChild(row);
      });
    };

    // Centraliza de perto + mostra a rota dele + segue no GPS
    MapService.focusDriver = function (id) {
      id = String(id);
      var loc = this._lastLoc[id];
      if (!loc && hasSM()) {
        var self = this;
        StorageManager.getDriverLocations().then(function (rows) {
          var f = (rows || []).filter(function (l) { return String(l.driver_id) === id; })[0];
          if (f) { self._lastLoc[id] = f; self.focusDriver(id); }
        }).catch(function () {});
        return;
      }
      if (!loc || !this.map) return;
      if (this.isDriverHidden(id)) this.setDriverHidden(id, false);
      var p = this.getSnappedPos(id, Number(loc.lng), Number(loc.lat));
      this.setFollowDriver(id);
      try { this.map.flyTo({ center: [p.lng, p.lat], zoom: 15 }); } catch (e) {}
      var mk = this.driverMarkers[id];
      if (!mk) this.upsertDriverMarker(loc);
      mk = this.driverMarkers[id];
      if (mk) { try { mk.togglePopup(); } catch (e) {} }
      // garante a rota dele visível mesmo se o polling ainda não desenhou
      var adj = {};
      for (var k in loc) adj[k] = loc[k];
      adj.lng = p.lng; adj.lat = p.lat;
      this.drawDriverDestinations(id, adj);
    };

    // ===== Fase B: escala do marcador por zoom (regra anti-gigante) =====
    MapService.applyDriverScale = function () {
      if (!this.map) return;
      var z = 15;
      try { z = this.map.getZoom(); } catch (e) {}
      var s = 1, hideNames = false;
      if (z >= 16) s = 1;
      else if (z >= 15) s = 0.9;
      else if (z >= 14) s = 0.75;
      else if (z >= 13) s = 0.6;
      else if (z >= 12) s = 0.5;
      else { s = 0.4; hideNames = true; }
      try {
        var cont = this.map.getContainer();
        cont.style.setProperty('--dm-scale', String(s));
        if (hideNames) cont.classList.add('zoom-far');
        else cont.classList.remove('zoom-far');
      } catch (e) {}
    };
    MapService.hookDriverZoom = function () {
      if (this._zoomHooked || !this.map) return;
      this._zoomHooked = true;
      var self = this;
      try {
        this.map.on('zoom', function () { self.applyDriverScale(); });
        this.applyDriverScale();
      } catch (e) {}
    };

    MapService.setDriverLayer = function (on) {
      this.driverLayerOn = !!on;
      try { localStorage.setItem(LAYER_KEY, on ? '1' : '0'); } catch (e) {}
      if (!on) { this.clearDriverMarkers(); this.setFollowDriver(''); }
      else this.refreshDriverLayer();
      var sw = $('lfDriverGlobalSwitch');
      if (sw) sw.checked = !!on;
      this.renderDriverDrawer();
    };

    MapService.removeDestGroup = function (key) {
      var g = this.destMarkers[key];
      if (g) {
        g.forEach(function (m) { try { m.remove(); } catch (e) {} });
        delete this.destMarkers[key];
      }
    };
    MapService.clearDriverMarkers = function () {
      var self = this;
      Object.keys(this.driverMarkers).forEach(function (id) {
        try { self.driverMarkers[id].remove(); } catch (e) {}
      });
      this.driverMarkers = {};
      Object.keys(this.destMarkers || {}).forEach(function (key) {
        self.removeDestGroup(key);
      });
      this.destMarkers = {};
      // Remove linhas de trajeto/conector dos motoristas
      try {
        (this.destLineIds || []).forEach(function (o) {
          try {
            var layers = o.layers || (o.layer ? [o.layer] : []);
            layers.forEach(function (L) { if (self.map.getLayer(L)) self.map.removeLayer(L); });
            if (self.map.getSource(o.source)) self.map.removeSource(o.source);
          } catch (e) {}
        });
      } catch (e) {}
      this.destLineIds = [];
    };

    MapService.upsertDriverMarker = function (loc) {
      if (!this.map || !loc || !isFinite(Number(loc.lat)) || !isFinite(Number(loc.lng))) return;
      if (Number(loc.lat) === 0 && Number(loc.lng) === 0) return; // sem posição válida
      var id = String(loc.driver_id);
      this._lastLoc[id] = loc;
      if (this.isDriverHidden(id)) return; // chave off na gaveta: não desenha
      var rawLng = Number(loc.lng), rawLat = Number(loc.lat);
      var pos = this.getSnappedPos(id, rawLng, rawLat); // carro sempre na pista (ou cru em fallback)
      var updated = new Date(loc.updated_at).getTime();
      var online = !!loc.is_sharing && (Date.now() - updated < ONLINE_MS);
      var name = loc.driver_name || 'Motorista';
      var speedKmh = (loc.speed !== null && loc.speed !== undefined && isFinite(Number(loc.speed)))
        ? Math.round(Number(loc.speed) * 3.6) : null;
      var statusTxt = !loc.is_sharing ? 'compartilhamento pausado'
        : (online ? 'online • ' + agoText(loc.updated_at) : 'offline ' + agoText(loc.updated_at));
      var popupHtml = '<div class="lf-pop">' +
        '<strong>' + escapeHtml(name) + '</strong><br>' +
        'Rota: ' + escapeHtml(loc.route_name || '—') + '<br>' +
        'Vel: ' + (speedKmh !== null ? speedKmh + ' km/h' : '—') + ' • ' + statusTxt + '<br>' +
        (pos.snapped ? '<small>Posição ajustada à via</small><br>' : '') +
        '<button onclick="window._centerDriver(' + pos.lat + ',' + pos.lng + ')">Centralizar</button> ' +
        '<a href="https://www.google.com/maps?q=' + rawLat + ',' + rawLng + '" target="_blank" rel="noopener">GMaps</a>' +
        '</div>';

      var photo = this.resolveDriverPhoto(loc);
      var adj = {};
      for (var k in loc) adj[k] = loc[k];
      adj.lng = pos.lng; adj.lat = pos.lat;
      var mk = this.driverMarkers[id];
      if (mk) {
        var box = (mk.getElement ? mk.getElement() : null);
        // Legado (elemento raiz era o próprio .driver-marker): recria no formato wrapper
        if (box && box.classList && box.classList.contains('driver-marker')) {
          try { mk.remove(); } catch (e) {}
          delete this.driverMarkers[id];
          mk = null;
        }
      }
      if (mk) {
        try { mk.setLngLat([pos.lng, pos.lat]); } catch (e) {}
        if (mk.getElement) {
          var box2 = mk.getElement();
          var inner = box2.querySelector('.driver-marker');
          if (inner) inner.outerHTML = this.buildDriverEl(name, photo, online);
          else box2.innerHTML = this.buildDriverEl(name, photo, online);
        }
        if (mk.getPopup) { try { mk.getPopup().setHTML(popupHtml); } catch (e) {} }
        this.drawDriverDestinations(id, adj);
      } else {
        // Wrapper externo: o MapLibre posiciona/transforma ELE (inline);
        // a escala por zoom vive no .driver-marker filho (não é sobrescrita)
        var el = document.createElement('div');
        el.className = 'dm-wrap';
        el.innerHTML = this.buildDriverEl(name, photo, online);
        try {
          var marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([pos.lng, pos.lat])
            .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(popupHtml))
            .addTo(this.map);
          this.driverMarkers[id] = marker;
          this.drawDriverDestinations(id, adj);
        } catch (e) {}
      }
      // Tenta colar na pista em fundo (atualiza sozinho quando responder)
      this.maybeSnapToRoad(id, rawLng, rawLat);
      // Seguir no GPS: acompanha o motorista centralizado
      if (String(this.followDriverId) === id && this.map && mapVisible()) {
        try { this.map.easeTo({ center: [pos.lng, pos.lat] }); } catch (e) {}
      }
    };

    // Desenha todas as paradas da rota do motorista + bandeira na final + linha tracejada
    MapService.drawDriverDestinations = function (driverId, loc) {
      var self = this;
      if (!this.map || !hasSM()) return;
      var key = 'dest_' + String(driverId);
      // limpa anterior desse motorista
      this.removeDestGroup(key);
      this.destMarkers[key] = [];
      var routeId = loc && (loc.route_id || loc.routeId);
      if (!routeId) return;
      // Origem da rota: sempre visível quando existir (mesmo sem paradas)
      var route = null;
      try { route = StorageManager.getRoute(routeId); } catch (e) { route = null; }
      var origin = route && route.origin;
      var hasOrigin = origin && isFinite(Number(origin.lat)) && isFinite(Number(origin.lng)) &&
        !(Number(origin.lat) === 0 && Number(origin.lng) === 0);
      if (hasOrigin) this.drawRouteOrigin(key, origin, route);
      var stops = [];
      try { stops = StorageManager.getDeliveriesByRoute(routeId) || []; } catch (e) { stops = []; }
      var stopsValid = stops.filter(function (s) {
        return s && isFinite(Number(s.lat)) && isFinite(Number(s.lng)) && !(Number(s.lat) === 0 && Number(s.lng) === 0);
      }).sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
      stops = stopsValid;
      if (!stops.length) {
        // Sem paradas localizáveis: sem trajeto; avisa uma vez por rota
        this.removeDriverLines(driverId);
        this.warnNoStops(routeId, route);
        return;
      }
      var lineCoords = [[Number(loc.lng), Number(loc.lat)]];
      stops.forEach(function (s, i) {
        var isLast = i === stops.length - 1;
        var done = String(s.status || '').toLowerCase() === 'delivered';
        var el = document.createElement('div');
        el.className = 'dm-wrap';
        el.innerHTML = '<div class="dm-dest">' +
          '<div class="dm-dest-num' + (done ? ' done' : '') + '">' + (i + 1) + '</div>' +
          (isLast ? '<div class="dm-dest-flag">🏁</div>' : '') +
          '<div class="dm-dest-label">' + escapeHtml(isLast ? ('DESTINO: ' + (s.recipient || s.address || '')) : (s.recipient || s.address || '')) + '</div></div>';
        try {
          var m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([Number(s.lng), Number(s.lat)])
            .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(
              '<div class="lf-pop"><strong>Parada ' + (i + 1) + (isLast ? ' — DESTINO 🏁' : '') + '</strong><br>' +
              escapeHtml(s.recipient || '') + '<br>' + escapeHtml(s.address || '') + '</div>'
            ))
            .addTo(self.map);
          self.destMarkers[key].push(m);
        } catch (e) {}
        lineCoords.push([Number(s.lng), Number(s.lat)]);
      });
      // Trajeto destinado ao motorista em cor diferente (âmbar + contorno),
      // seguindo as ruas como na rota criada (Imagem 4). Fallback: conector reto.
      self.drawDriverRouteLine(driverId, routeId, lineCoords);
    };

    // Marcador da origem da rota do motorista (partida)
    MapService.drawRouteOrigin = function (key, origin, route) {
      var el = document.createElement('div');
      el.className = 'dm-wrap';
      el.innerHTML = '<div class="dm-dest">' +
        '<div class="dm-dest-num">🏠</div>' +
        '<div class="dm-dest-label">ORIGEM: ' + escapeHtml((route && route.name) || (origin.address || '')) + '</div></div>';
      try {
        var m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([Number(origin.lng), Number(origin.lat)])
          .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(
            '<div class="lf-pop"><strong>Origem da rota</strong><br>' +
            escapeHtml((route && route.name) || '') + '<br>' + escapeHtml(origin.address || '') + '</div>'
          ))
          .addTo(this.map);
        this.destMarkers[key].push(m);
      } catch (e) {}
    };

    // Aviso único por rota sem paradas localizáveis
    MapService.warnNoStops = function (routeId, route) {
      if (!this._warnedNoStops) this._warnedNoStops = {};
      if (this._warnedNoStops[routeId]) return;
      this._warnedNoStops[routeId] = true;
      trackToast('Rota "' + ((route && route.name) || 'do motorista') + '" sem paradas com localização — mostrando só a origem.');
    };

    // Remove todas as linhas (trajeto + conector) de um motorista
    MapService.removeDriverLines = function (driverId) {
      var self = this;
      var ids = [
        'lf-droute-case-' + driverId, 'lf-droute-main-' + driverId,
        'lf-dconn-' + driverId
      ];
      var srcs = ['lf-droute-src-' + driverId, 'lf-dconn-src-' + driverId];
      try {
        ids.forEach(function (L) { if (self.map.getLayer(L)) self.map.removeLayer(L); });
        srcs.forEach(function (S) { if (self.map.getSource(S)) self.map.removeSource(S); });
      } catch (e) {}
      this.destLineIds = (this.destLineIds || []).filter(function (o) {
        return ids.indexOf(o.layer) === -1 && (!o.layers || !o.layers.some(function (L) { return ids.indexOf(L) !== -1; }));
      });
    };

    MapService.trackDriverLine = function (sourceId, layers) {
      this.destLineIds = (this.destLineIds || []).filter(function (o) { return o.source !== sourceId; });
      this.destLineIds.push({ source: sourceId, layers: layers });
    };

    // Trajeto real origem -> paradas via OSRM (cache por rota); fallback reto
    MapService.drawDriverRouteLine = function (driverId, routeId, fallbackCoords) {
      var self = this;
      this.removeDriverLines(driverId);
      var cached = this.routeGeoCache && this.routeGeoCache[routeId];
      if (cached) {
        this.drawAmberRoute(driverId, cached);
        return;
      }
      // Mostra o conector reto até a geometria real chegar
      this.drawStraightConnector(driverId, fallbackCoords);
      if (this.routeGeoFetch && this.routeGeoFetch[routeId]) return; // já buscando
      var route = null, origin = null;
      try { route = hasSM() ? StorageManager.getRoute(routeId) : null; } catch (e) {}
      origin = route && route.origin;
      var stops = [];
      try { stops = hasSM() ? (StorageManager.getDeliveriesByRoute(routeId) || []) : []; } catch (e) {}
      stops = stops.filter(function (s) {
        return s && isFinite(Number(s.lat)) && isFinite(Number(s.lng)) && !(Number(s.lat) === 0 && Number(s.lng) === 0);
      }).sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
      if (!origin || !isFinite(Number(origin.lat)) || !isFinite(Number(origin.lng)) || !stops.length) return;
      var coords = [[Number(origin.lng), Number(origin.lat)]];
      stops.forEach(function (s) { coords.push([Number(s.lng), Number(s.lat)]); });
      var url = 'https://router.project-osrm.org/route/v1/driving/' +
        coords.map(function (c) { return c.join(','); }).join(';') +
        '?overview=full&geometries=geojson';
      if (!this.routeGeoFetch) this.routeGeoFetch = {};
      try {
        this.routeGeoFetch[routeId] = fetch(url, { signal: AbortSignal.timeout(8000) }).then(function (r) {
          return r.json();
        }).then(function (data) {
          delete self.routeGeoFetch[routeId];
          var g = data && data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].geometry;
          if (!self.routeGeoError) self.routeGeoError = {};
          if (g) {
            if (!self.routeGeoCache) self.routeGeoCache = {};
            self.routeGeoCache[routeId] = g;
            delete self.routeGeoError[routeId];
            // Só redesenha se o motorista ainda está no mapa
            if (self.driverMarkers[String(driverId)]) {
              self.removeDriverLines(driverId);
              self.drawAmberRoute(driverId, g);
            }
          } else {
            self.routeGeoError[routeId] = 'OSRM: ' + ((data && data.code) || 'sem geometria');
          }
        }).catch(function (err) {
          delete self.routeGeoFetch[routeId]; // mantém o conector reto
          if (!self.routeGeoError) self.routeGeoError = {};
          self.routeGeoError[routeId] = 'rede: ' + ((err && err.message) || err);
        });
      } catch (e) {}
    };

    // Trajeto em âmbar com contorno escuro (visível no mapa claro e escuro)
    MapService.drawAmberRoute = function (driverId, geometry) {
      var sourceId = 'lf-droute-src-' + driverId;
      var caseId = 'lf-droute-case-' + driverId;
      var mainId = 'lf-droute-main-' + driverId;
      try {
        this.removeDriverLines(driverId);
        this.map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: geometry }
        });
        this.map.addLayer({
          id: caseId, type: 'line', source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#111111', 'line-opacity': 0.9,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 7, 17, 9]
          }
        });
        this.map.addLayer({
          id: mainId, type: 'line', source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#FFB300', 'line-opacity': 0.95,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 4.5, 17, 6]
          }
        });
        this.trackDriverLine(sourceId, [caseId, mainId]);
      } catch (e) {}
    };

    // Conector reto motorista -> paradas (usado antes do OSRM responder ou sem origem)
    MapService.drawStraightConnector = function (driverId, lineCoords) {
      var sourceId = 'lf-dconn-src-' + driverId;
      var layerId = 'lf-dconn-' + driverId;
      try {
        this.map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lineCoords } }
        });
        this.map.addLayer({
          id: layerId, type: 'line', source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#111111',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 4, 17, 5],
            'line-dasharray': [1, 1.6],
            'line-opacity': 0.85
          }
        });
        this.trackDriverLine(sourceId, [layerId]);
      } catch (e) {}
    };

    MapService.refreshDriverLayer = function () {
      var self = this;
      if (!hasSM() || !this.map) return Promise.resolve();
      self.hookDriverZoom();
      self.ensureDriverDrawer();
      return StorageManager.getDriverLocations().then(function (rows) {
        if (!self.driverLayerOn) return;
        // remove destinos de motoristas que sumiram
        var seen = {};
        (rows || []).forEach(function (loc) { seen['dest_' + String(loc.driver_id)] = true; });
        Object.keys(self.destMarkers || {}).forEach(function (k) {
          if (!seen[k]) self.removeDestGroup(k);
        });
        (rows || []).forEach(function (loc) { self.upsertDriverMarker(loc); });
        var btn = $('lfDriverLayerBtn');
        if (btn) {
          var n = (rows || []).filter(function (l) { return l.is_sharing; }).length;
          btn.innerHTML = '🚚 Motoristas (' + n + ')';
        }
        self.renderDriverDrawer(rows);
      }).catch(function () {});
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window._centerDriver = function (lat, lng) {
    if (typeof MapService !== 'undefined' && MapService.map) {
      MapService.map.flyTo({ center: [Number(lng), Number(lat)], zoom: 15 });
    }
  };

  // Diagnóstico: estado do rastreio por motorista (abrir no console do navegador)
  window._driverDebug = function () {
    if (typeof MapService === 'undefined') return { error: 'sem MapService' };
    var out = {};
    var locs = MapService._lastLoc || {};
    Object.keys(locs).forEach(function (id) {
      var loc = locs[id] || {};
      var routeId = loc.route_id || loc.routeId;
      var stops = [];
      try { stops = hasSM() ? (StorageManager.getDeliveriesByRoute(routeId) || []) : []; } catch (e) {}
      var route = null;
      try { route = hasSM() ? StorageManager.getRoute(routeId) : null; } catch (e) {}
      out[id] = {
        nome: loc.driver_name,
        cru: [Number(loc.lng), Number(loc.lat)],
        snap: MapService.snapCache[id] || null,
        routeId: routeId,
        rota: (route && route.name) || loc.route_name,
        origem: route && route.origin,
        paradasTotal: stops.length,
        paradasValidas: stops.filter(function (s) {
          return s && isFinite(Number(s.lat)) && isFinite(Number(s.lng));
        }).length,
        geoEmCache: !!(MapService.routeGeoCache && MapService.routeGeoCache[routeId]),
        buscandoGeo: !!(MapService.routeGeoFetch && MapService.routeGeoFetch[routeId]),
        erroGeo: (MapService.routeGeoError && MapService.routeGeoError[routeId]) || null,
        oculto: MapService.isDriverHidden ? MapService.isDriverHidden(id) : null,
        seguindo: String(MapService.followDriverId) === String(id)
      };
    });
    return out;
  };

  function ensureLayerButton() {
    if ($('lfDriverLayerBtn')) return;
    var overlay = $('mapControlsOverlay');
    if (!overlay) return;
    var u = currentUser();
    if (!u || !isAdmin(u)) return;
    var btn = document.createElement('button');
    btn.id = 'lfDriverLayerBtn';
    btn.className = 'btn-icon theme-btn lf-layer-btn';
    btn.title = 'Motoristas no mapa';
    btn.innerHTML = '🚚 Motoristas';
    btn.addEventListener('click', function () {
      if (typeof MapService !== 'undefined' && MapService.toggleDriverDrawer) {
        MapService.toggleDriverDrawer();
      }
    });
    overlay.insertBefore(btn, overlay.firstChild);
    if (!MapService.driverLayerOn) btn.classList.add('off');
  }

  // ===== Fase C: gaveta de motoristas (lista + chave on/off + seguir) =====
  function driverRowStatus(loc) {
    var updated = new Date(loc.updated_at).getTime();
    var online = !!loc.is_sharing && (Date.now() - updated < ONLINE_MS);
    if (!loc.is_sharing) return { online: false, txt: 'pausado' };
    return { online: online, txt: (online ? 'online • ' : 'offline ') + agoText(loc.updated_at) };
  }

  // Polling ADM: 15s, só com mapa visível + admin + camada ON
  function admTick() {
    extendMap();
    ensureLayerButton();
    if (typeof MapService === 'undefined' || !MapService.map) return;
    var u = currentUser();
    if (!u || !isAdmin(u)) return;
    if (!MapService.driverLayerOn || !mapVisible()) return;
    MapService.refreshDriverLayer();
  }

  // ---- Boot ----
  function boot() {
    extendMap();
    if (hasSM()) {
      var u = StorageManager.getCurrentUser();
      if (u) TrackingService.onAuth(u);
    }
    // Auto-retoma ao voltar pra aba (qualquer tela) + wake lock de volta
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (TrackingService.sharing) TrackingService.requestWakeLock();
      if (hasSM()) {
        var u2 = StorageManager.getCurrentUser();
        if (u2) TrackingService.onAuth(u2);
      }
    });
    setInterval(admTick, POLL_ADM_MS);
    setTimeout(admTick, 5000);
  }

  window.TrackingService = TrackingService;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
